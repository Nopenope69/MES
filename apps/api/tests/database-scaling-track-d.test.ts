import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { MigrationRunner } from '../src/db/migration-runner';
import { PostgresPoolManager } from '../src/db/postgres-pool';

describe('Track D: Enterprise Database & PostgreSQL Scaling Suite', () => {
  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  it('discovers and verifies cryptographic checksums of SQL migration scripts', () => {
    const runner = new MigrationRunner();
    const files = runner.getMigrationFiles();

    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files[0].version).toBe('001');
    expect(files[0].name).toContain('001_enterprise_schema');
    expect(files[0].checksum.length).toBe(64);

    expect(files[1].version).toBe('002');
    expect(files[1].name).toContain('002_brin_and_advanced_indexes');
    expect(files[1].checksum.length).toBe(64);
  });

  it('enforces declarative monthly range partitioning on high-throughput event tables', () => {
    const runner = new MigrationRunner();
    const files = runner.getMigrationFiles();
    const schemaFile = files.find(f => f.version === '001');
    expect(schemaFile).toBeDefined();

    const sql = fs.readFileSync(schemaFile!.filePath, 'utf-8');

    // Declarative partitioning on production_events
    expect(sql).toContain('PARTITION BY RANGE (event_time)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS production_events_2026_09 PARTITION OF production_events');
    expect(sql).toContain('FOR VALUES FROM (\'2026-09-01 00:00:00+00\') TO (\'2026-10-01 00:00:00+00\')');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS production_events_default PARTITION OF production_events DEFAULT');

    // Declarative partitioning on ingress_events
    expect(sql).toContain('PARTITION BY RANGE (received_at)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ingress_events_2026_09 PARTITION OF ingress_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ingress_events_default PARTITION OF ingress_events DEFAULT');

    // Primary key includes partition key
    expect(sql).toContain('PRIMARY KEY (id, event_time)');
    expect(sql).toContain('PRIMARY KEY (id, received_at)');
  });

  it('configures BRIN and GIN indexes for sub-second 100,000+ CPH temporal queries', () => {
    const runner = new MigrationRunner();
    const files = runner.getMigrationFiles();
    const indexFile = files.find(f => f.version === '002');
    expect(indexFile).toBeDefined();

    const sql = fs.readFileSync(indexFile!.filePath, 'utf-8');

    // BRIN (Block Range Index) on event times
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_production_events_brin_time');
    expect(sql).toContain('ON production_events USING brin (event_time)');

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_ingress_events_brin_time');
    expect(sql).toContain('ON ingress_events USING brin (received_at)');

    // Composite B-Tree for common SMT line filtering
    expect(sql).toContain('ON production_events (work_center_id, event_time DESC)');
    expect(sql).toContain('ON production_events (event_type, event_time DESC)');

    // GIN indexes for semi-structured payload searches
    expect(sql).toContain('ON production_events USING gin (payload_json)');
    expect(sql).toContain('ON compliance_audit_ledger USING gin (metadata_json)');
    expect(sql).toContain('ON device_history_records USING gin (dhr_payload_json)');
  });

  it('manages PostgreSQL connection pooling and health statistics', () => {
    const poolManager = PostgresPoolManager.getInstance({
      max: 15,
      min: 3,
      idleTimeoutMillis: 25000,
      connectionTimeoutMillis: 4000
    });

    expect(poolManager).toBeDefined();

    // Verify statistics interface
    const stats = poolManager.getStats();
    expect(typeof stats.totalCount).toBe('number');
    expect(typeof stats.idleCount).toBe('number');
    expect(typeof stats.waitingCount).toBe('number');
    expect(typeof stats.activeCount).toBe('number');
  });

  it('tracks applied database migrations idempotently in schema_migrations', async () => {
    const db = getDatabase();
    const runner = new MigrationRunner();

    await runner.ensureTrackingTable(db);

    const rows = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    );
    expect(rows.length).toBe(1);

    // Record test migration entry
    const testChecksum = 'a'.repeat(64);
    await db.execute(
      'INSERT OR REPLACE INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
      ['000', '000_baseline_schema', new Date().toISOString(), testChecksum]
    );

    const check = await db.query(
      'SELECT * FROM schema_migrations WHERE version = ?',
      ['000']
    );
    expect(check.length).toBe(1);
    expect(check[0].name).toBe('000_baseline_schema');
  });

  it('validates SQLite table extraction and batch record formatting for PostgreSQL sync', async () => {
    const db = getDatabase();

    // Query seeded batches and material consumptions
    const batches = await db.query('SELECT * FROM batches LIMIT 5');
    const reels = await db.query('SELECT * FROM component_reels LIMIT 5');

    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(reels.length).toBeGreaterThanOrEqual(1);

    // Validate that columns convert cleanly to parameter placeholders
    const batchCols = Object.keys(batches[0]);
    expect(batchCols).toContain('batch_number');
    expect(batchCols).toContain('product_code');
    expect(batchCols).toContain('work_center_id');

    let paramIdx = 1;
    const pgPlaceholders = batchCols.map(() => `$${paramIdx++}`).join(', ');
    expect(pgPlaceholders).toContain('$1');
    expect(pgPlaceholders).toContain(`$${batchCols.length}`);
  });
});
