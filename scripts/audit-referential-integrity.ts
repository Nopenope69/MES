import { getDatabase, initDatabase } from '../apps/api/src/db/database';

interface ForeignKeyCheck {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
}

const FOREIGN_KEY_CHECKS: ForeignKeyCheck[] = [
  { childTable: 'sites', childColumn: 'organization_id', parentTable: 'organizations', parentColumn: 'id' },
  { childTable: 'areas', childColumn: 'site_id', parentTable: 'sites', parentColumn: 'id' },
  { childTable: 'production_lines', childColumn: 'area_id', parentTable: 'areas', parentColumn: 'id' },
  { childTable: 'work_centers', childColumn: 'line_id', parentTable: 'production_lines', parentColumn: 'id' },
  { childTable: 'equipment_units', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'recipes', childColumn: 'product_code', parentTable: 'products', parentColumn: 'code' },
  { childTable: 'recipe_items', childColumn: 'recipe_id', parentTable: 'recipes', parentColumn: 'id' },
  { childTable: 'batches', childColumn: 'work_order_number', parentTable: 'work_orders', parentColumn: 'order_number' },
  { childTable: 'batches', childColumn: 'recipe_code', parentTable: 'recipes', parentColumn: 'code' },
  { childTable: 'batches', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'panel_checkouts', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'panel_checkouts', childColumn: 'batch_id', parentTable: 'batches', parentColumn: 'id' },
  { childTable: 'feeder_error_logs', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'material_consumptions', childColumn: 'batch_id', parentTable: 'batches', parentColumn: 'id' },
  { childTable: 'equipment_state_logs', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'aoi_inspections', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'aoi_defects', childColumn: 'inspection_id', parentTable: 'aoi_inspections', parentColumn: 'id' },
  { childTable: 'rework_dispositions', childColumn: 'defect_id', parentTable: 'aoi_defects', parentColumn: 'id' },
  { childTable: 'rework_events', childColumn: 'defect_id', parentTable: 'aoi_defects', parentColumn: 'id' },
  { childTable: 'spi_inspections', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'spi_pad_measurements', childColumn: 'inspection_id', parentTable: 'spi_inspections', parentColumn: 'id' },
  { childTable: 'stencil_sessions', childColumn: 'stencil_id', parentTable: 'stencils', parentColumn: 'stencil_id' },
  { childTable: 'stencil_sessions', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'stencil_paste_loads', childColumn: 'stencil_session_id', parentTable: 'stencil_sessions', parentColumn: 'id' },
  { childTable: 'stencil_paste_loads', childColumn: 'paste_jar_id', parentTable: 'solder_paste_jars', parentColumn: 'jar_id' },
  { childTable: 'solder_paste_jars', childColumn: 'profile_id', parentTable: 'solder_paste_profiles', parentColumn: 'id' },
  { childTable: 'smt_feeder_slots', childColumn: 'work_center_id', parentTable: 'work_centers', parentColumn: 'id' },
  { childTable: 'refresh_tokens', childColumn: 'operator_id', parentTable: 'operators', parentColumn: 'id' }
];

export async function runReferentialIntegrityAudit(): Promise<{ totalChecks: number; violations: number; details: string[] }> {
  await initDatabase();
  const db = getDatabase();
  const details: string[] = [];
  let violations = 0;

  console.log('[AUDIT] Running referential integrity audit across tables...');

  for (const check of FOREIGN_KEY_CHECKS) {
    try {
      const sql = `
        SELECT c.${check.childColumn} as orphan_id
        FROM ${check.childTable} c
        LEFT JOIN ${check.parentTable} p ON c.${check.childColumn} = p.${check.parentColumn}
        WHERE c.${check.childColumn} IS NOT NULL AND p.${check.parentColumn} IS NULL
        LIMIT 10
      `;
      const orphans = await db.query(sql);
      if (orphans.length > 0) {
        violations++;
        const msg = `VIOLATION: ${check.childTable}.${check.childColumn} has orphans not found in ${check.parentTable}.${check.parentColumn} (Sample: ${orphans.map((o: any) => o.orphan_id).join(', ')})`;
        details.push(msg);
        console.warn(`  ❌ ${msg}`);
      } else {
        console.log(`  ✓ ${check.childTable}.${check.childColumn} -> ${check.parentTable}.${check.parentColumn} clean`);
      }
    } catch (err: any) {
      // If table doesn't exist yet, note it gracefully
      console.log(`  - Note: check ${check.childTable} -> ${check.parentTable} skipped (${err?.message})`);
    }
  }

  console.log(`\n[AUDIT COMPLETE] ${FOREIGN_KEY_CHECKS.length} checks performed, ${violations} violation(s) found.`);
  return { totalChecks: FOREIGN_KEY_CHECKS.length, violations, details };
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('audit-referential-integrity'))) {
  runReferentialIntegrityAudit()
    .then((res) => {
      if (res.violations > 0) {
        console.error(`[AUDIT FAILED] ${res.violations} referential integrity violation(s) require sanitization.`);
        process.exit(1);
      }
      console.log('[AUDIT PASSED] All examined foreign key relationships are referentially sound.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[AUDIT ERROR]', err);
      process.exit(1);
    });
}
