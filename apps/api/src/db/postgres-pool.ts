import { Pool, PoolConfig } from 'pg';

export interface PostgresPoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  activeCount: number;
}

export interface PoolHealthResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export class PostgresPoolManager {
  private static instance: PostgresPoolManager | null = null;
  private pool: Pool | null = null;
  private config: PoolConfig;

  private constructor(customConfig?: PoolConfig) {
    const connectionString = process.env.DATABASE_URL || 'postgres://mes_user:mes_password@localhost:5432/mes_db';

    this.config = {
      connectionString,
      max: parseInt(process.env.PG_POOL_MAX || '20', 10),
      min: parseInt(process.env.PG_POOL_MIN || '4', 10),
      idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT_MS || '5000', 10),
      ...customConfig
    };
  }

  public static getInstance(customConfig?: PoolConfig): PostgresPoolManager {
    if (!this.instance) {
      this.instance = new PostgresPoolManager(customConfig);
    }
    return this.instance;
  }

  public getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool(this.config);

      this.pool.on('error', (err) => {
        console.error('[PG POOL] Unexpected error on idle client:', err);
      });
    }
    return this.pool;
  }

  public getStats(): PostgresPoolStats {
    if (!this.pool) {
      return { totalCount: 0, idleCount: 0, waitingCount: 0, activeCount: 0 };
    }
    const total = this.pool.totalCount;
    const idle = this.pool.idleCount;
    const waiting = this.pool.waitingCount;
    const active = Math.max(0, total - idle);

    return {
      totalCount: total,
      idleCount: idle,
      waitingCount: waiting,
      activeCount: active
    };
  }

  public async healthCheck(): Promise<PoolHealthResult> {
    const pool = this.getPool();
    const start = Date.now();
    try {
      await pool.query('SELECT 1 as ping');
      const latency = Date.now() - start;
      return {
        healthy: true,
        latencyMs: latency
      };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err.message || 'Failed to ping PostgreSQL pool'
      };
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
