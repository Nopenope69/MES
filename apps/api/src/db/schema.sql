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
  completed_at TIMESTAMP NOT NULL
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



