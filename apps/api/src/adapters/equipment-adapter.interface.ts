/**
 * Hardware Abstraction Layer (HAL) Equipment Adapter Interface
 * (Track A: Architecture & Event Sourcing)
 *
 * Provides a uniform lifecycle and telemetry interface for all equipment protocols
 * (Fuji Nexim Host Interface, Panasonic PanaCIM, ASM SIPLACE, DEK Horizon screen printers).
 */
export interface EquipmentAdapterStatus {
  id: string;
  name: string;
  protocolName: string;
  workCenterId: string;
  isRunning: boolean;
  port: number;
  activeConnections: number;
  lastFrameReceivedAt?: string;
  framesProcessedTotal: number;
}

export interface IEquipmentAdapter {
  readonly id: string;
  readonly name: string;
  readonly protocolName: string;
  readonly workCenterId: string;

  startListener(port?: number): Promise<void> | void;
  stopListener(): Promise<void> | void;
  getStatus(): EquipmentAdapterStatus;
}

export type MachineCapability =
  | 'HOLD'
  | 'PARAMETER_MODIFICATION'
  | 'CLEANING'
  | 'PURGE'
  | 'DIVERT';

export type MachineParameterCommand =
  | { type: 'PRINTER_PRESSURE'; value: number; unit?: string }
  | { type: 'PRINTER_SEPARATION_SPEED'; value: number; unit?: string }
  | { type: 'PRINTER_PRINT_SPEED'; value: number; unit?: string }
  | { type: 'PLACEMENT_SPEED'; value: number; unit?: string };

export type MachineActionCommand =
  | { type: 'CLEANING'; mode: 'DRY' | 'VACUUM' | 'SOLVENT' | 'VACUUM_SOLVENT'; triggerReason?: string }
  | { type: 'PURGE'; triggerReason?: string }
  | { type: 'DIVERT'; targetConveyorId: string; triggerReason?: string };

export interface IControllableEquipmentAdapter extends IEquipmentAdapter {
  getCapabilities(): MachineCapability[];
  tripHold(reason: string, details?: Record<string, any>): Promise<void>;
  clearHold(reason: string): Promise<void>;
  isHoldActive(): { active: boolean; reason: string | null };
  applyParameters(commands: MachineParameterCommand[]): Promise<boolean>;
  executeAction(command: MachineActionCommand): Promise<boolean>;
}
