import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../src/server';
import { initDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import http from 'http';

describe('End-to-End HTTP API Endpoints Test Suite', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('GET /health returns 200 and healthy status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('HEALTHY');
    expect(data.system).toBe('Antigravity SMT MES Engine');
  });

  it('GET /api/v1/work-centers returns SMT line work centers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/work-centers`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data.some((wc: any) => wc.id === 'wc-nxt-01')).toBe(true);
  });

  it('GET /api/v1/work-centers/:id/timeline returns equipment state history', async () => {
    const res = await fetch(`${baseUrl}/api/v1/work-centers/wc-nxt-01/timeline`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/batches returns active SMT jobs', async () => {
    const res = await fetch(`${baseUrl}/api/v1/batches`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((b: any) => b.batch_number === 'JOB-SM-260901')).toBe(true);
  });

  it('GET /api/v1/batches/:id returns single batch details', async () => {
    const res = await fetch(`${baseUrl}/api/v1/batches/job-01`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe('job-01');
    expect(data.product_code).toBe('PRD-SM-4G-V2');
  });

  it('GET /api/v1/events returns canonical event stream', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events?limit=5`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/v1/reports/shift-summary returns OEE metrics', async () => {
    const res = await fetch(`${baseUrl}/api/v1/reports/shift-summary?workCenterId=wc-nxt-01`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.shiftCode).toBeDefined();
    expect(data.availabilityPercentage).toBeGreaterThanOrEqual(0);
    expect(data.qualityPercentage).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/v1/smt/feeders returns physical cassette rack mappings', async () => {
    const res = await fetch(`${baseUrl}/api/v1/smt/feeders?workCenterId=wc-nxt-01`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(5); // Slots 1 to 5
    expect(data[0].slot_no).toBe(1);
    expect(data[0].assigned_part_number).toBe('C0402-100NF-16V');
  });

  it('POST /api/v1/smt/splice-verify approves matching reel barcode', async () => {
    const res = await fetch(`${baseUrl}/api/v1/smt/splice-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotNo: 1,
        scannedPartNumber: 'C0402-100NF-16V',
        scannedReelId: 'REEL-MUR-98125-NEW',
        workCenterId: 'wc-nxt-01'
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(data.decision).toBe('APPROVED');
    expect(data.machineAction).toBe('ENGAGE_FEEDER_PICKUP');
  });

  it('POST /api/v1/smt/splice-verify blocks mismatched reel barcode (Interlock Trip)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/smt/splice-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotNo: 1,
        scannedPartNumber: 'R0402-10K-1%', // Resistor into Capacitor slot!
        scannedReelId: 'REEL-VISH-WRONG',
        workCenterId: 'wc-nxt-01'
      })
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.decision).toBe('BLOCKED_MISMATCH');
    expect(data.machineAction).toBe('INTERLOCK_TRIPPED_HALT_FEEDER');
  });

  it('GET /api/v1/smt/pick-errors returns feeder pickup error Pareto', async () => {
    const res = await fetch(`${baseUrl}/api/v1/smt/pick-errors?workCenterId=wc-nxt-01`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].error_type).toBeDefined();
  });

  it('GET /api/v1/genealogy/lot/:lotNumber returns traceability tree', async () => {
    const res = await fetch(`${baseUrl}/api/v1/genealogy/lot/LOT-MUR-202608`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rootNodeId).toBeDefined();
    expect(data.nodes.length).toBeGreaterThan(0);
  });
});
