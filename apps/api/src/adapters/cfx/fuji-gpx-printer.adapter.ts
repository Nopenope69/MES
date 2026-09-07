import { MockCfxAmqpBroker } from './mock-cfx-amqp-broker';
import {
  CfxMessageEnvelope,
  CfxExecuteCleaningData,
  CfxModifyProcessParametersData
} from './cfx-message.interface';
import {
  IControllableEquipmentAdapter,
  EquipmentAdapterStatus,
  MachineCapability,
  MachineParameterCommand,
  MachineActionCommand
} from '../equipment-adapter.interface';

export interface FujiGpxPrinterState {
  workCenterId: string;
  squeegeePressureKgf: number;
  separationSpeedMmS: number;
  printSpeedMmS: number;
  lastCleanedAt?: string;
  cleaningCyclesTotal: number;
  lastModifiedAt?: string;
}

export class FujiGpxPrinterAdapter implements IControllableEquipmentAdapter {
  readonly id: string = 'fuji-gpx-01';
  readonly name: string = 'Fuji GPX-C Screen Printer';
  readonly protocolName: string = 'IPC-CFX-2591 / AMQP 1.0';
  readonly workCenterId: string = 'wc-spg-01';
  readonly equipmentId: string = 'wc-spg-01';
  readonly manufacturer: string = 'Fuji Machine MFG';
  readonly model: string = 'Fuji GPX-C Screen Printer';

  private isRunning: boolean = true;
  private isHold: boolean = false;
  private holdReason: string | null = null;

  private state: FujiGpxPrinterState = {
    workCenterId: 'wc-spg-01',
    squeegeePressureKgf: 8.5,
    separationSpeedMmS: 1.2,
    printSpeedMmS: 40.0,
    cleaningCyclesTotal: 0
  };

  private broker: MockCfxAmqpBroker;

  constructor(broker?: MockCfxAmqpBroker) {
    this.broker = broker || MockCfxAmqpBroker.getInstance();
    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen for Cleaning Commands
    this.broker.subscribe<CfxExecuteCleaningData>(
      'cfx.production.pressandprint.clean',
      async (envelope: CfxMessageEnvelope<CfxExecuteCleaningData>) => {
        if (envelope.data.equipmentId === this.equipmentId) {
          await this.executeCleaning(envelope.data.cleaningMode, envelope.data.triggerReason);
        }
      }
    );

    // Listen for Process Parameter Modification
    this.broker.subscribe<CfxModifyProcessParametersData>(
      'cfx.production.pressandprint.parameters',
      async (envelope: CfxMessageEnvelope<CfxModifyProcessParametersData>) => {
        if (envelope.data.equipmentId === this.equipmentId) {
          await this.applyParameter(
            envelope.data.parameterName,
            envelope.data.targetValue,
            envelope.data.triggerReason
          );
        }
      }
    );
  }

  public async executeCleaning(
    mode: 'Dry' | 'Vacuum' | 'Solvent' | 'VacuumSolvent',
    reason: string
  ): Promise<void> {
    this.state.cleaningCyclesTotal++;
    this.state.lastCleanedAt = new Date().toISOString();
    console.log(`[Fuji GPX-C Printer] Stencil underside wipe executed (${mode}). Reason: ${reason}`);
  }

  public async applyParameter(
    param: 'SqueegeePressure' | 'SeparationSpeed' | 'PrintSpeed',
    value: number,
    reason: string
  ): Promise<void> {
    if (param === 'SqueegeePressure') {
      this.state.squeegeePressureKgf = value;
    } else if (param === 'SeparationSpeed') {
      this.state.separationSpeedMmS = value;
    } else if (param === 'PrintSpeed') {
      this.state.printSpeedMmS = value;
    }
    this.state.lastModifiedAt = new Date().toISOString();
    console.log(`[Fuji GPX-C Printer] Parameter [${param}] set to ${value}. Reason: ${reason}`);
  }

  public getState(): FujiGpxPrinterState {
    return { ...this.state };
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
      framesProcessedTotal: this.state.cleaningCyclesTotal
    };
  }

  public getCapabilities(): MachineCapability[] {
    return ['HOLD', 'CLEANING', 'PARAMETER_MODIFICATION'];
  }

  public async tripHold(reason: string, _details?: Record<string, any>): Promise<void> {
    this.isHold = true;
    this.holdReason = reason;
    console.warn(`[Fuji GPX-C Printer] HOLD TRIPPED: ${reason}`);
  }

  public async clearHold(reason: string): Promise<void> {
    this.isHold = false;
    this.holdReason = null;
    console.log(`[Fuji GPX-C Printer] HOLD CLEARED: ${reason}`);
  }

  public isHoldActive(): { active: boolean; reason: string | null } {
    return {
      active: this.isHold,
      reason: this.holdReason
    };
  }

  public async applyParameters(commands: MachineParameterCommand[]): Promise<boolean> {
    for (const cmd of commands) {
      if (cmd.type === 'PRINTER_PRESSURE') {
        await this.applyParameter('SqueegeePressure', cmd.value, 'Closed-loop tuning');
      } else if (cmd.type === 'PRINTER_SEPARATION_SPEED') {
        await this.applyParameter('SeparationSpeed', cmd.value, 'Closed-loop tuning');
      } else if (cmd.type === 'PRINTER_PRINT_SPEED') {
        await this.applyParameter('PrintSpeed', cmd.value, 'Closed-loop tuning');
      }
    }
    return true;
  }

  public async executeAction(command: MachineActionCommand): Promise<boolean> {
    if (command.type === 'CLEANING') {
      const modeMap: Record<string, 'Dry' | 'Vacuum' | 'Solvent' | 'VacuumSolvent'> = {
        DRY: 'Dry',
        VACUUM: 'Vacuum',
        SOLVENT: 'Solvent',
        VACUUM_SOLVENT: 'VacuumSolvent'
      };
      const mode = modeMap[command.mode] || 'Dry';
      await this.executeCleaning(mode, command.triggerReason || 'Closed-loop cleaning action');
      return true;
    }
    return false;
  }
}
