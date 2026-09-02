import { describe, it, expect, beforeAll } from 'vitest';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { FUJI_FRAMING, mapFujiStatusToCanonical } from '@mes/shared';
import { initDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';

describe('Fuji Nexim Adapter & SMT Interlock Engine', () => {
  const adapter = new FujiNeximAdapter();

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  it('should map Fuji machine states to canonical industrial states', () => {
    expect(mapFujiStatusToCanonical(5).state).toBe('RUNNING');
    expect(mapFujiStatusToCanonical(6).state).toBe('STOPPED_UNPLANNED');
    expect(mapFujiStatusToCanonical(2).state).toBe('CHANGEOVER');
    expect(mapFujiStatusToCanonical(3).state).toBe('IDLE');
    expect(mapFujiStatusToCanonical(8).state).toBe('STOPPED_PLANNED');
    expect(mapFujiStatusToCanonical(11).state).toBe('MAINTENANCE');
  });

  it('should correctly parse a binary Fuji TCP frame', () => {
    const bodyStr = 'MCSTATECHANGE\t55329\t20260903120000\tLINE01\tNXT01\t1\t5\t6';
    const bodyBuf = Buffer.from(bodyStr, 'utf-8');
    const totalLength = 1 + bodyBuf.length + 1;

    const frame = Buffer.alloc(FUJI_FRAMING.HEADER_SIZE + totalLength);
    frame.writeUInt32BE(totalLength, 0);
    frame[4] = FUJI_FRAMING.STX;
    bodyBuf.copy(frame, 5);
    frame[frame.length - 1] = FUJI_FRAMING.ETX;

    const parsed = adapter.parseRawFrame(frame);
    expect(parsed).not.toBeNull();
    expect(parsed?.command).toBe('MCSTATECHANGE');
    expect(parsed?.seqId).toBe(55329);
  });

  it('should generate a compliant ACK reply frame echoing Sequence ID', () => {
    const ackFrame = adapter.buildAckFrame('MCSTATECHANGE', 55329, true);
    
    expect(ackFrame.length).toBeGreaterThan(FUJI_FRAMING.HEADER_SIZE + 2);
    const totalLength = ackFrame.readUInt32BE(0);
    expect(ackFrame[4]).toBe(FUJI_FRAMING.STX);
    expect(ackFrame[ackFrame.length - 1]).toBe(FUJI_FRAMING.ETX);

    const body = ackFrame.toString('utf-8', 5, ackFrame.length - 1);
    expect(body).toBe('MCSTATECHANGE_ACK\t55329\t0');
  });

  it('should enforce Splicing Interlock: approve matching part, block mismatched part', async () => {
    // Slot 1 expects C0402-100NF-16V
    const approved = await adapter.verifySplicingInterlock(1, 'C0402-100NF-16V', 'wc-nxt-01');
    expect(approved).toBe(true);

    // Wrong part spliced at Slot 1 (e.g. 10k resistor into 100nF capacitor slot)
    const blocked = await adapter.verifySplicingInterlock(1, 'R0402-10K-1%', 'wc-nxt-01');
    expect(blocked).toBe(false);
  });
});
