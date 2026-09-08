-- ============================================================================
-- 004_phase5_fleet_and_predictive.sql
-- PostgreSQL Enterprise DDL for Phase 5 (Multi-Line Fleet, Logistics & Predictive Quality)
-- ============================================================================

-- 1. Material Reservations (Atomic concurrency lock preventing double-mounting)
CREATE TABLE IF NOT EXISTS material_reservations (
  id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  slot_no INTEGER NOT NULL,
  part_number TEXT NOT NULL,
  reserved_for_request_id TEXT,
  purpose TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RESERVED',
  reserved_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  mounted_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_material_res_active 
ON material_reservations(reel_id) 
WHERE status IN ('RESERVED', 'MOUNTED');

CREATE INDEX IF NOT EXISTS idx_material_res_line 
ON material_reservations(line_id, status);

-- 2. AGV Fleet Units
CREATE TABLE IF NOT EXISTS agv_units (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IDLE',
  current_location TEXT NOT NULL DEFAULT 'CHARGING_DOCK_1',
  battery_percent NUMERIC(5, 2) NOT NULL DEFAULT 100.0,
  current_mission_id TEXT,
  last_heartbeat_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. AGV Missions (Transport Orders)
CREATE TABLE IF NOT EXISTS agv_missions (
  id TEXT PRIMARY KEY,
  agv_id TEXT,
  mission_type TEXT NOT NULL,
  material_type TEXT NOT NULL,
  material_id TEXT NOT NULL,
  source_location TEXT NOT NULL,
  target_line_id TEXT NOT NULL,
  target_work_center_id TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'STANDARD',
  status TEXT NOT NULL DEFAULT 'CREATED',
  dock_delivery_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  dock_authorized_at TIMESTAMPTZ,
  dock_authorized_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agv_missions_status 
ON agv_missions(status, priority);

CREATE INDEX IF NOT EXISTS idx_agv_missions_target 
ON agv_missions(target_line_id, target_work_center_id);

-- 4. Material Replenishment Requests (Lifecycle decoupled from vehicle missions)
CREATE TABLE IF NOT EXISTS material_replenishment_requests (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL,
  work_center_id TEXT NOT NULL,
  slot_no INTEGER NOT NULL,
  part_number TEXT NOT NULL,
  current_reel_id TEXT,
  remaining_quantity INTEGER NOT NULL DEFAULT 0,
  estimated_minutes_remaining NUMERIC(8, 2) NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'ACTUAL_PLACEMENT_TELEMETRY',
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  assigned_mission_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  gated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_replenish_status 
ON material_replenishment_requests(status, line_id);

-- 5. Time-Series Telemetry Store (Decoupled from Transactional EventStore)
CREATE TABLE IF NOT EXISTS telemetry_points (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  factory_id TEXT NOT NULL DEFAULT 'site-noida-p4',
  bay_id TEXT NOT NULL DEFAULT 'area-smt-01',
  line_id TEXT NOT NULL,
  work_center_id TEXT,
  equipment_id TEXT,
  asset_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC(12, 4) NOT NULL,
  unit TEXT NOT NULL,
  metadata_json TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_query 
ON telemetry_points(asset_id, metric, timestamp);

CREATE INDEX IF NOT EXISTS idx_telemetry_line 
ON telemetry_points(line_id, metric, timestamp);

-- 6. Predictive Anomalies (Derived statistical facts)
CREATE TABLE IF NOT EXISTS predictive_anomalies (
  id TEXT PRIMARY KEY,
  anomaly_type TEXT NOT NULL,
  line_id TEXT NOT NULL,
  work_center_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  score NUMERIC(8, 3) NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL,
  baseline_value NUMERIC(10, 4) NOT NULL,
  observed_value NUMERIC(10, 4) NOT NULL,
  details_json TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_anomalies_status 
ON predictive_anomalies(status, line_id);

-- 7. Predictive Actions (Safety Gated Physical Interventions)
CREATE TABLE IF NOT EXISTS predictive_actions (
  id TEXT PRIMARY KEY,
  anomaly_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_work_center_id TEXT NOT NULL,
  parameters_json TEXT,
  reason TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'STANDARD',
  status TEXT NOT NULL DEFAULT 'RECOMMENDED',
  authorization_mode TEXT,
  authorized_by TEXT,
  authorized_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  execution_result_json TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pred_actions_status 
ON predictive_actions(status, target_work_center_id);

-- 8. Production Metrics & OEE Snapshots
CREATE TABLE IF NOT EXISTS production_metrics (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  availability NUMERIC(6, 4) NOT NULL,
  performance NUMERIC(6, 4) NOT NULL,
  quality NUMERIC(6, 4) NOT NULL,
  oee NUMERIC(6, 4) NOT NULL,
  takt_adherence NUMERIC(6, 4) NOT NULL,
  operating_time_seconds NUMERIC(10, 2) NOT NULL,
  planned_time_seconds NUMERIC(10, 2) NOT NULL,
  total_output INTEGER NOT NULL DEFAULT 0,
  good_output INTEGER NOT NULL DEFAULT 0,
  downtime_seconds NUMERIC(10, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_production_metrics_line 
ON production_metrics(line_id, calculated_at);
