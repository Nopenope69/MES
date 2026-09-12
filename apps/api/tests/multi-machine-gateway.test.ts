import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'net';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { FUJI_FRAMING } from '@mes/shared';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';

describe('Multi-Machine Gateway Mapping Suite (Task I-02 / Gate G-10)', () => {
  let adapter: FujiNeximAdapter;
  const testPort = 30199;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    adapter = new FujiNeximAdapter();
    adapter.setAllowedSubnets(['127.0.0.1/32', '192.168.10.0/24', '10.0.0.0/8']);

    // Register multi-machine configurations
    adapter.registerMachineMapping({
      machineId: 'NXT01',
      workCenterId: 'wc-nxt-01',
      lineId: 'line-smt-01',
      ipAddress: '192.168.10.42'
    });

    adapter.registerMachineMapping({
      machineId: 'NXT02',
      workCenterId: 'wc-nxt-02',
      lineId: 'line-smt-02',
      ipAddress: '192.168.10.43'
    });

    adapter.registerMachineMapping({
      machineId: 'AIMEX01',
      workCenterId: 'wc-nxt-01',
      lineId: 'line-smt-01'
    });

    adapter.startListener(testPort);
  });

  afterAll(() => {
    adapter.stopListener();
  });

  function buildTestFrame(command: string, seqId: number, tokens: string[]): Buffer {
    const bodyStr = [command, seqId.toString(), ...tokens].join('\t');
    const bodyBuf = Buffer.from(bodyStr, 'utf-8');
    const totalLength = 1 + bodyBuf.length + 1;

    const frame = Buffer.alloc(FUJI_FRAMING.HEADER_SIZE + totalLength);
    frame.writeUInt32BE(totalLength, 0);
    frame[4] = FUJI_FRAMING.STX;
    bodyBuf.copy(frame, 5);
    frame[frame.length - 1] = FUJI_FRAMING.ETX;
    return frame;
  }

  it('correctly reports pre-registered machines in registry', () => {
    const machines = adapter.getRegisteredMachines();
    const machineIds = machines.map((m) => m.machineId);
    expect(machineIds).toContain('NXT01');
    expect(machineIds).toContain('NXT02');
    expect(machineIds).toContain('AIMEX01');
  });

  it('dynamically resolves machine context by machine identifier', () => {
    const nxt1 = adapter.resolveMachineContext('127.0.0.1', 'NXT01');
    expect(nxt1.machineId).toBe('NXT01');
    expect(nxt1.workCenterId).toBe('wc-nxt-01');
    expect(nxt1.lineId).toBe('line-smt-01');

    const nxt2 = adapter.resolveMachineContext('127.0.0.1', 'NXT02');
    expect(nxt2.machineId).toBe('NXT02');
    expect(nxt2.workCenterId).toBe('wc-nxt-02');
    expect(nxt2.lineId).toBe('line-smt-02');
  });

  it('dynamically resolves machine context by client IP', () => {
    const resIp1 = adapter.resolveMachineContext('192.168.10.42');
    expect(resIp1.workCenterId).toBe('wc-nxt-01');

    const resIp2 = adapter.resolveMachineContext('192.168.10.43');
    expect(resIp2.workCenterId).toBe('wc-nxt-02');
  });

  it('handshake SETEV/STARTEV dynamically replies with machine ID instead of hardcoded NXT01', async () => {
    const client = new net.Socket();
    await new Promise<void>((resolve) => client.connect(testPort, '127.0.0.1', resolve));

    const receivedAcks: Buffer[] = [];
    client.on('data', (chunk) => {
      receivedAcks.push(chunk);
    });

    // 1. Send SETEV with machine identifier NXT02
    const setevFrame = buildTestFrame('SETEV', 101, ['NXT02']);
    client.write(setevFrame);

    await new Promise((r) => setTimeout(r, 60));

    expect(receivedAcks.length).toBeGreaterThan(0);
    const combined = Buffer.concat(receivedAcks);
    const { frames } = FujiNeximAdapter.extractFrames(combined);
    expect(frames.length).toBeGreaterThan(0);

    const parsedAck = adapter.parseRawFrame(frames[0]);
    expect(parsedAck?.command).toBe('SETEV_ACK');
    expect(parsedAck?.tokens[2]).toBe('0'); // Success
    expect(parsedAck?.tokens[3]).toBe('NXT02'); // Dynamically returned NXT02, NOT hardcoded NXT01!

    client.destroy();
  });

  it('attaches incoming production events to the dynamically mapped work center', async () => {
    const client = new net.Socket();
    await new Promise<void>((resolve) => client.connect(testPort, '127.0.0.1', resolve));

    const testSeq = 99201;
    const prodStartedFrame = buildTestFrame('PRODSTARTED', testSeq, [
      '20260908120000',
      'LINE02',
      'NXT02', // Machine Name
      '1', // Module
      '1', // Lane
      'AUTO',
      'PROG-AUTO-ECU-TOP-REV1',
      'PNL-MULTI-NXT2-001'
    ]);

    client.write(prodStartedFrame);
    await new Promise((r) => setTimeout(r, 80));

    // Verify canonical event in database
    const db = getDatabase();
    const rows = await db.query<any>(
      `SELECT * FROM production_events 
       WHERE sequence_id = ? AND event_type = 'PANEL_CHECKIN'`,
      [testSeq]
    );

    expect(rows.length).toBe(1);
    expect(rows[0].work_center_id).toBe('wc-nxt-02'); // Attributed to Line 2 work center, not hardcoded wc-nxt-01!
    expect(rows[0].source_id).toBe('fuji-NXT02');

    client.destroy();
  });
});
