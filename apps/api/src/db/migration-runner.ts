import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';
import { IDatabase, getDatabase } from './database';
import { PostgresPoolManager } from './postgres-pool';

export interface MigrationFileRecord {
  version: string;
  name: string;
  filePath: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  applied_at: string;
  checksum: string;
}

export interface MigrationRunSummary {
  appliedCount: number;
  skippedCount: number;
  appliedMigrations: string[];
  totalAvailable: number;
}

export interface DataSyncSummary {
  tablesMigrated: number;
  totalRecordsCopied: number;
  tableDetails: Record<string, number>;
  durationMs: number;
}

/**
 * MigrationRunner (Track D: Enterprise Database & PostgreSQL Scaling)
 *
 * Provides transactional DDL migration tracking and seamless SQLite-to-PostgreSQL
 * data synchronization for high-scale factory environments.
 */
export class MigrationRunner {
  private migrationsDir: string;

  constructor(migrationsDir?: string) {
    this.migrationsDir = migrationsDir || path.resolve(__dirname, 'migrations');
  }

  /**
   * Discovers all SQL migration files in the migrations directory in sorted order.
   */
  public getMigrationFiles(): MigrationFileRecord[] {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    return files.map(file => {
      const fullPath = path.join(this.migrationsDir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const checksum = crypto.createHash('sha256').update(content).digest('hex');
      const version = file.split('_')[0] || file;
      const name = file.replace(/\.sql$/, '');

      return {
        version,
        name,
        filePath: fullPath,
        checksum
      };
    });
  }

  /**
   * Initializes schema_migrations tracking table if not present.
   */
  public async ensureTrackingTable(db: IDatabase): Promise<void> {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(32) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        applied_at TIMESTAMP NOT NULL,
        checksum VARCHAR(64) NOT NULL
      );
    `);
  }

  /**
   * Runs all pending migrations against the target database connection.
   */
  public async runPendingMigrations(db?: IDatabase): Promise<MigrationRunSummary> {
    const targetDb = db || getDatabase();
    await this.ensureTrackingTable(targetDb);

    const appliedRows = await targetDb.query<AppliedMigration>(
      'SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC'
    );
    const appliedMap = new Map(appliedRows.map(r => [r.version, r]));

    const migrationFiles = this.getMigrationFiles();
    const appliedNow: string[] = [];
    let skippedCount = 0;

    for (const mig of migrationFiles) {
      if (appliedMap.has(mig.version)) {
        skippedCount++;
        continue;
      }

      const sqlContent = fs.readFileSync(mig.filePath, 'utf-8');
      const now = new Date().toISOString();

      await targetDb.withTransaction(async (tx) => {
        await tx.execScript(sqlContent);
        await tx.execute(
          'INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
          [mig.version, mig.name, now, mig.checksum]
        );
      });

      appliedNow.push(mig.name);
    }

    return {
      appliedCount: appliedNow.length,
      skippedCount,
      appliedMigrations: appliedNow,
      totalAvailable: migrationFiles.length
    };
  }

  public static readonly SYNC_TABLES: string[] = [
    'sites',
    'areas',
    'work_centers',
    'dry_cabinets',
    'msl_bake_profiles',
    'component_reels',
    'msl_exposure_logs',
    'solder_paste_profiles',
    'solder_paste_jars',
    'stencils',
    'stencil_sessions',
    'stencil_paste_loads',
    'smt_feeder_slots',
    'work_orders',
    'batches',
    'panel_checkouts',
    'material_consumptions',
    'equipment_state_logs',
    'downtime_attributions',
    'ingress_events',
    'production_events',
    'projection_checkpoints',
    'projection_snapshots',
    'compliance_audit_ledger',
    'device_history_records',
    // Phase 3: Closed-Loop 3D AOI & Rework
    'quality_rules',
    'pcb_cad_definitions',
    'panel_units',
    'aoi_inspections',
    'aoi_defects',
    'rework_dispositions',
    'rework_events',
    // Phase 4: Closed-Loop 3D SPI & Screen Printer CFX Auto-Tuning
    'recipe_process_windows',
    'printer_capabilities',
    'spi_inspections',
    'spi_pad_measurements',
    'printer_tuning_events',
    'dr_drill_history'
  ];

  public getSyncTables(): string[] {
    return [...MigrationRunner.SYNC_TABLES];
  }

  /**
   * Migrates existing factory data from SQLite into PostgreSQL with foreign-key preservation.
   */
  public async syncSqliteToPostgres(sqliteDb: IDatabase, pgPool?: Pool): Promise<DataSyncSummary> {
    const pool = pgPool || PostgresPoolManager.getInstance().getPool();
    const startTime = Date.now();

    // Ordered list of tables to respect foreign key constraints
    const tablesToSync = this.getSyncTables();

    const tableDetails: Record<string, number> = {};
    let totalCopied = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const table of tablesToSync) {
        let rows: any[] = [];
        try {
          rows = await sqliteDb.query(`SELECT * FROM ${table}`);
        } catch {
          // Table may not exist yet in SQLite
          continue;
        }

        if (rows.length === 0) {
          tableDetails[table] = 0;
          continue;
        }

        const cols = Object.keys(rows[0]);
        const colList = cols.join(', ');

        for (const row of rows) {
          let paramIdx = 1;
          const placeholders = cols.map(() => `$${paramIdx++}`).join(', ');
          const values = cols.map(c => {
            const v = row[c];
            // Format object or JSON string appropriately
            if (typeof v === 'object' && v !== null && !(v instanceof Buffer)) {
              return JSON.stringify(v);
            }
            return v;
          });

          await client.query(
            `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            values
          );
        }

        tableDetails[table] = rows.length;
        totalCopied += rows.length;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return {
      tablesMigrated: Object.keys(tableDetails).length,
      totalRecordsCopied: totalCopied,
      tableDetails,
      durationMs: Date.now() - startTime
    };
  }
}
