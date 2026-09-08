-- ============================================================================
-- 005_phase6_reflow_profiling.sql
-- PostgreSQL Enterprise DDL for Phase 6 (Closed-Loop Reflow Profiling & Drift)
-- ============================================================================

-- 1. Versioned Thermal Specifications
CREATE TABLE IF NOT EXISTS reflow_thermal_specifications (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  board_part_number TEXT NOT NULL,
  board_revision TEXT NOT NULL,
  specification_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- DRAFT, ACTIVE, RETIRED
  alloy TEXT NOT NULL,
  specification_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_reflow_spec UNIQUE(recipe_id, board_part_number, board_revision, specification_version)
);

CREATE INDEX IF NOT EXISTS idx_reflow_spec_scope 
ON reflow_thermal_specifications(recipe_id, board_part_number, board_revision);

-- 2. Physical Profile Runs (Immutable historical records)
CREATE TABLE IF NOT EXISTS reflow_profile_runs (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  board_part_number TEXT NOT NULL,
  board_revision TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  specification_id TEXT NOT NULL,
  specification_version INTEGER NOT NULL,
  calculation_version TEXT NOT NULL,
  overall_pwi NUMERIC(6, 2) NOT NULL,
  compliance_result TEXT NOT NULL, -- PASS, WARNING, FAIL
  status TEXT NOT NULL, -- UPLOADED, PARSED, PARSE_FAILED, VALIDATED, VALIDATION_FAILED, REVIEW_REQUIRED, APPROVED, REJECTED, ACTIVE, RETIRED
  metadata_json TEXT NOT NULL,
  imported_by TEXT NOT NULL,
  imported_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ
);

-- Partial Unique Index guaranteeing at most one ACTIVE baseline per applicability scope
CREATE UNIQUE INDEX IF NOT EXISTS idx_reflow_profile_active_scope 
ON reflow_profile_runs(line_id, equipment_id, recipe_id, board_part_number, board_revision) 
WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_reflow_profile_scope 
ON reflow_profile_runs(line_id, equipment_id, recipe_id, board_part_number, board_revision);

CREATE INDEX IF NOT EXISTS idx_reflow_profile_sha 
ON reflow_profile_runs(file_sha256);

-- 3. Profile Probes & Normalized Time-Series Samples
CREATE TABLE IF NOT EXISTS reflow_profile_probes (
  id TEXT PRIMARY KEY,
  profile_run_id TEXT NOT NULL REFERENCES reflow_profile_runs(id) ON DELETE CASCADE,
  probe_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  thermal_role TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  pwi_json TEXT NOT NULL,
  samples_json TEXT NOT NULL, -- Explicit array of { timeSeconds, temperatureC }
  CONSTRAINT uq_reflow_probe_idx UNIQUE(profile_run_id, probe_index)
);

CREATE INDEX IF NOT EXISTS idx_reflow_probe_run 
ON reflow_profile_probes(profile_run_id);

-- 4. Active Process Compliance State Snapshot
CREATE TABLE IF NOT EXISTS reflow_process_states (
  line_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  board_part_number TEXT NOT NULL,
  board_revision TEXT NOT NULL,
  active_profile_run_id TEXT,
  compliance_status TEXT NOT NULL, -- COMPLIANT, DRIFT_SUSPECTED, DRIFT_CONFIRMED, REVALIDATION_REQUIRED, DATA_INSUFFICIENT
  consecutive_drift_seconds NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
  consecutive_healthy_seconds NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
  last_evaluated_at TIMESTAMPTZ NOT NULL,
  drift_metrics_json TEXT NOT NULL,
  PRIMARY KEY(line_id, equipment_id, recipe_id, board_part_number, board_revision)
);

-- 5. Contemporaneous Profile-Telemetry Correlation
CREATE TABLE IF NOT EXISTS reflow_profile_correlations (
  profile_run_id TEXT PRIMARY KEY REFERENCES reflow_profile_runs(id) ON DELETE CASCADE,
  line_id TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  sample_count INTEGER NOT NULL,
  telemetry_integrity_score NUMERIC(5, 4) NOT NULL,
  correlation_json TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
