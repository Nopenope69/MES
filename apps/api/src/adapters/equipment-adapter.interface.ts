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
