import {
  ReflowThermalSpecification,
  ReflowProfileRun,
  ReflowProfileProbe,
  ReflowProcessState,
  ProfileTelemetryCorrelation
} from '@mes/shared';

export interface IReflowProfileDataStore {
  // Thermal Specifications
  saveSpecification(spec: ReflowThermalSpecification): Promise<void>;
  getSpecification(recipeId: string, boardPartNumber: string, boardRevision: string, version?: number): Promise<ReflowThermalSpecification | null>;
  getActiveSpecification(recipeId: string, boardPartNumber: string, boardRevision: string): Promise<ReflowThermalSpecification | null>;

  // Physical Profile Runs
  saveProfileRun(run: ReflowProfileRun, probes?: ReflowProfileProbe[]): Promise<void>;
  getProfileRunById(id: string, includeProbes?: boolean): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] } | null>;
  getActiveProfileRun(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    includeProbes?: boolean;
  }): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] } | null>;
  getProfileRunBySha(sha256: string): Promise<ReflowProfileRun | null>;
  updateProfileRunStatus(
    id: string,
    status: ReflowProfileRun['status'],
    details?: {
      approvedBy?: string;
      approvedAt?: string;
      activatedAt?: string;
      retiredAt?: string;
      approvalAudit?: ReflowProfileRun['approvalAudit'];
    }
  ): Promise<void>;
  activateProfileRunAtomic(params: {
    runId: string;
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    activatedBy: string;
  }): Promise<void>;

  // Probes
  getProbesForRun(profileRunId: string): Promise<ReflowProfileProbe[]>;

  // Process States
  saveProcessState(state: ReflowProcessState): Promise<void>;
  getProcessState(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
  }): Promise<ReflowProcessState | null>;
  listProcessStatesByLine(lineId: string): Promise<ReflowProcessState[]>;

  // Profile-Telemetry Correlations
  saveCorrelation(correlation: ProfileTelemetryCorrelation): Promise<void>;
  getCorrelation(profileRunId: string): Promise<ProfileTelemetryCorrelation | null>;
}
