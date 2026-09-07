-- ============================================================================
-- 003_phase3_and_phase4_quality_closed_loop.sql
-- PostgreSQL Enterprise DDL for Phase 3 (3D AOI & Rework) & Phase 4 (3D SPI & CFX Auto-Tuning)
-- ============================================================================

-- Phase 3: Quality Rules & PCB CAD Master Data
CREATE TABLE IF NOT EXISTS quality_rules (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  program_id TEXT,
  consecutive_failure_limit INTEGER NOT NULL DEFAULT 3,
  sliding_window_failures INTEGER NOT NULL DEFAULT 5,
  sliding_window_panels INTEGER NOT NULL DEFAULT 20,
  default_max_rework_cycles INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pcb_cad_definitions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_revision INTEGER NOT NULL DEFAULT 1,
  program_id TEXT NOT NULL,
  program_revision INTEGER NOT NULL DEFAULT 1,
  board_side TEXT NOT NULL DEFAULT 'TOP',
  cad_revision TEXT NOT NULL DEFAULT 'REV_1',
  ref_des TEXT NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  x_mm NUMERIC(8, 3) NOT NULL,
  y_mm NUMERIC(8, 3) NOT NULL,
  rotation_deg NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
  package_type TEXT NOT NULL DEFAULT '0402',
  assigned_part_number TEXT NOT NULL,
  max_rework_cycles INTEGER NOT NULL DEFAULT 2
);

CREATE INDEX IF NOT EXISTS idx_cad_program ON pcb_cad_definitions(program_id, program_revision, board_side);

CREATE TABLE IF NOT EXISTS panel_units (
  id TEXT PRIMARY KEY,
  panel_barcode TEXT NOT NULL,
  unit_position INTEGER NOT NULL,
  unit_serial_number TEXT,
  status TEXT NOT NULL DEFAULT 'PASSED',
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(panel_barcode, unit_position)
);

CREATE TABLE IF NOT EXISTS aoi_inspections (
  id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_inspection_id TEXT NOT NULL,
  source_file_hash TEXT NOT NULL,
  panel_barcode TEXT NOT NULL,
  batch_id TEXT,
  work_center_id TEXT NOT NULL,
  optical_machine_id TEXT NOT NULL,
  inspection_phase TEXT NOT NULL DEFAULT 'POST_REFLOW',
  result TEXT NOT NULL,
  total_defects INTEGER NOT NULL DEFAULT 0,
  duration_seconds NUMERIC(8, 2),
  inspected_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_system, source_inspection_id, source_file_hash)
);

CREATE INDEX IF NOT EXISTS idx_aoi_panel ON aoi_inspections(panel_barcode);

CREATE TABLE IF NOT EXISTS aoi_defects (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  panel_barcode TEXT NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  ref_des TEXT NOT NULL,
  defect_category TEXT NOT NULL,
  defect_type TEXT NOT NULL,
  defect_signature TEXT NOT NULL,
  offset_x_um NUMERIC(8, 2),
  offset_y_um NUMERIC(8, 2),
  rotation_deg NUMERIC(6, 2),
  board_side TEXT NOT NULL DEFAULT 'TOP',
  status TEXT NOT NULL DEFAULT 'OPEN',
  image_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_defects_panel ON aoi_defects(panel_barcode, unit_position);
CREATE INDEX IF NOT EXISTS idx_defects_signature ON aoi_defects(defect_signature);

CREATE TABLE IF NOT EXISTS rework_dispositions (
  id TEXT PRIMARY KEY,
  defect_id TEXT NOT NULL,
  panel_barcode TEXT NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  disposition TEXT NOT NULL,
  reason TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  disposition_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rework_events (
  id TEXT PRIMARY KEY,
  defect_id TEXT NOT NULL,
  panel_barcode TEXT NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  ref_des TEXT NOT NULL,
  technician_id TEXT NOT NULL,
  station_id TEXT NOT NULL DEFAULT 'STATION-REWORK-01',
  old_mpn TEXT NOT NULL,
  old_reel_id TEXT,
  replacement_mpn TEXT NOT NULL,
  replacement_reel_id TEXT NOT NULL,
  rework_method TEXT NOT NULL DEFAULT 'HOT_AIR_DESOLDER_SOLDERING_IRON',
  temperature_profile_id TEXT,
  rework_cycle INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rework_panel ON rework_events(panel_barcode, ref_des);

-- Phase 4: Closed-Loop 3D SPI & Screen Printer IPC-CFX Auto-Tuning
CREATE TABLE IF NOT EXISTS recipe_process_windows (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  recipe_revision INTEGER NOT NULL DEFAULT 1,
  stencil_id TEXT NOT NULL,
  stencil_revision TEXT NOT NULL DEFAULT 'A',
  nominal_stencil_thickness_um NUMERIC(6, 2) NOT NULL DEFAULT 120.0,
  volume_lower_limit_pct NUMERIC(6, 2) NOT NULL DEFAULT 75.0,
  volume_upper_limit_pct NUMERIC(6, 2) NOT NULL DEFAULT 135.0,
  volume_warning_lower_pct NUMERIC(6, 2) NOT NULL DEFAULT 85.0,
  volume_warning_upper_pct NUMERIC(6, 2) NOT NULL DEFAULT 120.0,
  height_lower_limit_um NUMERIC(6, 2) NOT NULL DEFAULT 90.0,
  height_upper_limit_um NUMERIC(6, 2) NOT NULL DEFAULT 160.0,
  area_lower_limit_pct NUMERIC(6, 2) NOT NULL DEFAULT 80.0,
  max_offset_um NUMERIC(6, 2) NOT NULL DEFAULT 50.0,
  nominal_pressure_kgf NUMERIC(6, 2) NOT NULL DEFAULT 8.5,
  nominal_separation_speed_mm_s NUMERIC(6, 2) NOT NULL DEFAULT 1.2,
  min_pressure_kgf NUMERIC(6, 2) NOT NULL DEFAULT 6.0,
  max_pressure_kgf NUMERIC(6, 2) NOT NULL DEFAULT 12.0,
  max_abs_delta_pressure NUMERIC(6, 2) NOT NULL DEFAULT 0.5,
  max_pct_delta_pressure NUMERIC(6, 2) NOT NULL DEFAULT 5.0,
  min_separation_speed_mm_s NUMERIC(6, 2) NOT NULL DEFAULT 0.5,
  max_separation_speed_mm_s NUMERIC(6, 2) NOT NULL DEFAULT 3.0,
  max_abs_delta_separation_speed NUMERIC(6, 2) NOT NULL DEFAULT 0.2,
  min_time_between_changes_sec INTEGER NOT NULL DEFAULT 180,
  max_changes_per_hour INTEGER NOT NULL DEFAULT 4,
  cooldown_after_cleaning_sec INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS printer_capabilities (
  equipment_id TEXT PRIMARY KEY,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  cfx_version TEXT NOT NULL DEFAULT '1.7',
  supports_stencil_cleaning INTEGER NOT NULL DEFAULT 1,
  supports_parameter_modification INTEGER NOT NULL DEFAULT 1,
  supports_pressure_control INTEGER NOT NULL DEFAULT 1,
  supports_separation_speed_control INTEGER NOT NULL DEFAULT 1,
  supports_print_speed_control INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spi_inspections (
  id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_inspection_id TEXT NOT NULL,
  source_file_hash TEXT NOT NULL,
  panel_barcode TEXT NOT NULL,
  batch_id TEXT,
  work_center_id TEXT NOT NULL,
  optical_machine_id TEXT NOT NULL,
  result TEXT NOT NULL,
  total_pads_inspected INTEGER NOT NULL DEFAULT 0,
  defective_pads_count INTEGER NOT NULL DEFAULT 0,
  mean_volume_pct NUMERIC(6, 2),
  sigma_volume_pct NUMERIC(6, 2),
  duration_seconds NUMERIC(8, 2),
  inspected_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_system, source_inspection_id, source_file_hash)
);

CREATE INDEX IF NOT EXISTS idx_spi_panel ON spi_inspections(panel_barcode);

CREATE TABLE IF NOT EXISTS spi_pad_measurements (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  panel_barcode TEXT NOT NULL,
  pad_id TEXT NOT NULL,
  unit_position INTEGER NOT NULL DEFAULT 1,
  ref_des TEXT NOT NULL,
  pin_no INTEGER,
  volume_ratio_pct NUMERIC(6, 2) NOT NULL,
  height_um NUMERIC(6, 2) NOT NULL,
  area_ratio_pct NUMERIC(6, 2) NOT NULL,
  offset_x_um NUMERIC(6, 2) NOT NULL,
  offset_y_um NUMERIC(6, 2) NOT NULL,
  is_critical_pad INTEGER NOT NULL DEFAULT 0,
  defect_type TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spi_pad_panel ON spi_pad_measurements(panel_barcode, ref_des);

CREATE TABLE IF NOT EXISTS printer_tuning_events (
  id TEXT PRIMARY KEY,
  correction_id TEXT UNIQUE NOT NULL,
  recipe_id TEXT NOT NULL,
  work_center_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  cleaning_mode TEXT,
  parameter_name TEXT,
  old_value NUMERIC(8, 3),
  proposed_value NUMERIC(8, 3),
  delta NUMERIC(8, 3),
  unit TEXT DEFAULT 'kgf',
  trigger_condition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  commanded_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by_panel_barcode TEXT,
  rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_tuning_correction ON printer_tuning_events(correction_id);
