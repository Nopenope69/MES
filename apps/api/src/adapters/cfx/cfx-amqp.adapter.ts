import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  CanonicalSpiInspectionResult,
  SpiPadMeasurement,
  SpiDefectType
} from '@mes/shared';
import {
  CFX_VERSION,
  CfxMessageEnvelope,
  CfxUnitsInspectedData,
  CfxExecuteCleaningData,
  CfxModifyProcessParametersData,
  CfxCommandResponse
} from './cfx-message.interface';
import { MockCfxAmqpBroker } from './mock-cfx-amqp-broker';

export class CfxAmqpAdapter {
  private broker: MockCfxAmqpBroker;
  private isConnected: boolean = false;
  private sourceUri: string = 'cfx:mes-quality-engine@dixon-p4';

  constructor(broker?: MockCfxAmqpBroker) {
    this.broker = broker || MockCfxAmqpBroker.getInstance();
  }

  public async connect(): Promise<void> {
    this.isConnected = true;
    console.log(`[CFX Adapter] Connected to IPC-CFX v${CFX_VERSION} AMQP Transport.`);
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  public getStatus(): { connected: boolean; version: string } {
    return { connected: this.isConnected, version: CFX_VERSION };
  }

  /**
   * Normalizes an IPC-CFX UnitsInspected message into the CanonicalSpiInspectionResult.
   */
  public parseUnitsInspected(envelope: CfxMessageEnvelope<CfxUnitsInspectedData>): CanonicalSpiInspectionResult {
    const data = envelope.data;
    const rawStr = JSON.stringify(envelope);
    const sourceFileHash = crypto.createHash('sha256').update(rawStr).digest('hex');

    const resultMapping: Record<string, 'PASS' | 'WARNING' | 'FAIL'> = {
      Passed: 'PASS',
      Warning: 'WARNING',
      Failed: 'FAIL'
    };
    const result = resultMapping[data.overallResult] || 'FAIL';

    const measurements: SpiPadMeasurement[] = (data.measurements || []).map((m) => {
      let defectType: SpiDefectType | undefined;
      if (m.defectType) {
        defectType = m.defectType.toUpperCase() as SpiDefectType;
      } else if (m.volumeRatioPct < 70) {
        defectType = 'INSUFFICIENT_PASTE';
      } else if (m.volumeRatioPct > 140) {
        defectType = 'EXCESS_PASTE';
      }

      return {
        padId: m.padId,
        unitPosition: m.unitPosition || 1,
        refDes: m.refDes,
        pinNo: m.pinNo,
        volumeRatioPct: Number(m.volumeRatioPct),
        heightUm: Number(m.heightUm),
        areaRatioPct: Number(m.areaRatioPct),
        offsetXUm: Number(m.offsetXUm),
        offsetYUm: Number(m.offsetYUm),
        isCriticalPad: Boolean(m.isCriticalPad),
        defectType
      };
    });

    return {
      sourceSystem: 'IPC_CFX_AMQP_1.0',
      sourceInspectionId: envelope.uniqueId || `CFX-${Date.now()}`,
      sourceFileHash,
      panelBarcode: data.panelBarcode,
      batchId: data.batchId,
      workCenterId: 'wc-spi-01',
      opticalMachineId: envelope.sourceUri || 'KY-ASPIRE3-01',
      result,
      totalPadsInspected: data.totalPadsInspected ?? measurements.length,
      defectivePadsCount: data.defectivePadsCount ?? measurements.filter(m => m.defectType).length,
      meanVolumePct: Number(data.meanVolumePct || 100.0),
      sigmaVolumePct: Number(data.sigmaVolumePct || 0.0),
      measurements,
      durationSeconds: data.durationSeconds,
      timestamp: envelope.timestamp || new Date().toISOString()
    };
  }

  /**
   * Dispatches an IPC-CFX Stencil Underside Cleaning Command to the screen printer.
   */
  public async sendCleaningCommand(params: {
    printerEquipmentId: string;
    cleaningMode: 'Dry' | 'Vacuum' | 'Solvent' | 'VacuumSolvent';
    triggerReason: string;
  }): Promise<CfxCommandResponse> {
    const topic = 'cfx.production.pressandprint.clean';
    const message: CfxMessageEnvelope<CfxExecuteCleaningData> = {
      cfxVersion: CFX_VERSION,
      messageName: 'CFX.Production.Assembly.PressAndPrint.ExecuteCleaning',
      sourceUri: this.sourceUri,
      targetUri: `cfx:${params.printerEquipmentId}`,
      timestamp: new Date().toISOString(),
      uniqueId: uuidv4(),
      data: {
        equipmentId: params.printerEquipmentId,
        cleaningMode: params.cleaningMode,
        triggerReason: params.triggerReason,
        requestedBy: 'MES_SPI_CLOSED_LOOP_ENGINE'
      }
    };

    await this.broker.publish(topic, message);

    return {
      transactionId: message.uniqueId,
      status: 'Success',
      equipmentId: params.printerEquipmentId,
      message: `CFX Stencil Cleaning (${params.cleaningMode}) executed on ${params.printerEquipmentId}`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Dispatches an IPC-CFX Process Parameter Modification Command to the screen printer.
   */
  public async sendParameterModification(params: {
    printerEquipmentId: string;
    parameterName: 'SqueegeePressure' | 'SeparationSpeed' | 'PrintSpeed';
    targetValue: number;
    unit: string;
    triggerReason: string;
  }): Promise<CfxCommandResponse> {
    const topic = 'cfx.production.pressandprint.parameters';
    const message: CfxMessageEnvelope<CfxModifyProcessParametersData> = {
      cfxVersion: CFX_VERSION,
      messageName: 'CFX.Production.Assembly.PressAndPrint.ModifyProcessParameters',
      sourceUri: this.sourceUri,
      targetUri: `cfx:${params.printerEquipmentId}`,
      timestamp: new Date().toISOString(),
      uniqueId: uuidv4(),
      data: {
        equipmentId: params.printerEquipmentId,
        parameterName: params.parameterName,
        targetValue: params.targetValue,
        unit: params.unit,
        triggerReason: params.triggerReason,
        requestedBy: 'MES_SPI_CLOSED_LOOP_ENGINE'
      }
    };

    await this.broker.publish(topic, message);

    return {
      transactionId: message.uniqueId,
      status: 'Success',
      equipmentId: params.printerEquipmentId,
      appliedValue: params.targetValue,
      message: `CFX Parameter [${params.parameterName}] updated to ${params.targetValue} ${params.unit}`,
      timestamp: new Date().toISOString()
    };
  }
}
