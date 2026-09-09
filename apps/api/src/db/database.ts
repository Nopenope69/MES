import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

export interface IDatabase {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid?: number }>;
  execScript(sqlScript: string): Promise<void>;
  close(): Promise<void>;
  withTransaction<T>(fn: (tx: IDatabase) => Promise<T>): Promise<T>;
}

class NodeSqliteDatabase implements IDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...params);
    return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
  }

  async execScript(sqlScript: string): Promise<void> {
    this.db.exec(sqlScript);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private transactionDepth = 0;

  async withTransaction<T>(fn: (tx: IDatabase) => Promise<T>): Promise<T> {
    const isTopLevel = this.transactionDepth === 0;
    if (isTopLevel) {
      this.db.exec('BEGIN IMMEDIATE;');
    }
    this.transactionDepth++;
    try {
      const result = await fn(this);
      this.transactionDepth--;
      if (isTopLevel) {
        this.db.exec('COMMIT;');
      }
      return result;
    } catch (error) {
      this.transactionDepth--;
      if (isTopLevel) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Ignored if already rolled back
        }
      }
      throw error;
    }
  }
}

class PostgresDatabase implements IDatabase {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    const res = await this.pool.query(pgSql, params);
    return res.rows as T[];
  }

  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number }> {
    let index = 1;
    const pgSql = sql.replace(/\?/g, () => `$${index++}`);
    const res = await this.pool.query(pgSql, params);
    return { changes: res.rowCount ?? 0 };
  }

  async execScript(sqlScript: string): Promise<void> {
    await this.pool.query(sqlScript);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async withTransaction<T>(fn: (tx: IDatabase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txDb: IDatabase = {
        query: async (sql, params = []) => {
          let index = 1;
          const pgSql = sql.replace(/\?/g, () => `$${index++}`);
          const res = await client.query(pgSql, params);
          return res.rows;
        },
        execute: async (sql, params = []) => {
          let index = 1;
          const pgSql = sql.replace(/\?/g, () => `$${index++}`);
          const res = await client.query(pgSql, params);
          return { changes: res.rowCount ?? 0 };
        },
        execScript: async (sqlScript) => {
          await client.query(sqlScript);
        },
        close: async () => {},
        withTransaction: (nestedFn) => nestedFn(txDb)
      };
      const result = await fn(txDb);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

let dbInstance: IDatabase | null = null;

import { EMBEDDED_SCHEMA_SQL } from './schema-sql';

export function getDatabase(): IDatabase {
  if (dbInstance) return dbInstance;

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
    console.log('[DB] Connecting to PostgreSQL database...');
    dbInstance = new PostgresDatabase(dbUrl);
  } else {
    const defaultDbPath = path.resolve(process.cwd(), 'mes_local.db');
    const localDbPath = process.env.SQLITE_DB_PATH || defaultDbPath;
    console.log(`[DB] Using built-in Node SQLite database at: ${localDbPath}`);
    dbInstance = new NodeSqliteDatabase(localDbPath);
  }

  return dbInstance;
}

export async function initDatabase(): Promise<void> {
  const db = getDatabase();
  let schemaSql = EMBEDDED_SCHEMA_SQL;
  try {
    const directPath = path.resolve(__dirname, 'schema.sql');
    const relPath = path.resolve(__dirname, '../../src/db/schema.sql');
    const cwdPath = path.resolve(process.cwd(), 'schema.sql');
    if (fs.existsSync(directPath)) {
      schemaSql = fs.readFileSync(directPath, 'utf-8');
    } else if (fs.existsSync(relPath)) {
      schemaSql = fs.readFileSync(relPath, 'utf-8');
    } else if (fs.existsSync(cwdPath)) {
      schemaSql = fs.readFileSync(cwdPath, 'utf-8');
    }
  } catch {
    // Graceful fallback to EMBEDDED_SCHEMA_SQL
  }
  await db.execScript(schemaSql);
  try {
    await db.execute('ALTER TABLE ingress_events ADD COLUMN decoded_payload TEXT;');
  } catch {}

  const reelCols = [
    "ALTER TABLE component_reels ADD COLUMN msl_class VARCHAR(8) DEFAULT 'MSL_1';",
    "ALTER TABLE component_reels ADD COLUMN mbb_opened_at TIMESTAMP;",
    "ALTER TABLE component_reels ADD COLUMN mbb_resealed_at TIMESTAMP;",
    "ALTER TABLE component_reels ADD COLUMN storage_location VARCHAR(64) DEFAULT 'FACTORY_FLOOR';",
    "ALTER TABLE component_reels ADD COLUMN storage_state VARCHAR(32) DEFAULT 'AMBIENT_EXPOSURE';",
    "ALTER TABLE component_reels ADD COLUMN floor_clock_state VARCHAR(32) DEFAULT 'FLOOR_EXPOSURE';",
    "ALTER TABLE component_reels ADD COLUMN floor_life_nominal_minutes INTEGER DEFAULT 999999;",
    "ALTER TABLE component_reels ADD COLUMN floor_life_expires_at TIMESTAMP;",
    "ALTER TABLE component_reels ADD COLUMN hic_status VARCHAR(32) DEFAULT 'OK';",
    "ALTER TABLE component_reels ADD COLUMN hic_verified_at TIMESTAMP;",
    "ALTER TABLE component_reels ADD COLUMN hic_verified_by VARCHAR(64);",
    "ALTER TABLE component_reels ADD COLUMN bake_status VARCHAR(32) DEFAULT 'NOT_REQUIRED';",
    "ALTER TABLE component_reels ADD COLUMN bake_started_at TIMESTAMP;",
    "ALTER TABLE component_reels ADD COLUMN last_bake_profile_id VARCHAR(64);",
    "ALTER TABLE component_reels ADD COLUMN last_bake_completed_at TIMESTAMP;"
  ];
  for (const sql of reelCols) {
    try { await db.execute(sql); } catch {}
  }

  // Track A: Event Sourcing & Projection Schema Migrations
  try {
    await db.execute("ALTER TABLE production_events ADD COLUMN schema_version VARCHAR(16) DEFAULT '1.0.0';");
  } catch {}

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS projection_checkpoints (
        projection_name VARCHAR(64) PRIMARY KEY,
        last_event_id VARCHAR(64),
        last_event_time TIMESTAMP,
        events_processed BIGINT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS projection_snapshots (
        id VARCHAR(64) PRIMARY KEY,
        aggregate_type VARCHAR(64) NOT NULL,
        aggregate_id VARCHAR(64) NOT NULL,
        snapshot_version BIGINT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch {}

  // Track B: Compliance & Industrial Audit Readiness Migrations
  try {
    await db.execute(`
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
    `);
    await db.execute(`
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
    `);
  } catch {}

  // Tenant & Site Scoping Migrations (Section 1)
  try {
    await db.execute("ALTER TABLE batches ADD COLUMN organization_id VARCHAR(64) DEFAULT 'org-dixon';");
  } catch {}
  try {
    await db.execute("ALTER TABLE batches ADD COLUMN site_id VARCHAR(64) DEFAULT 'site-noida-p4';");
  } catch {}

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS organization_settings (
        organization_id VARCHAR(64) NOT NULL,
        setting_key VARCHAR(64) NOT NULL,
        setting_value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (organization_id, setting_key)
      );
    `);
  } catch {}

  // Operator Credentials & Lockout Migrations (Section 2)
  try { await db.execute("ALTER TABLE operators ADD COLUMN pin_hash VARCHAR(255);"); } catch {}
  try { await db.execute("ALTER TABLE operators ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;"); } catch {}
  try { await db.execute("ALTER TABLE operators ADD COLUMN locked_until TIMESTAMP;"); } catch {}
  try { await db.execute("ALTER TABLE operators ADD COLUMN status VARCHAR(24) DEFAULT 'ACTIVE';"); } catch {}
  try { await db.execute("ALTER TABLE operators ADD COLUMN last_login_at TIMESTAMP;"); } catch {}
  try { await db.execute("ALTER TABLE operators ADD COLUMN authz_version INTEGER DEFAULT 1;"); } catch {}
  try { await db.execute("ALTER TABLE operators ADD COLUMN organization_id VARCHAR(64) DEFAULT 'org-dixon';"); } catch {}
  try { await db.execute("ALTER TABLE operators ADD COLUMN site_id VARCHAR(64) DEFAULT 'site-noida-p4';"); } catch {}

  // Dual-Token Refresh Sessions (Section 2 / Task 3)
  try {
    await db.execute(`
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
    `);
    await db.execute("CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);");
  } catch {}

  console.log('[DB] Schema verified and initialized.');
}

export class DatabaseManager {
  public static getInstance(): IDatabase {
    return getDatabase();
  }
}

