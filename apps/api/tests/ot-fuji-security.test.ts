import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'net';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { FUJI_FRAMING } from '@mes/shared';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';

function buildFujiFrame(command: string, seqId: number, fields: string[] = []): Buffer {
  const body = [command, seqId.toString(), ...fields].join('\t');
  const bodyBuf = Buffer.from(body, 'utf-8');
  const totalLength = 1 + bodyBuf.length + 1; // STX (1 byte) + body + ETX (1 byte)

  const frame = Buffer.alloc(FUJI_FRAMING.HEADER_SIZE + totalLength);
  frame.writeUInt32BE(totalLength, 0);
  frame[4] = FUJI_FRAMING.STX;
  bodyBuf.copy(frame, 5);
  frame[frame.length - 1] = FUJI_FRAMING.ETX;
  return frame;
}

describe('OT Fuji Gateway Security & Protocol Suite (Task 7)', () => {
  let adapter: FujiNeximAdapter;
  const basePort = 30250;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  afterAll(() => {
    if (adapter) {
      adapter.stop();
    }
  });

  it('drops connection immediately when incoming frame header declares length exceeding 64KB DoS limit (totalLength > 65536)', async () => {
    const port = basePort;
    adapter = new FujiNeximAdapter();
    adapter.startListener(port, 'wc-nxt-01');

    await new Promise((r) => setTimeout(r, 50));

    const client = net.createConnection({ port, host: '127.0.0.1' });
    client.on('error', () => {}); // Absorb ECONNRESET on intentional server teardown
    await new Promise((r) => client.on('connect', r));

    const closePromise = new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });

    // 4-byte header declaring 65537 bytes (> 64KB limit)
    const dosHeader = Buffer.alloc(4);
    dosHeader.writeUInt32BE(65537, 0);
    client.write(dosHeader);

    const closed = await closePromise;
    expect(closed).toBe(true);

    client.destroy();
    adapter.stop();
  });

  it('drops connection immediately when incoming frame declares length underflow (totalLength < 2)', async () => {
    const port = basePort + 1;
    adapter = new FujiNeximAdapter();
    adapter.startListener(port, 'wc-nxt-01');

    await new Promise((r) => setTimeout(r, 50));

    const client = net.createConnection({ port, host: '127.0.0.1' });
    client.on('error', () => {});
    await new Promise((r) => client.on('connect', r));

    const closePromise = new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });

    // 4-byte header declaring 1 byte (< 2 bytes min for STX+ETX)
    const underflowHeader = Buffer.alloc(4);
    underflowHeader.writeUInt32BE(1, 0);
    client.write(underflowHeader);

    const closed = await closePromise;
    expect(closed).toBe(true);

    client.destroy();
    adapter.stop();
  });

  it('disconnects socket immediately when sync header is corrupt (byte 4 != STX 0x02)', async () => {
    const port = basePort + 2;
    adapter = new FujiNeximAdapter();
    adapter.startListener(port, 'wc-nxt-01');

    await new Promise((r) => setTimeout(r, 50));

    const client = net.createConnection({ port, host: '127.0.0.1' });
    client.on('error', () => {});
    await new Promise((r) => client.on('connect', r));

    const closePromise = new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });

    // 5 bytes: valid declared length (10), but byte 4 is 0xAA instead of STX 0x02
    const corruptSyncFrame = Buffer.alloc(5);
    corruptSyncFrame.writeUInt32BE(10, 0);
    corruptSyncFrame[4] = 0xAA; // Corrupt sync byte
    client.write(corruptSyncFrame);

    const closed = await closePromise;
    expect(closed).toBe(true);

    client.destroy();
    adapter.stop();
  });

  it('disconnects socket immediately when accumulator chunk exceeds 64KB overflow guard', async () => {
    const port = basePort + 3;
    adapter = new FujiNeximAdapter();
    adapter.startListener(port, 'wc-nxt-01');

    await new Promise((r) => setTimeout(r, 50));

    const client = net.createConnection({ port, host: '127.0.0.1' });
    client.on('error', () => {});
    await new Promise((r) => client.on('connect', r));

    const closePromise = new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });

    // Massive chunk > 64KB (65537 bytes) with valid declared length so accumulator overflow guard specifically triggers
    const overflowChunk = Buffer.alloc(65537, 0x00);
    overflowChunk.writeUInt32BE(10, 0);
    overflowChunk[4] = FUJI_FRAMING.STX;
    client.write(overflowChunk);

    const closed = await closePromise;
    expect(closed).toBe(true);

    client.destroy();
    adapter.stop();
  });

  it('closes socket on 30s idle timeout', async () => {
    // Verify default idle timeout constant is 30 seconds (30000 ms)
    expect(FujiNeximAdapter.IDLE_TIMEOUT_MS).toBe(30000);

    const port = basePort + 4;
    adapter = new FujiNeximAdapter();
    expect(adapter.getIdleTimeout()).toBe(30000);

    // Set a fast test timeout (100ms) to test actual timeout event handling without waiting 30 seconds
    adapter.setIdleTimeout(100);
    expect(adapter.getIdleTimeout()).toBe(100);

    adapter.startListener(port, 'wc-nxt-01');

    await new Promise((r) => setTimeout(r, 50));

    const client = net.createConnection({ port, host: '127.0.0.1' });
    client.on('error', () => {});
    await new Promise((r) => client.on('connect', r));

    const closePromise = new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });

    // Do not send any data; client should be closed by server timeout within ~100ms
    const closed = await closePromise;
    expect(closed).toBe(true);

    client.destroy();
    adapter.stop();
  });

  it('maintains strict compatibility with standard Fuji Nexim frame layout and processes valid multi-frame streams seamlessly', async () => {
    const port = basePort + 5;
    adapter = new FujiNeximAdapter();
    adapter.startListener(port, 'wc-nxt-01');

    await new Promise((r) => setTimeout(r, 50));

    const client = net.createConnection({ port, host: '127.0.0.1' });
    client.on('error', () => {});
    await new Promise((r) => client.on('connect', r));

    // Prepare 4 canonical Fuji Nexim protocol frames:
    // 1. SETEV (protocol handshake)
    const f1 = buildFujiFrame('SETEV', 2001, ['NXT01']);
    // 2. KEEPALIVE (liveness heartbeat)
    const f2 = buildFujiFrame('KEEPALIVE', 2002);
    // 3. LOADCOMP (splicing & part load interlock with valid feeder slot 1 and part)
    const f3 = buildFujiFrame('LOADCOMP', 2003, [
      '20260909120000',
      'LINE01',
      'NXT01',
      '1', // moduleNo
      '1', // stageNo
      '1', // slotNo
      '0', // subSlotNo
      'FID-W08F-01', // feederId
      'C0402-100NF-16V', // partNo
      'REEL-NEW-001', // newReelId
      'LOT-01', // lotNo
      '5000' // quantity
    ]);
    // 4. PRODSTARTED (board entry check-in)
    const f4 = buildFujiFrame('PRODSTARTED', 2004, [
      '20260909120001',
      'LINE01',
      'NXT01',
      '1', // moduleNo
      '1', // laneNo
      '0', // productMode
      'PROG-SM-METER', // programName
      '998877' // panelNo
    ]);

    // Accumulate all received ACK responses
    let receivedBuffer = Buffer.alloc(0);
    const acksExpected = 4;

    const allAcksPromise = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for multi-frame ACKs')), 4000);
      client.on('data', (data: Buffer) => {
        receivedBuffer = Buffer.concat([receivedBuffer, data]);
        const { frames } = FujiNeximAdapter.extractFrames(receivedBuffer);
        if (frames.length >= acksExpected) {
          clearTimeout(timeout);
          resolve(receivedBuffer);
        }
      });
    });

    // Send all 4 frames in a single coalesced TCP stream
    const coalescedStream = Buffer.concat([f1, f2, f3, f4]);
    client.write(coalescedStream);

    const receivedAcks = await allAcksPromise;
    const { frames: ackFrames } = FujiNeximAdapter.extractFrames(receivedAcks);
    expect(ackFrames.length).toBe(4);

    // Verify SETEV_ACK
    const ack1 = adapter.parseRawFrame(ackFrames[0]);
    expect(ack1?.command).toBe('SETEV_ACK');
    expect(ack1?.seqId).toBe(2001);
    expect(ack1?.tokens[2]).toBe('0'); // Success status

    // Verify KEEPALIVE_ACK
    const ack2 = adapter.parseRawFrame(ackFrames[1]);
    expect(ack2?.command).toBe('KEEPALIVE_ACK');
    expect(ack2?.seqId).toBe(2002);
    expect(ack2?.tokens[2]).toBe('0');

    // Verify LOADCOMP_ACK
    const ack3 = adapter.parseRawFrame(ackFrames[2]);
    expect(ack3?.command).toBe('LOADCOMP_ACK');
    expect(ack3?.seqId).toBe(2003);
    expect(ack3?.tokens[2]).toBe('0');

    // Verify PRODSTARTED_ACK
    const ack4 = adapter.parseRawFrame(ackFrames[3]);
    expect(ack4?.command).toBe('PRODSTARTED_ACK');
    expect(ack4?.seqId).toBe(2004);
    expect(ack4?.tokens[2]).toBe('0');

    // Verify adapter status metrics
    const status = adapter.getStatus();
    expect(status.framesProcessedTotal).toBeGreaterThanOrEqual(4);

    // Verify raw ingress event preservation in database
    const db = getDatabase();
    const ingressRows = await db.query(
      "SELECT id, source_adapter, protocol, processed_status FROM ingress_events WHERE source_adapter = 'FUJI_NEXIM' ORDER BY received_at DESC LIMIT 4"
    );
    expect(ingressRows.length).toBe(4);
    for (const row of ingressRows) {
      expect(row.protocol).toBe('TCP_ASCII_STX_ETX');
      expect(row.processed_status).toBe('PROCESSED');
    }

    client.destroy();
    adapter.stop();
  });
});
