import { MockCfxAmqpBroker } from './mock-cfx-amqp-broker';
import {
  CfxMessageEnvelope,
  CfxExecuteCleaningData,
  CfxModifyProcessParametersData
} from './cfx-message.interface';

export interface FujiGpxPrinterState {
  workCenterId: string;
  squeegeePressureKgf: number;
  separationSpeedMmS: number;
  printSpeedMmS: number;
  lastCleanedAt?: string;
  cleaningCyclesTotal: number;
  lastModifiedAt?: string;
}

export class FujiGpxPrinterAdapter {
  readonly equipmentId: string = 'wc-spg-01';
  readonly manufacturer: string = 'Fuji Machine MFG';
  readonly model: string = 'Fuji GPX-C Screen Printer';

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
}
