import net from 'net';
import {
  FUJI_FRAMING,
  FujiCommand,
  IFactoryIntegrationAdapter,
  mapFujiStatusToCanonical,
  MesEventEnvelope
} from '@mes/shared';
import { EventIngestionService } from '../services/event-ingestion.service';
import { SplicingAuthorizationService } from '../services/splicing-authorization.service';
import { getDatabase } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { IpFirewall } from '../security/ip-firewall';
import { SecretsConfigManager } from '../config/secrets';
import { ProductionHoldService } from '../services/production-hold.service';

import {
  IControllableEquipmentAdapter,
  EquipmentAdapterStatus,
  MachineCapability,
  MachineParameterCommand,
  MachineActionCommand
} from './equipment-adapter.interface';

export interface FujiMachineMapping {
  machineId: string;
  workCenterId: string;
  lineId: string;
  ipAddress?: string;
}

/**
 * Production Fuji Nexim TCP Socket Gateway.
 * Implements the Fuji Host Interface Specification V2.8.0.
 * Decodes Big-Endian length + STX (0x02) / ETX (0x03) packets.
 * Includes stream frame accumulator for fragmented/coalesced TCP packets.
 * Includes closed-loop Splicing Verification Interlock (ADR-003 decoupled).
 *
 * =========================================================================================
 * MANDATORY OT NETWORK COMPENSATING CONTROLS (IEC 62443 / Defense-in-Depth):
 * Standard OEM Fuji Nexim SMT equipment controllers (NXT III, AIMEX) run proprietary wire
 * protocols and firmware that do NOT support custom TLS or application-level authentication.
 * Modifying the OEM wire format with custom handshakes would break line controller interop.
 * Therefore, deployment requires strict network-level compensating controls:
 * 1. Dedicated OT VLAN / Interface: The gateway socket (port 30040) binds strictly to an
 *    isolated physical OT machine network (e.g. 192.168.40.0/24) with no route to enterprise LAN
 *    or public Internet.
 * 2. Hardware Industrial Firewall: Strict Layer-3/4 stateful inspection between IT and OT segments,
 *    blocking all traffic except authorized machine controller IPs.
 * 3. Monitored IP Allowlist (IpFirewall): Layer-4 ingress enforcement validating remote IP
 *    against configured machine controller CIDR blocks before socket acceptance.
 * 4. Protocol-Safe Defensive Framing: Strict 64KB accumulator limit, declared length bounds
 *    (2 <= totalLength <= 65536), sync header (STX) validation, and 30-second idle socket timeout.
 * =========================================================================================
 */
export class FujiNeximAdapter implements IFactoryIntegrationAdapter, IControllableEquipmentAdapter {
  readonly id = 'fuji-nxt-01';
  readonly name = 'Fuji NXT III Placement Gateway';
  readonly protocolName = 'Fuji Nexim Host Interface V2.8.0';
  readonly workCenterId = 'wc-nxt-01';
  readonly adapterId = 'FujiNeximAdapter';
  readonly adapterName = 'FujiNeximAdapter';
  readonly sourceType = 'INTEGRATION_SOCKET';
  private server: net.Server | null = null;
  private isRunning = false;
  private activePort: number = 30040;
  private activeConnections: number = 0;
  private framesProcessedTotal: number = 0;
  private lastFrameReceivedAt?: string;
  public static readonly MAX_SOCKET_BUFFER: number = 64 * 1024; // 64KB max buffer guard against memory exhaustion DoS
  public static readonly IDLE_TIMEOUT_MS: number = 30000; // 30-second socket timeout to prevent hung connections
  private customIdleTimeoutMs: number = FujiNeximAdapter.IDLE_TIMEOUT_MS;
  private customAllowedSubnets: string[] | null = null;
  private machineRegistry: Map<string, FujiMachineMapping> = new Map();

  constructor() {
    // Pre-register standard SMT lines
    this.registerMachineMapping({
      machineId: 'NXT01',
      workCenterId: 'wc-nxt-01',
      lineId: 'line-smt-01',
      ipAddress: '192.168.10.42'
    });
    this.registerMachineMapping({
      machineId: 'NXT02',
      workCenterId: 'wc-nxt-02',
      lineId: 'line-smt-02',
      ipAddress: '192.168.10.43'
    });
  }

  public registerMachineMapping(mapping: FujiMachineMapping): void {
    const key = mapping.machineId.toUpperCase();
    this.machineRegistry.set(key, mapping);
    if (mapping.workCenterId) {
      this.machineRegistry.set(mapping.workCenterId.toLowerCase(), mapping);
    }
    if (mapping.ipAddress) {
      const cleanIp = mapping.ipAddress.replace(/^::ffff:/, '');
      this.machineRegistry.set(cleanIp, mapping);
    }
  }

  public getRegisteredMachines(): FujiMachineMapping[] {
    const unique = new Map<string, FujiMachineMapping>();
    for (const mapping of this.machineRegistry.values()) {
      unique.set(mapping.machineId, mapping);
    }
    return Array.from(unique.values());
  }

  public resolveMachineContext(clientIp: string, machineName?: string): FujiMachineMapping {
    const cleanIp = clientIp.replace(/^::ffff:/, '');

    if (machineName) {
      const key = machineName.toUpperCase();
      if (this.machineRegistry.has(key)) {
        return this.machineRegistry.get(key)!;
      }
      const lowerKey = machineName.toLowerCase();
      if (this.machineRegistry.has(lowerKey)) {
        return this.machineRegistry.get(lowerKey)!;
      }
    }

    if (this.machineRegistry.has(cleanIp)) {
      return this.machineRegistry.get(cleanIp)!;
    }

    // Dynamic resolution based on machine identifier pattern
    if (machineName && (machineName.includes('02') || machineName.includes('2'))) {
      return {
        machineId: machineName,
        workCenterId: 'wc-nxt-02',
        lineId: 'line-smt-02',
        ipAddress: cleanIp
      };
    }

    return {
      machineId: machineName || 'NXT01',
      workCenterId: this.workCenterId,
      lineId: 'line-smt-01',
      ipAddress: cleanIp
    };
  }

  public setAllowedSubnets(subnets: string[] | null): void {
    this.customAllowedSubnets = subnets;
  }

  public setIdleTimeout(ms: number): void {
    this.customIdleTimeoutMs = ms;
  }

  public getIdleTimeout(): number {
    return this.customIdleTimeoutMs;
  }

  /**
   * Streaming TCP Frame Extractor.
   * Handles arbitrary packet segmentation, chunk fragmentation, and packet coalescing.
   * Extracts all complete STX/ETX frames from the buffer and returns them alongside the unconsumed remainder.
   */
  public static extractFrames(buffer: Buffer): { frames: Buffer[]; remainder: Buffer } {
    const frames: Buffer[] = [];
    let offset = 0;

    while (buffer.length - offset >= FUJI_FRAMING.HEADER_SIZE) {
      const totalLength = buffer.readUInt32BE(offset);

      // Declared Length Guard: totalLength must be between 2 (STX+ETX) and MAX_SOCKET_BUFFER (64KB)
      if (totalLength < 2 || totalLength > FujiNeximAdapter.MAX_SOCKET_BUFFER) {
        break;
      }

      // Sync Header Guard: when at least 5 bytes are present from offset, verify byte 4 is STX (0x02)
      if (buffer.length - offset >= FUJI_FRAMING.HEADER_SIZE + 1) {
        const stx = buffer[offset + FUJI_FRAMING.HEADER_SIZE];
        if (stx !== FUJI_FRAMING.STX) {
          break;
        }
      }

      const fullFrameSize = FUJI_FRAMING.HEADER_SIZE + totalLength;
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
        // Corrupted frame boundary: break to prevent desynchronized processing
        break;
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
   * Splicing verification interlock (Unified SplicingAuthorizationService Gate).
   */
  public async verifySplicingInterlock(slotNo: number, partNumber: string, workCenterId: string, reelId?: string): Promise<boolean> {
    const decision = await SplicingAuthorizationService.authorizeSplicing({
      workCenterId,
      slotNo,
      scannedPartNumber: partNumber,
      scannedReelId: reelId
    });
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

    const fields = this.parseCommandTokens(parsed.command, parsed.tokens);
    const resolved = this.resolveMachineContext(
      socket.remoteAddress || '127.0.0.1',
      fields.machineName || parsed.tokens[2] || (parsed.tokens.length > 4 ? parsed.tokens[4] : undefined)
    );
    const effectiveWorkCenterId = resolved.workCenterId;

    // Handle Protocol Start Handshake (Dynamically reply with resolved machine ID)
    if (parsed.command === 'SETEV') {
      const ackMachine = parsed.tokens[2] || resolved.machineId;
      socket.write(this.buildAckFrame('SETEV', parsed.seqId, true, [ackMachine]));
      return;
    }
    if (parsed.command === 'STARTEV') {
      const ackMachine = parsed.tokens[2] || resolved.machineId;
      socket.write(this.buildAckFrame('STARTEV', parsed.seqId, true, [ackMachine]));
      return;
    }

    // Interlock: Check if production line or work center is currently under active hold
    const isHold = this.isProductionHold || await ProductionHoldService.isHoldActive(resolved.lineId);
    if (isHold && (parsed.command === 'PRODSTARTED' || parsed.command === 'LOADCOMP' || parsed.command === 'LOADCOMPIV' || parsed.command === 'CHANGECOMP' || parsed.command === 'CHANGECOMPII')) {
      console.warn(`[Fuji Gateway] PRODUCTION HOLD ACTIVE on ${resolved.lineId} (${effectiveWorkCenterId}). Rejecting ${parsed.command}!`);
      socket.write(this.buildAckFrame(parsed.command, parsed.seqId, false, ['HOLD_ACTIVE']));
      return;
    }

    // Splicing & Part Load Interlock (Unified SplicingAuthorizationService Gate)
    if (parsed.command === 'LOADCOMP' || parsed.command === 'LOADCOMPIV' || parsed.command === 'CHANGECOMP' || parsed.command === 'CHANGECOMPII') {
      const slotNo = parseInt(fields.slotNo || parsed.tokens[8] || parsed.tokens[3] || '1', 10);
      const partNo = fields.partNo || parsed.tokens[9] || parsed.tokens[4] || '';
      const newReelId = fields.newReelId || parsed.tokens[12] || parsed.tokens[10] || undefined;

      const decision = await SplicingAuthorizationService.authorizeSplicing({
        workCenterId: effectiveWorkCenterId,
        slotNo,
        scannedPartNumber: partNo,
        scannedReelId: newReelId
      });

      if (!decision.allowed) {
        console.warn(`[Fuji Gateway] SPLICING INTERLOCK BLOCKED (${decision.decisionCode}): Slot ${slotNo} - ${decision.reason}. Halting feeder!`);
        socket.write(this.buildAckFrame(parsed.command, parsed.seqId, false)); // Result = 1 (NG)
        return;
      }
    }

    // Project Canonical Event
    const canonical = this.toCanonicalEvent(parsed.command, parsed.seqId, fields, effectiveWorkCenterId);
    if (canonical) {
      canonical.ingressEventId = ingressId;
      await EventIngestionService.ingest(canonical);
    }

    // Respond OK ACK
    socket.write(this.buildAckFrame(parsed.command, parsed.seqId, true));
  }

  public startListener(port = 30040, workCenterId = 'wc-nxt-01', idleTimeoutMs?: number): void {
    if (this.isRunning) return;
    this.activePort = port;
    const socketTimeout = idleTimeoutMs ?? this.customIdleTimeoutMs;

    this.server = net.createServer((socket) => {
      const clientIp = socket.remoteAddress || '';
      const allowed = this.customAllowedSubnets || SecretsConfigManager.loadConfig().allowedSubnets;

      // Compensating Control #3: OT Subnet & IP Firewall Interlock
      if (!IpFirewall.isAllowed(clientIp, allowed)) {
        console.warn(`[SECURITY ALERT] Blocked unauthorized SMT TCP connection from IP: ${clientIp}`);
        socket.destroy();
        return;
      }

      // Idle Timeout Guard: Configure 30-second socket timeout (or configured timeoutMs)
      // Closes hung connections on silence/inactivity.
      socket.setTimeout(socketTimeout);
      socket.on('timeout', () => {
        console.warn(
          `[SECURITY ALERT] OT Socket idle timeout (${socketTimeout}ms) reached for client: ${clientIp}. Terminating connection.`
        );
        socket.destroy();
      });

      this.activeConnections++;
      console.log(`[Fuji Gateway] SMT Machine authorized & connected from ${socket.remoteAddress}:${socket.remotePort}`);

      let socketBuffer = Buffer.alloc(0);

      socket.on('data', async (chunk: Buffer) => {
        // Accumulator Overflow Guard: If socketBuffer.length + chunk.length > 65536, immediately disconnect
        if (socketBuffer.length + chunk.length > FujiNeximAdapter.MAX_SOCKET_BUFFER) {
          console.warn(
            `[SECURITY ALERT] Socket buffer overflow attempt from ${clientIp} (${socketBuffer.length + chunk.length} bytes > ${FujiNeximAdapter.MAX_SOCKET_BUFFER}). Terminating connection.`
          );
          socketBuffer = Buffer.alloc(0);
          socket.destroy();
          return;
        }

        socketBuffer = Buffer.concat([socketBuffer, chunk]);

        const framesToProcess: Buffer[] = [];

        while (true) {
          // Declared Length Guard: If at least 4 bytes are present, inspect declared totalLength
          if (socketBuffer.length >= FUJI_FRAMING.HEADER_SIZE) {
            const totalLength = socketBuffer.readUInt32BE(0);

            // Disconnect socket immediately (socket.destroy()), drop buffer, and log security warning.
            // Do not allow memory accumulation if declared length > 65536 or < 2 (minimum STX + ETX).
            if (totalLength > FujiNeximAdapter.MAX_SOCKET_BUFFER || totalLength < 2) {
              console.warn(
                `[SECURITY ALERT] Malformed declared length (${totalLength} bytes) from ${clientIp}. Terminating connection immediately.`
              );
              socketBuffer = Buffer.alloc(0);
              socket.destroy();
              return;
            }
          }

          // Sync Header Guard: When at least 5 bytes are present in accumulator, verify byte 4 is FUJI_FRAMING.STX (0x02).
          // If invalid/corrupt, immediately drop the connection (socket.destroy()).
          if (socketBuffer.length >= FUJI_FRAMING.HEADER_SIZE + 1) {
            const stx = socketBuffer[FUJI_FRAMING.HEADER_SIZE];
            if (stx !== FUJI_FRAMING.STX) {
              console.warn(
                `[SECURITY ALERT] Corrupt sync header (byte 4 = 0x${stx.toString(16)} != 0x02) from ${clientIp}. Terminating connection immediately.`
              );
              socketBuffer = Buffer.alloc(0);
              socket.destroy();
              return;
            }
          }

          // Need at least 4 bytes to determine full frame size
          if (socketBuffer.length < FUJI_FRAMING.HEADER_SIZE) {
            break;
          }

          const totalLength = socketBuffer.readUInt32BE(0);
          const fullFrameSize = FUJI_FRAMING.HEADER_SIZE + totalLength;

          // Incomplete frame; wait for subsequent TCP chunks
          if (socketBuffer.length < fullFrameSize) {
            break;
          }

          // Frame Boundary Guard: Verify ETX (0x03) at byte 4 + totalLength - 1
          const etx = socketBuffer[fullFrameSize - 1];
          if (etx !== FUJI_FRAMING.ETX) {
            console.warn(
              `[SECURITY ALERT] Corrupt frame boundary (ETX = 0x${etx.toString(16)} != 0x03) from ${clientIp}. Terminating connection immediately.`
            );
            socketBuffer = Buffer.alloc(0);
            socket.destroy();
            return;
          }

          // Extract frame and advance accumulator
          framesToProcess.push(socketBuffer.subarray(0, fullFrameSize));
          socketBuffer = Buffer.from(socketBuffer.subarray(fullFrameSize));
        }

        // Process valid extracted frames sequentially
        for (const frame of framesToProcess) {
          if (socket.destroyed) break;
          this.framesProcessedTotal++;
          this.lastFrameReceivedAt = new Date().toISOString();
          await this.processSingleFrame(socket, frame, workCenterId);
        }
      });

      socket.on('close', () => {
        this.activeConnections = Math.max(0, this.activeConnections - 1);
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
      this.activeConnections = 0;
    }
  }

  public stopListener(): void {
    this.stop();
  }

  private isProductionHold: boolean = false;
  private productionHoldReason: string | null = null;

  public async tripProductionHold(reason: string, targetLineId?: string, targetWorkCenterId?: string): Promise<void> {
    this.isProductionHold = true;
    this.productionHoldReason = reason;
    const workCenter = targetWorkCenterId || this.workCenterId;
    console.warn(`[Fuji Gateway] PRODUCTION HOLD TRIPPED for ${workCenter}: ${reason}`);
    try {
      await ProductionHoldService.tripProductionHold({
        lineId: targetLineId,
        workCenterId: workCenter,
        reason
      });
    } catch (err: any) {
      console.error(`[Fuji Gateway] Failed to trip production hold in service:`, err.message);
      // Fallback local update
      try {
        const db = getDatabase();
        await db.execute(
          `UPDATE work_centers SET current_state = 'QUALITY_HOLD', last_state_change_time = ? WHERE id = ?`,
          [new Date().toISOString(), workCenter]
        );
      } catch (dbErr: any) {
        console.error(`[Fuji Gateway] DB fallback failed:`, dbErr.message);
      }
    }
  }

  public async clearProductionHold(acknowledgedBy = 'LINE_LEAD_01', reason = 'Supervisor acknowledged hold clear'): Promise<void> {
    this.isProductionHold = false;
    this.productionHoldReason = null;
    console.log(`[Fuji Gateway] Production hold CLEARED for ${this.workCenterId}`);
    try {
      await ProductionHoldService.acknowledgeProductionHold({
        workCenterId: this.workCenterId,
        acknowledgedBy,
        role: 'LINE_LEAD',
        acknowledgementReason: reason
      });
    } catch (err: any) {
      // Fallback local update
      try {
        const db = getDatabase();
        await db.execute(
          `UPDATE work_centers SET current_state = 'RUNNING', last_state_change_time = ? WHERE id = ?`,
          [new Date().toISOString(), this.workCenterId]
        );
      } catch (dbErr: any) {
        console.error(`[Fuji Gateway] DB fallback failed:`, dbErr.message);
      }
    }
  }

  public getCapabilities(): MachineCapability[] {
    return ['HOLD'];
  }

  public async tripHold(reason: string, _details?: Record<string, any>): Promise<void> {
    await this.tripProductionHold(reason);
  }

  public async clearHold(reason: string): Promise<void> {
    console.log(`[Fuji Gateway] Clearing hold with reason: ${reason}`);
    await this.clearProductionHold();
  }

  public async applyParameters(_commands: MachineParameterCommand[]): Promise<boolean> {
    return false; // Placement gateway does not support screen printer parameters
  }

  public async executeAction(_command: MachineActionCommand): Promise<boolean> {
    return false; // Placement gateway does not support cleaning/divert actions
  }

  public isHoldActive(): { active: boolean; reason: string | null } {
    return {
      active: this.isProductionHold,
      reason: this.productionHoldReason
    };
  }

  public getStatus(): EquipmentAdapterStatus {
    return {
      id: this.id,
      name: this.name,
      protocolName: this.protocolName,
      workCenterId: this.workCenterId,
      isRunning: this.isRunning,
      port: this.activePort,
      activeConnections: this.activeConnections,
      lastFrameReceivedAt: this.lastFrameReceivedAt,
      framesProcessedTotal: this.framesProcessedTotal
    };
  }

  public isListening(): boolean {
    return !!(this.server && this.server.listening);
  }
}

