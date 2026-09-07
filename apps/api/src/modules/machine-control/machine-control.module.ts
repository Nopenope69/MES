import { v4 as uuidv4 } from 'uuid';
import { getDatabase, IDatabase } from '../../db/database';
import {
  IControllableEquipmentAdapter,
  MachineCapability,
  MachineParameterCommand,
  MachineActionCommand
} from '../../adapters/equipment-adapter.interface';
import { EquipmentGatewayManager } from '../../adapters/equipment-gateway.manager';
import { FujiNeximAdapter } from '../../adapters/fuji-nexim.adapter';
import { FujiGpxPrinterAdapter } from '../../adapters/cfx/fuji-gpx-printer.adapter';
import { IEventStoreModule } from '../event-store/event-store.interface';
import { EventStoreModule } from '../event-store/event-store.module';
import {
  IMachineControlModule,
  InterlockTripResult,
  InterlockClearResult,
  ParameterApplyResult,
  ActionExecuteResult
} from './machine-control.interface';

export class MachineControlModule implements IMachineControlModule {
  private static instance: MachineControlModule | null = null;
  private adapters: Map<string, IControllableEquipmentAdapter> = new Map();
  private dbProvider: () => IDatabase;
  private eventStoreProvider: () => IEventStoreModule;

  constructor(options?: {
    dbProvider?: () => IDatabase;
    eventStoreProvider?: () => IEventStoreModule;
  }) {
    this.dbProvider = options?.dbProvider || getDatabase;
    this.eventStoreProvider = options?.eventStoreProvider || (() => EventStoreModule.getInstance());

    // Auto-register standard factory line equipment
    this.registerDefaultAdapters();
  }

  public static getInstance(options?: {
    dbProvider?: () => IDatabase;
    eventStoreProvider?: () => IEventStoreModule;
  }): MachineControlModule {
    if (!this.instance) {
      this.instance = new MachineControlModule(options);
    }
    return this.instance;
  }

  public static resetInstance(): void {
    this.instance = null;
  }

  private registerDefaultAdapters(): void {
    // 1. Fuji NXT III placement adapter from gateway manager or newly instantiated
    const gw = EquipmentGatewayManager.getInstance();
    const existingFuji = gw.getAdapter<FujiNeximAdapter>('fuji-nxt-01');
    if (existingFuji) {
      this.registerAdapter(existingFuji);
    } else {
      const fuji = new FujiNeximAdapter();
      gw.registerAdapter(fuji);
      this.registerAdapter(fuji);
    }

    // 2. Fuji GPX-C screen printer adapter
    const printer = new FujiGpxPrinterAdapter();
    this.registerAdapter(printer);
  }

  public registerAdapter(adapter: IControllableEquipmentAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.adapters.set(adapter.workCenterId, adapter);
  }

  public getAdapter(workCenterIdOrId: string): IControllableEquipmentAdapter | undefined {
    return this.adapters.get(workCenterIdOrId);
  }

  public getCapabilities(workCenterId: string): MachineCapability[] {
    const adapter = this.getAdapter(workCenterId);
    return adapter ? adapter.getCapabilities() : [];
  }

  public async tripInterlock(
    workCenterId: string,
    reason: string,
    context?: {
      sourceId?: string;
      programId?: string;
      refDes?: string;
      defectType?: string;
      consecutiveCount?: number;
      slidingWindowCount?: number;
      [key: string]: any;
    }
  ): Promise<InterlockTripResult> {
    const adapter = this.getAdapter(workCenterId);
    const db = this.dbProvider();
    const eventStore = this.eventStoreProvider();
    const now = new Date().toISOString();

    // 1. Check capability & command hardware hold
    if (adapter) {
      const capabilities = adapter.getCapabilities();
      if (capabilities.includes('HOLD')) {
        await adapter.tripHold(reason, context);
      }
    }

    // 2. Update DB work center state atomically
    await db.execute(
      `UPDATE work_centers SET current_state = 'QUALITY_HOLD', last_state_change_time = ? WHERE id = ? OR type = 'PICK_AND_PLACE'`,
      [now, workCenterId]
    );

    // 3. Emit canonical audit event via EventStoreModule
    let auditEventId = uuidv4();
    if (context?.refDes || context?.defectType) {
      const appendRes = await eventStore.append({
        eventId: auditEventId,
        eventType: 'REPEAT_DEFECT_INTERLOCK_TRIPPED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'QUALITY_SENTINEL',
        sourceId: context?.sourceId || 'MachineControlModule',
        workCenterId,
        payload: {
          programId: context?.programId || 'PROG-SM-METER-TOP-REV4',
          programRevision: context?.programRevision || 4,
          workCenterId,
          machineId: adapter?.id || workCenterId,
          refDes: context?.refDes,
          defectType: context?.defectType,
          consecutiveCount: context?.consecutiveCount || 3,
          slidingWindowFailures: context?.slidingWindowCount || 3,
          thresholdLimit: 3,
          actionTaken: 'PRODUCTION_HOLD_COMMANDED',
          reason
        }
      });
      auditEventId = appendRes.eventId;
    } else {
      const appendRes = await eventStore.append({
        eventId: auditEventId,
        eventType: 'QUALITY_HOLD_APPLIED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'QUALITY_ENGINE',
        sourceId: 'MachineControlModule',
        workCenterId,
        payload: {
          panelBarcode: context?.panelBarcode || `INTERLOCK-${workCenterId}`,
          holdReason: reason,
          defectCount: 1,
          workCenterId,
          appliedBy: 'MACHINE_CONTROL_MODULE'
        }
      });
      auditEventId = appendRes.eventId;
    }

    return {
      success: true,
      workCenterId,
      holdActive: true,
      reason,
      auditEventId
    };
  }

  public async clearInterlock(
    workCenterId: string,
    authorizedBy: string,
    reason: string
  ): Promise<InterlockClearResult> {
    const adapter = this.getAdapter(workCenterId);
    const db = this.dbProvider();
    const eventStore = this.eventStoreProvider();
    const now = new Date().toISOString();

    // 1. Hardware hold release
    if (adapter) {
      const capabilities = adapter.getCapabilities();
      if (capabilities.includes('HOLD')) {
        await adapter.clearHold(reason);
      }
    }

    // 2. Update DB work center state
    await db.execute(
      `UPDATE work_centers SET current_state = 'RUNNING', last_state_change_time = ? WHERE id = ? OR type = 'PICK_AND_PLACE'`,
      [now, workCenterId]
    );

    // 3. Emit STATE_CHANGED audit event
    const auditEventId = uuidv4();
    await eventStore.append({
      eventId: auditEventId,
      eventType: 'STATE_CHANGED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'SYSTEM',
      sourceId: authorizedBy,
      workCenterId,
      payload: {
        previousState: 'STOPPED_UNPLANNED',
        currentState: 'RUNNING',
        comment: `Interlock cleared by ${authorizedBy}: ${reason}`
      }
    });

    return {
      success: true,
      workCenterId,
      authorizedBy,
      reason,
      auditEventId
    };
  }

  public async isHoldActive(workCenterId: string): Promise<{ active: boolean; reason: string | null }> {
    const adapter = this.getAdapter(workCenterId);
    if (adapter) {
      return adapter.isHoldActive();
    }
    const db = this.dbProvider();
    const rows = await db.query<{ current_state: string }>(
      'SELECT current_state FROM work_centers WHERE id = ?',
      [workCenterId]
    );
    if (rows.length > 0 && rows[0].current_state === 'QUALITY_HOLD') {
      return { active: true, reason: 'Work center state is QUALITY_HOLD in DB' };
    }
    return { active: false, reason: null };
  }

  public async applyParameters(
    workCenterId: string,
    commands: MachineParameterCommand[],
    options?: { triggerCondition?: string; recipeId?: string }
  ): Promise<ParameterApplyResult> {
    const adapter = this.getAdapter(workCenterId);
    if (!adapter) {
      return {
        success: false,
        workCenterId,
        appliedCommands: [],
        error: `No equipment adapter registered for work center [${workCenterId}]`
      };
    }

    const capabilities = adapter.getCapabilities();
    if (!capabilities.includes('PARAMETER_MODIFICATION')) {
      throw new Error(
        `Equipment [${adapter.id}] at work center [${workCenterId}] does not support PARAMETER_MODIFICATION`
      );
    }

    await adapter.applyParameters(commands);

    const eventStore = this.eventStoreProvider();
    let lastAuditEventId: string | undefined;

    for (const cmd of commands) {
      let paramName: 'SQUEEGEE_PRESSURE' | 'SEPARATION_SPEED' | 'PRINT_SPEED' = 'SQUEEGEE_PRESSURE';
      let unit = cmd.unit || 'kgf';
      if (cmd.type === 'PRINTER_PRESSURE') {
        paramName = 'SQUEEGEE_PRESSURE';
        unit = cmd.unit || 'kgf';
      } else if (cmd.type === 'PRINTER_SEPARATION_SPEED') {
        paramName = 'SEPARATION_SPEED';
        unit = cmd.unit || 'mm/s';
      } else if (cmd.type === 'PRINTER_PRINT_SPEED') {
        paramName = 'PRINT_SPEED';
        unit = cmd.unit || 'mm/s';
      }

      const appendRes = await eventStore.append({
        eventType: 'PRINTER_PARAMETERS_MODIFIED',
        workCenterId,
        sourceType: 'PRINTER_CONTROLLER',
        sourceId: adapter.id,
        payload: {
          correctionId: uuidv4(),
          workCenterId,
          parameterName: paramName,
          oldValue: cmd.value,
          proposedValue: cmd.value,
          delta: 0,
          unit,
          triggerCondition: options?.triggerCondition || 'ClosedLoopOptimization',
          recipeId: options?.recipeId || 'PROG-SM-METER-TOP-REV4'
        }
      });
      lastAuditEventId = appendRes.eventId;
    }

    return {
      success: true,
      workCenterId,
      appliedCommands: commands,
      auditEventId: lastAuditEventId
    };
  }

  public async executeAction(
    workCenterId: string,
    command: MachineActionCommand
  ): Promise<ActionExecuteResult> {
    const adapter = this.getAdapter(workCenterId);
    if (!adapter) {
      return {
        success: false,
        workCenterId,
        command,
        error: `No equipment adapter registered for work center [${workCenterId}]`
      };
    }

    const capabilities = adapter.getCapabilities();
    if (command.type === 'CLEANING' && !capabilities.includes('CLEANING')) {
      throw new Error(`Equipment [${adapter.id}] does not support CLEANING capability`);
    }
    if (command.type === 'DIVERT' && !capabilities.includes('DIVERT')) {
      throw new Error(`Equipment [${adapter.id}] does not support DIVERT capability`);
    }
    if (command.type === 'PURGE' && !capabilities.includes('PURGE')) {
      throw new Error(`Equipment [${adapter.id}] does not support PURGE capability`);
    }

    await adapter.executeAction(command);

    const eventStore = this.eventStoreProvider();
    let auditEventId: string | undefined;

    if (command.type === 'CLEANING') {
      const appendRes = await eventStore.append({
        eventType: 'PRINTER_CLEANING_COMMANDED',
        workCenterId,
        sourceType: 'PRINTER_CONTROLLER',
        sourceId: adapter.id,
        payload: {
          correctionId: uuidv4(),
          workCenterId,
          cleaningMode: command.mode,
          triggerCondition: command.triggerReason || 'AutomatedMaintenance'
        }
      });
      auditEventId = appendRes.eventId;
    } else if (command.type === 'DIVERT') {
      const appendRes = await eventStore.append({
        eventType: 'PRE_REFLOW_PANEL_DIVERTED',
        workCenterId,
        sourceType: 'SYSTEM',
        sourceId: adapter.id,
        payload: {
          panelBarcode: `DIVERT-${Date.now()}`,
          divertTarget: command.targetConveyorId,
          reason: command.triggerReason || 'DefectDivert'
        }
      });
      auditEventId = appendRes.eventId;
    }

    return {
      success: true,
      workCenterId,
      command,
      auditEventId
    };
  }
}
