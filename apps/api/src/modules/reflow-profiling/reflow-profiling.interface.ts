import {
  ReflowThermalSpecification,
  ReflowProfileRun,
  ReflowProfileProbe,
  ReflowProcessState,
  OvenDriftReport,
  ProfileTelemetryCorrelation
} from '@mes/shared';
import { ImportProfileRunParams } from './services/profiler-import.service';
import { EvaluateOvenDriftParams } from './services/oven-drift.service';

export interface IReflowProfilingModule {
  // 1. Profiler Ingress & Lifecycle
  importProfileRun(params: ImportProfileRunParams): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] }>;
  approveProfileRun(params: {
    runId: string;
    approvedBy: string;
    electronicSignature?: {
      signerName: string;
      signerRole: string;
      meaning: string;
      timestamp: string;
    };
    comments?: string;
  }): Promise<ReflowProfileRun>;
  rejectProfileRun(params: {
    runId: string;
    rejectedBy: string;
    reason: string;
  }): Promise<ReflowProfileRun>;
  activateProfileRun(params: {
    runId: string;
    activatedBy: string;
  }): Promise<ReflowProfileRun>;

  // 2. Profile Query & History
  getActiveProfile(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    includeProbes?: boolean;
  }): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] } | null>;
  getProfileRunById(profileRunId: string, includeProbes?: boolean): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] } | null>;

  // 3. Telemetry Drift Analysis & Compliance Evaluation
  evaluateOvenDrift(params: EvaluateOvenDriftParams): Promise<OvenDriftReport>;
  correlateProfileWithTelemetry(profileRunId: string, windowMinutes?: number): Promise<ProfileTelemetryCorrelation>;
  getProcessState(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
  }): Promise<ReflowProcessState | null>;

  // 4. Recipe Thermal Specifications
  getThermalSpecification(params: {
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    version?: number;
  }): Promise<ReflowThermalSpecification | null>;
  registerThermalSpecification(
    spec: Omit<ReflowThermalSpecification, 'id' | 'specificationVersion' | 'status' | 'createdAt'>
  ): Promise<ReflowThermalSpecification>;
}
