import {
  IControllableEquipmentAdapter,
  MachineCapability,
  MachineParameterCommand,
  MachineActionCommand
} from '../../adapters/equipment-adapter.interface';

export interface InterlockTripResult {
  success: boolean;
  workCenterId: string;
  holdActive: boolean;
  reason: string;
  auditEventId?: string;
}

export interface InterlockClearResult {
  success: boolean;
  workCenterId: string;
  authorizedBy: string;
  reason: string;
  auditEventId?: string;
}

export interface ParameterApplyResult {
  success: boolean;
  workCenterId: string;
  appliedCommands: MachineParameterCommand[];
  auditEventId?: string;
  error?: string;
}

export interface ActionExecuteResult {
  success: boolean;
  workCenterId: string;
  command: MachineActionCommand;
  auditEventId?: string;
  error?: string;
}

export interface IMachineControlModule {
  registerAdapter(adapter: IControllableEquipmentAdapter): void;
  getAdapter(workCenterIdOrId: string): IControllableEquipmentAdapter | undefined;
  getCapabilities(workCenterId: string): MachineCapability[];
  tripInterlock(
    workCenterId: string,
    reason: string,
    context?: {
      sourceId?: string;
      programId?: string;
      refDes?: string;
      defectType?: string;
      [key: string]: any;
    }
  ): Promise<InterlockTripResult>;
  clearInterlock(
    workCenterId: string,
    authorizedBy: string,
    reason: string
  ): Promise<InterlockClearResult>;
  isHoldActive(workCenterId: string): Promise<{ active: boolean; reason: string | null }>;
  applyParameters(
    workCenterId: string,
    commands: MachineParameterCommand[],
    options?: { triggerCondition?: string; recipeId?: string }
  ): Promise<ParameterApplyResult>;
  executeAction(
    workCenterId: string,
    command: MachineActionCommand
  ): Promise<ActionExecuteResult>;
}
