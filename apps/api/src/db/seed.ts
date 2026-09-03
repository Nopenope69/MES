import { getDatabase, initDatabase } from './database';

export async function seedDatabase(): Promise<void> {
  await initDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();

  console.log('[SEED] Clearing existing records for clean SMT factory state...');
  await db.execScript(`
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

  // 4. Production Line
  await db.execute(`
    INSERT INTO production_lines (id, area_id, code, name)
    VALUES
      ('line-smt-01', 'area-smt-01', 'LINE-SMT-01', 'SMT Line 01 (Fuji NXT III High-Speed Line)')
  `);

  // 5. SMT Work Centers
  await db.execute(`
    INSERT INTO work_centers (id, line_id, code, name, area, type, asset_path, current_state, current_program_name, module_count, last_state_change_time)
    VALUES 
      ('wc-spg-01', 'line-smt-01', 'WC-SPG-01', 'Fuji GPX-C Solder Paste Screen Printer', 'SMT Cleanroom Bay A', 'SCREEN_PRINTER', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-01.WC-SPG-01', 'RUNNING', 'PROG-SM-METER-TOP-REV4', 1, ?),
      ('wc-nxt-01', 'line-smt-01', 'WC-NXT-01', 'Fuji NXT III M6 Pick-and-Place (4 Modules)', 'SMT Cleanroom Bay A', 'PICK_AND_PLACE', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-01.WC-NXT-01', 'RUNNING', 'PROG-SM-METER-TOP-REV4', 4, ?),
      ('wc-rfl-01', 'line-smt-01', 'WC-RFL-01', 'Heller 1913 MK5 10-Zone Reflow Oven', 'SMT Cleanroom Bay A', 'REFLOW_OVEN', 'ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-01.WC-RFL-01', 'RUNNING', 'PROG-SM-METER-TOP-REV4', 1, ?),
      ('wc-aoi-01', 'line-smt-01', 'WC-AOI-01', 'Koh Young 3D AOI Optical Inspector', 'Post-Reflow Optical Inspection Suite', 'AOI_INSPECTION', 'ORG-DIXON.SITE-NOIDA-P4.AREA-AOI-01.LINE-SMT-01.WC-AOI-01', 'RUNNING', 'PROG-SM-METER-TOP-REV4', 1, ?)
  `, [now, now, now, now]);

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

  console.log('[SEED] Dixon SMT Line 01 successfully populated with authentic high-speed SMT data.');
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[SEED ERROR]', err);
      process.exit(1);
    });
}
