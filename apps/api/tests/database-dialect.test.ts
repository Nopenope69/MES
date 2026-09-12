import { describe, it, expect } from 'vitest';
import { convertSqlPlaceholders, getDatabase, initDatabase } from '../src/db/database';

describe('Database Dialect & Parameter Mapping Suite (Stage 1 / D-01 & D-02)', () => {
  it('a \'?\' inside a quoted string literal must not be treated as a bind parameter', () => {
    const inputSql = "SELECT * FROM work_centers WHERE status = 'IS_ACTIVE?' AND line_id = ?";
    const outputSql = convertSqlPlaceholders(inputSql);

    // The '?' inside 'IS_ACTIVE?' must be preserved as literal text
    // The '?' after line_id = must be transformed to $1
    expect(outputSql).toBe("SELECT * FROM work_centers WHERE status = 'IS_ACTIVE?' AND line_id = $1");
  });

  it('handles multiple placeholders, escaped quotes, and comments correctly', () => {
    const inputSql = `
      -- Is this a comment with a ? question mark?
      SELECT * FROM products
      WHERE description = 'It''s a high-precision sensor?'
        AND category = ?
        /* Another block comment with ? */
        AND unit = ?;
    `;
    const outputSql = convertSqlPlaceholders(inputSql);

    expect(outputSql).toContain("description = 'It''s a high-precision sensor?'");
    expect(outputSql).toContain('category = $1');
    expect(outputSql).toContain('unit = $2');
  });

  it('does not clobber question marks in double-quoted identifiers or slash escapes', () => {
    const inputSql = 'SELECT "col?name" FROM "my_table" WHERE name = \'hello\\\'?\' AND id = ?';
    const outputSql = convertSqlPlaceholders(inputSql);

    expect(outputSql).toContain('"col?name"');
    expect(outputSql).toContain("'hello\\\'?'");
    expect(outputSql).toContain('id = $1');
  });

  it('verifies database initializes schema cleanly without try/catch ALTERs', async () => {
    await initDatabase();
    const db = getDatabase();

    // Verify system_settings table exists
    const settings = await db.query('SELECT * FROM system_settings');
    expect(Array.isArray(settings)).toBe(true);

    // Verify operators table has new auth columns
    const opCols = await db.query("SELECT pin_hash, failed_login_attempts FROM operators LIMIT 1");
    expect(Array.isArray(opCols)).toBe(true);
  });

  it('serializes concurrent withTransaction executions cleanly without bleeding', async () => {
    const db = getDatabase();
    const executionOrder: string[] = [];

    const p1 = db.withTransaction(async (tx) => {
      executionOrder.push('t1_start');
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push('t1_end');
      return 't1_done';
    });

    const p2 = db.withTransaction(async (tx) => {
      executionOrder.push('t2_start');
      await new Promise((r) => setTimeout(r, 10));
      executionOrder.push('t2_end');
      return 't2_done';
    });

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe('t1_done');
    expect(res2).toBe('t2_done');

    // Transactions must be strictly serialized (t1 finishes before t2 starts)
    expect(executionOrder).toEqual(['t1_start', 't1_end', 't2_start', 't2_end']);
  });
});
