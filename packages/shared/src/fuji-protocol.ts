import { MesEventEnvelope } from './events';
import { EquipmentState } from './state-machine';

export const FUJI_FRAMING = {
  STX: 0x02,
  ETX: 0x03,
  HEADER_SIZE: 4, // 4-byte Big-Endian total packet length
  DEFAULT_PORTS: {
    CENTRAL_SERVER: 30040,
    SETUP_STATION: 30041,
    PARTS_REGISTRATION: 30042,
    VERIFIER_CLIENT: 30500
  },
  KEEPALIVE_INTERVAL_SEC: 120,
  KEEPALIVE_TIMEOUT_SEC: 30
};

export type FujiCommand =
  | 'SETEV'
  | 'SETEV_ACK'
  | 'STARTEV'
  | 'STARTEV_ACK'
  | 'KEEPALIVE'
  | 'KEEPALIVE_ACK'
  | 'PGCHANGE'
  | 'PGCHANGEII'
  | 'BOMLIST'
  | 'PCBCHECKIN'
  | 'PCBCHECKOUT'
  | 'LOADCOMP'
  | 'LOADCOMPIV'
  | 'UNLOADCOMP'
  | 'CHANGECOMP'
  | 'CHANGECOMPII'
  | 'PRODSTARTED'
  | 'PRODCOMPLETED'
  | 'PRODCOMPLETEII'
  | 'PRODSTOPPED'
  | 'MCSTATECHANGE'
  | 'MCALARMON'
  | 'MCALARMOFF'
  | 'PARTSUSAGE'
  | 'FEEDERUSAGE'
  | 'STOPEQUIP'
  | 'RESTARTEQUIP'
  | 'MESSAGETEXT';

/**
 * Mapping Fuji machine status code to our canonical EquipmentState.
 * Fuji Code reference:
 * 2: Change Over
 * 3: Idle
 * 4: Loading
 * 5: Run
 * 6: Stop (Error)
 * 7: Wait Next
 * 8: Wait Parts
 * 9: Wait Previous
 * 10: Wait Switch
 * 11: Maintenance
 */
export function mapFujiStatusToCanonical(fujiStatus: number | string): {
  state: EquipmentState;
  reasonCategory?: string;
  reasonCode?: string;
} {
  const code = Number(fujiStatus);
  switch (code) {
    case 5: // Run
      return { state: 'RUNNING' };
    case 2: // Change Over
      return { state: 'CHANGEOVER', reasonCategory: 'PROCESS_QUALITY', reasonCode: 'CHANGEOVER_SETUP' };
    case 3: // Idle
    case 10: // Wait Switch
      return { state: 'IDLE' };
    case 4: // Loading
      return { state: 'RUNNING' };
    case 6: // Stop
      return { state: 'STOPPED_UNPLANNED', reasonCategory: 'MECHANICAL', reasonCode: 'MACHINE_ERROR_STOP' };
    case 7: // Wait Next
      return { state: 'STOPPED_PLANNED', reasonCategory: 'PROCESS_QUALITY', reasonCode: 'WAITING_DOWNSTREAM' };
    case 8: // Wait Parts
      return { state: 'STOPPED_PLANNED', reasonCategory: 'MATERIAL', reasonCode: 'MAT_WAITING_RM' };
    case 9: // Wait Previous
      return { state: 'STOPPED_PLANNED', reasonCategory: 'PROCESS_QUALITY', reasonCode: 'WAITING_UPSTREAM' };
    case 11: // Maintenance
      return { state: 'MAINTENANCE', reasonCategory: 'MECHANICAL', reasonCode: 'PREVENTIVE_MAINTENANCE' };
    default:
      return { state: 'IDLE' };
  }
}

/**
 * Universal interface that any industrial connector (Fuji, Modbus, OPC-UA, MQTT) must satisfy.
 * Proves our architectural boundary: The core MES never knows about sockets or vendor framing.
 */
export interface IFactoryIntegrationAdapter {
  readonly adapterName: string;
  readonly sourceType: 'INTEGRATION_SOCKET';
  
  parseRawFrame(buffer: Buffer): { command: FujiCommand; seqId: number; payloadRaw: string } | null;
  toCanonicalEvent(command: FujiCommand, seqId: number, parsedData: Record<string, any>, workCenterId: string): MesEventEnvelope | null;
  buildAckFrame(command: FujiCommand, seqId: number, resultOk: boolean, extraFields?: string[]): Buffer;
}
