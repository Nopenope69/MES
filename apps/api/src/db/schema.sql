-- ============================================================================
-- ISA-95 Physical Asset Hierarchy for EMS Facilities
-- Organization -> Site -> Area -> ProductionLine -> WorkCenter -> EquipmentUnit
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64) NOT NULL,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  location VARCHAR(128),
  timezone VARCHAR(32) DEFAULT 'Asia/Kolkata'
);

CREATE TABLE IF NOT EXISTS areas (
  id VARCHAR(64) PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS production_lines (
  id VARCHAR(64) PRIMARY KEY,
  area_id VARCHAR(64) NOT NULL,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS work_centers (
  id VARCHAR(64) PRIMARY KEY,
  line_id VARCHAR(64),
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  area VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL, -- SMT_LINE, SCREEN_PRINTER, PICK_AND_PLACE, REFLOW_OVEN, AOI_INSPECTION
  asset_path VARCHAR(256) NOT NULL DEFAULT '',
  current_state VARCHAR(32) NOT NULL DEFAULT 'IDLE',
  current_batch_id VARCHAR(64),
  current_program_name VARCHAR(128),
  current_operator_id VARCHAR(64),
  module_count INTEGER DEFAULT 1,
  last_state_change_time TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment_units (
  id VARCHAR(64) PRIMARY KEY,
  work_center_id VARCHAR(64) NOT NULL,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(64) NOT NULL
);

-- ============================================================================
-- Master Data: Products, SMT Programs & BOM Components
-- ============================================================================

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  uom VARCHAR(16) NOT NULL DEFAULT 'PANEL',
  category VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL, -- SMT Program Name e.g. "PROG-SM-METER-TOP-REV4"
  product_code VARCHAR(64) NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(128) NOT NULL,
  target_cycle_time_minutes INTEGER NOT NULL DEFAULT 1,
  panels_per_job INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id VARCHAR(64) PRIMARY KEY,
  recipe_id VARCHAR(64) NOT NULL,
  material_code VARCHAR(64) NOT NULL, -- Manufacturer Part Number (MPN)
  material_name VARCHAR(128) NOT NULL,
  planned_quantity DECIMAL(12, 3) NOT NULL, -- Points per board
  unit VARCHAR(16) NOT NULL DEFAULT 'PCS',
  tolerance_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0.0,
  step_order INTEGER NOT NULL DEFAULT 1,
  module_no INTEGER DEFAULT 1,
  stage_no INTEGER DEFAULT 1,
  slot_no INTEGER NOT NULL,
  sub_slot_no INTEGER DEFAULT 0,
  package_type VARCHAR(32) DEFAULT '0402',
  reference_designators TEXT -- e.g. "C12, C14, C18"
);

CREATE TABLE IF NOT EXISTS operators (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'OPERATOR',
  pin VARCHAR(16) NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(64) NOT NULL,
  start_time VARCHAR(8) NOT NULL,
  end_time VARCHAR(8) NOT NULL
);

-- ============================================================================
-- SMT Floor Resources: Component Reels & Feeder Bank
-- ============================================================================

CREATE TABLE IF NOT EXISTS component_reels (
  id VARCHAR(64) PRIMARY KEY,
  reel_id VARCHAR(64) UNIQUE NOT NULL,
  part_number VARCHAR(64) NOT NULL,
  part_name VARCHAR(128) NOT NULL,
  supplier_name VARCHAR(128) NOT NULL,
  lot_number VARCHAR(64) NOT NULL,
  date_code VARCHAR(32) NOT NULL,
  initial_quantity INTEGER NOT NULL,
  current_quantity INTEGER NOT NULL,
  unit VARCHAR(16) NOT NULL DEFAULT 'PCS',
  msl_level INTEGER NOT NULL DEFAULT 1,
  msl_class VARCHAR(8) NOT NULL DEFAULT 'MSL_1',
  msl_remaining_minutes INTEGER NOT NULL DEFAULT 999999,
  mbb_opened_at TIMESTAMP,
  mbb_resealed_at TIMESTAMP,
  storage_location VARCHAR(64) DEFAULT 'FACTORY_FLOOR',
  storage_state VARCHAR(32) DEFAULT 'AMBIENT_EXPOSURE',
  floor_clock_state VARCHAR(32) DEFAULT 'FLOOR_EXPOSURE',
  floor_life_nominal_minutes INTEGER DEFAULT 999999,
  floor_life_expires_at TIMESTAMP,
  hic_status VARCHAR(32) DEFAULT 'OK',
  hic_verified_at TIMESTAMP,
  hic_verified_by VARCHAR(64),
  bake_status VARCHAR(32) DEFAULT 'NOT_REQUIRED',
  bake_started_at TIMESTAMP,
  last_bake_profile_id VARCHAR(64),
  last_bake_completed_at TIMESTAMP,
  status VARCHAR(32) NOT NULL DEFAULT 'READY' -- READY, MOUNTED, SPLICED, DEPLETED, EXPIRED_MSL, QUARANTINED
);

-- JEDEC J-STD-033D Dry Cabinets Master Data
CREATE TABLE IF NOT EXISTS dry_cabinets (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  rh_limit_percent DECIMAL(5, 2) NOT NULL DEFAULT 5.0,
  temperature_min_c DECIMAL(5, 2) NOT NULL DEFAULT 20.0,
  temperature_max_c DECIMAL(5, 2) NOT NULL DEFAULT 30.0,
  validation_status VARCHAR(32) NOT NULL DEFAULT 'VALIDATED',
  last_calibrated_at TIMESTAMP
);

-- JEDEC J-STD-033D Bake Profiles (Thermal Desiccation Standards)
CREATE TABLE IF NOT EXISTS msl_bake_profiles (
  id VARCHAR(64) PRIMARY KEY,
  standard VARCHAR(64) NOT NULL DEFAULT 'JEDEC_J_STD_033D',
  standard_revision VARCHAR(16) NOT NULL DEFAULT 'D',
  msl_class VARCHAR(8) NOT NULL,
  package_thickness_class VARCHAR(32) NOT NULL DEFAULT 'THIN_LE_1_4MM',
  temperature_c INTEGER NOT NULL,
  minimum_duration_minutes INTEGER NOT NULL,
  carrier_type VARCHAR(32) NOT NULL DEFAULT 'HIGH_TEMP_REEL',
  max_bake_temperature_c INTEGER NOT NULL DEFAULT 125,
  enabled INTEGER NOT NULL DEFAULT 1
);

-- Historical MSL Exposure Interval Logs (Source for Computed-on-Read Algorithm)
CREATE TABLE IF NOT EXISTS msl_exposure_logs (
  id VARCHAR(64) PRIMARY KEY,
  reel_id VARCHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL, -- AMBIENT_EXPOSURE, DRY_STORAGE, BAKING
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  duration_seconds INTEGER DEFAULT 0,
  cabinet_id VARCHAR(64),
  ambient_temperature_c DECIMAL(5, 2),
  ambient_rh DECIMAL(5, 2),
  source_event_id VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Solder Paste Profiles (Process Parameters)
CREATE TABLE IF NOT EXISTS solder_paste_profiles (
  id VARCHAR(64) PRIMARY KEY,
  manufacturer VARCHAR(64) NOT NULL,
  product_code VARCHAR(64) UNIQUE NOT NULL,
  alloy_type VARCHAR(64) NOT NULL,
  storage_min_c DECIMAL(5, 2) NOT NULL DEFAULT 2.0,
  storage_max_c DECIMAL(5, 2) NOT NULL DEFAULT 10.0,
  thaw_required_minutes INTEGER NOT NULL DEFAULT 240,
  minimum_processing_temperature_c DECIMAL(5, 2) NOT NULL DEFAULT 22.0,
  mixing_required INTEGER NOT NULL DEFAULT 1,
  mixing_method VARCHAR(64) NOT NULL DEFAULT 'CENTRIFUGAL_PLANETARY',
  mixing_min_seconds INTEGER NOT NULL DEFAULT 120,
  mixing_max_seconds INTEGER NOT NULL DEFAULT 300,
  stencil_life_minutes INTEGER NOT NULL DEFAULT 480,
  shelf_life_days INTEGER NOT NULL DEFAULT 180,
  standard_or_tds_reference VARCHAR(128) NOT NULL DEFAULT 'IPC-J-STD-004B',
  revision VARCHAR(16) NOT NULL DEFAULT '1.0',
  active INTEGER NOT NULL DEFAULT 1
);

-- Solder Paste Jars Tracking (Stage 01 Screen Printer)
CREATE TABLE IF NOT EXISTS solder_paste_jars (
  id VARCHAR(64) PRIMARY KEY,
  jar_id VARCHAR(64) UNIQUE NOT NULL,
  part_number VARCHAR(64) NOT NULL,
  profile_id VARCHAR(64) NOT NULL,
  alloy_type VARCHAR(64) NOT NULL,
  lot_number VARCHAR(64) NOT NULL,
  expiry_date TIMESTAMP NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'REFRIGERATED',
  removed_from_cold_at TIMESTAMP,
  thaw_verified_at TIMESTAMP,
  thaw_duration_minutes INTEGER DEFAULT 240,
  temperature_verified_at TIMESTAMP,
  temperature_verified_c DECIMAL(5, 2),
  mixed_at TIMESTAMP,
  mixed_duration_seconds INTEGER DEFAULT 0,
  mixing_method VARCHAR(64),
  current_stencil_session_id VARCHAR(64),
  depleted_at TIMESTAMP,
  discarded_at TIMESTAMP,
  current_work_center_id VARCHAR(64) DEFAULT 'wc-spg-01',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stencils Master Data
CREATE TABLE IF NOT EXISTS stencils (
  id VARCHAR(64) PRIMARY KEY,
  stencil_id VARCHAR(64) UNIQUE NOT NULL,
  part_number VARCHAR(64) NOT NULL,
  revision VARCHAR(16) NOT NULL DEFAULT 'A',
  stencil_serial_number VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stencil Sessions (Genealogy Link: Batch -> Stencil Session -> Paste Jar)
CREATE TABLE IF NOT EXISTS stencil_sessions (
  id VARCHAR(64) PRIMARY KEY,
  stencil_id VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64) NOT NULL,
  batch_id VARCHAR(64),
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  life_expires_at TIMESTAMP
);

-- Stencil Paste Loads
CREATE TABLE IF NOT EXISTS stencil_paste_loads (
  id VARCHAR(64) PRIMARY KEY,
  stencil_session_id VARCHAR(64) NOT NULL,
  paste_jar_id VARCHAR(64) NOT NULL,
  loaded_at TIMESTAMP NOT NULL,
  removed_at TIMESTAMP,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS smt_feeder_slots (
  id VARCHAR(64) PRIMARY KEY,
  work_center_id VARCHAR(64) NOT NULL,
  module_no INTEGER NOT NULL DEFAULT 1,
  stage_no INTEGER NOT NULL DEFAULT 1,
  slot_no INTEGER NOT NULL,
  sub_slot_no INTEGER NOT NULL DEFAULT 0,
  feeder_id VARCHAR(64) NOT NULL,
  feeder_type VARCHAR(64) DEFAULT 'W08f (8mm)',
  assigned_part_number VARCHAR(64) NOT NULL,
  current_reel_id VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'OK'
);

-- ============================================================================
-- Execution Context: Work Orders & Production Runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_orders (
  id VARCHAR(64) PRIMARY KEY,
  order_number VARCHAR(64) UNIQUE NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  target_quantity DECIMAL(12, 3) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  id VARCHAR(64) PRIMARY KEY,
  batch_number VARCHAR(64) UNIQUE NOT NULL, -- Job Run ID
  work_order_number VARCHAR(64) NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  recipe_code VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'READY',
  planned_quantity DECIMAL(12, 3) NOT NULL,
  actual_quantity DECIMAL(12, 3) NOT NULL DEFAULT 0,
  rejected_quantity DECIMAL(12, 3) NOT NULL DEFAULT 0,
  unit VARCHAR(16) NOT NULL DEFAULT 'PANEL',
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  operator_id VARCHAR(64)
);

-- Individual Panel Checkout Records (From PRODCOMPLETED / PCBCHECKOUT)
CREATE TABLE IF NOT EXISTS panel_checkouts (
  id VARCHAR(64) PRIMARY KEY,
  panel_barcode VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64) NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  program_name VARCHAR(128) NOT NULL,
  cycle_time_seconds DECIMAL(8, 3) NOT NULL,
  block_count INTEGER DEFAULT 1,
  block_skip_count INTEGER DEFAULT 0,
  skip_bitmask VARCHAR(64),
  completed_at TIMESTAMP NOT NULL,
  profile_run_id VARCHAR(64)
);

-- Feeder Error Logs (From PDERROR / FEEDERUSAGE / NOZZLECOUNT)
CREATE TABLE IF NOT EXISTS feeder_error_logs (
  id VARCHAR(64) PRIMARY KEY,
  work_center_id VARCHAR(64) NOT NULL,
  module_no INTEGER NOT NULL,
  slot_no INTEGER NOT NULL,
  feeder_id VARCHAR(64) NOT NULL,
  part_number VARCHAR(64) NOT NULL,
  nozzle_id VARCHAR(64),
  error_type VARCHAR(64) NOT NULL, -- VISION_ERROR, DROPPED_PART, EMPTY_PICKUP
  occurred_at TIMESTAMP NOT NULL
);

-- ============================================================================
-- TIER 1: Ingress Layer (Raw Inbound TCP Socket Frames)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingress_events (
  id VARCHAR(64) PRIMARY KEY,
  source_adapter VARCHAR(64) NOT NULL,
  source_address VARCHAR(128),
  protocol VARCHAR(32) NOT NULL,
  raw_payload BLOB NOT NULL,
  decoded_payload TEXT,
  sequence_id BIGINT,
  processed_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raw_integration_messages (
  id VARCHAR(64) PRIMARY KEY,
  source_adapter VARCHAR(64) NOT NULL,
  raw_payload TEXT NOT NULL,
  processed_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- TIER 2: Canonical Event Log (Immutable Single Source of Truth)
-- ============================================================================

CREATE TABLE IF NOT EXISTS production_events (
  id VARCHAR(64) PRIMARY KEY,
  event_id VARCHAR(64) UNIQUE NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  schema_version VARCHAR(16) DEFAULT '1.0.0',
  event_time TIMESTAMP NOT NULL,
  received_time TIMESTAMP NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  sequence_id BIGINT,
  site_id VARCHAR(32) NOT NULL,
  work_center_id VARCHAR(64) NOT NULL,
  asset_path VARCHAR(256),
  ingress_event_id VARCHAR(64),
  batch_id VARCHAR(64),
  work_order_id VARCHAR(64),
  operator_id VARCHAR(64),
  correlation_id VARCHAR(64),
  payload_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_work_center ON production_events(work_center_id, event_time);
CREATE INDEX IF NOT EXISTS idx_events_batch ON production_events(batch_id, event_time);
CREATE INDEX IF NOT EXISTS idx_events_type ON production_events(event_type);

-- Track A: Projection Checkpoints (High-Water Mark for Catch-up and Fast Replay)
CREATE TABLE IF NOT EXISTS projection_checkpoints (
  projection_name VARCHAR(64) PRIMARY KEY,
  last_event_id VARCHAR(64),
  last_event_time TIMESTAMP,
  events_processed BIGINT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Track A: Aggregate State Snapshots (O(1) Catch-up without Genesis Replay)
CREATE TABLE IF NOT EXISTS projection_snapshots (
  id VARCHAR(64) PRIMARY KEY,
  aggregate_type VARCHAR(64) NOT NULL, -- e.g. FEEDER_BANK, WORK_CENTER, REEL
  aggregate_id VARCHAR(64) NOT NULL,
  snapshot_version BIGINT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_aggregate ON projection_snapshots(aggregate_type, aggregate_id, snapshot_version);

-- ============================================================================
-- TIER 3: Projections (State Slices, Downtime, Lineage)
-- ============================================================================

CREATE TABLE IF NOT EXISTS equipment_state_logs (
  id VARCHAR(64) PRIMARY KEY,
  work_center_id VARCHAR(64) NOT NULL,
  batch_id VARCHAR(64),
  previous_state VARCHAR(32) NOT NULL,
  current_state VARCHAR(32) NOT NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  duration_seconds INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS downtime_attributions (
  id VARCHAR(64) PRIMARY KEY,
  state_log_id VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64) NOT NULL,
  batch_id VARCHAR(64),
  reason_category VARCHAR(64) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  comment TEXT,
  operator_id VARCHAR(64),
  created_at TIMESTAMP NOT NULL
);

-- Splicing & Component Genealogy
CREATE TABLE IF NOT EXISTS material_consumptions (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  material_lot_number VARCHAR(64) NOT NULL, -- Reel ID or Lot No
  material_code VARCHAR(64) NOT NULL,       -- Part Number
  material_name VARCHAR(128) NOT NULL,
  quantity_consumed DECIMAL(12, 3) NOT NULL,
  unit VARCHAR(16) NOT NULL DEFAULT 'PCS',
  container_id VARCHAR(64),                 -- Feeder ID / Slot
  operator_id VARCHAR(64),
  consumed_at TIMESTAMP NOT NULL
);

-- ============================================================================
-- TRACK B: Compliance & Industrial Audit Readiness (21 CFR Part 11 & ISO 13485)
-- ============================================================================

-- Cryptographically Hash-Chained Audit Ledger (21 CFR Part 11 / Tamper-Evident)
CREATE TABLE IF NOT EXISTS compliance_audit_ledger (
  id VARCHAR(64) PRIMARY KEY,
  sequence_number BIGINT UNIQUE NOT NULL,
  previous_hash VARCHAR(64) NOT NULL,
  current_hash VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  actor_role VARCHAR(64) NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  meaning VARCHAR(256) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  metadata_json TEXT NOT NULL,
  signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Non-owner runtime role segregation for 21 CFR Part 11 ledger
-- GRANT SELECT, INSERT ON compliance_audit_ledger TO mes_runtime;
-- REVOKE UPDATE, DELETE, TRUNCATE ON compliance_audit_ledger FROM mes_runtime;

CREATE INDEX IF NOT EXISTS idx_ledger_sequence ON compliance_audit_ledger(sequence_number);
CREATE INDEX IF NOT EXISTS idx_ledger_entity ON compliance_audit_ledger(entity_type, entity_id);

-- Electronic Device History Records (eDHR) (21 CFR 820.180 / ISO 13485 Clause 7.5.3)
CREATE TABLE IF NOT EXISTS device_history_records (
  id VARCHAR(64) PRIMARY KEY,
  dhr_number VARCHAR(64) UNIQUE NOT NULL,
  batch_id VARCHAR(64) NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  work_order_number VARCHAR(64) NOT NULL,
  manufactured_quantity DECIMAL(12, 3) NOT NULL,
  released_quantity DECIMAL(12, 3) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  qa_reviewer_id VARCHAR(64),
  qa_released_at TIMESTAMP,
  dhr_payload_json TEXT NOT NULL,
  sha256_checksum VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dhr_batch ON device_history_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_dhr_product ON device_history_records(product_code);

-- ============================================================================
-- PHASE 3: Closed-Loop 3D AOI, Quality Execution & Rework Engine
-- ============================================================================

CREATE TABLE IF NOT EXISTS quality_rules (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64),
  program_id VARCHAR(64),
  consecutive_failure_limit INTEGER NOT NULL DEFAULT 3,
  sliding_window_failures INTEGER NOT NULL DEFAULT 5,
  sliding_window_panels INTEGER NOT NULL DEFAULT 20,
  default_max_rework_cycles INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pcb_cad_definitions (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL,
  product_revision INTEGER NOT NULL DEFAULT 1,
  program_id VARCHAR(64) NOT NULL,
  program_revision INTEGER NOT NULL DEFAULT 1,
  board_side VARCHAR(16) NOT NULL DEFAULT 'TOP',
  cad_revision VARCHAR(32) NOT NULL DEFAULT 'REV_1',
  ref_des VARCHAR(32) NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  x_mm DECIMAL(8, 3) NOT NULL,
  y_mm DECIMAL(8, 3) NOT NULL,
  rotation_deg DECIMAL(6, 2) NOT NULL DEFAULT 0.0,
  package_type VARCHAR(32) NOT NULL DEFAULT '0402',
  assigned_part_number VARCHAR(64) NOT NULL,
  max_rework_cycles INTEGER NOT NULL DEFAULT 2
);

CREATE INDEX IF NOT EXISTS idx_cad_program ON pcb_cad_definitions(program_id, program_revision, board_side);

CREATE TABLE IF NOT EXISTS panel_units (
  id VARCHAR(64) PRIMARY KEY,
  panel_barcode VARCHAR(64) NOT NULL,
  unit_position INTEGER NOT NULL,
  unit_serial_number VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'PASSED',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(panel_barcode, unit_position)
);

CREATE TABLE IF NOT EXISTS aoi_inspections (
  id VARCHAR(64) PRIMARY KEY,
  source_system VARCHAR(64) NOT NULL,
  source_inspection_id VARCHAR(128) NOT NULL,
  source_file_hash VARCHAR(64) NOT NULL,
  panel_barcode VARCHAR(64) NOT NULL,
  batch_id VARCHAR(64),
  work_center_id VARCHAR(64) NOT NULL,
  optical_machine_id VARCHAR(64) NOT NULL,
  inspection_phase VARCHAR(32) NOT NULL DEFAULT 'POST_REFLOW',
  result VARCHAR(16) NOT NULL,
  total_defects INTEGER NOT NULL DEFAULT 0,
  duration_seconds DECIMAL(8, 2),
  inspected_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_system, source_inspection_id, source_file_hash)
);

CREATE INDEX IF NOT EXISTS idx_aoi_panel ON aoi_inspections(panel_barcode);

CREATE TABLE IF NOT EXISTS aoi_defects (
  id VARCHAR(64) PRIMARY KEY,
  inspection_id VARCHAR(64) NOT NULL,
  panel_barcode VARCHAR(64) NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  ref_des VARCHAR(32) NOT NULL,
  defect_category VARCHAR(32) NOT NULL,
  defect_type VARCHAR(64) NOT NULL,
  defect_signature VARCHAR(256) NOT NULL,
  offset_x_um DECIMAL(8, 2),
  offset_y_um DECIMAL(8, 2),
  rotation_deg DECIMAL(6, 2),
  board_side VARCHAR(16) NOT NULL DEFAULT 'TOP',
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  image_ref VARCHAR(256),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_defects_panel ON aoi_defects(panel_barcode, unit_position);
CREATE INDEX IF NOT EXISTS idx_defects_signature ON aoi_defects(defect_signature);

CREATE TABLE IF NOT EXISTS rework_dispositions (
  id VARCHAR(64) PRIMARY KEY,
  defect_id VARCHAR(64) NOT NULL,
  panel_barcode VARCHAR(64) NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  disposition VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  authorized_by VARCHAR(64) NOT NULL,
  disposition_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rework_events (
  id VARCHAR(64) PRIMARY KEY,
  defect_id VARCHAR(64) NOT NULL,
  panel_barcode VARCHAR(64) NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  ref_des VARCHAR(32) NOT NULL,
  technician_id VARCHAR(64) NOT NULL,
  station_id VARCHAR(64) NOT NULL DEFAULT 'STATION-REWORK-01',
  old_mpn VARCHAR(64) NOT NULL,
  old_reel_id VARCHAR(64),
  replacement_mpn VARCHAR(64) NOT NULL,
  replacement_reel_id VARCHAR(64) NOT NULL,
  rework_method VARCHAR(64) NOT NULL DEFAULT 'HOT_AIR_DESOLDER_SOLDERING_IRON',
  temperature_profile_id VARCHAR(64),
  rework_cycle INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rework_panel ON rework_events(panel_barcode, ref_des);

-- ============================================================================
-- PHASE 4: Closed-Loop 3D SPI & Screen Printer IPC-CFX Auto-Tuning
-- ============================================================================

CREATE TABLE IF NOT EXISTS recipe_process_windows (
  id VARCHAR(64) PRIMARY KEY,
  recipe_id VARCHAR(64) NOT NULL,
  recipe_revision INTEGER NOT NULL DEFAULT 1,
  stencil_id VARCHAR(64) NOT NULL,
  stencil_revision VARCHAR(16) NOT NULL DEFAULT 'A',
  nominal_stencil_thickness_um DECIMAL(6, 2) NOT NULL DEFAULT 120.0,
  volume_lower_limit_pct DECIMAL(6, 2) NOT NULL DEFAULT 75.0,
  volume_upper_limit_pct DECIMAL(6, 2) NOT NULL DEFAULT 135.0,
  volume_warning_lower_pct DECIMAL(6, 2) NOT NULL DEFAULT 85.0,
  volume_warning_upper_pct DECIMAL(6, 2) NOT NULL DEFAULT 120.0,
  height_lower_limit_um DECIMAL(6, 2) NOT NULL DEFAULT 90.0,
  height_upper_limit_um DECIMAL(6, 2) NOT NULL DEFAULT 160.0,
  area_lower_limit_pct DECIMAL(6, 2) NOT NULL DEFAULT 80.0,
  max_offset_um DECIMAL(6, 2) NOT NULL DEFAULT 50.0,
  nominal_pressure_kgf DECIMAL(6, 2) NOT NULL DEFAULT 8.5,
  nominal_separation_speed_mm_s DECIMAL(6, 2) NOT NULL DEFAULT 1.2,
  min_pressure_kgf DECIMAL(6, 2) NOT NULL DEFAULT 6.0,
  max_pressure_kgf DECIMAL(6, 2) NOT NULL DEFAULT 12.0,
  max_abs_delta_pressure DECIMAL(6, 2) NOT NULL DEFAULT 0.5,
  max_pct_delta_pressure DECIMAL(6, 2) NOT NULL DEFAULT 5.0,
  min_separation_speed_mm_s DECIMAL(6, 2) NOT NULL DEFAULT 0.5,
  max_separation_speed_mm_s DECIMAL(6, 2) NOT NULL DEFAULT 3.0,
  max_abs_delta_separation_speed DECIMAL(6, 2) NOT NULL DEFAULT 0.2,
  min_time_between_changes_sec INTEGER NOT NULL DEFAULT 180,
  max_changes_per_hour INTEGER NOT NULL DEFAULT 4,
  cooldown_after_cleaning_sec INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS printer_capabilities (
  equipment_id VARCHAR(64) PRIMARY KEY,
  manufacturer VARCHAR(64) NOT NULL,
  model VARCHAR(64) NOT NULL,
  cfx_version VARCHAR(16) NOT NULL DEFAULT '1.7',
  supports_stencil_cleaning INTEGER NOT NULL DEFAULT 1,
  supports_parameter_modification INTEGER NOT NULL DEFAULT 1,
  supports_pressure_control INTEGER NOT NULL DEFAULT 1,
  supports_separation_speed_control INTEGER NOT NULL DEFAULT 1,
  supports_print_speed_control INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spi_inspections (
  id VARCHAR(64) PRIMARY KEY,
  source_system VARCHAR(64) NOT NULL,
  source_inspection_id VARCHAR(128) NOT NULL,
  source_file_hash VARCHAR(64) NOT NULL,
  panel_barcode VARCHAR(64) NOT NULL,
  batch_id VARCHAR(64),
  work_center_id VARCHAR(64) NOT NULL,
  optical_machine_id VARCHAR(64) NOT NULL,
  result VARCHAR(16) NOT NULL,
  total_pads_inspected INTEGER NOT NULL DEFAULT 0,
  defective_pads_count INTEGER NOT NULL DEFAULT 0,
  mean_volume_pct DECIMAL(6, 2),
  sigma_volume_pct DECIMAL(6, 2),
  duration_seconds DECIMAL(8, 2),
  inspected_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_system, source_inspection_id, source_file_hash)
);

CREATE INDEX IF NOT EXISTS idx_spi_panel ON spi_inspections(panel_barcode);

CREATE TABLE IF NOT EXISTS spi_pad_measurements (
  id VARCHAR(64) PRIMARY KEY,
  inspection_id VARCHAR(64) NOT NULL,
  panel_barcode VARCHAR(64) NOT NULL,
  pad_id VARCHAR(64) NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  ref_des VARCHAR(32) NOT NULL,
  pin_no INTEGER,
  volume_ratio_pct DECIMAL(6, 2) NOT NULL,
  height_um DECIMAL(6, 2) NOT NULL,
  area_ratio_pct DECIMAL(6, 2) NOT NULL,
  offset_x_um DECIMAL(6, 2) NOT NULL,
  offset_y_um DECIMAL(6, 2) NOT NULL,
  is_critical_pad INTEGER NOT NULL DEFAULT 0,
  defect_type VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spi_pad_panel ON spi_pad_measurements(panel_barcode, ref_des);

CREATE TABLE IF NOT EXISTS printer_tuning_events (
  id VARCHAR(64) PRIMARY KEY,
  correction_id VARCHAR(64) UNIQUE NOT NULL,
  recipe_id VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64) NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  cleaning_mode VARCHAR(32),
  parameter_name VARCHAR(32),
  old_value DECIMAL(8, 3),
  proposed_value DECIMAL(8, 3),
  delta DECIMAL(8, 3),
  unit VARCHAR(16) DEFAULT 'kgf',
  trigger_condition TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PROPOSED',
  commanded_at TIMESTAMP NOT NULL,
  acknowledged_at TIMESTAMP,
  verified_at TIMESTAMP,
  verified_by_panel_barcode VARCHAR(64),
  rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_tuning_correction ON printer_tuning_events(correction_id);

-- ============================================================================
-- PHASE 5: Fleet Orchestration, Logistics, Telemetry & Predictive Quality
-- ============================================================================

-- 1. Material Reservations (Atomic concurrency lock preventing double-mounting)
CREATE TABLE IF NOT EXISTS material_reservations (
  id VARCHAR(64) PRIMARY KEY,
  reel_id VARCHAR(64) NOT NULL,
  line_id VARCHAR(64) NOT NULL,
  slot_no INTEGER NOT NULL,
  part_number VARCHAR(64) NOT NULL,
  reserved_for_request_id VARCHAR(64),
  purpose VARCHAR(128) NOT NULL,
  correlation_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RESERVED',
  reserved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  mounted_at TIMESTAMP,
  consumed_at TIMESTAMP,
  released_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_material_res_active 
ON material_reservations(reel_id) 
WHERE status IN ('RESERVED', 'MOUNTED');

CREATE INDEX IF NOT EXISTS idx_material_res_line 
ON material_reservations(line_id, status);

-- 2. AGV Fleet Units
CREATE TABLE IF NOT EXISTS agv_units (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'IDLE',
  current_location VARCHAR(64) NOT NULL DEFAULT 'CHARGING_DOCK_1',
  battery_percent DECIMAL(5, 2) NOT NULL DEFAULT 100.0,
  current_mission_id VARCHAR(64),
  last_heartbeat_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. AGV Missions (Transport Orders)
CREATE TABLE IF NOT EXISTS agv_missions (
  id VARCHAR(64) PRIMARY KEY,
  agv_id VARCHAR(64),
  mission_type VARCHAR(32) NOT NULL,
  material_type VARCHAR(32) NOT NULL,
  material_id VARCHAR(64) NOT NULL,
  source_location VARCHAR(64) NOT NULL,
  target_line_id VARCHAR(64) NOT NULL,
  target_work_center_id VARCHAR(64) NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  dock_delivery_authorized INTEGER NOT NULL DEFAULT 0,
  dock_authorized_at TIMESTAMP,
  dock_authorized_by VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agv_missions_status 
ON agv_missions(status, priority);

CREATE INDEX IF NOT EXISTS idx_agv_missions_target 
ON agv_missions(target_line_id, target_work_center_id);

-- 4. Material Replenishment Requests (Lifecycle decoupled from vehicle missions)
CREATE TABLE IF NOT EXISTS material_replenishment_requests (
  id VARCHAR(64) PRIMARY KEY,
  line_id VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64) NOT NULL,
  slot_no INTEGER NOT NULL,
  part_number VARCHAR(64) NOT NULL,
  current_reel_id VARCHAR(64),
  remaining_quantity INTEGER NOT NULL DEFAULT 0,
  estimated_minutes_remaining DECIMAL(8, 2) NOT NULL DEFAULT 0,
  confidence VARCHAR(32) NOT NULL DEFAULT 'ACTUAL_PLACEMENT_TELEMETRY',
  status VARCHAR(32) NOT NULL DEFAULT 'REQUESTED',
  assigned_mission_id VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  gated_at TIMESTAMP,
  closed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_replenish_status 
ON material_replenishment_requests(status, line_id);

-- 5. Time-Series Telemetry Store (Decoupled from Transactional EventStore)
CREATE TABLE IF NOT EXISTS telemetry_points (
  id VARCHAR(64) PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  factory_id VARCHAR(64) NOT NULL DEFAULT 'site-noida-p4',
  bay_id VARCHAR(64) NOT NULL DEFAULT 'area-smt-01',
  line_id VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64),
  equipment_id VARCHAR(64),
  asset_id VARCHAR(64) NOT NULL,
  metric VARCHAR(64) NOT NULL,
  value DECIMAL(12, 4) NOT NULL,
  unit VARCHAR(16) NOT NULL,
  metadata_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_query 
ON telemetry_points(asset_id, metric, timestamp);

CREATE INDEX IF NOT EXISTS idx_telemetry_line 
ON telemetry_points(line_id, metric, timestamp);

-- 6. Predictive Anomalies (Derived statistical facts)
CREATE TABLE IF NOT EXISTS predictive_anomalies (
  id VARCHAR(64) PRIMARY KEY,
  anomaly_type VARCHAR(64) NOT NULL,
  line_id VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64) NOT NULL,
  asset_id VARCHAR(64) NOT NULL,
  metric VARCHAR(64) NOT NULL,
  score DECIMAL(8, 3) NOT NULL,
  confidence DECIMAL(5, 4) NOT NULL,
  baseline_value DECIMAL(10, 4) NOT NULL,
  observed_value DECIMAL(10, 4) NOT NULL,
  details_json TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_anomalies_status 
ON predictive_anomalies(status, line_id);

-- 7. Predictive Actions (Safety Gated Physical Interventions)
CREATE TABLE IF NOT EXISTS predictive_actions (
  id VARCHAR(64) PRIMARY KEY,
  anomaly_id VARCHAR(64) NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  target_work_center_id VARCHAR(64) NOT NULL,
  parameters_json TEXT,
  reason TEXT NOT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
  status VARCHAR(32) NOT NULL DEFAULT 'RECOMMENDED',
  authorization_mode VARCHAR(32),
  authorized_by VARCHAR(64),
  authorized_at TIMESTAMP,
  executed_at TIMESTAMP,
  execution_result_json TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pred_actions_status 
ON predictive_actions(status, target_work_center_id);

-- 8. Production Metrics & OEE Snapshots
CREATE TABLE IF NOT EXISTS production_metrics (
  id VARCHAR(64) PRIMARY KEY,
  line_id VARCHAR(64) NOT NULL,
  calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  availability DECIMAL(6, 4) NOT NULL,
  performance DECIMAL(6, 4) NOT NULL,
  quality DECIMAL(6, 4) NOT NULL,
  oee DECIMAL(6, 4) NOT NULL,
  takt_adherence DECIMAL(6, 4) NOT NULL,
  operating_time_seconds DECIMAL(10, 2) NOT NULL,
  planned_time_seconds DECIMAL(10, 2) NOT NULL,
  total_output INTEGER NOT NULL DEFAULT 0,
  good_output INTEGER NOT NULL DEFAULT 0,
  downtime_seconds DECIMAL(10, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_production_metrics_line 
ON production_metrics(line_id, calculated_at);

-- ============================================================================
-- PHASE 6: Closed-Loop Reflow Oven Telemetry & Thermal Profiling Engine
-- ============================================================================

-- 1. Versioned Thermal Specifications
CREATE TABLE IF NOT EXISTS reflow_thermal_specifications (
  id VARCHAR(64) PRIMARY KEY,
  recipe_id VARCHAR(64) NOT NULL,
  board_part_number VARCHAR(64) NOT NULL,
  board_revision VARCHAR(32) NOT NULL,
  specification_version INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- DRAFT, ACTIVE, RETIRED
  alloy VARCHAR(32) NOT NULL,
  specification_json TEXT NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(recipe_id, board_part_number, board_revision, specification_version)
);

CREATE INDEX IF NOT EXISTS idx_reflow_spec_scope 
ON reflow_thermal_specifications(recipe_id, board_part_number, board_revision);

-- 2. Physical Profile Runs (Immutable historical records)
CREATE TABLE IF NOT EXISTS reflow_profile_runs (
  id VARCHAR(64) PRIMARY KEY,
  line_id VARCHAR(64) NOT NULL,
  equipment_id VARCHAR(64) NOT NULL,
  recipe_id VARCHAR(64) NOT NULL,
  board_part_number VARCHAR(64) NOT NULL,
  board_revision VARCHAR(32) NOT NULL,
  file_sha256 VARCHAR(64) NOT NULL,
  specification_id VARCHAR(64) NOT NULL,
  specification_version INTEGER NOT NULL,
  calculation_version VARCHAR(32) NOT NULL,
  overall_pwi DECIMAL(6, 2) NOT NULL,
  compliance_result VARCHAR(32) NOT NULL, -- PASS, WARNING, FAIL
  status VARCHAR(32) NOT NULL, -- UPLOADED, PARSED, PARSE_FAILED, VALIDATED, VALIDATION_FAILED, REVIEW_REQUIRED, APPROVED, REJECTED, ACTIVE, RETIRED
  metadata_json TEXT NOT NULL,
  imported_by VARCHAR(64) NOT NULL,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by VARCHAR(64),
  approved_at TIMESTAMP,
  activated_at TIMESTAMP,
  retired_at TIMESTAMP
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
  id VARCHAR(64) PRIMARY KEY,
  profile_run_id VARCHAR(64) NOT NULL,
  probe_index INTEGER NOT NULL,
  label VARCHAR(64) NOT NULL,
  thermal_role VARCHAR(32) NOT NULL,
  metrics_json TEXT NOT NULL,
  pwi_json TEXT NOT NULL,
  samples_json TEXT NOT NULL, -- Explicit array of { timeSeconds, temperatureC }
  UNIQUE(profile_run_id, probe_index)
);

CREATE INDEX IF NOT EXISTS idx_reflow_probe_run 
ON reflow_profile_probes(profile_run_id);

-- 4. Active Process Compliance State Snapshot
CREATE TABLE IF NOT EXISTS reflow_process_states (
  line_id VARCHAR(64) NOT NULL,
  equipment_id VARCHAR(64) NOT NULL,
  recipe_id VARCHAR(64) NOT NULL,
  board_part_number VARCHAR(64) NOT NULL,
  board_revision VARCHAR(32) NOT NULL,
  active_profile_run_id VARCHAR(64),
  compliance_status VARCHAR(32) NOT NULL, -- COMPLIANT, DRIFT_SUSPECTED, DRIFT_CONFIRMED, REVALIDATION_REQUIRED, DATA_INSUFFICIENT
  consecutive_drift_seconds DECIMAL(8, 2) NOT NULL DEFAULT 0.0,
  consecutive_healthy_seconds DECIMAL(8, 2) NOT NULL DEFAULT 0.0,
  last_evaluated_at TIMESTAMP NOT NULL,
  drift_metrics_json TEXT NOT NULL,
  PRIMARY KEY(line_id, equipment_id, recipe_id, board_part_number, board_revision)
);

-- 5. Contemporaneous Profile-Telemetry Correlation
CREATE TABLE IF NOT EXISTS reflow_profile_correlations (
  profile_run_id VARCHAR(64) PRIMARY KEY,
  line_id VARCHAR(64) NOT NULL,
  equipment_id VARCHAR(64) NOT NULL,
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  sample_count INTEGER NOT NULL,
  telemetry_integrity_score DECIMAL(5, 4) NOT NULL,
  correlation_json TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Section 2: Dual-Token Architecture & Refresh Sessions (Task 3)
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id VARCHAR(64) PRIMARY KEY,
  operator_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  family_id VARCHAR(64) NOT NULL,
  revoked INTEGER DEFAULT 0,
  revoked_reason VARCHAR(64),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by_ip VARCHAR(64) NOT NULL,
  authz_version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- ============================================================================
-- Section 5: Disaster Recovery & Automated Drill Pipeline (Task 8)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dr_drill_history (
  drill_id VARCHAR(64) PRIMARY KEY,
  drill_version VARCHAR(32) NOT NULL,
  backup_timestamp TIMESTAMP NOT NULL,
  drill_started_at TIMESTAMP NOT NULL,
  drill_completed_at TIMESTAMP NOT NULL,
  rpo_seconds INTEGER NOT NULL,
  rto_seconds INTEGER NOT NULL,
  schema_valid INTEGER NOT NULL DEFAULT 0,
  event_store_valid INTEGER NOT NULL DEFAULT 0,
  ledger_integrity INTEGER NOT NULL DEFAULT 0,
  manifest_integrity INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL, -- 'PASS', 'FAIL'
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_dr_drill_status ON dr_drill_history(status, drill_completed_at);
