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
  msl_remaining_minutes INTEGER NOT NULL DEFAULT 999999,
  status VARCHAR(32) NOT NULL DEFAULT 'READY' -- READY, MOUNTED, SPLICED, DEPLETED, EXPIRED_MSL
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
