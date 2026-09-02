import { describe, it, expect, beforeAll } from 'vitest';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { FUJI_FRAMING, mapFujiStatusToCanonical } from '@mes/shared';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { EventIngestionService } from '../src/services/event-ingestion.service';

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

  it('should safely return null on corrupted or truncated binary frames', () => {
    // Too short for header
    expect(adapter.parseRawFrame(Buffer.from([0x00, 0x01]))).toBeNull();

    // Invalid STX
    const badStx = Buffer.from([0x00, 0x00, 0x00, 0x03, 0xFF, 0x41, 0x03]);
    expect(adapter.parseRawFrame(badStx)).toBeNull();

    // Declared length exceeds available buffer
    const truncated = Buffer.alloc(8);
    truncated.writeUInt32BE(100, 0); // claims 100 bytes
    truncated[4] = FUJI_FRAMING.STX;
    expect(adapter.parseRawFrame(truncated)).toBeNull();
  });

  it('should parse command tokens into named fields according to Fuji spec', () => {
    // MCSTATECHANGE
    const mcTokens = ['MCSTATECHANGE', '101', '20260903120000', 'LINE01', 'NXT01', '1', '3', '5'];
    const mcFields = adapter.parseCommandTokens('MCSTATECHANGE', mcTokens);
    expect(mcFields.previousStatus).toBe(3);
    expect(mcFields.currentStatus).toBe(5);

    // PRODCOMPLETEII
    const pcTokens = ['PRODCOMPLETEII', '102', '20260903120018', 'LINE01', 'NXT01', '1', '1', '0', 'PROG-TEST', '123456', '4', '0', '0', '18.42'];
    const pcFields = adapter.parseCommandTokens('PRODCOMPLETEII', pcTokens);
    expect(pcFields.panelNo).toBe('123456');
    expect(pcFields.cycleTime).toBe('18.42');
    expect(pcFields.blockCount).toBe('4');

    // PDERROR
    const errTokens = ['PDERROR', '103', '20260903120020', 'LINE01', 'NXT01', '1', '1', '3', 'FEEDER-3', 'C0402-100NF-16V', 'NOZZLE-02', 'HEAD-01', 'E04', 'S01'];
    const errFields = adapter.parseCommandTokens('PDERROR', errTokens);
    expect(errFields.slotNo).toBe('3');
    expect(errFields.nozzleId).toBe('NOZZLE-02');
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

  it('should auto-infer active batch on work center when PANEL_CHECKOUT is ingested', async () => {
    const db = getDatabase();
    const activeBatchBefore = await db.query("SELECT id, actual_quantity FROM batches WHERE id = 'job-01'");
    const initialQty = activeBatchBefore[0].actual_quantity;

    // Ingest PANEL_CHECKOUT without explicit batchId
    const res = await EventIngestionService.ingest({
      eventType: 'PANEL_CHECKOUT',
      workCenterId: 'wc-nxt-01',
      sourceType: 'INTEGRATION_SOCKET',
      sourceId: 'fuji-nxt01',
      payload: {
        panelBarcode: 'PNL-DEBUG-001',
        programName: 'PROG-SM-METER-TOP-REV4',
        cycleTimeSeconds: 18.2,
        blockCount: 4,
        blockSkipCount: 0
      }
    });

    expect(res.success).toBe(true);

    const activeBatchAfter = await db.query("SELECT actual_quantity FROM batches WHERE id = 'job-01'");
    expect(activeBatchAfter[0].actual_quantity).toBe(initialQty + 1);
  });
});
