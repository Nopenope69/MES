import net from 'net';
import {
  FUJI_FRAMING,
  FujiCommand,
  IFactoryIntegrationAdapter,
  mapFujiStatusToCanonical,
  MesEventEnvelope
} from '@mes/shared';
import { EventIngestionService } from '../services/event-ingestion.service';
import { SmtInterlockService } from '../services/smt-interlock.service';
import { getDatabase } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * Production Fuji Nexim TCP Socket Gateway.
 * Implements the Fuji Host Interface Specification V2.8.0.
 * Decodes Big-Endian length + STX (0x02) / ETX (0x03) packets.
 * Includes stream frame accumulator for fragmented/coalesced TCP packets.
 * Includes closed-loop Splicing Verification Interlock (ADR-003 decoupled).
 */
export class FujiNeximAdapter implements IFactoryIntegrationAdapter {
  readonly adapterId = 'FujiNeximAdapter';
  readonly adapterName = 'FujiNeximAdapter';
  readonly sourceType = 'INTEGRATION_SOCKET';
  private server: net.Server | null = null;
  private isRunning = false;

  /**
   * Streaming TCP Frame Extractor.
   * Handles arbitrary packet segmentation, chunk fragmentation, and packet coalescing.
   * Extracts all complete STX/ETX frames from the buffer and returns them alongside the unconsumed remainder.
   */
  public static extractFrames(buffer: Buffer): { frames: Buffer[]; remainder: Buffer } {
    const frames: Buffer[] = [];
    let offset = 0;

    while (buffer.length - offset >= FUJI_FRAMING.HEADER_SIZE + 2) {
      const totalLength = buffer.readUInt32BE(offset);
      const fullFrameSize = FUJI_FRAMING.HEADER_SIZE + totalLength;

      // Sanity check: totalLength must be reasonable (e.g. <= 65536 bytes) and at least 2 bytes (STX+ETX)
      if (totalLength < 2 || totalLength > 65536) {
        // Corrupted length header: scan forward by 1 byte to re-synchronize
        offset += 1;
        continue;
      }

      if (buffer.length - offset < fullFrameSize) {
        // Incomplete frame; wait for additional TCP chunks
        break;
      }

      const stx = buffer[offset + FUJI_FRAMING.HEADER_SIZE];
      const etx = buffer[offset + fullFrameSize - 1];

      if (stx === FUJI_FRAMING.STX && etx === FUJI_FRAMING.ETX) {
        // Complete, valid frame
        frames.push(buffer.subarray(offset, offset + fullFrameSize));
        offset += fullFrameSize;
      } else {
        // Corrupted frame boundary: scan forward by 1 byte to find next valid STX header
        offset += 1;
      }
    }

    return {
      frames,
      remainder: buffer.subarray(offset)
    };
  }

  public parseRawFrame(buffer: Buffer): { command: FujiCommand; seqId: number; payloadRaw: string; tokens: string[] } | null {
    if (buffer.length < FUJI_FRAMING.HEADER_SIZE + 2) return null;

    const totalLength = buffer.readUInt32BE(0);
    if (buffer.length < FUJI_FRAMING.HEADER_SIZE + totalLength) return null;

    const stx = buffer[FUJI_FRAMING.HEADER_SIZE];
    const etx = buffer[FUJI_FRAMING.HEADER_SIZE + totalLength - 1];
    if (stx !== FUJI_FRAMING.STX || etx !== FUJI_FRAMING.ETX) return null;

    const bodyStr = buffer.toString('utf-8', FUJI_FRAMING.HEADER_SIZE + 1, FUJI_FRAMING.HEADER_SIZE + totalLength - 1);
    const tokens = bodyStr.split('\t');
    if (tokens.length < 2) return null;

    const command = tokens[0] as FujiCommand;
    const seqId = parseInt(tokens[1], 10) || 0;
    const payloadRaw = tokens.slice(2).join('\t');

    return { command, seqId, payloadRaw, tokens };
  }

  public toCanonicalEvent(
    command: FujiCommand,
    seqId: number,
    parsedData: Record<string, any>,
    workCenterId: string
  ): MesEventEnvelope | null {
    const now = new Date().toISOString();

    switch (command) {
      case 'MCSTATECHANGE': {
        const canonical = mapFujiStatusToCanonical(parsedData.currentStatus);
        return {
          eventId: uuidv4(),
          eventType: 'STATE_CHANGED',
          eventTime: parsedData.time || now,
          receivedTime: now,
          sourceType: 'INTEGRATION_SOCKET',
          sourceId: `fuji-${parsedData.machineName || 'nxt'}`,
          sequenceId: seqId,
          siteId: 'SITE-NOIDA-P4',
          workCenterId,
          payload: {
            previousState: mapFujiStatusToCanonical(parsedData.previousStatus).state,
            currentState: canonical.state,
            reasonCategory: canonical.reasonCategory,
            reasonCode: canonical.reasonCode,
            comment: `Fuji Machine State Transition: ${parsedData.previousStatus} -> ${parsedData.currentStatus}`
          }
        };
      }

      case 'PRODSTARTED': {
        return {
          eventId: uuidv4(),
          eventType: 'PANEL_CHECKIN',
          eventTime: parsedData.time || now,
          receivedTime: now,
          sourceType: 'INTEGRATION_SOCKET',
          sourceId: `fuji-${parsedData.machineName || 'nxt'}`,
          sequenceId: seqId,
          siteId: 'SITE-NOIDA-P4',
          workCenterId,
          payload: {
            panelBarcode: parsedData.panelNo ? `PNL-${parsedData.panelNo}` : 'PNL-AUTO',
            programName: parsedData.programName || 'UNKNOWN',
            cycleTimeSeconds: 0,
            blockCount: 1,
            blockSkipCount: 0
          }
        };
      }

      case 'PRODCOMPLETEII': {
        return {
          eventId: uuidv4(),
          eventType: 'PANEL_CHECKOUT',
          eventTime: parsedData.time || now,
          receivedTime: now,
          sourceType: 'INTEGRATION_SOCKET',
          sourceId: `fuji-${parsedData.machineName || 'nxt'}`,
          sequenceId: seqId,
          siteId: 'SITE-NOIDA-P4',
          workCenterId,
          payload: {
            panelBarcode: parsedData.panelNo ? `PNL-${parsedData.panelNo}` : `PNL-SEQ-${seqId}`,
            programName: parsedData.programName,
            moduleNo: parseInt(parsedData.moduleNo || '1', 10),
            laneNo: parseInt(parsedData.laneNo || '1', 10),
            cycleTimeSeconds: parseFloat(parsedData.cycleTime || '18.2'),
            blockCount: parseInt(parsedData.blockCount || '4', 10),
            blockSkipCount: parseInt(parsedData.blockSkipCount || '0', 10),
            skipBitmask: parsedData.bsInfoBit || '0x00'
          }
        };
      }

      case 'CHANGECOMP':
      case 'CHANGECOMPII':
      case 'LOADCOMP':
      case 'LOADCOMPIV': {
        return {
          eventId: uuidv4(),
          eventType: 'REEL_SPLICED',
          eventTime: parsedData.time || now,
          receivedTime: now,
          sourceType: 'INTEGRATION_SOCKET',
          sourceId: `fuji-${parsedData.machineName || 'nxt'}`,
          sequenceId: seqId,
          siteId: 'SITE-NOIDA-P4',
          workCenterId,
          payload: {
            slotNo: parseInt(parsedData.slotNo || '1', 10),
            moduleNo: parseInt(parsedData.moduleNo || '1', 10),
            stageNo: parseInt(parsedData.stageNo || '1', 10),
            feederId: parsedData.feederId || 'FID-W08F-01',
            partNumber: parsedData.partNo || '',
            oldReelId: parsedData.oldReelId || 'REEL-OLD',
            newReelId: parsedData.newReelId || 'REEL-NEW',
            newReelLotNumber: parsedData.lotNo || 'LOT-AUTO',
            newReelVendor: 'Supplier',
            newReelQuantity: parseInt(parsedData.quantity || '10000', 10),
            mslRemainingMinutes: 999999
          }
        };
      }

      case 'PDERROR': {
        return {
          eventId: uuidv4(),
          eventType: 'PICK_ERROR_RECORDED',
          eventTime: parsedData.time || now,
          receivedTime: now,
          sourceType: 'INTEGRATION_SOCKET',
          sourceId: `fuji-${parsedData.machineName || 'nxt'}`,
          sequenceId: seqId,
          siteId: 'SITE-NOIDA-P4',
          workCenterId,
          payload: {
            moduleNo: parseInt(parsedData.moduleNo || '1', 10),
            stageNo: parseInt(parsedData.stageNo || '1', 10),
            slotNo: parseInt(parsedData.slotNo || '1', 10),
            partNumber: parsedData.partNo || 'UNKNOWN-PART',
            feederId: parsedData.feederId || 'FEEDER-01',
            nozzleId: parsedData.nozzleId || 'NOZZLE-01',
            headId: parsedData.headId || 'HEAD-01',
            errorType: 'VISION_ERROR',
            errorCode: parsedData.errorCode,
            subErrorCode: parsedData.subErrorCode
          }
        };
      }

      default:
        return null;
    }
  }

  public buildAckFrame(command: FujiCommand, seqId: number, resultOk: boolean, extraFields: string[] = []): Buffer {
    const ackCommand = `${command}_ACK`;
    const resultCode = resultOk ? '0' : '1';
    const bodyParts = [ackCommand, seqId.toString(), resultCode, ...extraFields];
    const bodyStr = bodyParts.join('\t');

    const bodyBuffer = Buffer.from(bodyStr, 'utf-8');
    const totalLength = 1 + bodyBuffer.length + 1; // STX + body + ETX

    const frame = Buffer.alloc(FUJI_FRAMING.HEADER_SIZE + totalLength);
    frame.writeUInt32BE(totalLength, 0);
    frame[4] = FUJI_FRAMING.STX;
    bodyBuffer.copy(frame, 5);
    frame[frame.length - 1] = FUJI_FRAMING.ETX;

    return frame;
  }

  /**
   * Splicing verification interlock (ADR-003 Decoupled).
   * Delegates domain validation to SmtInterlockService with zero SQL knowledge in the adapter.
   */
  public async verifySplicingInterlock(slotNo: number, partNumber: string, workCenterId: string): Promise<boolean> {
    const decision = await SmtInterlockService.verifyFeederSplice(workCenterId, slotNo, partNumber);
    return decision.allowed;
  }

  public parseCommandTokens(command: FujiCommand, tokens: string[]): Record<string, any> {
    const data: Record<string, any> = {};

    switch (command) {
      case 'MCSTATECHANGE':
        data.time = tokens[2];
        data.lineName = tokens[3];
        data.machineName = tokens[4];
        data.moduleNo = tokens[5];
        data.previousStatus = parseInt(tokens[6], 10);
        data.currentStatus = parseInt(tokens[7], 10);
        break;

      case 'PRODSTARTED':
        data.time = tokens[2];
        data.lineName = tokens[3];
        data.machineName = tokens[4];
        data.moduleNo = tokens[5];
        data.laneNo = tokens[6];
        data.productMode = tokens[7];
        data.programName = tokens[8];
        data.panelNo = tokens[9];
        break;

      case 'PRODCOMPLETEII':
        data.time = tokens[2];
        data.lineName = tokens[3];
        data.machineName = tokens[4];
        data.moduleNo = tokens[5];
        data.laneNo = tokens[6];
        data.productMode = tokens[7];
        data.programName = tokens[8];
        data.panelNo = tokens[9];
        data.blockCount = tokens[10];
        data.blockSkipCount = tokens[11];
        data.bsInfoBit = tokens[12];
        data.cycleTime = tokens[13];
        break;

      case 'LOADCOMP':
      case 'LOADCOMPIV':
        data.time = tokens[2];
        data.lineName = tokens[3];
        data.machineName = tokens[4];
        data.moduleNo = tokens[5];
        data.stageNo = tokens[6];
        data.slotNo = tokens[7];
        data.subSlotNo = tokens[8];
        data.feederId = tokens[9];
        data.partNo = tokens[10];
        data.newReelId = tokens[11];
        data.lotNo = tokens[12];
        data.quantity = tokens[13];
        break;

      case 'CHANGECOMP':
      case 'CHANGECOMPII':
        data.time = tokens[2];
        data.lineName = tokens[3];
        data.machineName = tokens[4];
        if (tokens.length >= 13) {
          // tokens[6]=numList, tokens[7]=subSeq, tokens[8]=slotNo, tokens[9]=partNo, tokens[10]=feederId
          data.slotNo = tokens[8];
          data.partNo = tokens[9];
          data.feederId = tokens[10];
          data.oldReelId = tokens[11];
          data.newReelId = tokens[12];
          data.quantity = tokens[13];
        } else {
          data.slotNo = tokens[6] || '1';
          data.partNo = tokens[7] || '';
          data.feederId = tokens[8] || 'FID-W08F-01';
          data.oldReelId = tokens[9] || 'REEL-OLD';
          data.newReelId = tokens[10] || 'REEL-NEW';
          data.quantity = tokens[11] || '10000';
        }
        break;

      case 'PDERROR':
        data.time = tokens[2];
        data.lineName = tokens[3];
        data.machineName = tokens[4];
        data.moduleNo = tokens[5];
        data.stageNo = tokens[6];
        data.slotNo = tokens[7];
        data.feederId = tokens[8];
        data.partNo = tokens[9];
        data.nozzleId = tokens[10];
        data.headId = tokens[11];
        data.errorCode = tokens[12];
        data.subErrorCode = tokens[13];
        break;
    }

    return data;
  }

  /**
   * Processes a single extracted frame with BLOB preservation and decoupled interlock checking.
   */
  public async processSingleFrame(socket: net.Socket, frame: Buffer, workCenterId: string): Promise<void> {
    const db = getDatabase();
    const ingressId = uuidv4();
    const decodedPayload = frame.toString('utf-8');

    // Tier 1 Ingress: Preserve verbatim raw bytes as BLOB + decoded text
    await db.execute(`
      INSERT INTO ingress_events (
        id, source_adapter, source_address, protocol, raw_payload, decoded_payload, processed_status
      ) VALUES (?, ?, ?, 'TCP_ASCII_STX_ETX', ?, ?, 'PROCESSED')
    `, [
      ingressId,
      'FUJI_NEXIM',
      `${socket.remoteAddress || '127.0.0.1'}:${socket.remotePort || 0}`,
      frame,
      decodedPayload
    ]);

    const parsed = this.parseRawFrame(frame);
    if (!parsed) return;

    // Handle Heartbeat Liveness (120s / 30s)
    if (parsed.command === 'KEEPALIVE') {
      socket.write(this.buildAckFrame('KEEPALIVE', parsed.seqId, true));
      return;
    }

    // Handle Protocol Start Handshake
    if (parsed.command === 'SETEV') {
      socket.write(this.buildAckFrame('SETEV', parsed.seqId, true, ['NXT01']));
      return;
    }
    if (parsed.command === 'STARTEV') {
      socket.write(this.buildAckFrame('STARTEV', parsed.seqId, true, ['NXT01']));
      return;
    }

    const fields = this.parseCommandTokens(parsed.command, parsed.tokens);

    // Splicing & Part Load Interlock (Decoupled domain call per ADR-003)
    if (parsed.command === 'LOADCOMP' || parsed.command === 'LOADCOMPIV' || parsed.command === 'CHANGECOMP' || parsed.command === 'CHANGECOMPII') {
      const slotNo = parseInt(fields.slotNo || parsed.tokens[8] || parsed.tokens[3] || '1', 10);
      const partNo = fields.partNo || parsed.tokens[9] || parsed.tokens[4] || '';

      const decision = await SmtInterlockService.verifyFeederSplice(workCenterId, slotNo, partNo);
      if (!decision.allowed) {
        console.warn(`[Fuji Gateway] SPLICING INTERLOCK BLOCKED: Slot ${slotNo} expected ${decision.expectedPartNumber}, received ${partNo}. Halting feeder!`);
        socket.write(this.buildAckFrame(parsed.command, parsed.seqId, false)); // Result = 1 (NG)
        return;
      }
    }

    // Project Canonical Event
    const canonical = this.toCanonicalEvent(parsed.command, parsed.seqId, fields, workCenterId);
    if (canonical) {
      canonical.ingressEventId = ingressId;
      await EventIngestionService.ingest(canonical);
    }

    // Respond OK ACK
    socket.write(this.buildAckFrame(parsed.command, parsed.seqId, true));
  }

  public startListener(port = 30040, workCenterId = 'wc-nxt-01'): void {
    if (this.isRunning) return;

    this.server = net.createServer((socket) => {
      console.log(`[Fuji Gateway] SMT Machine connected from ${socket.remoteAddress}:${socket.remotePort}`);

      let socketBuffer = Buffer.alloc(0);

      socket.on('data', async (chunk: Buffer) => {
        socketBuffer = Buffer.concat([socketBuffer, chunk]);

        const { frames, remainder } = FujiNeximAdapter.extractFrames(socketBuffer);
        socketBuffer = Buffer.from(remainder);

        for (const frame of frames) {
          await this.processSingleFrame(socket, frame, workCenterId);
        }
      });

      socket.on('close', () => {
        socketBuffer = Buffer.alloc(0);
        console.log('[Fuji Gateway] SMT Machine disconnected.');
      });

      socket.on('error', (err) => {
        console.error('[Fuji Gateway] Socket error:', err.message);
      });
    });

    this.server.listen(port, () => {
      console.log(`[Fuji Gateway] TCP Listener active on port ${port} (Ready for Fuji NXT/AIMEX Central Server)`);
      this.isRunning = true;
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.isRunning = false;
    }
  }
}
