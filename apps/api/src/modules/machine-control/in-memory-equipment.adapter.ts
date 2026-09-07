import {
  IControllableEquipmentAdapter,
  EquipmentAdapterStatus,
  MachineCapability,
  MachineParameterCommand,
  MachineActionCommand
} from '../../adapters/equipment-adapter.interface';

export class InMemoryEquipmentAdapter implements IControllableEquipmentAdapter {
  readonly id: string;
  readonly name: string;
  readonly protocolName: string;
  readonly workCenterId: string;

  private isRunning: boolean = true;
  private hold: boolean = false;
  private holdReason: string | null = null;
  private supportedCapabilities: MachineCapability[];

  public appliedParameters: MachineParameterCommand[] = [];
  public executedActions: MachineActionCommand[] = [];
  public holdHistory: Array<{ action: 'TRIP' | 'CLEAR'; reason: string; timestamp: string }> = [];

  constructor(options?: {
    id?: string;
    name?: string;
    protocolName?: string;
    workCenterId?: string;
    capabilities?: MachineCapability[];
  }) {
    this.id = options?.id || 'mock-eq-01';
    this.name = options?.name || 'Mock Controllable Equipment';
    this.protocolName = options?.protocolName || 'MOCK_HAL_PROTOCOL';
    this.workCenterId = options?.workCenterId || 'wc-nxt-01';
    this.supportedCapabilities = options?.capabilities || [
      'HOLD',
      'PARAMETER_MODIFICATION',
      'CLEANING',
      'PURGE',
      'DIVERT'
    ];
  }

  public startListener(): void {
    this.isRunning = true;
  }

  public stopListener(): void {
    this.isRunning = false;
  }

  public getStatus(): EquipmentAdapterStatus {
    return {
      id: this.id,
      name: this.name,
      protocolName: this.protocolName,
      workCenterId: this.workCenterId,
      isRunning: this.isRunning,
      port: 0,
      activeConnections: this.isRunning ? 1 : 0,
      framesProcessedTotal: this.appliedParameters.length + this.executedActions.length
    };
  }

  public getCapabilities(): MachineCapability[] {
    return [...this.supportedCapabilities];
  }

  public setCapabilities(capabilities: MachineCapability[]): void {
    this.supportedCapabilities = [...capabilities];
  }

  public async tripHold(reason: string, _details?: Record<string, any>): Promise<void> {
    if (!this.supportedCapabilities.includes('HOLD')) {
      throw new Error(`Equipment [${this.id}] does not support HOLD capability`);
    }
    this.hold = true;
    this.holdReason = reason;
    this.holdHistory.push({ action: 'TRIP', reason, timestamp: new Date().toISOString() });
  }

  public async clearHold(reason: string): Promise<void> {
    if (!this.supportedCapabilities.includes('HOLD')) {
      throw new Error(`Equipment [${this.id}] does not support HOLD capability`);
    }
    this.hold = false;
    this.holdReason = null;
    this.holdHistory.push({ action: 'CLEAR', reason, timestamp: new Date().toISOString() });
  }

  public isHoldActive(): { active: boolean; reason: string | null } {
    return {
      active: this.hold,
      reason: this.holdReason
    };
  }

  public async applyParameters(commands: MachineParameterCommand[]): Promise<boolean> {
    if (!this.supportedCapabilities.includes('PARAMETER_MODIFICATION')) {
      throw new Error(`Equipment [${this.id}] does not support PARAMETER_MODIFICATION capability`);
    }
    this.appliedParameters.push(...commands);
    return true;
  }

  public async executeAction(command: MachineActionCommand): Promise<boolean> {
    if (command.type === 'CLEANING' && !this.supportedCapabilities.includes('CLEANING')) {
      throw new Error(`Equipment [${this.id}] does not support CLEANING capability`);
    }
    if (command.type === 'PURGE' && !this.supportedCapabilities.includes('PURGE')) {
      throw new Error(`Equipment [${this.id}] does not support PURGE capability`);
    }
    if (command.type === 'DIVERT' && !this.supportedCapabilities.includes('DIVERT')) {
      throw new Error(`Equipment [${this.id}] does not support DIVERT capability`);
    }
    this.executedActions.push(command);
    return true;
  }
}
