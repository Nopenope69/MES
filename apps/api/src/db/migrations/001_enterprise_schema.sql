-- ============================================================================
-- 001_enterprise_schema.sql (Track D: PostgreSQL Enterprise DDL with Partitioning)
-- PostgreSQL 16+ Production Schema with Declarative Range Partitioning
-- ============================================================================

-- Ensure uuid-ossp or pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ISA-95 Physical Asset Hierarchy Master Data
-- ============================================================================

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  site_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  area_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_areas_site_id ON areas(site_id);

CREATE TABLE IF NOT EXISTS work_centers (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES areas(id) ON DELETE CASCADE,
  work_center_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  equipment_type TEXT NOT NULL DEFAULT 'SMT_PLACEMENT',
  current_state TEXT NOT NULL DEFAULT 'IDLE',
  current_batch_id TEXT,
  current_operator_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_work_centers_area_id ON work_centers(area_id);

-- ============================================================================
-- High-Throughput Event Ingress & Event Sourcing (Range Partitioned)
-- ============================================================================

-- TIER 1: Ingress Layer (Raw Inbound TCP Socket Frames)
CREATE TABLE IF NOT EXISTS ingress_events (
  id TEXT NOT NULL,
  source_adapter TEXT NOT NULL,
  source_address TEXT,
  protocol TEXT NOT NULL,
  raw_payload BYTEA NOT NULL,
  decoded_payload TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_status TEXT NOT NULL DEFAULT 'PENDING',
  error_details TEXT,
  PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);

-- Partitions for 2026 and default catch-all
CREATE TABLE IF NOT EXISTS ingress_events_2026_08 PARTITION OF ingress_events
  FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS ingress_events_2026_09 PARTITION OF ingress_events
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS ingress_events_2026_10 PARTITION OF ingress_events
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS ingress_events_default PARTITION OF ingress_events DEFAULT;

-- TIER 2: Canonical Domain Event Store (Event Sourcing Backbone)
CREATE TABLE IF NOT EXISTS production_events (
  id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  ingress_event_id TEXT,
  work_center_id TEXT NOT NULL,
  batch_id TEXT,
  event_type TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  payload_json JSONB NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, event_time)
) PARTITION BY RANGE (event_time);

-- Monthly partitions for production events
CREATE TABLE IF NOT EXISTS production_events_2026_08 PARTITION OF production_events
  FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS production_events_2026_09 PARTITION OF production_events
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS production_events_2026_10 PARTITION OF production_events
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS production_events_default PARTITION OF production_events DEFAULT;

-- Projection High-Water Mark Checkpoints
CREATE TABLE IF NOT EXISTS projection_checkpoints (
  projection_name TEXT PRIMARY KEY,
  last_event_id TEXT,
  last_event_time TIMESTAMPTZ,
  events_processed BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Aggregate State Snapshots for O(1) Catch-up Replay
CREATE TABLE IF NOT EXISTS projection_snapshots (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  snapshot_version BIGINT NOT NULL,
  state_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_aggregate ON projection_snapshots(aggregate_type, aggregate_id, snapshot_version);

-- ============================================================================
-- SMT Materials, Feeder Bank & Controlled Lifecycles
-- ============================================================================

CREATE TABLE IF NOT EXISTS component_reels (
  id TEXT PRIMARY KEY,
  reel_id TEXT UNIQUE NOT NULL,
  part_number TEXT NOT NULL,
  lot_number TEXT NOT NULL,
  supplier TEXT NOT NULL,
  initial_quantity NUMERIC(12, 3) NOT NULL,
  remaining_quantity NUMERIC(12, 3) NOT NULL,
  msl_level TEXT NOT NULL DEFAULT '1',
  msl_package_type TEXT NOT NULL DEFAULT 'SMD',
  initial_floor_life_seconds BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'SEALED',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reels_part ON component_reels(part_number);
CREATE INDEX IF NOT EXISTS idx_reels_lot ON component_reels(lot_number);

CREATE TABLE IF NOT EXISTS dry_cabinets (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  rh_limit_percent NUMERIC(5, 2) NOT NULL DEFAULT 5.0,
  temperature_min_c NUMERIC(5, 2) NOT NULL DEFAULT 20.0,
  temperature_max_c NUMERIC(5, 2) NOT NULL DEFAULT 30.0,
  validation_status TEXT NOT NULL DEFAULT 'VALIDATED',
  last_calibrated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS msl_bake_profiles (
  id TEXT PRIMARY KEY,
  standard TEXT NOT NULL DEFAULT 'JEDEC_J_STD_033D',
  standard_revision TEXT NOT NULL DEFAULT 'D',
  msl_class TEXT NOT NULL,
  package_thickness_class TEXT NOT NULL DEFAULT 'THIN_LE_1_4MM',
  temperature_c INTEGER NOT NULL,
  minimum_duration_minutes INTEGER NOT NULL,
  carrier_type TEXT NOT NULL DEFAULT 'HIGH_TEMP_REEL',
  max_bake_temperature_c INTEGER NOT NULL DEFAULT 125,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS msl_exposure_logs (
  id TEXT PRIMARY KEY,
  reel_id TEXT NOT NULL REFERENCES component_reels(reel_id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  cabinet_id TEXT REFERENCES dry_cabinets(id),
  ambient_temperature_c NUMERIC(5, 2),
  ambient_rh NUMERIC(5, 2),
  source_event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_msl_exposure_reel ON msl_exposure_logs(reel_id);

CREATE TABLE IF NOT EXISTS solder_paste_profiles (
  id TEXT PRIMARY KEY,
  manufacturer TEXT NOT NULL,
  product_code TEXT UNIQUE NOT NULL,
  alloy_type TEXT NOT NULL,
  storage_min_c NUMERIC(5, 2) NOT NULL DEFAULT 2.0,
  storage_max_c NUMERIC(5, 2) NOT NULL DEFAULT 10.0,
  thaw_required_minutes INTEGER NOT NULL DEFAULT 240,
  minimum_processing_temperature_c NUMERIC(5, 2) NOT NULL DEFAULT 22.0,
  mixing_required INTEGER NOT NULL DEFAULT 1,
  mixing_method TEXT NOT NULL DEFAULT 'CENTRIFUGAL_PLANETARY',
  mixing_min_seconds INTEGER NOT NULL DEFAULT 120,
  mixing_max_seconds INTEGER NOT NULL DEFAULT 300,
  stencil_life_minutes INTEGER NOT NULL DEFAULT 480,
  shelf_life_days INTEGER NOT NULL DEFAULT 180,
  standard_or_tds_reference TEXT NOT NULL DEFAULT 'IPC-J-STD-004B',
  revision TEXT NOT NULL DEFAULT '1.0',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS solder_paste_jars (
  id TEXT PRIMARY KEY,
  jar_id TEXT UNIQUE NOT NULL,
  part_number TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES solder_paste_profiles(id),
  alloy_type TEXT NOT NULL,
  lot_number TEXT NOT NULL,
  expiry_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'REFRIGERATED',
  removed_from_cold_at TIMESTAMPTZ,
  thaw_verified_at TIMESTAMPTZ,
  thaw_duration_minutes INTEGER DEFAULT 240,
  temperature_verified_at TIMESTAMPTZ,
  temperature_verified_c NUMERIC(5, 2),
  mixed_at TIMESTAMPTZ,
  mixed_duration_seconds INTEGER DEFAULT 0,
  mixing_method TEXT,
  current_stencil_session_id TEXT,
  depleted_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  current_work_center_id TEXT DEFAULT 'wc-spg-01',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_paste_jars_lot ON solder_paste_jars(lot_number);

CREATE TABLE IF NOT EXISTS stencils (
  id TEXT PRIMARY KEY,
  stencil_id TEXT UNIQUE NOT NULL,
  part_number TEXT NOT NULL,
  revision TEXT NOT NULL DEFAULT 'A',
  stencil_serial_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stencil_sessions (
  id TEXT PRIMARY KEY,
  stencil_id TEXT NOT NULL,
  work_center_id TEXT NOT NULL,
  batch_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  life_expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stencil_paste_loads (
  id TEXT PRIMARY KEY,
  stencil_session_id TEXT NOT NULL REFERENCES stencil_sessions(id) ON DELETE CASCADE,
  paste_jar_id TEXT NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL,
  removed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS smt_feeder_slots (
  id TEXT PRIMARY KEY,
  work_center_id TEXT NOT NULL,
  module_no INTEGER NOT NULL DEFAULT 1,
  stage_no INTEGER NOT NULL DEFAULT 1,
  slot_no INTEGER NOT NULL,
  sub_slot_no INTEGER NOT NULL DEFAULT 0,
  feeder_id TEXT NOT NULL,
  feeder_type TEXT DEFAULT 'W08f (8mm)',
  assigned_part_number TEXT NOT NULL,
  current_reel_id TEXT,
  status TEXT NOT NULL DEFAULT 'OK'
);

CREATE INDEX IF NOT EXISTS idx_feeder_slots_wc ON smt_feeder_slots(work_center_id, module_no, slot_no);

-- ============================================================================
-- Production Execution & Genealogy
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  product_code TEXT NOT NULL,
  target_quantity NUMERIC(12, 3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  batch_number TEXT UNIQUE NOT NULL,
  work_order_number TEXT NOT NULL,
  product_code TEXT NOT NULL,
  recipe_code TEXT NOT NULL,
  work_center_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'READY',
  planned_quantity NUMERIC(12, 3) NOT NULL,
  actual_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
  rejected_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'PANEL',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  operator_id TEXT
);

CREATE TABLE IF NOT EXISTS panel_checkouts (
  id TEXT PRIMARY KEY,
  panel_barcode TEXT NOT NULL,
  work_center_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  program_name TEXT NOT NULL,
  cycle_time_seconds NUMERIC(8, 3) NOT NULL,
  block_count INTEGER DEFAULT 1,
  block_skip_count INTEGER DEFAULT 0,
  skip_bitmask TEXT,
  completed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_panel_checkouts_batch ON panel_checkouts(batch_id);
CREATE INDEX IF NOT EXISTS idx_panel_checkouts_barcode ON panel_checkouts(panel_barcode);

CREATE TABLE IF NOT EXISTS material_consumptions (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  material_lot_number TEXT NOT NULL,
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  quantity_consumed NUMERIC(12, 3) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'PCS',
  container_id TEXT,
  operator_id TEXT,
  consumed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mat_consumptions_batch ON material_consumptions(batch_id);
CREATE INDEX IF NOT EXISTS idx_mat_consumptions_lot ON material_consumptions(material_lot_number);

CREATE TABLE IF NOT EXISTS equipment_state_logs (
  id TEXT PRIMARY KEY,
  work_center_id TEXT NOT NULL,
  batch_id TEXT,
  previous_state TEXT NOT NULL,
  current_state TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS downtime_attributions (
  id TEXT PRIMARY KEY,
  state_log_id TEXT NOT NULL,
  work_center_id TEXT NOT NULL,
  batch_id TEXT,
  reason_category TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  comment TEXT,
  operator_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

-- ============================================================================
-- Industrial Compliance & Audit Ledger (21 CFR Part 11 & FDA 820.180)
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance_audit_ledger (
  id TEXT PRIMARY KEY,
  sequence_number BIGINT UNIQUE NOT NULL,
  previous_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  meaning TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_seq ON compliance_audit_ledger(sequence_number);
CREATE INDEX IF NOT EXISTS idx_ledger_entity ON compliance_audit_ledger(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS device_history_records (
  id TEXT PRIMARY KEY,
  dhr_number TEXT UNIQUE NOT NULL,
  batch_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  work_order_number TEXT NOT NULL,
  manufactured_quantity NUMERIC(12, 3) NOT NULL,
  released_quantity NUMERIC(12, 3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  qa_reviewer_id TEXT,
  qa_released_at TIMESTAMPTZ,
  dhr_payload_json JSONB NOT NULL,
  sha256_checksum TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dhr_batch ON device_history_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_dhr_product ON device_history_records(product_code);
