import { getDatabase, initDatabase } from './database';

export async function seedDatabase(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();

  console.log('[SEED] Clearing existing records for clean SMT factory state...');
  await db.execScript(`
    DELETE FROM reflow_profile_correlations;
    DELETE FROM reflow_process_states;
    DELETE FROM reflow_profile_probes;
    DELETE FROM reflow_profile_runs;
    DELETE FROM reflow_thermal_specifications;
    DELETE FROM production_metrics;
    DELETE FROM predictive_actions;
    DELETE FROM predictive_anomalies;
    DELETE FROM telemetry_points;
    DELETE FROM material_replenishment_requests;
    DELETE FROM agv_missions;
    DELETE FROM agv_units;
    DELETE FROM material_reservations;
    DELETE FROM printer_tuning_events;
    DELETE FROM spi_pad_measurements;
    DELETE FROM spi_inspections;
    DELETE FROM printer_capabilities;
    DELETE FROM recipe_process_windows;
    DELETE FROM rework_events;
    DELETE FROM rework_dispositions;
    DELETE FROM aoi_defects;
    DELETE FROM aoi_inspections;
    DELETE FROM panel_units;
    DELETE FROM pcb_cad_definitions;
    DELETE FROM quality_rules;
    DELETE FROM stencil_paste_loads;
    DELETE FROM stencil_sessions;
    DELETE FROM stencils;
    DELETE FROM solder_paste_jars;
    DELETE FROM solder_paste_profiles;
    DELETE FROM msl_exposure_logs;
    DELETE FROM msl_bake_profiles;
    DELETE FROM dry_cabinets;
    DELETE FROM feeder_error_logs;
    DELETE FROM panel_checkouts;
    DELETE FROM smt_feeder_slots;
    DELETE FROM component_reels;
    DELETE FROM material_consumptions;
    DELETE FROM downtime_attributions;
    DELETE FROM equipment_state_logs;
    DELETE FROM production_events;
    DELETE FROM ingress_events;
    DELETE FROM raw_integration_messages;
    DELETE FROM batches;
    DELETE FROM work_orders;
    DELETE FROM recipe_items;
    DELETE FROM recipes;
    DELETE FROM products;
    DELETE FROM operators;
    DELETE FROM shifts;
    DELETE FROM equipment_units;
    DELETE FROM work_centers;
    DELETE FROM production_lines;
    DELETE FROM areas;
    DELETE FROM sites;
    DELETE FROM organizations;
  `);

  console.log('[SEED] Inserting ISA-95 Asset Hierarchy for Dixon SMT Facility...');
  // 1. Organization
  await db.execute(`
    INSERT INTO organizations (id, code, name)
    VALUES ('org-dixon', 'ORG-DIXON', 'Dixon Technologies (India) Ltd')
  `);

  // 2. Site
  await db.execute(`
    INSERT INTO sites (id, organization_id, code, name, location, timezone)
    VALUES ('site-noida-p4', 'org-dixon', 'SITE-NOIDA-P4', 'Noida Sector 63 SMT Facility', 'Noida, Uttar Pradesh, India', 'Asia/Kolkata')
  `);

  // 3. Area
  await db.execute(`
    INSERT INTO areas (id, site_id, code, name, type)
    VALUES
      ('area-smt-01', 'site-noida-p4', 'AREA-SMT-01', 'SMT Cleanroom Bay A', 'SMT_CLEANROOM'),
      ('area-aoi-01', 'site-noida-p4', 'AREA-AOI-01', 'Post-Reflow Optical Inspection Suite', 'TESTING_AOI')
  `);

  // 4. Production Lines
  await db.execute(`
    INSERT INTO production_lines (id, area_id, code, name)
    VALUES
      ('line-smt-01', 'area-smt-01', 'LINE-SMT-01', 'SMT Line 01 (Fuji NXT III High-Speed Line)'),
      ('line-smt-02', 'area-smt-01', 'LINE-SMT-02', 'SMT Line 02 (Automotive ECU High-Reliability Line)')
  `);

  // 5. SMT Work Centers
  await db.execute(`
    INSERT INTO work_centers (id, line_id, code, name, area, type, asset_path, current_state, current_program_name, module_count, last_state_change_time)
    VALUES 
      ('wc-spg-01', 'line-smt-01', 'WC-SPG-01', 'Fuji GPX-C Solder Paste Screen Printer', 'SMT Cleanroom Bay A', 'SCREEN_PRINTER', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-01.WC-SPG-01', 'RUNNING', 'PROG-SM-METER-TOP-REV4', 1, ?),
      ('wc-nxt-01', 'line-smt-01', 'WC-NXT-01', 'Fuji NXT III M6 Pick-and-Place (4 Modules)', 'SMT Cleanroom Bay A', 'PICK_AND_PLACE', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-01.WC-NXT-01', 'RUNNING', 'PROG-SM-METER-TOP-REV4', 4, ?),
      ('wc-rfl-01', 'line-smt-01', 'WC-RFL-01', 'Heller 1913 MK5 10-Zone Reflow Oven', 'SMT Cleanroom Bay A', 'REFLOW_OVEN', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-01.WC-RFL-01', 'RUNNING', 'PROG-SM-METER-TOP-REV4', 1, ?),
      ('wc-aoi-01', 'line-smt-01', 'WC-AOI-01', 'Koh Young 3D AOI Optical Inspector', 'Post-Reflow Optical Inspection Suite', 'AOI_INSPECTION', 'ORG-DIXON.SITE-NOIDA-P4.AREA-AOI-01.LINE-SMT-01.WC-AOI-01', 'RUNNING', 'PROG-SM-METER-TOP-REV4', 1, ?),
      ('wc-spg-02', 'line-smt-02', 'WC-SPG-02', 'DEK NeoHorizon High-Precision Screen Printer', 'SMT Cleanroom Bay A', 'SCREEN_PRINTER', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-02.WC-SPG-02', 'RUNNING', 'PROG-AUTO-ECU-TOP-REV1', 1, ?),
      ('wc-nxt-02', 'line-smt-02', 'WC-NXT-02', 'Fuji NXT III M6 Pick-and-Place (Module 2)', 'SMT Cleanroom Bay A', 'PICK_AND_PLACE', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-02.WC-NXT-02', 'RUNNING', 'PROG-AUTO-ECU-TOP-REV1', 4, ?),
      ('wc-rfl-02', 'line-smt-02', 'WC-RFL-02', 'Rehm Nitro 12-Zone Nitrogen Reflow Oven', 'SMT Cleanroom Bay A', 'REFLOW_OVEN', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-02.WC-RFL-02', 'RUNNING', 'PROG-AUTO-ECU-TOP-REV1', 1, ?),
      ('wc-aoi-02', 'line-smt-02', 'WC-AOI-02', 'Omron VT-S1080 3D AOI Dual-Lane Inspector', 'Post-Reflow Optical Inspection Suite', 'AOI_INSPECTION', 'ORG-DIXON.SITE-NOIDA-P4.AREA-AOI-01.LINE-SMT-02.WC-AOI-02', 'RUNNING', 'PROG-AUTO-ECU-TOP-REV1', 1, ?)
  `, [now, now, now, now, now, now, now, now]);

  console.log('[SEED] Inserting SMT Operators & Shift Schedules...');
  await db.execute(`
    INSERT INTO operators (id, code, name, role, pin)
    VALUES
      ('op-smt-01', 'OP-SMT-01', 'Vikram Singh (Feeder Specialist)', 'OPERATOR', '1234'),
      ('op-smt-02', 'OP-SMT-02', 'Rahul Yadav (Splicing Tech)', 'OPERATOR', '2345'),
      ('sup-smt-01', 'SUP-SMT-01', 'Deepak Sharma (SMT Line Leader)', 'SMT_SUPERVISOR', '9999'),
      ('qa-smt-01', 'QA-SMT-01', 'Meera Rao (Quality Lead)', 'QUALITY_INSPECTOR', '8888')
  `);

  await db.execute(`
    INSERT INTO shifts (id, code, name, start_time, end_time)
    VALUES
      ('shift-a', 'SHIFT_A', 'Morning Shift (06:00 - 14:00)', '06:00', '14:00'),
      ('shift-b', 'SHIFT_B', 'Evening Shift (14:00 - 22:00)', '14:00', '22:00'),
      ('shift-c', 'SHIFT_C', 'Night Shift (22:00 - 06:00)', '22:00', '06:00')
  `);

  console.log('[SEED] Inserting SMT Product & Fuji Placement BOM Program...');
  await db.execute(`
    INSERT INTO products (id, code, name, description, uom, category)
    VALUES
      ('prd-sm-4g', 'PRD-SM-4G-V2', 'Smart Energy Meter 4G Communication Board', 'High-density 4-layer PCBA with 4G LTE & ARM Cortex-M4', 'PANEL', 'SMART_METER')
  `);

  await db.execute(`
    INSERT INTO recipes (id, code, product_code, revision, name, target_cycle_time_minutes, panels_per_job)
    VALUES
      ('rec-sm-01', 'PROG-SM-METER-TOP-REV4', 'PRD-SM-4G-V2', 4, 'Smart Meter Top Side SMT Placement Program', 1, 500)
  `);

  // SMT Program BOM (Component Placements per Slot)
  await db.execute(`
    INSERT INTO recipe_items (id, recipe_id, material_code, material_name, planned_quantity, unit, module_no, slot_no, sub_slot_no, package_type, reference_designators)
    VALUES
      ('bom-01', 'rec-sm-01', 'C0402-100NF-16V', '100nF 16V 10% 0402 Ceramic Cap', 42.0, 'PCS', 1, 1, 0, '0402', 'C1, C2, C3, C4, C5, C6, C12, C14, C18...'),
      ('bom-02', 'rec-sm-01', 'R0402-10K-1%', '10k Ohm 1% 0402 Thick Film Resistor', 28.0, 'PCS', 1, 2, 0, '0402', 'R1, R2, R4, R8, R12, R15, R22...'),
      ('bom-03', 'rec-sm-01', 'IC-STM32F401-LQFP64', 'STM32F401 32-bit ARM Cortex MCU', 1.0, 'PCS', 1, 3, 0, 'LQFP-64', 'U1 (Main Processor)'),
      ('bom-04', 'rec-sm-01', 'MOD-QUECTEL-EC200U', 'Quectel EC200U-CN 4G LTE IoT Module', 1.0, 'PCS', 1, 4, 0, 'LGA-144', 'MOD1 (Cellular Modem)'),
      ('bom-05', 'rec-sm-01', 'IC-TPS62130-QFN16', 'TI Synchronous Step-Down DC-DC Converter', 2.0, 'PCS', 1, 5, 0, 'QFN-16', 'U2, U3 (Power Rails)')
  `);

  console.log('[SEED] Inserting JEDEC MSL Bake Profiles & Dry Cabinets...');
  await db.execute(`
    INSERT INTO dry_cabinets (id, code, name, rh_limit_percent, temperature_min_c, temperature_max_c, validation_status, last_calibrated_at)
    VALUES
      ('cab-01', 'DRY-CAB-01', 'N2 Nitrogen Dry Storage Cabinet 01 (RH < 5%)', 5.0, 20.0, 25.0, 'VALIDATED', ?)
  `, [now]);

  await db.execute(`
    INSERT INTO msl_bake_profiles (id, standard, standard_revision, msl_class, package_thickness_class, temperature_c, minimum_duration_minutes, carrier_type, max_bake_temperature_c, enabled)
    VALUES
      ('BAKE-JEDEC-125C-24H', 'JEDEC_J_STD_033D', 'D', 'MSL_3', 'THIN_LE_1_4MM', 125, 1440, 'HIGH_TEMP_REEL', 125, 1),
      ('BAKE-JEDEC-90C-48H', 'JEDEC_J_STD_033D', 'D', 'MSL_3', 'THIN_LE_1_4MM', 90, 2880, 'MEDIUM_TEMP_REEL', 95, 1),
      ('BAKE-JEDEC-40C-192H', 'JEDEC_J_STD_033D', 'D', 'MSL_3', 'THIN_LE_1_4MM', 40, 11520, 'STANDARD_PLASTIC_REEL', 45, 1)
  `);

  console.log('[SEED] Inserting Solder Paste Profiles & Stencil Master Data...');
  await db.execute(`
    INSERT INTO solder_paste_profiles (
      id, manufacturer, product_code, alloy_type, storage_min_c, storage_max_c,
      thaw_required_minutes, minimum_processing_temperature_c, mixing_required,
      mixing_method, mixing_min_seconds, mixing_max_seconds, stencil_life_minutes,
      shelf_life_days, standard_or_tds_reference, revision, active
    ) VALUES (
      'spp-alpha-om338', 'Alpha Assembly Solutions', 'ALPHA-OM338-PT', 'SAC305 (Sn96.5/Ag3.0/Cu0.5)',
      2.0, 10.0, 240, 22.0, 1, 'CENTRIFUGAL_PLANETARY', 120, 300, 480,
      180, 'IPC-J-STD-004B ROL0', '1.2', 1
    )
  `);

  await db.execute(`
    INSERT INTO solder_paste_jars (
      id, jar_id, part_number, profile_id, alloy_type, lot_number,
      expiry_date, status, removed_from_cold_at, thaw_verified_at,
      thaw_duration_minutes, temperature_verified_at, temperature_verified_c,
      mixed_at, mixed_duration_seconds, mixing_method, current_work_center_id
    ) VALUES
      ('jar-01', 'JAR-ALPHA-2601-A', 'ALPHA-OM338-PT', 'spp-alpha-om338', 'SAC305', 'LOT-PASTE-2601', '2026-12-31T00:00:00Z', 'REFRIGERATED', NULL, NULL, 240, NULL, NULL, NULL, 0, NULL, 'wc-spg-01'),
      ('jar-02', 'JAR-ALPHA-2601-B', 'ALPHA-OM338-PT', 'spp-alpha-om338', 'SAC305', 'LOT-PASTE-2601', '2026-12-31T00:00:00Z', 'AUTHORIZED', ?, ?, 240, ?, 23.4, ?, 120, 'CENTRIFUGAL_PLANETARY', 'wc-spg-01'),
      ('jar-03', 'JAR-ALPHA-2601-C', 'ALPHA-OM338-PT', 'spp-alpha-om338', 'SAC305', 'LOT-PASTE-2601', '2026-12-31T00:00:00Z', 'ON_STENCIL', ?, ?, 240, ?, 23.2, ?, 120, 'CENTRIFUGAL_PLANETARY', 'wc-spg-01')
  `, [now, now, now, now, now, now, now, now]);

  await db.execute(`
    INSERT INTO stencils (id, stencil_id, part_number, revision, stencil_serial_number, status)
    VALUES
      ('stc-sm-01', 'STC-SM-4G-TOP', 'PRD-SM-4G-V2', 'A', 'STN-2026-0042', 'IN_USE')
  `);

  console.log('[SEED] Inserting Component Reels in Warehouse & Feeder Bank...');
  await db.execute(`
    INSERT INTO component_reels (
      id, reel_id, part_number, part_name, supplier_name, lot_number,
      date_code, initial_quantity, current_quantity, unit, msl_level,
      msl_class, msl_remaining_minutes, mbb_opened_at, storage_location,
      storage_state, floor_clock_state, floor_life_nominal_minutes, status
    ) VALUES
      ('reel-01', 'REEL-MUR-98124', 'C0402-100NF-16V', '100nF 16V 10% 0402 Ceramic Cap', 'Murata Electronics', 'LOT-MUR-2601', '202612', 10000, 7850, 'PCS', 1, 'MSL_1', 999999, NULL, 'FACTORY_FLOOR', 'AMBIENT_EXPOSURE', 'FLOOR_EXPOSURE', 999999, 'MOUNTED'),
      ('reel-02', 'REEL-VSH-44120', 'R0402-10K-1%', '10k Ohm 1% 0402 Thick Film Resistor', 'Vishay Intertechnology', 'LOT-VSH-8812', '202615', 5000, 3210, 'PCS', 1, 'MSL_1', 999999, NULL, 'FACTORY_FLOOR', 'AMBIENT_EXPOSURE', 'FLOOR_EXPOSURE', 999999, 'MOUNTED'),
      ('reel-03', 'REEL-STM-11029', 'IC-STM32F401-LQFP64', 'STM32F401 32-bit ARM Cortex MCU', 'STMicroelectronics', 'LOT-STM-2602', '202618', 1500, 1358, 'PCS', 3, 'MSL_3', 9600, ?, 'FACTORY_FLOOR', 'AMBIENT_EXPOSURE', 'FLOOR_EXPOSURE', 10080, 'MOUNTED'),
      ('reel-04', 'REEL-QCT-77821', 'MOD-QUECTEL-EC200U', 'Quectel EC200U-CN 4G LTE IoT Module', 'Quectel Wireless', 'LOT-QCT-5519', '202610', 500, 358, 'PCS', 3, 'MSL_3', 4320, ?, 'FACTORY_FLOOR', 'AMBIENT_EXPOSURE', 'FLOOR_EXPOSURE', 10080, 'MOUNTED'),
      ('reel-05', 'REEL-TI-66100', 'IC-TPS62130-QFN16', 'TI Synchronous Step-Down DC-DC Converter', 'Texas Instruments', 'LOT-TI-9901', '202620', 3000, 2716, 'PCS', 2, 'MSL_2', 520000, ?, 'FACTORY_FLOOR', 'AMBIENT_EXPOSURE', 'FLOOR_EXPOSURE', 525600, 'MOUNTED'),
      ('reel-06-sp', 'REEL-MUR-98125-SPLICE', 'C0402-100NF-16V', '100nF 16V 10% 0402 Ceramic Cap', 'Murata Electronics', 'LOT-MUR-2603', '202614', 10000, 10000, 'PCS', 1, 'MSL_1', 999999, NULL, 'WAREHOUSE', 'SEALED_MBB', 'SEALED', 999999, 'READY'),
      ('reel-exp-demo', 'REEL-EXPIRED-TEST-01', 'C0402-100NF-16V', '100nF Cap (MSL Expired Demo)', 'Murata Electronics', 'LOT-EXP-01', '202610', 5000, 5000, 'PCS', 3, 'MSL_3', 0, '2026-08-01T00:00:00Z', 'FACTORY_FLOOR', 'AMBIENT_EXPOSURE', 'BAKE_REQUIRED', 10080, 'EXPIRED_MSL'),
      ('reel-quar-demo', 'REEL-QUARANTINE-01', 'C0402-100NF-16V', '100nF Cap (Quarantined Demo)', 'Murata Electronics', 'LOT-QUAR-01', '202611', 5000, 5000, 'PCS', 1, 'MSL_1', 999999, NULL, 'FACTORY_FLOOR', 'AMBIENT_EXPOSURE', 'FLOOR_EXPOSURE', 999999, 'QUARANTINED')
  `, [now, now, now]);

  // Seed active ambient exposure intervals for reels 3, 4, and demo expired reel
  await db.execute(`
    INSERT INTO msl_exposure_logs (id, reel_id, state, started_at, source_event_id)
    VALUES
      ('log-exp-03', 'REEL-STM-11029', 'AMBIENT_EXPOSURE', ?, 'evt-unseal-03'),
      ('log-exp-04', 'REEL-QCT-77821', 'AMBIENT_EXPOSURE', ?, 'evt-unseal-04'),
      ('log-exp-demo', 'REEL-EXPIRED-TEST-01', 'AMBIENT_EXPOSURE', '2026-08-01T00:00:00Z', 'evt-seed-exp')
  `, [now, now]);

  console.log('[SEED] Mapping SMT Feeder Slots on Fuji NXT III (Module 1)...');
  await db.execute(`
    INSERT INTO smt_feeder_slots (id, work_center_id, module_no, stage_no, slot_no, sub_slot_no, feeder_id, feeder_type, assigned_part_number, current_reel_id, status)
    VALUES
      ('slot-01', 'wc-nxt-01', 1, 1, 1, 0, 'FID-W08F-01', 'W08f (8mm High Speed)', 'C0402-100NF-16V', 'REEL-MUR-98124', 'OK'),
      ('slot-02', 'wc-nxt-01', 1, 1, 2, 0, 'FID-W08F-02', 'W08f (8mm High Speed)', 'R0402-10K-1%', 'REEL-VSH-44120', 'OK'),
      ('slot-03', 'wc-nxt-01', 1, 1, 3, 0, 'FID-W12F-03', 'W12f (12mm IC Feeder)', 'IC-STM32F401-LQFP64', 'REEL-STM-11029', 'OK'),
      ('slot-04', 'wc-nxt-01', 1, 1, 4, 0, 'FID-W24F-04', 'W24f (24mm Module Feeder)', 'MOD-QUECTEL-EC200U', 'REEL-QCT-77821', 'OK'),
      ('slot-05', 'wc-nxt-01', 1, 1, 5, 0, 'FID-W16F-05', 'W16f (16mm QFN Feeder)', 'IC-TPS62130-QFN16', 'REEL-TI-66100', 'OK')
  `);

  console.log('[SEED] Inserting Active SMT Production Run...');
  await db.execute(`
    INSERT INTO work_orders (id, order_number, product_code, target_quantity, status, created_at)
    VALUES ('wo-dixon-01', 'WO-2026-DIXON-01', 'PRD-SM-4G-V2', 500.0, 'IN_PROGRESS', ?)
  `, [now]);

  await db.execute(`
    INSERT INTO batches (id, batch_number, work_order_number, product_code, recipe_code, work_center_id, status, planned_quantity, actual_quantity, rejected_quantity, unit, started_at, operator_id)
    VALUES ('job-01', 'JOB-SM-260901', 'WO-2026-DIXON-01', 'PRD-SM-4G-V2', 'PROG-SM-METER-TOP-REV4', 'wc-nxt-01', 'RUNNING', 500.0, 142.0, 3.0, 'PANEL', ?, 'op-smt-01')
  `, [now]);

  await db.execute(`
    UPDATE work_centers 
    SET current_batch_id = 'job-01', current_operator_id = 'op-smt-01'
    WHERE id = 'wc-nxt-01'
  `);

  // Initial State Log
  await db.execute(`
    INSERT INTO equipment_state_logs (id, work_center_id, batch_id, previous_state, current_state, started_at)
    VALUES ('state-log-nxt', 'wc-nxt-01', 'job-01', 'IDLE', 'RUNNING', ?)
  `, [now]);

  // Seed sample panel checkouts
  await db.execute(`
    INSERT INTO panel_checkouts (id, panel_barcode, work_center_id, batch_id, program_name, cycle_time_seconds, block_count, block_skip_count, completed_at)
    VALUES 
      ('panel-chk-01', 'PNL-SM-00140', 'wc-nxt-01', 'job-01', 'PROG-SM-METER-TOP-REV4', 18.24, 4, 0, ?),
      ('panel-chk-02', 'PNL-SM-00141', 'wc-nxt-01', 'job-01', 'PROG-SM-METER-TOP-REV4', 18.50, 4, 0, ?),
      ('panel-chk-03', 'PNL-SM-00142', 'wc-nxt-01', 'job-01', 'PROG-SM-METER-TOP-REV4', 19.12, 3, 1, ?)
  `, [now, now, now]);

  // Seed SMT feeder error logs
  await db.execute(`
    INSERT INTO feeder_error_logs (id, work_center_id, module_no, slot_no, feeder_id, part_number, nozzle_id, error_type, occurred_at)
    VALUES
      ('err-01', 'wc-nxt-01', 1, 1, 'FID-W08F-01', 'C0402-100NF-16V', 'NOZ-0402-A', 'EMPTY_PICKUP', ?),
      ('err-02', 'wc-nxt-01', 1, 1, 'FID-W08F-01', 'C0402-100NF-16V', 'NOZ-0402-A', 'VISION_ERROR', ?),
      ('err-03', 'wc-nxt-01', 1, 2, 'FID-W08F-02', 'R0402-10K-1%', 'NOZ-0402-B', 'DROPPED_PART', ?)
  `, [now, now, now]);

  // Seed material consumption linkage for Panel 140
  await db.execute(`
    INSERT INTO material_consumptions (id, batch_id, material_lot_number, material_code, material_name, quantity_consumed, unit, container_id, operator_id, consumed_at)
    VALUES
      ('mc-01', 'job-01', 'REEL-MUR-98124', 'C0402-100NF-16V', '100nF 16V 0402 Cap', 42.0, 'PCS', 'FID-W08F-01 (Slot 1)', 'op-smt-01', ?),
      ('mc-02', 'job-01', 'REEL-VSH-44120', 'R0402-10K-1%', '10k Ohm 0402 Resistor', 28.0, 'PCS', 'FID-W08F-02 (Slot 2)', 'op-smt-01', ?),
      ('mc-03', 'job-01', 'REEL-STM-11029', 'IC-STM32F401-LQFP64', 'STM32F401 MCU', 1.0, 'PCS', 'FID-W12F-03 (Slot 3)', 'op-smt-01', ?),
      ('mc-04', 'job-01', 'REEL-QCT-77821', 'MOD-QUECTEL-EC200U', 'Quectel 4G Module', 1.0, 'PCS', 'FID-W24F-04 (Slot 4)', 'op-smt-01', ?)
  `, [now, now, now, now]);

  // Seed sample Tier 1 Ingress TCP frames with raw BLOB and decoded text
  const p1 = '\x02MCSTATECHANGE\t55329\t20260903120000\tLINE01\tNXT01\t1\t3\t5\x03';
  const p2 = '\x02PRODCOMPLETEII\t55330\t20260903120018\tLINE01\tNXT01\t1\t1\t0\tPROG-SM-METER-TOP-REV4\t140\t4\t0\t0x00\t18.24\x03';
  const p3 = '\x02PDERROR\t55331\t20260903120020\tLINE01\tNXT01\t1\t1\t1\tFID-W08F-01\tC0402-100NF-16V\tNOZ-0402-A\tHEAD-01\tEMPTY_PICKUP\t0x04\x03';
  const p4 = '\x02CHANGECOMPII\t55332\t20260903120025\tLINE01\tNXT01\t1\t1\t1\t1\tC0402-100NF-16V\tFID-W08F-01\tREEL-OLD\tREEL-MUR-98125-SPLICE\t10000\x03';

  await db.execute(`
    INSERT INTO ingress_events (id, source_adapter, source_address, protocol, raw_payload, decoded_payload, received_at, processed_status)
    VALUES
      ('ing-01', 'FUJI_NEXIM', '192.168.10.42:30040', 'TCP_ASCII_STX_ETX', ?, ?, ?, 'PROCESSED'),
      ('ing-02', 'FUJI_NEXIM', '192.168.10.42:30040', 'TCP_ASCII_STX_ETX', ?, ?, ?, 'PROCESSED'),
      ('ing-03', 'FUJI_NEXIM', '192.168.10.42:30040', 'TCP_ASCII_STX_ETX', ?, ?, ?, 'PROCESSED'),
      ('ing-04', 'FUJI_NEXIM', '192.168.10.42:30040', 'TCP_ASCII_STX_ETX', ?, ?, ?, 'PROCESSED')
  `, [
    Buffer.from(p1, 'utf-8'), p1, now,
    Buffer.from(p2, 'utf-8'), p2, now,
    Buffer.from(p3, 'utf-8'), p3, now,
    Buffer.from(p4, 'utf-8'), p4, now
  ]);

  console.log('[SEED] Inserting Phase 3 Quality Rules & Multi-Up PCB CAD Coordinates...');
  await db.execute(`
    INSERT INTO quality_rules (
      id, product_id, program_id, consecutive_failure_limit,
      sliding_window_failures, sliding_window_panels, default_max_rework_cycles
    ) VALUES
      ('qr-sm-01', 'PRD-SM-4G-V2', 'PROG-SM-METER-TOP-REV4', 3, 5, 20, 2)
  `);

  // 6-up PCB Panel CAD definitions for PROG-SM-METER-TOP-REV4
  for (let u = 1; u <= 6; u++) {
    const xOffset = (u - 1) * 45.0;
    await db.execute(`
      INSERT INTO pcb_cad_definitions (
        id, product_id, product_revision, program_id, program_revision,
        board_side, cad_revision, ref_des, unit_position,
        x_mm, y_mm, rotation_deg, package_type, assigned_part_number, max_rework_cycles
      ) VALUES
        (?, 'PRD-SM-4G-V2', 1, 'PROG-SM-METER-TOP-REV4', 4, 'TOP', 'REV_1', 'C12', ?, ?, 18.200, 90.0, '0402', 'C0402-100NF-16V', 2),
        (?, 'PRD-SM-4G-V2', 1, 'PROG-SM-METER-TOP-REV4', 4, 'TOP', 'REV_1', 'C14', ?, ?, 18.200, 90.0, '0402', 'C0402-100NF-16V', 2),
        (?, 'PRD-SM-4G-V2', 1, 'PROG-SM-METER-TOP-REV4', 4, 'TOP', 'REV_1', 'R104', ?, ?, 25.400, 0.0, '0402', 'R0402-10K-1%', 2),
        (?, 'PRD-SM-4G-V2', 1, 'PROG-SM-METER-TOP-REV4', 4, 'TOP', 'REV_1', 'U3', ?, ?, 32.500, 0.0, 'QFN-16', 'IC-TPS62130-QFN16', 1),
        (?, 'PRD-SM-4G-V2', 1, 'PROG-SM-METER-TOP-REV4', 4, 'TOP', 'REV_1', 'MOD1', ?, ?, 50.000, 0.0, 'LGA-144', 'MOD-QUECTEL-EC200U', 1)
    `, [
      `cad-u${u}-c12`, u, xOffset + 12.5,
      `cad-u${u}-c14`, u, xOffset + 14.8,
      `cad-u${u}-r104`, u, xOffset + 22.1,
      `cad-u${u}-u3`, u, xOffset + 30.0,
      `cad-u${u}-mod1`, u, xOffset + 35.0
    ]);
  }

  console.log('[SEED] Inserting Multi-Up Panel & Baseline AOI Inspection Hold...');
  const demoPanel = 'PNL-260901-0042';
  for (let u = 1; u <= 6; u++) {
    const status = u === 3 ? 'QUALITY_HOLD' : 'PASSED';
    await db.execute(`
      INSERT INTO panel_units (id, panel_barcode, unit_position, unit_serial_number, status)
      VALUES (?, ?, ?, ?, ?)
    `, [`pnl-unit-0042-${u}`, demoPanel, u, `SN-MTR-0042-U${u}`, status]);
  }

  // Baseline 3D AOI Inspection record with Unit 3 Defect (C12 Tombstone)
  await db.execute(`
    INSERT INTO aoi_inspections (
      id, source_system, source_inspection_id, source_file_hash,
      panel_barcode, batch_id, work_center_id, optical_machine_id,
      inspection_phase, result, total_defects, duration_seconds, inspected_at
    ) VALUES (
      'aoi-insp-demo-01', 'KOH_YOUNG_3D_AOI', 'KY-20260907-0042', 'hash-ky-0042-seed',
      ?, 'job-01', 'wc-aoi-01', 'KY-ZENITH-01',
      'POST_REFLOW', 'FAILED', 1, 14.20, ?
    )
  `, [demoPanel, now]);

  await db.execute(`
    INSERT INTO aoi_defects (
      id, inspection_id, panel_barcode, unit_position, ref_des,
      defect_category, defect_type, defect_signature,
      offset_x_um, offset_y_um, rotation_deg, board_side, status, image_ref
    ) VALUES (
      'defect-demo-01', 'aoi-insp-demo-01', ?, 3, 'C12',
      'SOLDER', 'TOMBSTONE', 'PROG-SM-METER-TOP-REV4:wc-aoi-01:KY-ZENITH-01:C12:TOMBSTONE',
      45.20, 180.50, 28.50, 'TOP', 'OPEN', 'img/aoi/ky-zenith-01/pnl-0042-u3-c12.png'
    )
  `, [demoPanel]);

  console.log('[SEED] Inserting Phase 4 Recipe Process Windows & Screen Printer Capabilities...');
  await db.execute(`
    INSERT INTO recipe_process_windows (
      id, recipe_id, recipe_revision, stencil_id, stencil_revision,
      nominal_stencil_thickness_um, volume_lower_limit_pct, volume_upper_limit_pct,
      volume_warning_lower_pct, volume_warning_upper_pct, height_lower_limit_um,
      height_upper_limit_um, area_lower_limit_pct, max_offset_um,
      nominal_pressure_kgf, nominal_separation_speed_mm_s, min_pressure_kgf,
      max_pressure_kgf, max_abs_delta_pressure, max_pct_delta_pressure,
      min_separation_speed_mm_s, max_separation_speed_mm_s, max_abs_delta_separation_speed,
      min_time_between_changes_sec, max_changes_per_hour, cooldown_after_cleaning_sec
    ) VALUES (
      'rpw-sm-01', 'PROG-SM-METER-TOP-REV4', 4, 'STC-SM-4G-TOP', 'A',
      120.0, 75.0, 135.0, 85.0, 120.0, 90.0, 160.0, 80.0, 50.0,
      8.5, 1.2, 6.0, 12.0, 0.5, 5.0, 0.5, 3.0, 0.2, 180, 4, 60
    )
  `);

  await db.execute(`
    INSERT INTO printer_capabilities (
      equipment_id, manufacturer, model, cfx_version,
      supports_stencil_cleaning, supports_parameter_modification,
      supports_pressure_control, supports_separation_speed_control, supports_print_speed_control
    ) VALUES (
      'wc-spg-01', 'Fuji Machine MFG', 'Fuji GPX-C Screen Printer', '1.7',
      1, 1, 1, 1, 1
    )
  `);

  console.log('[SEED] Inserting Baseline 3D SPI Inspection & Aperture Measurements...');
  await db.execute(`
    INSERT INTO spi_inspections (
      id, source_system, source_inspection_id, source_file_hash,
      panel_barcode, batch_id, work_center_id, optical_machine_id,
      result, total_pads_inspected, defective_pads_count,
      mean_volume_pct, sigma_volume_pct, duration_seconds, inspected_at
    ) VALUES (
      'spi-insp-demo-01', 'KOH_YOUNG_ASPIRE3_CFX', 'KY-SPI-20260907-0042', 'hash-spi-0042-seed',
      ?, 'job-01', 'wc-spg-01', 'KY-ASPIRE3-01',
      'WARNING', 120, 1, 102.4, 8.2, 12.5, ?
    )
  `, [demoPanel, now]);

  // Seed sample aperture measurements on panel units
  const pads = [
    { padId: 'PAD-U3-P1', unit: 3, refDes: 'U3', pin: 1, vol: 138.5, ht: 168.0, area: 112.0, xOff: 4.2, yOff: 2.1, crit: 1, def: 'SMEARING' },
    { padId: 'PAD-C12-P1', unit: 3, refDes: 'C12', pin: 1, vol: 82.0, ht: 104.0, area: 90.0, xOff: -1.2, yOff: 0.5, crit: 0, def: null },
    { padId: 'PAD-C12-P2', unit: 3, refDes: 'C12', pin: 2, vol: 78.5, ht: 98.0, area: 88.0, xOff: 2.1, yOff: -0.8, crit: 0, def: null },
    { padId: 'PAD-U1-P1', unit: 1, refDes: 'C14', pin: 1, vol: 104.2, ht: 122.5, area: 101.0, xOff: 0.5, yOff: -0.2, crit: 0, def: null },
    { padId: 'PAD-MOD1-P1', unit: 1, refDes: 'MOD1', pin: 1, vol: 101.0, ht: 121.0, area: 99.5, xOff: 0.1, yOff: 0.1, crit: 1, def: null }
  ];

  for (const p of pads) {
    await db.execute(`
      INSERT INTO spi_pad_measurements (
        id, inspection_id, panel_barcode, pad_id, unit_position,
        ref_des, pin_no, volume_ratio_pct, height_um, area_ratio_pct,
        offset_x_um, offset_y_um, is_critical_pad, defect_type
      ) VALUES (?, 'spi-insp-demo-01', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      `meas-${p.padId}`, demoPanel, p.padId, p.unit, p.refDes, p.pin,
      p.vol, p.ht, p.area, p.xOff, p.yOff, p.crit, p.def
    ]);
  }

  // Baseline closed loop printer tuning event
  await db.execute(`
    INSERT INTO printer_tuning_events (
      id, correction_id, recipe_id, work_center_id, action_type,
      cleaning_mode, parameter_name, old_value, proposed_value, delta, unit,
      trigger_condition, status, commanded_at, acknowledged_at, verified_at, verified_by_panel_barcode
    ) VALUES (
      'tune-01', 'CORR-20260907-001', 'PROG-SM-METER-TOP-REV4', 'wc-spg-01', 'STENCIL_CLEAN',
      'VACUUM_SOLVENT', NULL, NULL, NULL, NULL, NULL,
      'Aperture smear detected on fine-pitch pad PAD-U3-P1 (Volume 138.5% > 135% limit)',
      'VERIFIED_RECOVERED', ?, ?, ?, ?
    )
  `, [now, now, now, demoPanel]);

  console.log('[SEED] Inserting Phase 5 AGV Fleet & Synthetic Telemetry Calibration Fixtures...');
  // 1. AGV Fleet Units
  await db.execute(`
    INSERT INTO agv_units (id, code, name, status, current_location, battery_percent, current_mission_id, last_heartbeat_at)
    VALUES
      ('agv-01', 'AGV-01', 'MiR 250 Autonomous SMT Reel Courier', 'IDLE', 'CHARGING_DOCK_1', 98.5, NULL, ?),
      ('agv-02', 'AGV-02', 'Omron LD-90 High-Payload SMT AMR', 'IDLE', 'CHARGING_DOCK_2', 91.0, NULL, ?)
  `, [now, now]);

  // 2. Synthetic Telemetry Fixtures (Decoupled from EventStore)
  // Calibration baseline: Normal 0201 nozzle pickup telemetry
  for (let i = 1; i <= 30; i++) {
    const ts = new Date(Date.now() - (30 - i) * 60000).toISOString();
    // Normal nozzle NZ-04: vacuum ~ 65 kPa (+/- 2)
    const normalVacuum = 65 + (Math.sin(i) * 1.5);
    await db.execute(`
      INSERT INTO telemetry_points (
        id, timestamp, factory_id, bay_id, line_id, work_center_id, equipment_id,
        asset_id, metric, value, unit, metadata_json
      ) VALUES (?, ?, 'site-noida-p4', 'area-smt-01', 'line-smt-01', 'wc-nxt-01', 'fuji-nxt-01', ?, ?, ?, ?, ?)
    `, [
      `telem-nz04-${i}`, ts, 'nozzle-head-1-nz-04', 'vacuum_pressure_kpa',
      normalVacuum, 'kPa', JSON.stringify({ packageType: '0201', feederId: 'fdr-nxt1-01', retryCount: 0 })
    ]);

    // Decaying nozzle NZ-08: vacuum drops from 64 kPa down to 42 kPa (severe leak)
    const decayingVacuum = Math.max(38, 64 - (i * 0.8));
    await db.execute(`
      INSERT INTO telemetry_points (
        id, timestamp, factory_id, bay_id, line_id, work_center_id, equipment_id,
        asset_id, metric, value, unit, metadata_json
      ) VALUES (?, ?, 'site-noida-p4', 'area-smt-01', 'line-smt-01', 'wc-nxt-01', 'fuji-nxt-01', ?, ?, ?, ?, ?)
    `, [
      `telem-nz08-${i}`, ts, 'nozzle-head-1-nz-08', 'vacuum_pressure_kpa',
      decayingVacuum, 'kPa', JSON.stringify({ packageType: '0201', feederId: 'fdr-nxt1-02', retryCount: i > 20 ? 2 : 0 })
    ]);

    // Aperture U3-P1 clogging trend across panels: volume decay from 118% down to 88%
    const apertureVol = 118 - (i * 1.0);
    await db.execute(`
      INSERT INTO telemetry_points (
        id, timestamp, factory_id, bay_id, line_id, work_center_id, equipment_id,
        asset_id, metric, value, unit, metadata_json
      ) VALUES (?, ?, 'site-noida-p4', 'area-smt-01', 'line-smt-01', 'wc-spi-01', 'ky-spi-01', ?, ?, ?, ?, ?)
    `, [
      `telem-apt-${i}`, ts, 'aperture-U3-P1', 'paste_volume_pct',
      apertureVol, 'percent', JSON.stringify({ recipeId: 'PROG-SM-METER-TOP-REV4', refDes: 'U3', pin: 1, panelIndex: i })
    ]);
  }

  console.log('[SEED] Inserting Phase 6 Closed-Loop Reflow Profiling & Thermal Drift Fixtures...');
  // 1. Reflow Thermal Specification
  const specJson = JSON.stringify({
    rampRate: { minCPerSec: 1.0, maxCPerSec: 3.0, targetCPerSec: 2.0, evaluationStartTempC: 30, evaluationEndTempC: 150 },
    soak: { minTempC: 150, maxTempC: 200, minSeconds: 60, maxSeconds: 120, targetSeconds: 90 },
    tal: { liquidusTempC: 217, minSeconds: 45, maxSeconds: 90, targetSeconds: 67.5 },
    peak: { minC: 235, maxC: 248, targetC: 241.5 },
    cooling: { minCPerSec: 1.0, maxCPerSec: 4.0, evaluationStartTempC: 241.5, evaluationEndTempC: 217 },
    conveyorSpeedLimit: { minCmPerMin: 85, maxCmPerMin: 95, targetCmPerMin: 90, toleranceCmPerMin: 1.5 },
    oxygenControl: { targetPpm: 500, tolerancePpm: 100, maxPpm: 800 },
    zoneTolerancesC: 2.5,
    variabilityLimitC: 1.2,
    minimumSigmaC: 0.5,
    createdBy: 'OP-RAJESH',
    createdAt: now
  });

  await db.execute(`
    INSERT INTO reflow_thermal_specifications (
      id, recipe_id, board_part_number, board_revision, specification_version,
      status, alloy, specification_json, created_by, created_at
    ) VALUES (
      'spec-prog-sm-meter-top-rev4', 'PROG-SM-METER-TOP-REV4', 'PRD-SM-4G-V2', 'REV4', 1,
      'ACTIVE', 'SAC305', ?, 'OP-RAJESH', ?
    )
  `, [specJson, now]);

  // 2. Active Baseline Physical Profile Run
  const profileMetadataJson = JSON.stringify({
    originalFileName: 'KIC_RUN184_METER_SAC305.KIC2000Profile',
    fileSizeBytes: 24576,
    fileSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    vendorFormat: 'KIC',
    profilerHardware: {
      manufacturer: 'KIC',
      model: 'KIC 2000 SlimKIC',
      serialNumber: 'SK-2000-8842',
      totalProbesUsed: 6,
      sampleIntervalSeconds: 0.5,
      sampleCount: 500
    },
    ovenSettingsSnapshot: {
      recipeName: 'HELLER-SAC305-PROFILE-A',
      conveyorSpeedCmPerMin: 90.0,
      zoneSetpointsC: [160, 165, 170, 175, 185, 195, 220, 245, 255, 210]
    },
    analysisResult: {
      calculationVersion: 'PWI-MIDPOINT-v1.0.0',
      overallPwi: 20.0,
      worstProbeIndex: 2,
      worstCharacteristic: 'PEAK',
      complianceResult: 'PASS',
      evaluatedAt: now
    }
  });

  await db.execute(`
    INSERT INTO reflow_profile_runs (
      id, line_id, equipment_id, recipe_id, board_part_number, board_revision,
      file_sha256, specification_id, specification_version, calculation_version,
      overall_pwi, compliance_result, status, metadata_json,
      imported_by, imported_at, approved_by, approved_at, activated_at
    ) VALUES (
      'run-prf-20260908-01', 'line-smt-01', 'wc-rfl-01', 'PROG-SM-METER-TOP-REV4', 'PRD-SM-4G-V2', 'REV4',
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', 'spec-prog-sm-meter-top-rev4', 1, 'PWI-MIDPOINT-v1.0.0',
      20.0, 'PASS', 'ACTIVE', ?,
      'OP-RAJESH', ?, 'QA-NEHA', ?, ?
    )
  `, [profileMetadataJson, now, now, now]);

  // 3. Probes with Realistic Thermocouple Curves
  const probeDefinitions = [
    { index: 1, label: 'TC1 - QFN-32 Lead (Hotspot)', role: 'HOTSPOT', refDes: 'U2', pkg: 'QFN-32', peak: 243.0, tal: 68.0, soak: 88.0, ramp: 1.9, cool: 2.7, pwi: 13.3 },
    { index: 2, label: 'TC2 - Power Inductor Body (Coldspot)', role: 'COLDSPOT', refDes: 'L1', pkg: 'IND-1210', peak: 237.5, tal: 56.0, soak: 82.0, ramp: 1.7, cool: 2.2, pwi: 20.0 },
    { index: 3, label: 'TC3 - BGA-144 Ball Center (Component Limit)', role: 'COMPONENT_LIMIT', refDes: 'U1', pkg: 'BGA-144', peak: 239.0, tal: 62.0, soak: 86.0, ramp: 1.8, cool: 2.5, pwi: 15.6 },
    { index: 4, label: 'TC4 - C12 Ground Solder Joint', role: 'SOLDER_JOINT', refDes: 'C12', pkg: '0603', peak: 241.5, tal: 64.0, soak: 85.0, ramp: 1.8, cool: 2.6, pwi: 6.7 },
    { index: 5, label: 'TC5 - R22 Power Resistor', role: 'SOLDER_JOINT', refDes: 'R22', pkg: '0805', peak: 241.0, tal: 65.0, soak: 87.0, ramp: 1.85, cool: 2.55, pwi: 8.9 },
    { index: 6, label: 'TC6 - Top Board Surface Center', role: 'BOARD_SURFACE', refDes: 'PCB', pkg: 'FR4', peak: 242.0, tal: 66.0, soak: 86.0, ramp: 1.82, cool: 2.65, pwi: 7.8 }
  ];

  for (const p of probeDefinitions) {
    // Generate synthetic T(t) curve with 60 time points spanning 0s to 300s
    const samples: Array<{ timeSeconds: number; temperatureC: number }> = [];
    for (let t = 0; t <= 300; t += 5) {
      let temp = 25;
      if (t < 65) {
        // Ramp stage: 25C to 150C
        temp = 25 + (t / 65) * 125 * (p.ramp / 1.9);
      } else if (t < 150) {
        // Soak stage: 150C to 200C
        temp = 150 + ((t - 65) / 85) * 50;
      } else if (t < 210) {
        // Reflow spike: 200C to peak
        const frac = (t - 150) / 60;
        temp = 200 + Math.sin(frac * Math.PI * 0.9) * (p.peak - 200);
      } else {
        // Cooling: peak down to 40C
        temp = Math.max(40, p.peak - ((t - 210) * p.cool * 0.9));
      }
      samples.push({ timeSeconds: t, temperatureC: Number(temp.toFixed(2)) });
    }

    const metricsJson = JSON.stringify({
      maxRampRateCPerSec: p.ramp,
      soakDurationSeconds: p.soak,
      timeAboveLiquidusSeconds: p.tal,
      peakTemperatureC: p.peak,
      maxCoolingRateCPerSec: p.cool
    });

    const pwiJson = JSON.stringify({
      overall: p.pwi,
      ramp: Number((Math.abs(p.ramp - 2.0) / 1.0 * 100).toFixed(1)),
      soak: Number((Math.abs(p.soak - 90.0) / 30.0 * 100).toFixed(1)),
      tal: Number((Math.abs(p.tal - 67.5) / 22.5 * 100).toFixed(1)),
      peak: Number((Math.abs(p.peak - 241.5) / 6.5 * 100).toFixed(1)),
      cooling: Number((Math.abs(p.cool - 2.5) / 1.5 * 100).toFixed(1))
    });

    await db.execute(`
      INSERT INTO reflow_profile_probes (
        id, profile_run_id, probe_index, label, thermal_role,
        metrics_json, pwi_json, samples_json
      ) VALUES (?, 'run-prf-20260908-01', ?, ?, ?, ?, ?, ?)
    `, [
      `probe-run184-${p.index}`, p.index, p.label, p.role,
      metricsJson, pwiJson, JSON.stringify(samples)
    ]);
  }

  // 4. Initial Active Process Compliance State
  const initialDriftJson = JSON.stringify({
    isCompliant: true,
    compositeSeverityScore: 0.04,
    consecutiveDriftSeconds: 0,
    zones: [
      { zoneIndex: 1, zoneName: 'Zone 1 Top', windowMeanC: 160.1, windowStdDevC: 0.35, baselineMeanC: 160.0, baselineStdDevC: 0.40, meanDeviationC: 0.1, meanZScore: 0.2, variabilityZScore: -0.1, isDrifting: false },
      { zoneIndex: 2, zoneName: 'Zone 2 Top', windowMeanC: 165.2, windowStdDevC: 0.38, baselineMeanC: 165.0, baselineStdDevC: 0.40, meanDeviationC: 0.2, meanZScore: 0.4, variabilityZScore: -0.05, isDrifting: false },
      { zoneIndex: 3, zoneName: 'Zone 3 Top', windowMeanC: 169.9, windowStdDevC: 0.42, baselineMeanC: 170.0, baselineStdDevC: 0.45, meanDeviationC: -0.1, meanZScore: -0.2, variabilityZScore: -0.06, isDrifting: false },
      { zoneIndex: 4, zoneName: 'Zone 4 Top', windowMeanC: 175.1, windowStdDevC: 0.39, baselineMeanC: 175.0, baselineStdDevC: 0.42, meanDeviationC: 0.1, meanZScore: 0.2, variabilityZScore: -0.07, isDrifting: false },
      { zoneIndex: 5, zoneName: 'Zone 5 Top', windowMeanC: 185.0, windowStdDevC: 0.41, baselineMeanC: 185.0, baselineStdDevC: 0.40, meanDeviationC: 0.0, meanZScore: 0.0, variabilityZScore: 0.02, isDrifting: false },
      { zoneIndex: 6, zoneName: 'Zone 6 Top', windowMeanC: 194.8, windowStdDevC: 0.44, baselineMeanC: 195.0, baselineStdDevC: 0.45, meanDeviationC: -0.2, meanZScore: -0.4, variabilityZScore: -0.02, isDrifting: false },
      { zoneIndex: 7, zoneName: 'Zone 7 Top', windowMeanC: 220.2, windowStdDevC: 0.46, baselineMeanC: 220.0, baselineStdDevC: 0.48, meanDeviationC: 0.2, meanZScore: 0.4, variabilityZScore: -0.04, isDrifting: false },
      { zoneIndex: 8, zoneName: 'Zone 8 Top', windowMeanC: 245.1, windowStdDevC: 0.48, baselineMeanC: 245.0, baselineStdDevC: 0.50, meanDeviationC: 0.1, meanZScore: 0.2, variabilityZScore: -0.04, isDrifting: false },
      { zoneIndex: 9, zoneName: 'Zone 9 Top', windowMeanC: 254.9, windowStdDevC: 0.50, baselineMeanC: 255.0, baselineStdDevC: 0.52, meanDeviationC: -0.1, meanZScore: -0.19, variabilityZScore: -0.04, isDrifting: false },
      { zoneIndex: 10, zoneName: 'Zone 10 Top', windowMeanC: 210.0, windowStdDevC: 0.45, baselineMeanC: 210.0, baselineStdDevC: 0.46, meanDeviationC: 0.0, meanZScore: 0.0, variabilityZScore: -0.02, isDrifting: false }
    ],
    conveyorSpeed: { windowMeanCmPerMin: 90.05, baselineCmPerMin: 90.0, deviationCmPerMin: 0.05, isDrifting: false },
    oxygen: { windowMeanPpm: 485, baselinePpm: 500, deviationPpm: -15, isDrifting: false }
  });

  await db.execute(`
    INSERT INTO reflow_process_states (
      line_id, equipment_id, recipe_id, board_part_number, board_revision,
      active_profile_run_id, compliance_status, consecutive_drift_seconds,
      consecutive_healthy_seconds, last_evaluated_at, drift_metrics_json
    ) VALUES (
      'line-smt-01', 'wc-rfl-01', 'PROG-SM-METER-TOP-REV4', 'PRD-SM-4G-V2', 'REV4',
      'run-prf-20260908-01', 'COMPLIANT', 0.0, 120.0, ?, ?
    )
  `, [now, initialDriftJson]);

  // 5. Contemporaneous Telemetry Window for Oven wc-rfl-01
  const ovenZoneSetpoints = [160, 165, 170, 175, 185, 195, 220, 245, 255, 210];
  for (let s = 1; s <= 20; s++) {
    const telemTime = new Date(Date.now() - (20 - s) * 2000).toISOString();
    for (let z = 1; z <= 10; z++) {
      const nominal = ovenZoneSetpoints[z - 1];
      const val = nominal + (Math.sin(s + z) * 0.3);
      await db.execute(`
        INSERT INTO telemetry_points (
          id, timestamp, factory_id, bay_id, line_id, work_center_id, equipment_id,
          asset_id, metric, value, unit, metadata_json
        ) VALUES (?, ?, 'site-noida-p4', 'area-smt-01', 'line-smt-01', 'wc-rfl-01', 'wc-rfl-01', ?, ?, ?, 'C', ?)
      `, [
        `telem-rfl-z${z}-${s}`, telemTime, `zone-${z}`, 'temperature_c',
        Number(val.toFixed(2)), JSON.stringify({ zoneIndex: z, setpointC: nominal })
      ]);
    }
    // Conveyor speed
    await db.execute(`
      INSERT INTO telemetry_points (
        id, timestamp, factory_id, bay_id, line_id, work_center_id, equipment_id,
        asset_id, metric, value, unit, metadata_json
      ) VALUES (?, ?, 'site-noida-p4', 'area-smt-01', 'line-smt-01', 'wc-rfl-01', 'wc-rfl-01', 'conveyor-1', 'speed_cm_per_min', ?, 'cm/min', ?)
    `, [
      `telem-rfl-spd-${s}`, telemTime, Number((90.0 + (Math.cos(s) * 0.1)).toFixed(2)),
      JSON.stringify({ targetSpeedCmPerMin: 90.0 })
    ]);
  }

  console.log('[SEED] Dixon SMT Multi-Line Facility (Line 01 & Line 02) successfully seeded with Phase 5 & Phase 6 fixtures.');
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[SEED ERROR]', err);
      process.exit(1);
    });
}
