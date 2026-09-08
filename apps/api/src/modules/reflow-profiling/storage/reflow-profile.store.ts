import { IDatabase } from '../../../db/database';
import {
  ReflowThermalSpecification,
  ReflowProfileRun,
  ReflowProfileProbe,
  ReflowProcessState,
  ProfileTelemetryCorrelation
} from '@mes/shared';
import { IReflowProfileDataStore } from './reflow-profile.store.interface';

export class ReflowProfileStore implements IReflowProfileDataStore {
  constructor(private db: IDatabase) {}

  // --------------------------------------------------------------------------
  // Thermal Specifications
  // --------------------------------------------------------------------------

  async saveSpecification(spec: ReflowThermalSpecification): Promise<void> {
    const specJson = JSON.stringify({
      rampRate: spec.rampRate,
      soak: spec.soak,
      tal: spec.tal,
      peak: spec.peak,
      cooling: spec.cooling,
      conveyorSpeedLimit: spec.conveyorSpeedLimit,
      oxygenControl: spec.oxygenControl,
      zoneTolerancesC: spec.zoneTolerancesC,
      variabilityLimitC: spec.variabilityLimitC,
      minimumSigmaC: spec.minimumSigmaC,
      createdBy: spec.createdBy,
      createdAt: spec.createdAt
    });

    await this.db.execute(`
      INSERT INTO reflow_thermal_specifications (
        id, recipe_id, board_part_number, board_revision, specification_version,
        status, alloy, specification_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(recipe_id, board_part_number, board_revision, specification_version) DO UPDATE SET
        status = excluded.status,
        alloy = excluded.alloy,
        specification_json = excluded.specification_json
    `, [
      spec.id,
      spec.recipeId,
      spec.boardPartNumber,
      spec.boardRevision,
      spec.specificationVersion,
      spec.status,
      spec.alloy,
      specJson,
      spec.createdBy,
      spec.createdAt
    ]);
  }

  async getSpecification(
    recipeId: string,
    boardPartNumber: string,
    boardRevision: string,
    version?: number
  ): Promise<ReflowThermalSpecification | null> {
    let sql = `
      SELECT * FROM reflow_thermal_specifications
      WHERE recipe_id = ? AND board_part_number = ? AND board_revision = ?
    `;
    const params: any[] = [recipeId, boardPartNumber, boardRevision];

    if (version !== undefined) {
      sql += ` AND specification_version = ?`;
      params.push(version);
    } else {
      sql += ` ORDER BY specification_version DESC LIMIT 1`;
    }

    const rows = await this.db.query(sql, params);
    if (!rows || rows.length === 0) {
      return null;
    }

    return this.mapSpecificationRow(rows[0]);
  }

  async getActiveSpecification(
    recipeId: string,
    boardPartNumber: string,
    boardRevision: string
  ): Promise<ReflowThermalSpecification | null> {
    const rows = await this.db.query(`
      SELECT * FROM reflow_thermal_specifications
      WHERE recipe_id = ? AND board_part_number = ? AND board_revision = ? AND status = 'ACTIVE'
      ORDER BY specification_version DESC LIMIT 1
    `, [recipeId, boardPartNumber, boardRevision]);

    if (!rows || rows.length === 0) {
      return null;
    }

    return this.mapSpecificationRow(rows[0]);
  }

  private mapSpecificationRow(row: any): ReflowThermalSpecification {
    const details = JSON.parse(row.specification_json);
    return {
      id: row.id,
      recipeId: row.recipe_id,
      boardPartNumber: row.board_part_number,
      boardRevision: row.board_revision,
      specificationVersion: Number(row.specification_version),
      status: row.status,
      alloy: row.alloy,
      rampRate: details.rampRate,
      soak: details.soak,
      tal: details.tal,
      peak: details.peak,
      cooling: details.cooling,
      conveyorSpeedLimit: details.conveyorSpeedLimit,
      oxygenControl: details.oxygenControl,
      zoneTolerancesC: details.zoneTolerancesC,
      variabilityLimitC: details.variabilityLimitC,
      minimumSigmaC: details.minimumSigmaC,
      createdBy: row.created_by,
      createdAt: row.created_at
    };
  }

  // --------------------------------------------------------------------------
  // Physical Profile Runs
  // --------------------------------------------------------------------------

  async saveProfileRun(run: ReflowProfileRun, probes?: ReflowProfileProbe[]): Promise<void> {
    const metadataJson = JSON.stringify({
      fileMetadata: run.fileMetadata,
      profilerHardware: run.profilerHardware,
      ovenSettingsSnapshot: run.ovenSettingsSnapshot,
      specificationReference: run.specificationReference,
      analysisResult: run.analysisResult,
      approvalAudit: run.approvalAudit
    });

    await this.db.withTransaction(async (tx) => {
      await tx.execute(`
        INSERT INTO reflow_profile_runs (
          id, line_id, equipment_id, recipe_id, board_part_number, board_revision,
          file_sha256, specification_id, specification_version, calculation_version,
          overall_pwi, compliance_result, status, metadata_json,
          imported_by, imported_at, approved_by, approved_at, activated_at, retired_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          overall_pwi = excluded.overall_pwi,
          compliance_result = excluded.compliance_result,
          status = excluded.status,
          metadata_json = excluded.metadata_json,
          approved_by = excluded.approved_by,
          approved_at = excluded.approved_at,
          activated_at = excluded.activated_at,
          retired_at = excluded.retired_at
      `, [
        run.id,
        run.applicabilityKey.lineId,
        run.applicabilityKey.equipmentId,
        run.applicabilityKey.recipeId,
        run.applicabilityKey.boardPartNumber,
        run.applicabilityKey.boardRevision,
        run.fileMetadata.fileSha256,
        run.specificationReference.specificationId,
        run.specificationReference.specificationVersion,
        run.analysisResult.calculationVersion,
        run.analysisResult.overallPwi,
        run.analysisResult.complianceResult,
        run.status,
        metadataJson,
        run.fileMetadata.uploadedBy,
        run.fileMetadata.uploadedAt,
        run.approvalAudit?.approvedBy || null,
        run.approvalAudit?.approvedAt || null,
        run.activatedAt || null,
        run.retiredAt || null
      ]);

      if (probes && probes.length > 0) {
        for (const p of probes) {
          await tx.execute(`
            INSERT INTO reflow_profile_probes (
              id, profile_run_id, probe_index, label, thermal_role,
              metrics_json, pwi_json, samples_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(profile_run_id, probe_index) DO UPDATE SET
              label = excluded.label,
              thermal_role = excluded.thermal_role,
              metrics_json = excluded.metrics_json,
              pwi_json = excluded.pwi_json,
              samples_json = excluded.samples_json
          `, [
            p.id,
            p.profileRunId,
            p.probeIndex,
            p.label,
            p.thermalRole,
            JSON.stringify(p.metrics),
            JSON.stringify(p.pwi),
            JSON.stringify(p.samples)
          ]);
        }
      }
    });
  }

  async getProfileRunById(
    id: string,
    includeProbes: boolean = true
  ): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] } | null> {
    const rows = await this.db.query(`
      SELECT * FROM reflow_profile_runs WHERE id = ?
    `, [id]);

    if (!rows || rows.length === 0) {
      return null;
    }

    const run = this.mapProfileRunRow(rows[0]);
    let probes: ReflowProfileProbe[] = [];
    if (includeProbes) {
      probes = await this.getProbesForRun(id);
    }

    return { run, probes };
  }

  async getActiveProfileRun(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    includeProbes?: boolean;
  }): Promise<{ run: ReflowProfileRun; probes: ReflowProfileProbe[] } | null> {
    const rows = await this.db.query(`
      SELECT * FROM reflow_profile_runs
      WHERE line_id = ? AND equipment_id = ? AND recipe_id = ? AND board_part_number = ? AND board_revision = ? AND status = 'ACTIVE'
      LIMIT 1
    `, [
      params.lineId,
      params.equipmentId,
      params.recipeId,
      params.boardPartNumber,
      params.boardRevision
    ]);

    if (!rows || rows.length === 0) {
      return null;
    }

    const run = this.mapProfileRunRow(rows[0]);
    let probes: ReflowProfileProbe[] = [];
    if (params.includeProbes) {
      probes = await this.getProbesForRun(run.id);
    }

    return { run, probes };
  }

  async getProfileRunBySha(sha256: string): Promise<ReflowProfileRun | null> {
    const rows = await this.db.query(`
      SELECT * FROM reflow_profile_runs WHERE file_sha256 = ? LIMIT 1
    `, [sha256]);

    if (!rows || rows.length === 0) {
      return null;
    }

    return this.mapProfileRunRow(rows[0]);
  }

  async updateProfileRunStatus(
    id: string,
    status: ReflowProfileRun['status'],
    details?: {
      approvedBy?: string;
      approvedAt?: string;
      activatedAt?: string;
      retiredAt?: string;
      approvalAudit?: ReflowProfileRun['approvalAudit'];
    }
  ): Promise<void> {
    const runResult = await this.getProfileRunById(id, false);
    if (!runResult) {
      throw new Error(`Profile run not found: ${id}`);
    }

    const { run } = runResult;
    run.status = status;
    if (details?.approvedBy) run.approvalAudit = { ...(run.approvalAudit || {}), approvedBy: details.approvedBy, approvedAt: details.approvedAt || new Date().toISOString() };
    if (details?.approvalAudit) run.approvalAudit = details.approvalAudit;
    if (details?.activatedAt) run.activatedAt = details.activatedAt;
    if (details?.retiredAt) run.retiredAt = details.retiredAt;

    await this.saveProfileRun(run);
  }

  async activateProfileRunAtomic(params: {
    runId: string;
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    activatedBy: string;
  }): Promise<void> {
    const now = new Date().toISOString();

    await this.db.withTransaction(async (tx) => {
      // 1. Verify target run exists and is eligible
      const rows = await tx.query(`
        SELECT * FROM reflow_profile_runs WHERE id = ?
      `, [params.runId]);

      if (!rows || rows.length === 0) {
        throw new Error(`Profile run not found: ${params.runId}`);
      }

      const target = rows[0];
      const pwi = Number(target.overall_pwi);
      if (target.compliance_result === 'FAIL' || pwi > 100.0) {
        throw new Error(
          `CANNOT_ACTIVATE_NON_COMPLIANT_PROFILE: Cannot activate profile run with PWI > 100% (overallPwi=${pwi}, complianceResult=${target.compliance_result})`
        );
      }

      // 2. Retire any currently ACTIVE run on this applicability scope
      await tx.execute(`
        UPDATE reflow_profile_runs
        SET status = 'RETIRED', retired_at = ?
        WHERE line_id = ? AND equipment_id = ? AND recipe_id = ? AND board_part_number = ? AND board_revision = ?
          AND status = 'ACTIVE' AND id != ?
      `, [
        now,
        params.lineId,
        params.equipmentId,
        params.recipeId,
        params.boardPartNumber,
        params.boardRevision,
        params.runId
      ]);

      // 3. Update target run to ACTIVE
      const metadata = JSON.parse(target.metadata_json);
      metadata.activatedBy = params.activatedBy;
      metadata.activatedAt = now;

      await tx.execute(`
        UPDATE reflow_profile_runs
        SET status = 'ACTIVE', activated_at = ?, metadata_json = ?
        WHERE id = ?
      `, [now, JSON.stringify(metadata), params.runId]);

      // 4. Update process state active pointer
      await tx.execute(`
        UPDATE reflow_process_states
        SET active_profile_run_id = ?, last_evaluated_at = ?
        WHERE line_id = ? AND equipment_id = ? AND recipe_id = ? AND board_part_number = ? AND board_revision = ?
      `, [
        params.runId,
        now,
        params.lineId,
        params.equipmentId,
        params.recipeId,
        params.boardPartNumber,
        params.boardRevision
      ]);
    });
  }

  private mapProfileRunRow(row: any): ReflowProfileRun {
    const meta = JSON.parse(row.metadata_json);
    return {
      id: row.id,
      applicabilityKey: {
        lineId: row.line_id,
        equipmentId: row.equipment_id,
        recipeId: row.recipe_id,
        boardPartNumber: row.board_part_number,
        boardRevision: row.board_revision
      },
      fileMetadata: meta.fileMetadata || {
        originalFileName: 'unknown',
        fileSizeBytes: 0,
        fileSha256: row.file_sha256,
        vendorFormat: 'GENERIC_CSV',
        uploadedAt: row.imported_at,
        uploadedBy: row.imported_by
      },
      profilerHardware: meta.profilerHardware || {
        manufacturer: 'UNKNOWN',
        model: 'UNKNOWN',
        serialNumber: 'UNKNOWN',
        totalProbesUsed: 0,
        sampleIntervalSeconds: 1.0,
        sampleCount: 0
      },
      ovenSettingsSnapshot: meta.ovenSettingsSnapshot,
      specificationReference: meta.specificationReference || {
        specificationId: row.specification_id,
        specificationVersion: Number(row.specification_version),
        alloy: 'SAC305'
      },
      analysisResult: meta.analysisResult || {
        calculationVersion: row.calculation_version,
        overallPwi: Number(row.overall_pwi),
        worstProbeIndex: 1,
        worstCharacteristic: 'PEAK',
        complianceResult: row.compliance_result,
        evaluatedAt: row.imported_at
      },
      status: row.status,
      approvalAudit: meta.approvalAudit,
      activatedAt: row.activated_at || undefined,
      retiredAt: row.retired_at || undefined
    };
  }

  // --------------------------------------------------------------------------
  // Probes
  // --------------------------------------------------------------------------

  async getProbesForRun(profileRunId: string): Promise<ReflowProfileProbe[]> {
    const rows = await this.db.query(`
      SELECT * FROM reflow_profile_probes
      WHERE profile_run_id = ?
      ORDER BY probe_index ASC
    `, [profileRunId]);

    return rows.map((r: any) => ({
      id: r.id,
      profileRunId: r.profile_run_id,
      probeIndex: Number(r.probe_index),
      label: r.label,
      thermalRole: r.thermal_role,
      metrics: JSON.parse(r.metrics_json),
      pwi: JSON.parse(r.pwi_json),
      samples: JSON.parse(r.samples_json),
      calibration: { calibrationSource: 'NONE' }
    }));
  }

  // --------------------------------------------------------------------------
  // Process States
  // --------------------------------------------------------------------------

  async saveProcessState(state: ReflowProcessState): Promise<void> {
    const driftMetricsJson = state.driftReport ? JSON.stringify(state.driftReport) : '{}';

    await this.db.execute(`
      INSERT INTO reflow_process_states (
        line_id, equipment_id, recipe_id, board_part_number, board_revision,
        active_profile_run_id, compliance_status, consecutive_drift_seconds,
        consecutive_healthy_seconds, last_evaluated_at, drift_metrics_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(line_id, equipment_id, recipe_id, board_part_number, board_revision) DO UPDATE SET
        active_profile_run_id = excluded.active_profile_run_id,
        compliance_status = excluded.compliance_status,
        consecutive_drift_seconds = excluded.consecutive_drift_seconds,
        consecutive_healthy_seconds = excluded.consecutive_healthy_seconds,
        last_evaluated_at = excluded.last_evaluated_at,
        drift_metrics_json = excluded.drift_metrics_json
    `, [
      state.lineId,
      state.equipmentId,
      state.recipeId,
      state.boardPartNumber,
      state.boardRevision,
      state.activeProfileRunId || null,
      state.complianceStatus,
      state.consecutiveDriftSeconds,
      state.consecutiveHealthySeconds,
      state.lastEvaluatedAt,
      driftMetricsJson
    ]);
  }

  async getProcessState(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
  }): Promise<ReflowProcessState | null> {
    const rows = await this.db.query(`
      SELECT * FROM reflow_process_states
      WHERE line_id = ? AND equipment_id = ? AND recipe_id = ? AND board_part_number = ? AND board_revision = ?
    `, [
      params.lineId,
      params.equipmentId,
      params.recipeId,
      params.boardPartNumber,
      params.boardRevision
    ]);

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const driftReport = row.drift_metrics_json ? JSON.parse(row.drift_metrics_json) : undefined;
    return {
      lineId: row.line_id,
      equipmentId: row.equipment_id,
      recipeId: row.recipe_id,
      boardPartNumber: row.board_part_number,
      boardRevision: row.board_revision,
      activeProfileRunId: row.active_profile_run_id || undefined,
      complianceStatus: row.compliance_status,
      consecutiveDriftSeconds: Number(row.consecutive_drift_seconds),
      consecutiveHealthySeconds: Number(row.consecutive_healthy_seconds),
      lastEvaluatedAt: row.last_evaluated_at,
      driftReport: Object.keys(driftReport || {}).length > 0 ? driftReport : undefined
    };
  }

  async listProcessStatesByLine(lineId: string): Promise<ReflowProcessState[]> {
    const rows = await this.db.query(`
      SELECT * FROM reflow_process_states WHERE line_id = ?
    `, [lineId]);

    return rows.map((row: any) => {
      const driftReport = row.drift_metrics_json ? JSON.parse(row.drift_metrics_json) : undefined;
      return {
        lineId: row.line_id,
        equipmentId: row.equipment_id,
        recipeId: row.recipe_id,
        boardPartNumber: row.board_part_number,
        boardRevision: row.board_revision,
        activeProfileRunId: row.active_profile_run_id || undefined,
        complianceStatus: row.compliance_status,
        consecutiveDriftSeconds: Number(row.consecutive_drift_seconds),
        consecutiveHealthySeconds: Number(row.consecutive_healthy_seconds),
        lastEvaluatedAt: row.last_evaluated_at,
        driftReport: Object.keys(driftReport || {}).length > 0 ? driftReport : undefined
      };
    });
  }

  // --------------------------------------------------------------------------
  // Profile-Telemetry Correlations
  // --------------------------------------------------------------------------

  async saveCorrelation(correlation: ProfileTelemetryCorrelation): Promise<void> {
    const correlationJson = JSON.stringify({
      zones: correlation.zones,
      conveyorSpeed: correlation.conveyorSpeed,
      oxygen: correlation.oxygen
    });

    await this.db.execute(`
      INSERT INTO reflow_profile_correlations (
        profile_run_id, line_id, equipment_id, window_start, window_end,
        sample_count, telemetry_integrity_score, correlation_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_run_id) DO UPDATE SET
        telemetry_integrity_score = excluded.telemetry_integrity_score,
        correlation_json = excluded.correlation_json
    `, [
      correlation.profileRunId,
      correlation.lineId,
      correlation.equipmentId,
      correlation.windowStart,
      correlation.windowEnd,
      correlation.sampleCount,
      correlation.telemetryIntegrityScore,
      correlationJson,
      new Date().toISOString()
    ]);
  }

  async getCorrelation(profileRunId: string): Promise<ProfileTelemetryCorrelation | null> {
    const rows = await this.db.query(`
      SELECT * FROM reflow_profile_correlations WHERE profile_run_id = ?
    `, [profileRunId]);

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const data = JSON.parse(row.correlation_json);
    return {
      profileRunId: row.profile_run_id,
      lineId: row.line_id,
      equipmentId: row.equipment_id,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      sampleCount: Number(row.sample_count),
      telemetryIntegrityScore: Number(row.telemetry_integrity_score),
      zones: data.zones || [],
      conveyorSpeed: data.conveyorSpeed,
      oxygen: data.oxygen
    };
  }
}
