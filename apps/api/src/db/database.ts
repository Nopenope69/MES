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

  async withTransaction<T>(fn: (tx: IDatabase) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Ignored if already rolled back
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

export function getDatabase(): IDatabase {
  if (dbInstance) return dbInstance;

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
    console.log('[DB] Connecting to PostgreSQL database...');
    dbInstance = new PostgresDatabase(dbUrl);
  } else {
    const localDbPath = path.resolve(process.cwd(), 'mes_local.db');
    console.log(`[DB] Using built-in Node SQLite database at: ${localDbPath}`);
    dbInstance = new NodeSqliteDatabase(localDbPath);
  }

  return dbInstance;
}

export async function initDatabase(): Promise<void> {
  const db = getDatabase();
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  await db.execScript(schemaSql);
  try {
    await db.execute('ALTER TABLE ingress_events ADD COLUMN decoded_payload TEXT;');
  } catch {
    // Column already exists
  }
  console.log('[DB] Schema verified and initialized.');
}
