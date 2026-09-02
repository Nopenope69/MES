import net from 'net';
import {
  FUJI_FRAMING,
  FujiCommand,
  IFactoryIntegrationAdapter,
  mapFujiStatusToCanonical,
  MesEventEnvelope
} from '@mes/shared';
import { EventIngestionService } from '../services/event-ingestion.service';
import { getDatabase } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * Production Fuji Nexim TCP Socket Gateway.
 * Implements the Fuji Host Interface Specification V2.8.0.
 * Decodes Big-Endian length + STX (0x02) / ETX (0x03) packets.
 * Includes closed-loop Splicing Verification Interlock (rejects mismatched reels with Result=1).
 */
export class FujiNeximAdapter implements IFactoryIntegrationAdapter {
  readonly adapterId = 'FujiNeximAdapter';
  readonly adapterName = 'FujiNeximAdapter';
  readonly sourceType = 'INTEGRATION_SOCKET';
  private server: net.Server | null = null;
  private isRunning = false;

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
            programName: parsedData.programName || 'PROG-SM-METER-TOP-REV4',
            cycleTimeSeconds: 0,
            blockCount: 1,
            blockSkipCount: 0
          }
        };
      }

      case 'PRODCOMPLETED':
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
            panelBarcode: parsedData.panelNo ? `PNL-${parsedData.panelNo}` : `PNL-${Date.now().toString().slice(-6)}`,
            programName: parsedData.programName || 'PROG-SM-METER-TOP-REV4',
            moduleNo: Number(parsedData.moduleNo) || 1,
            laneNo: Number(parsedData.laneNo) || 1,
            cycleTimeSeconds: parseFloat(parsedData.cycleTime) || 18.5,
            blockCount: parseInt(parsedData.blockCount, 10) || 4,
            blockSkipCount: parseInt(parsedData.blockSkipCount, 10) || 0,
            skipBitmask: parsedData.bsInfoBit
          }
        };
      }

      case 'LOADCOMP':
      case 'LOADCOMPIV':
      case 'CHANGECOMP':
      case 'CHANGECOMPII': {
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
            slotNo: parseInt(parsedData.slotNo, 10) || 1,
            moduleNo: parseInt(parsedData.moduleNo, 10) || 1,
            stageNo: parseInt(parsedData.stageNo, 10) || 1,
            feederId: parsedData.feederId || 'FID-W08F-01',
            partNumber: parsedData.partNo || 'C0402-100NF-16V',
            oldReelId: parsedData.oldReelId || 'REEL-OLD',
            newReelId: parsedData.newReelId || parsedData.reelId || 'REEL-NEW',
            newReelLotNumber: parsedData.lotNo || 'LOT-AUTO',
            newReelVendor: parsedData.vendor || 'Supplier',
            newReelQuantity: parseInt(parsedData.quantity, 10) || 10000,
            mslRemainingMinutes: parseInt(parsedData.remainingTime, 10) || 999999
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
            moduleNo: parseInt(parsedData.moduleNo, 10) || 1,
            stageNo: parseInt(parsedData.stageNo, 10) || 1,
            slotNo: parseInt(parsedData.slotNo, 10) || 1,
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
   * Splicing verification interlock.
   * Checks if the scanned part number matches the assigned BOM part for that slot.
   */
  public async verifySplicingInterlock(slotNo: number, partNumber: string, workCenterId: string): Promise<boolean> {
    const db = getDatabase();
    const rows = await db.query(
      'SELECT assigned_part_number FROM smt_feeder_slots WHERE work_center_id = ? AND slot_no = ?',
      [workCenterId, slotNo]
    );

    if (rows.length === 0) return true; // Default allow if slot is not explicitly restricted
    const expectedPart = rows[0].assigned_part_number;
    return expectedPart === partNumber;
  }

  public parseCommandTokens(command: FujiCommand, tokens: string[]): Record<string, any> {
    const data: Record<string, any> = {};
    if (!tokens || tokens.length < 2) return data;

    switch (command) {
      case 'MCSTATECHANGE':
        data.time = tokens[2];
        data.lineName = tokens[3];
        data.machineName = tokens[4];
        data.moduleNo = tokens[5];
        data.previousStatus = parseInt(tokens[6] || '3', 10);
        data.currentStatus = parseInt(tokens[7] || '5', 10);
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

      case 'PRODCOMPLETED':
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
        data.moduleNo = tokens[5];
        if (tokens.length >= 12) {
          data.slotNo = tokens[7];
          data.partNo = tokens[8];
          data.feederId = tokens[9];
          data.oldReelId = tokens[10];
          data.newReelId = tokens[11];
          data.quantity = tokens[12];
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

  public startListener(port = 30040, workCenterId = 'wc-nxt-01'): void {
    if (this.isRunning) return;

    this.server = net.createServer((socket) => {
      console.log(`[Fuji Gateway] SMT Machine connected from ${socket.remoteAddress}:${socket.remotePort}`);

      socket.on('data', async (data) => {
        const db = getDatabase();
        const ingressId = uuidv4();

        // Tier 1 Ingress: Preserve raw socket frame verbatim
        await db.execute(`
          INSERT INTO ingress_events (
            id, source_adapter, source_address, protocol, raw_payload, processed_status
          ) VALUES (?, ?, ?, 'TCP_ASCII_STX_ETX', ?, 'RECEIVED')
        `, [ingressId, 'FUJI_NEXIM', `${socket.remoteAddress}:${socket.remotePort}`, data.toString('utf-8')]);

        const parsed = this.parseRawFrame(data);
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

        // Splicing & Part Load Interlock
        if (parsed.command === 'LOADCOMP' || parsed.command === 'LOADCOMPIV' || parsed.command === 'CHANGECOMP' || parsed.command === 'CHANGECOMPII') {
          const slotNo = parseInt(fields.slotNo || parsed.tokens[3] || '1', 10);
          const partNo = fields.partNo || parsed.tokens[4] || '';

          const isAllowed = await this.verifySplicingInterlock(slotNo, partNo, workCenterId);
          if (!isAllowed) {
            console.warn(`[Fuji Gateway] SPLICING INTERLOCK BLOCKED: Slot ${slotNo} expected correct part, received ${partNo}. Halting feeder!`);
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
      });

      socket.on('close', () => {
        console.log('[Fuji Gateway] SMT Machine disconnected.');
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
