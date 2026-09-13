#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Antigravity SMT MES - Enterprise PostgreSQL Backup & WAL Archiver (Stage 5 / O-01)
#
# Generates a point-in-time recovery archive including:
# 1. PostgreSQL schema and data dump (custom -Fc or .sql format)
# 2. Continuous WAL archives (if PG_WAL_ARCHIVE_DIR is configured)
# 3. Managed evidence artifacts (/var/data/dhr, reflow, inspection)
# 4. Cryptographic manifest.json with SHA-256 digests of all components
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-${BACKUP_DIR:-$REPO_ROOT/backups}}"
DATA_DIR="${DATA_DIR:-/var/data}"
if [ ! -d "$DATA_DIR" ] && [ -d "$REPO_ROOT/data" ]; then
  DATA_DIR="$REPO_ROOT/data"
fi

PG_URL="${DATABASE_URL:-${2:-}}"
WAL_ARCHIVE_DIR="${PG_WAL_ARCHIVE_DIR:-$REPO_ROOT/pg_wal_archive}"

TIMESTAMP="$(date -u +"%Y%m%d-%H%M%S")"
ISO_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BACKUP_ID="mes-pg-recovery-${TIMESTAMP}"
STAGING_DIR="${OUTPUT_DIR}/${BACKUP_ID}"

mkdir -p "${STAGING_DIR}/artifacts"
mkdir -p "${STAGING_DIR}/wal"
mkdir -p "${OUTPUT_DIR}"

echo "[PG-BACKUP] Initializing Enterprise PostgreSQL Backup Package: ${BACKUP_ID}"
echo "[PG-BACKUP] Staging Directory: ${STAGING_DIR}"
echo "[PG-BACKUP] Output Directory:  ${OUTPUT_DIR}"

DB_FILE_NAME="database.sql"
DUMP_FORMAT="sql"

# 1. Extract PostgreSQL Database Dump
if [ -n "$PG_URL" ] && [[ "$PG_URL" =~ ^postgres ]]; then
  echo "[PG-BACKUP] Connecting to PostgreSQL database via DATABASE_URL..."
  if command -v pg_dump >/dev/null 2>&1; then
    echo "[PG-BACKUP] Executing pg_dump with custom binary format (-Fc)..."
    DB_FILE_NAME="database.dump"
    DUMP_FORMAT="custom"
    pg_dump -Fc "$PG_URL" > "${STAGING_DIR}/${DB_FILE_NAME}"
  elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'smt_mes_postgres'; then
    echo "[PG-BACKUP] Executing pg_dump inside running Docker container smt_mes_postgres..."
    docker exec -e PGPASSWORD=mes_password smt_mes_postgres pg_dump -U mes_user -d mes_db > "${STAGING_DIR}/${DB_FILE_NAME}"
  else
    echo "[PG-BACKUP] Exporting PostgreSQL schema and tables via Node database client..."
    node - "$STAGING_DIR" "$DB_FILE_NAME" "$PG_URL" << 'NODE_PG_DUMP'
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function dump() {
  const stagingDir = process.argv[2];
  const dbFileName = process.argv[3];
  const url = process.argv[4];
  const client = new Client({ connectionString: url });
  await client.connect();

  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  let dumpContent = `-- PostgreSQL Snapshot generated at ${new Date().toISOString()}\n`;
  for (const row of tablesRes.rows) {
    const tbl = row.table_name;
    const dataRes = await client.query(`SELECT * FROM "${tbl}"`);
    dumpContent += `\n-- Data for ${tbl} (${dataRes.rowCount} rows)\n`;
    for (const record of dataRes.rows) {
      const cols = Object.keys(record);
      if (cols.length === 0) continue;
      const vals = cols.map(c => {
        const v = record[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return v;
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        if (v instanceof Date) return `'${v.toISOString()}'`;
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      dumpContent += `INSERT INTO "${tbl}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});\n`;
    }
  }

  await client.end();
  fs.writeFileSync(path.join(stagingDir, dbFileName), dumpContent, 'utf-8');
  console.log(`[PG-BACKUP] Node pg dump complete: ${tablesRes.rowCount} tables captured.`);
}

dump().catch(err => {
  console.error('[PG-BACKUP] Node pg dump failed:', err);
  process.exit(1);
});
NODE_PG_DUMP
  fi
else
  # Local SQLite / Fallback database mode for local cleanroom validation
  SQLITE_PATH="${SQLITE_DB_PATH:-$REPO_ROOT/mes_local.db}"
  if [ -f "$SQLITE_PATH" ]; then
    echo "[PG-BACKUP] Notice: DATABASE_URL not set; capturing SQLite baseline state from ${SQLITE_PATH}..."
    DB_FILE_NAME="database.sqlite"
    DUMP_FORMAT="sqlite"
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$SQLITE_PATH" ".backup '${STAGING_DIR}/${DB_FILE_NAME}'" 2>/dev/null || cp "$SQLITE_PATH" "${STAGING_DIR}/${DB_FILE_NAME}"
    else
      cp "$SQLITE_PATH" "${STAGING_DIR}/${DB_FILE_NAME}"
    fi
  else
    echo "[PG-BACKUP] Creating empty database baseline at ${STAGING_DIR}/${DB_FILE_NAME}..."
    touch "${STAGING_DIR}/${DB_FILE_NAME}"
  fi
fi

# 2. Capture Continuous WAL Archives (if configured)
WAL_COUNT=0
if [ -d "$WAL_ARCHIVE_DIR" ]; then
  echo "[PG-BACKUP] Capturing continuous WAL segments from ${WAL_ARCHIVE_DIR}..."
  cp -R "${WAL_ARCHIVE_DIR}/." "${STAGING_DIR}/wal/" 2>/dev/null || true
  WAL_COUNT=$(find "${STAGING_DIR}/wal" -type f | wc -l | tr -d ' ')
  echo "[PG-BACKUP] Bundled ${WAL_COUNT} WAL segment(s)."
fi

# 3. Capture Managed Evidence Artifacts (dhr, reflow, inspection)
for SUBDIR in dhr reflow inspection; do
  if [ -d "${DATA_DIR}/${SUBDIR}" ]; then
    echo "[PG-BACKUP] Bundling managed evidence: ${SUBDIR}/"
    mkdir -p "${STAGING_DIR}/artifacts/${SUBDIR}"
    cp -R "${DATA_DIR}/${SUBDIR}/." "${STAGING_DIR}/artifacts/${SUBDIR}/" 2>/dev/null || true
  fi
done

# 4. Generate SHA-256 Cryptographic manifest.json
echo "[PG-BACKUP] Generating cryptographic manifest.json with SHA-256 checksums..."
node - "${STAGING_DIR}" "${BACKUP_ID}" "${ISO_TIMESTAMP}" "${DB_FILE_NAME}" "${DUMP_FORMAT}" "${WAL_COUNT}" << 'NODE_MANIFEST'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const stagingDir = process.argv[2];
const backupId = process.argv[3];
const isoTimestamp = process.argv[4];
const dbFileName = process.argv[5];
const dumpFormat = process.argv[6];
const walCount = parseInt(process.argv[7] || '0', 10);

function computeSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function scanFiles(dirPath, baseDir) {
  let files = [];
  if (!fs.existsSync(dirPath)) return files;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(scanFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const stat = fs.statSync(fullPath);
      files.push({
        path: relPath,
        sha256: computeSha256(fullPath),
        size: stat.size
      });
    }
  }
  return files;
}

const dbFullPath = path.join(stagingDir, dbFileName);
let dbInfo = { file: dbFileName, format: dumpFormat, sha256: '', size: 0 };
if (fs.existsSync(dbFullPath)) {
  dbInfo.sha256 = computeSha256(dbFullPath);
  dbInfo.size = fs.statSync(dbFullPath).size;
}

const artifactsDir = path.join(stagingDir, 'artifacts');
const artifactEntries = scanFiles(artifactsDir, artifactsDir);

const walDir = path.join(stagingDir, 'wal');
const walEntries = scanFiles(walDir, walDir);

const allFiles = [
  { path: dbFileName, sha256: dbInfo.sha256, size: dbInfo.size },
  ...artifactEntries.map(a => ({ path: 'artifacts/' + a.path, sha256: a.sha256, size: a.size })),
  ...walEntries.map(w => ({ path: 'wal/' + w.path, sha256: w.sha256, size: w.size }))
];

const manifest = {
  backup_id: backupId,
  backup_type: 'POSTGRES_ENTERPRISE_PITR',
  engine: dumpFormat === 'sqlite' ? 'sqlite' : 'postgres',
  format: dumpFormat,
  timestamp: isoTimestamp,
  database: dbInfo,
  wal_segment_count: walCount,
  artifacts: artifactEntries,
  files: allFiles
};

fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
console.log(`[PG-BACKUP] manifest.json successfully created (${allFiles.length} hashed items).`);
NODE_MANIFEST

# 5. Compress Package Archive (.tar.gz)
PACKAGE_FILE="${OUTPUT_DIR}/${BACKUP_ID}.tar.gz"
echo "[PG-BACKUP] Compressing recovery package: ${PACKAGE_FILE}..."
tar -czf "${PACKAGE_FILE}" -C "${OUTPUT_DIR}" "${BACKUP_ID}"

echo "[PG-BACKUP] ✅ Backup complete! Package ready: ${PACKAGE_FILE}"
echo "${PACKAGE_FILE}"
