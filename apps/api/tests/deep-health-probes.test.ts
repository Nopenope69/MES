import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { app } from '../src/server';
import { initDatabase } from '../src/db/database';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { setFujiAdapterForHealth } from '../src/routes/health.router';

describe('Deep Health Check Probes & Authenticated Metrics Suite (Stage 5 / O-01 & O-03)', () => {
  let server: http.Server;
  let baseUrl: string;
  let adapter: FujiNeximAdapter;
  const fujiPort = 30899;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = ':memory:';
    await initDatabase();

    // Start test HTTP server on ephemeral port
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Start Fuji adapter on dedicated test port and wire to health probe
    adapter = new FujiNeximAdapter();
    adapter.startListener(fujiPort);
    setFujiAdapterForHealth(adapter);
  });

  afterAll(async () => {
    setFujiAdapterForHealth(null);
    await adapter.stopListener();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. Root /health probe: reports UP database status, latency, pool, memory, and replication', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('HEALTHY');
    expect(data.system).toBe('Antigravity SMT MES Engine');
    expect(data.checks).toBeDefined();

    // Database check
    expect(data.checks.database).toBeDefined();
    expect(data.checks.database.status).toBe('UP');
    expect(data.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(data.checks.database.dialect).toBeDefined();

    // OT Machine Gateway check
    expect(data.checks.fujiOtGateway).toBeDefined();
    expect(data.checks.fujiOtGateway.status).toBe('UP');
    expect(data.checks.fujiOtGateway.isListening).toBe(true);
    expect(data.checks.fujiOtGateway.port).toBe(fujiPort);

    // Memory check
    expect(data.checks.memory).toBeDefined();
    expect(data.checks.memory.heapUsedMb).toBeGreaterThan(0);
    expect(data.checks.memory.rssMb).toBeGreaterThan(0);

    // Replication check
    expect(data.checks.replication).toBeDefined();
    expect(data.checks.replication.status).toBe('SYNCHRONOUS_IN_PARITY');
  });

  it('2. Deep Readiness /health/ready probe: responds 200 with full subsystem status', async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('HEALTHY');
    expect(data.checks.database.status).toBe('UP');
    expect(data.checks.fujiOtGateway.status).toBe('UP');
  });

  it('3. Fast Liveness /health/live probe: responds 200 with minimal payload', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('UP');
    expect(data.timestamp).toBeDefined();
  });

  it('4. Authenticated Metrics /metrics: enforces Prometheus token when PROMETHEUS_METRICS_KEY is set', async () => {
    const testSecret = 'prom-secure-telemetry-token-2026';
    process.env.PROMETHEUS_METRICS_KEY = testSecret;

    try {
      // 4.1 Unauthenticated request should be rejected with 401
      const unauthRes = await fetch(`${baseUrl}/metrics`);
      expect(unauthRes.status).toBe(401);
      const unauthData = await unauthRes.json();
      expect(unauthData.error).toBe('UNAUTHORIZED');

      // 4.2 Request with invalid token should be rejected with 401
      const badTokenRes = await fetch(`${baseUrl}/metrics`, {
        headers: { 'Authorization': 'Bearer wrong-token' }
      });
      expect(badTokenRes.status).toBe(401);

      // 4.3 Request with valid Bearer token should succeed with 200 and Prometheus format
      const validBearerRes = await fetch(`${baseUrl}/metrics`, {
        headers: { 'Authorization': `Bearer ${testSecret}` }
      });
      expect(validBearerRes.status).toBe(200);
      const bearerText = await validBearerRes.text();
      expect(bearerText).toContain('# HELP');

      // 4.4 Request with valid X-API-Key should also succeed with 200
      const validApiKeyRes = await fetch(`${baseUrl}/metrics`, {
        headers: { 'x-api-key': testSecret }
      });
      expect(validApiKeyRes.status).toBe(200);
      const apiKeyText = await validApiKeyRes.text();
      expect(apiKeyText).toContain('# HELP');
    } finally {
      delete process.env.PROMETHEUS_METRICS_KEY;
    }
  });
});
