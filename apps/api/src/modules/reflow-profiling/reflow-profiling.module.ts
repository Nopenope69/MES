import {
  ReflowThermalSpecification,
  ReflowProfileRun,
  ReflowProfileProbe,
  ReflowProcessState,
  OvenDriftReport,
  ProfileTelemetryCorrelation
} from '@mes/shared';
import { getDatabase, IDatabase } from '../../db/database';
import { IReflowProfilingModule } from './reflow-profiling.interface';
import { IReflowProfileDataStore } from './storage/reflow-profile.store.interface';
import { ReflowProfileStore } from './storage/reflow-profile.store';
import { RecipeSpecificationService } from './services/recipe-specification.service';
import { PwiCalculationService } from './services/pwi-calculation.service';
import { ProfileLifecycleService } from './services/profile-lifecycle.service';
import { ProfilerImportService, ImportProfileRunParams } from './services/profiler-import.service';
import { ProfileCorrelationService } from './services/profile-correlation.service';
import { ThermalImpactService } from './services/thermal-impact.service';
import { OvenDriftService, EvaluateOvenDriftParams } from './services/oven-drift.service';
import { ITelemetryStore, TelemetryStore } from '../../services/telemetry-store.service';
import { IMachineControlModule } from '../machine-control/machine-control.interface';
import { MachineControlModule } from '../machine-control/machine-control.module';
import { EventStoreModule } from '../event-store/event-store.module';

export class ReflowProfilingModule implements IReflowProfilingModule {
  private static instance: ReflowProfilingModule | null = null;

  private store: IReflowProfileDataStore;
  private specService: RecipeSpecificationService;
  private pwiService: PwiCalculationService;
  private lifecycleService: ProfileLifecycleService;
  private importService: ProfilerImportService;
  private correlationService: ProfileCorrelationService;
  private thermalImpactService: ThermalImpactService;
  private driftService: OvenDriftService;

  constructor(options?: {
    db?: IDatabase;
    store?: IReflowProfileDataStore;
    telemetryStore?: ITelemetryStore;
    machineControl?: IMachineControlModule;
    eventStore?: EventStoreModule;
  }) {
    const db = options?.db || getDatabase();
    this.store = options?.store || new ReflowProfileStore(db);
    this.specService = new RecipeSpecificationService(this.store);
    this.pwiService = new PwiCalculationService();

    const eventStore = options?.eventStore || EventStoreModule.getInstance();
    const telemetryStore = options?.telemetryStore || TelemetryStore.getInstance();
    const machineControl = options?.machineControl || MachineControlModule.getInstance();

    this.lifecycleService = new ProfileLifecycleService(this.store, eventStore);
    this.importService = new ProfilerImportService(this.store, this.specService, this.pwiService, eventStore);
    this.correlationService = new ProfileCorrelationService(this.store, telemetryStore);
    this.thermalImpactService = new ThermalImpactService();
    this.driftService = new OvenDriftService(
      this.store,
      this.specService,
      this.thermalImpactService,
      telemetryStore,
      machineControl,
      eventStore
    );
  }

  public static getInstance(options?: {
    db?: IDatabase;
    store?: IReflowProfileDataStore;
    telemetryStore?: ITelemetryStore;
    machineControl?: IMachineControlModule;
    eventStore?: EventStoreModule;
  }): ReflowProfilingModule {
    if (!this.instance) {
      this.instance = new ReflowProfilingModule(options);
    }
    return this.instance;
  }

  public static resetInstance(): void {
    this.instance = null;
  }

  // 1. Profiler Ingress & Lifecycle
  async importProfileRun(params: ImportProfileRunParams): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] }> {
    return this.importService.importProfileFile(params);
  }

  async approveProfileRun(params: {
    runId: string;
    approvedBy: string;
    electronicSignature?: {
      signerName: string;
      signerRole: string;
      meaning: string;
      timestamp: string;
    };
    comments?: string;
  }): Promise<ReflowProfileRun> {
    return this.lifecycleService.approveProfileRun(params);
  }

  async rejectProfileRun(params: {
    runId: string;
    rejectedBy: string;
    reason: string;
  }): Promise<ReflowProfileRun> {
    return this.lifecycleService.rejectProfileRun(params);
  }

  async activateProfileRun(params: {
    runId: string;
    activatedBy: string;
  }): Promise<ReflowProfileRun> {
    return this.lifecycleService.activateProfileRun(params);
  }

  // 2. Profile Query & History
  async getActiveProfile(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    includeProbes?: boolean;
  }): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] } | null> {
    return this.store.getActiveProfileRun(params);
  }

  async getProfileRunById(
    profileRunId: string,
    includeProbes: boolean = true
  ): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] } | null> {
    return this.store.getProfileRunById(profileRunId, includeProbes);
  }

  // 3. Telemetry Drift Analysis & Compliance Evaluation
  async evaluateOvenDrift(params: EvaluateOvenDriftParams): Promise<OvenDriftReport> {
    return this.driftService.evaluateOvenDrift(params);
  }

  async correlateProfileWithTelemetry(
    profileRunId: string,
    windowMinutes?: number
  ): Promise<ProfileTelemetryCorrelation> {
    return this.correlationService.correlateProfileWithTelemetry(profileRunId, windowMinutes);
  }

  async getProcessState(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
  }): Promise<ReflowProcessState | null> {
    return this.store.getProcessState(params);
  }

  // 4. Recipe Thermal Specifications
  async getThermalSpecification(params: {
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    version?: number;
  }): Promise<ReflowThermalSpecification | null> {
    return this.specService.getSpecification(
      params.recipeId,
      params.boardPartNumber,
      params.boardRevision,
      params.version
    );
  }

  async registerThermalSpecification(
    spec: Omit<ReflowThermalSpecification, 'id' | 'specificationVersion' | 'status' | 'createdAt'>
  ): Promise<ReflowThermalSpecification> {
    return this.specService.registerSpecification(spec);
  }
}
