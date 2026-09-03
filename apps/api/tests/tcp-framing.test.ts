import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'net';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { FUJI_FRAMING } from '@mes/shared';
import { initDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';

function buildRequestFrame(command: string, seqId: number, fields: string[] = []): Buffer {
  const bodyStr = [command, seqId.toString(), ...fields].join('\t');
  const bodyBuf = Buffer.from(bodyStr, 'utf-8');
  const totalLen = 1 + bodyBuf.length + 1; // STX + body + ETX

  const frame = Buffer.alloc(FUJI_FRAMING.HEADER_SIZE + totalLen);
  frame.writeUInt32BE(totalLen, 0);
  frame[4] = FUJI_FRAMING.STX;
  bodyBuf.copy(frame, 5);
  frame[frame.length - 1] = FUJI_FRAMING.ETX;
  return frame;
}

describe('TCP Stream Framing Accumulator & Fragmentation Suite', () => {
  const adapter = new FujiNeximAdapter();

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  it('FujiNeximAdapter.extractFrames handles a single complete frame', () => {
    const frame = buildRequestFrame('KEEPALIVE', 101);
    const { frames, remainder } = FujiNeximAdapter.extractFrames(frame);

    expect(frames.length).toBe(1);
    expect(remainder.length).toBe(0);
    expect(frames[0]).toEqual(frame);
  });

  it('FujiNeximAdapter.extractFrames handles an incomplete/split frame', () => {
    const frame = buildRequestFrame('SETEV', 202, ['NXT01']);
    // Split frame into half
    const half1 = frame.subarray(0, 10);
    const { frames: frames1, remainder: rem1 } = FujiNeximAdapter.extractFrames(half1);

    expect(frames1.length).toBe(0);
    expect(rem1.length).toBe(10);

    // Now arrive remaining half
    const half2 = frame.subarray(10);
    const combined = Buffer.concat([rem1, half2]);
    const { frames: frames2, remainder: rem2 } = FujiNeximAdapter.extractFrames(combined);

    expect(frames2.length).toBe(1);
    expect(rem2.length).toBe(0);
    expect(frames2[0]).toEqual(frame);
  });

  it('FujiNeximAdapter.extractFrames handles coalesced frames in a single chunk', () => {
    const f1 = buildRequestFrame('KEEPALIVE', 1);
    const f2 = buildRequestFrame('SETEV', 2, ['NXT01']);
    const f3 = buildRequestFrame('STARTEV', 3, ['NXT01']);

    const coalesced = Buffer.concat([f1, f2, f3]);
    const { frames, remainder } = FujiNeximAdapter.extractFrames(coalesced);

    expect(frames.length).toBe(3);
    expect(remainder.length).toBe(0);
    expect(frames[0]).toEqual(f1);
    expect(frames[1]).toEqual(f2);
    expect(frames[2]).toEqual(f3);
  });

  it('FujiNeximAdapter.extractFrames handles coalesced frames + trailing fragment', () => {
    const f1 = buildRequestFrame('KEEPALIVE', 1);
    const f2 = buildRequestFrame('SETEV', 2, ['NXT01']);
    const f3 = buildRequestFrame('STARTEV', 3, ['NXT01']);

    // Take f1 + f2 + first 8 bytes of f3
    const chunk1 = Buffer.concat([f1, f2, f3.subarray(0, 8)]);
    const { frames: r1Frames, remainder: r1Rem } = FujiNeximAdapter.extractFrames(chunk1);

    expect(r1Frames.length).toBe(2);
    expect(r1Rem.length).toBe(8);
    expect(r1Frames[0]).toEqual(f1);
    expect(r1Frames[1]).toEqual(f2);

    // Second chunk delivers rest of f3
    const chunk2 = Buffer.concat([r1Rem, f3.subarray(8)]);
    const { frames: r2Frames, remainder: r2Rem } = FujiNeximAdapter.extractFrames(chunk2);

    expect(r2Frames.length).toBe(1);
    expect(r2Rem.length).toBe(0);
    expect(r2Frames[0]).toEqual(f3);
  });

  it('Live Socket Test: handles fragmented frame across delayed network chunks without drops', async () => {
    const testPort = 30141;
    const testAdapter = new FujiNeximAdapter();
    testAdapter.startListener(testPort, 'wc-nxt-01');

    await new Promise((r) => setTimeout(r, 100));

    const client = net.createConnection({ port: testPort, host: '127.0.0.1' });

    // Build a KEEPALIVE frame
    const frame = buildRequestFrame('KEEPALIVE', 888);

    const ackReceived = new Promise<Buffer>((resolve) => {
      client.on('data', (ackData) => {
        resolve(ackData);
      });
    });

    // Send in 3 tiny pieces with 15ms delays
    client.write(frame.subarray(0, 4));
    await new Promise((r) => setTimeout(r, 15));
    client.write(frame.subarray(4, 10));
    await new Promise((r) => setTimeout(r, 15));
    client.write(frame.subarray(10));

    const ack = await ackReceived;
    expect(ack.length).toBeGreaterThan(0);

    // Verify ACK frame contains KEEPALIVE_ACK
    const parsedAck = testAdapter.parseRawFrame(ack);
    expect(parsedAck).not.toBeNull();
    expect(parsedAck?.command).toBe('KEEPALIVE_ACK');
    expect(parsedAck?.seqId).toBe(888);

    client.destroy();
    testAdapter.stop();
  });
});
