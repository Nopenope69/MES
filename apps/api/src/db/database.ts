import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg, { Pool } from 'pg';
import { MigrationRunner } from './migration-runner';

const activeTxStorage = new AsyncLocalStorage<IDatabase>();

// Ensure PostgreSQL parses int8 / bigint / COUNT(*) aggregates as numbers when safe
pg.types.setTypeParser(20, (val: string) => {
  const num = Number(val);
  return Number.isSafeInteger(num) ? num : val;
});

export interface IDatabase {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid?: number }>;
  execScript(sqlScript: string): Promise<void>;
  close(): Promise<void>;
  withTransaction<T>(fn: (tx: IDatabase) => Promise<T>): Promise<T>;
}

/**
 * Tokenizer-safe SQL parameter mapper for PostgreSQL.
 * Converts '?' parameter placeholders to numbered '$1', '$2', etc.
 * Ignores '?' characters appearing inside single-quoted string literals ('...'),
 * double-quoted identifiers ("..."), line comments (-- ...), and block comments.
 */
export function convertSqlPlaceholders(sql: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let paramIndex = 1;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = i + 1 < sql.length ? sql[i + 1] : '';

    if (inLineComment) {
      result += char;
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      result += char;
      if (char === '*' && nextChar === '/') {
        result += nextChar;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      result += char;
      if (char === "'" && nextChar === "'") {
        result += nextChar;
        i++;
      } else if (char === '\\' && nextChar === "'") {
        result += nextChar;
        i++;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      result += char;
      if (char === '"' && nextChar === '"') {
        result += nextChar;
        i++;
      } else if (char === '\\' && nextChar === '"') {
        result += nextChar;
        i++;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      result += char + nextChar;
      i++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      result += char + nextChar;
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      result += char;
      continue;
    }

    if (char === '?') {
      result += `$${paramIndex++}`;
      continue;
    }

    result += char;
  }

  return result;
}

let DatabaseSyncClass: any = null;

class NodeSqliteDatabase implements IDatabase {
  private db: DatabaseSync;
  private transactionQueue: Promise<void> = Promise.resolve();

  constructor(dbPath: string) {
    if (!DatabaseSyncClass) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sqliteModule = require('node:sqlite');
        DatabaseSyncClass = sqliteModule.DatabaseSync;
      } catch (err: any) {
        throw new Error(`[DB] Built-in node:sqlite is unavailable in this runtime environment: ${err?.message || err}. For production environments, configure DATABASE_URL for PostgreSQL 16+. For SQLite simulator, ensure Node.js >= 22.x is used.`);
      }
    }
    this.db = new DatabaseSyncClass(dbPath) as DatabaseSync;
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

  async withTransaction<T>(fn: (tx: IDatabase) => Promise<T>): Promise<T> {
    const currentTx = activeTxStorage.getStore();
    if (currentTx) {
      return currentTx.withTransaction(fn);
    }

    const previousQueue = this.transactionQueue;
    let releaseLock: () => void;
    this.transactionQueue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousQueue;
    try {
      this.db.exec('BEGIN IMMEDIATE;');
      const txDb: IDatabase = {
        query: (sql, params) => this.query(sql, params),
        execute: (sql, params) => this.execute(sql, params),
        execScript: (sqlScript) => this.execScript(sqlScript),
        close: async () => {},
        withTransaction: async (nestedFn) => {
          const savepoint = `sp_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
          this.db.exec(`SAVEPOINT ${savepoint};`);
          try {
            const res = await activeTxStorage.run(txDb, () => nestedFn(txDb));
            this.db.exec(`RELEASE SAVEPOINT ${savepoint};`);
            return res;
          } catch (err) {
            try {
              this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
            } catch {
              // Ignored if already rolled back
            }
            throw err;
          }
        }
      };
      const result = await activeTxStorage.run(txDb, () => fn(txDb));
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Ignored if already rolled back
      }
      throw error;
    } finally {
      releaseLock!();
    }
  }
}

class PostgresDatabase implements IDatabase {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const pgSql = convertSqlPlaceholders(sql);
    const res = await this.pool.query(pgSql, params);
    return res.rows as T[];
  }

  async execute(sql: string, params: any[] = []): Promise<{ changes: number; lastInsertRowid?: number }> {
    const pgSql = convertSqlPlaceholders(sql);
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
    const currentTx = activeTxStorage.getStore();
    if (currentTx) {
      return currentTx.withTransaction(fn);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txDb: IDatabase = {
        query: async (sql, params = []) => {
          const pgSql = convertSqlPlaceholders(sql);
          const res = await client.query(pgSql, params);
          return res.rows;
        },
        execute: async (sql, params = []) => {
          const pgSql = convertSqlPlaceholders(sql);
          const res = await client.query(pgSql, params);
          return { changes: res.rowCount ?? 0 };
        },
        execScript: async (sqlScript) => {
          await client.query(sqlScript);
        },
        close: async () => {},
        withTransaction: async (nestedFn) => {
          const savepoint = `sp_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
          await client.query(`SAVEPOINT ${savepoint}`);
          try {
            const res = await activeTxStorage.run(txDb, () => nestedFn(txDb));
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            return res;
          } catch (err) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            throw err;
          }
        }
      };
      const result = await activeTxStorage.run(txDb, () => fn(txDb));
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
  let schemaSql = '';
  const candidatePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../src/db/schema.sql'),
    path.resolve(process.cwd(), 'schema.sql'),
    path.resolve(process.cwd(), 'apps/api/src/db/schema.sql')
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      schemaSql = fs.readFileSync(candidate, 'utf-8');
      break;
    }
  }

  if (!schemaSql) {
    throw new Error('[DB] Could not locate schema.sql across candidate search paths');
  }

  await db.execScript(schemaSql);

  // In SQLite, verify schema parity for columns added in forward migrations
  try {
    const tableInfo = await db.query<{ name: string }>('PRAGMA table_info(production_lines)');
    if (tableInfo && tableInfo.length > 0) {
      const hasStatus = tableInfo.some((col: any) => col.name === 'status');
      if (!hasStatus) {
        await db.execute("ALTER TABLE production_lines ADD COLUMN status VARCHAR(32) DEFAULT 'RUNNING'");
      }
    }
  } catch (err: any) {
    // Ignore if not supported (e.g. Postgres)
  }

  // If connected to PostgreSQL, execute the enterprise migration chain (001-007)
  const isPostgres = Boolean(process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://')));
  if (isPostgres) {
    const migrationsDir = path.resolve(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const runner = new MigrationRunner(migrationsDir);
      await runner.runPendingMigrations(db);
    }
  }

  console.log('[DB] Schema verified and initialized.');
}

export class DatabaseManager {
  public static getInstance(): IDatabase {
    return getDatabase();
  }
}

