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
