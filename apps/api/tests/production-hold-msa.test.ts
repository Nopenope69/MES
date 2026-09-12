import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import net from 'net';
import { app } from '../src/server';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { TokenManager } from '../src/security/jwt';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { FUJI_FRAMING } from '@mes/shared';
import { ProductionHoldService } from '../src/services/production-hold.service';
import { ComplianceLedgerService } from '../src/services/compliance-ledger.service';

describe('Mandatory Supervisor Acknowledgment (MSA) & Line Hold Suite (Task I-03 / Gate G-10)', () => {
  let server: http.Server;
  let baseUrl: string;
  let adapter: FujiNeximAdapter;
  const fujiPort = 30288;

  const tokens = {
    OPERATOR: TokenManager.generateAccessToken({
      sub: 'op-01',
      code: 'OP-01',
      name: 'Line Operator Alpha',
      role: 'OPERATOR',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    }),
    MAINTENANCE: TokenManager.generateAccessToken({
      sub: 'maint-01',
      code: 'MAINT-01',
      name: 'Tech Maintenance Beta',
      role: 'MAINTENANCE',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    }),
    SYSTEM_ADMIN: TokenManager.generateAccessToken({
      sub: 'admin-01',
      code: 'ADMIN-01',
      name: 'Global Administrator',
      role: 'SYSTEM_ADMIN',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    }),
    LINE_LEAD: TokenManager.generateAccessToken({
      sub: 'lead-01',
      code: 'LEAD-01',
      name: 'Line Lead Alpha',
      role: 'LINE_LEAD',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    }),
    QUALITY_LEAD: TokenManager.generateAccessToken({
      sub: 'qa-01',
      code: 'QA-01',
      name: 'Quality Lead Alpha',
      role: 'QUALITY_LEAD',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    })
  };

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    // Start Fuji adapter on test port
    adapter = new FujiNeximAdapter();
    adapter.setAllowedSubnets(['127.0.0.1/32']);
    adapter.startListener(fujiPort);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    adapter.stopListener();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function buildTestFrame(command: string, seqId: number, tokensArr: string[]): Buffer {
    const bodyStr = [command, seqId.toString(), ...tokensArr].join('\t');
    const bodyBuf = Buffer.from(bodyStr, 'utf-8');
    const totalLength = 1 + bodyBuf.length + 1;

    const frame = Buffer.alloc(FUJI_FRAMING.HEADER_SIZE + totalLength);
    frame.writeUInt32BE(totalLength, 0);
    frame[4] = FUJI_FRAMING.STX;
    bodyBuf.copy(frame, 5);
    frame[frame.length - 1] = FUJI_FRAMING.ETX;
    return frame;
  }

  it('1. Initial factory state: Line 01 is RUNNING with zero active holds', async () => {
    const res = await fetch(`${baseUrl}/api/v1/smt/hold/status?lineId=line-smt-01`, {
      headers: { Authorization: `Bearer ${tokens.LINE_LEAD}` }
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isHoldActive).toBe(false);
  });

  it('2. Trips production line hold: updates DB line and work center statuses', async () => {
    const tripRes = await fetch(`${baseUrl}/api/v1/smt/hold/trip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.LINE_LEAD}`
      },
      body: JSON.stringify({
        lineId: 'line-smt-01',
        workCenterId: 'wc-nxt-01',
        reason: 'Consecutive tombstone defects detected at AOI on C12',
        triggerDefect: {
          refDes: 'C12',
          defectType: 'TOMBSTONE',
          count: 3
        }
      })
    });

    expect(tripRes.status).toBe(201);
    const tripData = await tripRes.json();
    expect(tripData.success).toBe(true);
    expect(tripData.data.status).toBe('HOLD_ACTIVE');
    expect(tripData.data.lineId).toBe('line-smt-01');

    // Verify database line status is locked
    const db = getDatabase();
    const lineRows = await db.query<any>('SELECT status FROM production_lines WHERE id = ?', ['line-smt-01']);
    expect(lineRows[0].status).toBe('HOLD_ACTIVE');

    // Verify line work centers are in QUALITY_HOLD
    const wcRows = await db.query<any>('SELECT current_state FROM work_centers WHERE line_id = ?', ['line-smt-01']);
    expect(wcRows.every((wc: any) => wc.current_state === 'QUALITY_HOLD')).toBe(true);
  });

  it('3. Machine placement interlock rejects production while hold is active', async () => {
    const client = new net.Socket();
    await new Promise<void>((resolve) => client.connect(fujiPort, '127.0.0.1', resolve));

    const receivedAcks: Buffer[] = [];
    client.on('data', (chunk) => receivedAcks.push(chunk));

    const prodStartedFrame = buildTestFrame('PRODSTARTED', 501, [
      '20260908120000',
      'LINE01',
      'NXT01',
      '1',
      '1',
      'AUTO',
      'PROG-SM-METER-TOP-REV4',
      'PNL-REJECT-TEST'
    ]);

    client.write(prodStartedFrame);
    await new Promise((r) => setTimeout(r, 60));

    expect(receivedAcks.length).toBeGreaterThan(0);
    const combined = Buffer.concat(receivedAcks);
    const { frames } = FujiNeximAdapter.extractFrames(combined);
    expect(frames.length).toBeGreaterThan(0);

    const parsedAck = adapter.parseRawFrame(frames[0]);
    expect(parsedAck?.command).toBe('PRODSTARTED_ACK');
    expect(parsedAck?.tokens[2]).toBe('1'); // Result 1 = NG / REJECTED
    expect(parsedAck?.tokens[3]).toBe('HOLD_ACTIVE');

    client.destroy();
  });

  it('4. Enforces RBAC & SoD: rejects unauthenticated and unauthorized callers from acknowledging hold', async () => {
    // 4.1 Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/smt/hold/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineId: 'line-smt-01', acknowledgementReason: 'Test' })
    });
    expect(unauthRes.status).toBe(401);

    // 4.2 OPERATOR -> 403 Forbidden
    const opRes = await fetch(`${baseUrl}/api/v1/smt/hold/acknowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.OPERATOR}`
      },
      body: JSON.stringify({ lineId: 'line-smt-01', acknowledgementReason: 'Operator attempted clear' })
    });
    expect(opRes.status).toBe(403);

    // 4.3 MAINTENANCE -> 403 Forbidden
    const maintRes = await fetch(`${baseUrl}/api/v1/smt/hold/acknowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.MAINTENANCE}`
      },
      body: JSON.stringify({ lineId: 'line-smt-01', acknowledgementReason: 'Maintenance attempted clear' })
    });
    expect(maintRes.status).toBe(403);

    // 4.4 SYSTEM_ADMIN -> 403 Forbidden (Non-delegable Segregation of Duties!)
    const adminRes = await fetch(`${baseUrl}/api/v1/smt/hold/acknowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.SYSTEM_ADMIN}`
      },
      body: JSON.stringify({ lineId: 'line-smt-01', acknowledgementReason: 'Admin attempted clear' })
    });
    expect(adminRes.status).toBe(403);
  });

  it('5. Mandatory Supervisor Acknowledgment: LINE_LEAD clears hold with reason and Part 11 e-signature', async () => {
    const ackRes = await fetch(`${baseUrl}/api/v1/smt/hold/acknowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.LINE_LEAD}`
      },
      body: JSON.stringify({
        lineId: 'line-smt-01',
        acknowledgementReason: 'Replaced nozzle tip 104 and purged bad solder paste bead. Inspection verified clean.',
        digitalSignature: 'SIG-LEAD-20260912-VERIFIED'
      })
    });

    expect(ackRes.status).toBe(200);
    const ackData = await ackRes.json();
    expect(ackData.success).toBe(true);
    expect(ackData.data.status).toBe('ACKNOWLEDGED');
    expect(ackData.data.acknowledgedBy).toBe('LEAD-01');
    expect(ackData.data.acknowledgedRole).toBe('LINE_LEAD');

    // Verify DB line status restored to RUNNING
    const db = getDatabase();
    const lineRows = await db.query<any>('SELECT status FROM production_lines WHERE id = ?', ['line-smt-01']);
    expect(lineRows[0].status).toBe('RUNNING');

    // Verify work centers restored to RUNNING
    const wcRows = await db.query<any>('SELECT current_state FROM work_centers WHERE line_id = ?', ['line-smt-01']);
    expect(wcRows.every((wc: any) => wc.current_state === 'RUNNING')).toBe(true);

    // Verify 21 CFR Part 11 compliance audit ledger entry
    const ledgerRows = await db.query<any>(
      `SELECT * FROM compliance_audit_ledger 
       WHERE action_type = 'PRODUCTION_HOLD_ACKNOWLEDGED' AND entity_id = 'line-smt-01'
       ORDER BY sequence_number DESC LIMIT 1`
    );
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].actor_role).toBe('LINE_LEAD');
    expect(ledgerRows[0].current_hash).toBeDefined();

    // Verify audit ledger cryptographic integrity
    const ledgerValid = await ComplianceLedgerService.verifyLedgerIntegrity();
    expect(ledgerValid.valid).toBe(true);
  });

  it('6. SMT machine can resume production after supervisor acknowledgment', async () => {
    const client = new net.Socket();
    await new Promise<void>((resolve) => client.connect(fujiPort, '127.0.0.1', resolve));

    const receivedAcks: Buffer[] = [];
    client.on('data', (chunk) => receivedAcks.push(chunk));

    const prodStartedFrame = buildTestFrame('PRODSTARTED', 502, [
      '20260908120500',
      'LINE01',
      'NXT01',
      '1',
      '1',
      'AUTO',
      'PROG-SM-METER-TOP-REV4',
      'PNL-RESUME-OK'
    ]);

    client.write(prodStartedFrame);
    await new Promise((r) => setTimeout(r, 60));

    expect(receivedAcks.length).toBeGreaterThan(0);
    const combined = Buffer.concat(receivedAcks);
    const { frames } = FujiNeximAdapter.extractFrames(combined);
    expect(frames.length).toBeGreaterThan(0);

    const parsedAck = adapter.parseRawFrame(frames[0]);
    expect(parsedAck?.command).toBe('PRODSTARTED_ACK');
    expect(parsedAck?.tokens[2]).toBe('0'); // Success (0 = OK)

    client.destroy();
  });
});
