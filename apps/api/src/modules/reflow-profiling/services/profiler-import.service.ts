import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ReflowProfileRun,
  ReflowProfileProbe,
  ReflowProfileUploadedPayload,
  ReflowProfileValidatedPayload,
  ReflowProfileComplianceEvaluatedPayload
} from '@mes/shared';
import {
  IProfilerImporter,
  ProfilerFile,
  RawProfilerRun
} from '../adapters/profiler-importer.interface';
import { KicImporterAdapter } from '../adapters/kic-importer.adapter';
import { DatapaqImporterAdapter } from '../adapters/datapaq-importer.adapter';
import { MoleImporterAdapter } from '../adapters/mole-importer.adapter';
import { IReflowProfileDataStore } from '../storage/reflow-profile.store.interface';
import { RecipeSpecificationService } from './recipe-specification.service';
import { PwiCalculationService } from './pwi-calculation.service';
import { EventStoreModule } from '../../event-store/event-store.module';

export interface ImportProfileRunParams {
  file: ProfilerFile;
  lineId: string;
  equipmentId: string;
  recipeId: string;
  boardPartNumber: string;
  boardRevision: string;
  importedBy: string;
}

export class ProfilerImportService {
  private importers: IProfilerImporter[];

  constructor(
    private store: IReflowProfileDataStore,
    private specService: RecipeSpecificationService,
    private pwiService: PwiCalculationService,
    private eventStore: EventStoreModule = EventStoreModule.getInstance(),
    importers?: IProfilerImporter[]
  ) {
    this.importers = importers || [
      new KicImporterAdapter(),
      new DatapaqImporterAdapter(),
      new MoleImporterAdapter()
    ];
  }

  public registerImporter(importer: IProfilerImporter): void {
    this.importers.unshift(importer);
  }

  public async importProfileFile(
    params: ImportProfileRunParams
  ): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] }> {
    const { file, lineId, equipmentId, recipeId, boardPartNumber, boardRevision, importedBy } = params;
    const now = new Date().toISOString();

    // 1. Server-side SHA-256 calculation
    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 2. Idempotency check: hash + scope
    const existingRun = await this.store.getProfileRunBySha(sha256);
    if (existingRun &&
        existingRun.applicabilityKey.lineId === lineId &&
        existingRun.applicabilityKey.equipmentId === equipmentId &&
        existingRun.applicabilityKey.recipeId === recipeId &&
        existingRun.applicabilityKey.boardPartNumber === boardPartNumber &&
        existingRun.applicabilityKey.boardRevision === boardRevision) {
      const probes = await this.store.getProbesForRun(existingRun.id);
      return { run: existingRun, probes };
    }

    // 3. Adapter Sniffing & Detection
    const adapter = this.importers.find((imp) => imp.canParse(file));
    if (!adapter) {
      throw new Error(`UNSUPPORTED_FORMAT: No compatible profiler adapter found for file "${file.fileName}"`);
    }

    const runId = `run-prf-${Date.now()}-${uuidv4().slice(0, 8)}`;

    // 4. Emit REFLOW_PROFILE_UPLOADED
    const uploadPayload: ReflowProfileUploadedPayload = {
      profileRunId: runId,
      fileName: file.fileName,
      fileSha256: sha256,
      fileSizeBytes: file.fileSizeBytes,
      vendorFormat: adapter.vendorFormat,
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision,
      uploadedBy: importedBy,
      uploadedAt: now
    };

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'REFLOW_PROFILE_UPLOADED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'PROFILER_GATEWAY',
      sourceId: equipmentId,
      lineId,
      workCenterId: equipmentId,
      operatorId: importedBy,
      payload: uploadPayload
    });

    // 5. Parse execution with error handling
    let rawRun: RawProfilerRun;
    try {
      rawRun = await adapter.parse(file);
    } catch (err: any) {
      // Record failed run for audit tracking
      const failedRun: ReflowProfileRun = {
        id: runId,
        applicabilityKey: { lineId, equipmentId, recipeId, boardPartNumber, boardRevision },
        fileMetadata: {
          originalFileName: file.fileName,
          fileSizeBytes: file.fileSizeBytes,
          fileSha256: sha256,
          vendorFormat: adapter.vendorFormat,
          uploadedAt: now,
          uploadedBy: importedBy
        },
        profilerHardware: {
          manufacturer: adapter.vendorFormat,
          model: 'UNKNOWN',
          serialNumber: 'UNKNOWN',
          totalProbesUsed: 0,
          sampleIntervalSeconds: 1.0,
          sampleCount: 0
        },
        specificationReference: {
          specificationId: 'UNKNOWN',
          specificationVersion: 0,
          alloy: 'UNKNOWN'
        },
        analysisResult: {
          calculationVersion: this.pwiService.calculationVersion,
          overallPwi: 999.0,
          worstProbeIndex: 0,
          worstCharacteristic: 'PEAK',
          complianceResult: 'FAIL',
          evaluatedAt: now
        },
        status: 'PARSE_FAILED'
      };
      await this.store.saveProfileRun(failedRun);
      throw err;
    }

    // 6. Structural validation
    const validationErrors: string[] = [];
    if (!rawRun.probes || rawRun.probes.length === 0) {
      validationErrors.push('NO_PROBES_FOUND: Profiler file contains zero thermocouple channels');
    }

    for (const p of rawRun.probes || []) {
      if (!p.samples || p.samples.length < 2) {
        validationErrors.push(`INSUFFICIENT_SAMPLES: Probe ${p.probeIndex} has less than 2 data samples`);
      }
      for (let s = 1; s < (p.samples?.length || 0); s++) {
        if (p.samples[s].timeSeconds < p.samples[s - 1].timeSeconds) {
          validationErrors.push(`NON_MONOTONIC_TIMESTAMPS: Probe ${p.probeIndex} time decreased at sample ${s}`);
          break;
        }
      }
    }

    if (validationErrors.length > 0) {
      const validationFailedRun: ReflowProfileRun = {
        id: runId,
        applicabilityKey: { lineId, equipmentId, recipeId, boardPartNumber, boardRevision },
        fileMetadata: {
          originalFileName: file.fileName,
          fileSizeBytes: file.fileSizeBytes,
          fileSha256: sha256,
          vendorFormat: adapter.vendorFormat,
          uploadedAt: now,
          uploadedBy: importedBy
        },
        profilerHardware: rawRun.profilerHardware,
        specificationReference: {
          specificationId: 'UNKNOWN',
          specificationVersion: 0,
          alloy: 'UNKNOWN'
        },
        analysisResult: {
          calculationVersion: this.pwiService.calculationVersion,
          overallPwi: 999.0,
          worstProbeIndex: 0,
          worstCharacteristic: 'PEAK',
          complianceResult: 'FAIL',
          evaluatedAt: now
        },
        status: 'VALIDATION_FAILED'
      };
      await this.store.saveProfileRun(validationFailedRun);
      throw new Error(`VALIDATION_FAILED: ${validationErrors.join('; ')}`);
    }

    // Emit REFLOW_PROFILE_VALIDATED
    const maxDuration = Math.max(...rawRun.probes.map((p) => p.samples[p.samples.length - 1].timeSeconds));
    const validatedPayload: ReflowProfileValidatedPayload = {
      profileRunId: runId,
      vendorFormat: adapter.vendorFormat,
      probeCount: rawRun.probes.length,
      sampleCount: rawRun.profilerHardware.sampleCount,
      durationSeconds: Number(maxDuration.toFixed(2)),
      status: 'SUCCESS'
    };

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'REFLOW_PROFILE_VALIDATED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'PROFILER_GATEWAY',
      sourceId: equipmentId,
      lineId,
      workCenterId: equipmentId,
      operatorId: importedBy,
      payload: validatedPayload
    });

    // 7. Resolve Active Thermal Specification
    const spec = await this.specService.getActiveSpecification(recipeId, boardPartNumber, boardRevision);
    if (!spec) {
      throw new Error(
        `SPECIFICATION_NOT_FOUND: No active ReflowThermalSpecification found for recipe=${recipeId}, part=${boardPartNumber}, rev=${boardRevision}`
      );
    }

    // 8. PWI Engine Evaluation
    const pwiResult = this.pwiService.evaluateRun(rawRun.probes, spec);

    // Emit REFLOW_PROFILE_COMPLIANCE_EVALUATED
    const compliancePayload: ReflowProfileComplianceEvaluatedPayload = {
      profileRunId: runId,
      specificationId: spec.id,
      specificationVersion: spec.specificationVersion,
      overallPwi: pwiResult.overallPwi,
      complianceResult: pwiResult.complianceResult,
      evaluatedAt: now,
      worstProbeIndex: pwiResult.worstProbeIndex,
      worstCharacteristic: pwiResult.worstCharacteristic,
      probeResults: pwiResult.probes.map((p) => ({
        probeIndex: p.probeIndex,
        label: p.label,
        pwi: p.pwi
      }))
    };

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'REFLOW_PROFILE_COMPLIANCE_EVALUATED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'PROFILER_GATEWAY',
      sourceId: equipmentId,
      lineId,
      workCenterId: equipmentId,
      operatorId: importedBy,
      payload: compliancePayload
    });

    // 9. Build and persist ReflowProfileRun and Probes
    const profileRun: ReflowProfileRun = {
      id: runId,
      applicabilityKey: { lineId, equipmentId, recipeId, boardPartNumber, boardRevision },
      fileMetadata: {
        originalFileName: file.fileName,
        fileSizeBytes: file.fileSizeBytes,
        fileSha256: sha256,
        vendorFormat: adapter.vendorFormat,
        uploadedAt: now,
        uploadedBy: importedBy
      },
      profilerHardware: rawRun.profilerHardware,
      ovenSettingsSnapshot: rawRun.ovenSettings ? {
        recipeName: rawRun.ovenSettings.recipeName || recipeId,
        conveyorSpeedCmPerMin: rawRun.ovenSettings.conveyorSpeedCmPerMin || 90.0,
        zoneSetpointsC: rawRun.ovenSettings.zoneSetpointsC || []
      } : undefined,
      specificationReference: {
        specificationId: spec.id,
        specificationVersion: spec.specificationVersion,
        alloy: spec.alloy
      },
      analysisResult: {
        calculationVersion: this.pwiService.calculationVersion,
        overallPwi: pwiResult.overallPwi,
        worstProbeIndex: pwiResult.worstProbeIndex,
        worstCharacteristic: pwiResult.worstCharacteristic,
        complianceResult: pwiResult.complianceResult,
        evaluatedAt: now
      },
      status: 'REVIEW_REQUIRED'
    };

    const probes: ReflowProfileProbe[] = pwiResult.probes.map((p) => {
      const raw = rawRun.probes.find((rp) => rp.probeIndex === p.probeIndex)!;
      return {
        id: `probe-${runId}-${p.probeIndex}`,
        profileRunId: runId,
        probeIndex: p.probeIndex,
        label: p.label,
        thermalRole: raw.thermalRole || 'BOARD_SURFACE',
        componentRefDes: raw.componentRefDes,
        packageType: raw.packageType,
        calibration: {
          calibrationOffsetC: raw.calibrationOffsetC,
          calibrationSource: raw.calibrationOffsetC ? 'VENDOR_FILE' : 'NONE'
        },
        metrics: p.metrics,
        pwi: p.pwi,
        samples: raw.samples
      };
    });

    await this.store.saveProfileRun(profileRun, probes);

    return { run: profileRun, probes };
  }
}
