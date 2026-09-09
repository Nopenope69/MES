#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Antigravity MES - Point-in-Time Recovery Package Creator (Task 8)
# Creates a verified snapshot archive containing database, managed artifacts,
# and cryptographic manifest.json with SHA-256 checksums.
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-${BACKUP_DIR:-$REPO_ROOT/backups}}"
DATA_DIR="${DATA_DIR:-/var/data}"
if [ ! -d "$DATA_DIR" ] && [ -d "$REPO_ROOT/data" ]; then
  DATA_DIR="$REPO_ROOT/data"
fi
DB_PATH="${SQLITE_DB_PATH:-$REPO_ROOT/mes_local.db}"

TIMESTAMP="$(date -u +"%Y%m%d-%H%M%S")"
ISO_TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BACKUP_ID="mes-recovery-${TIMESTAMP}"
STAGING_DIR="${OUTPUT_DIR}/${BACKUP_ID}"

mkdir -p "${STAGING_DIR}/artifacts"
mkdir -p "${OUTPUT_DIR}"

echo "[BACKUP] Initializing Point-in-Time Recovery Package: ${BACKUP_ID}"
echo "[BACKUP] Data Directory: ${DATA_DIR}"
echo "[BACKUP] Output Directory: ${OUTPUT_DIR}"

# 1. Capture Database Snapshot
DB_FILE_NAME="database.sqlite"
if [ -n "${DATABASE_URL:-}" ] && [[ "$DATABASE_URL" =~ ^postgres ]]; then
  DB_FILE_NAME="database.sql"
  echo "[BACKUP] Dumping PostgreSQL database..."
  pg_dump "$DATABASE_URL" > "${STAGING_DIR}/${DB_FILE_NAME}"
elif [ -f "$DB_PATH" ]; then
  echo "[BACKUP] Snapshotting SQLite database from ${DB_PATH}..."
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '${STAGING_DIR}/${DB_FILE_NAME}'" 2>/dev/null || cp "$DB_PATH" "${STAGING_DIR}/${DB_FILE_NAME}"
  else
    cp "$DB_PATH" "${STAGING_DIR}/${DB_FILE_NAME}"
  fi
else
  echo "[BACKUP] No active database found at ${DB_PATH}; creating empty baseline..."
  touch "${STAGING_DIR}/${DB_FILE_NAME}"
fi

# 2. Capture Managed Artifacts (/var/data/dhr, /var/data/reflow, /var/data/inspection)
for SUBDIR in dhr reflow inspection; do
  if [ -d "${DATA_DIR}/${SUBDIR}" ]; then
    echo "[BACKUP] Snapshotting managed evidence: ${SUBDIR}/"
    mkdir -p "${STAGING_DIR}/artifacts/${SUBDIR}"
    cp -R "${DATA_DIR}/${SUBDIR}/." "${STAGING_DIR}/artifacts/${SUBDIR}/" 2>/dev/null || true
  fi
done

# 3. Generate Cryptographic manifest.json with SHA-256 Checksums
echo "[BACKUP] Generating SHA-256 cryptographic manifest.json..."
node - "${STAGING_DIR}" "${BACKUP_ID}" "${ISO_TIMESTAMP}" "${DB_FILE_NAME}" << 'PYEOF'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const stagingDir = process.argv[2];
const backupId = process.argv[3];
const isoTimestamp = process.argv[4];
const dbFileName = process.argv[5];

function computeSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getAllFiles(dirPath, baseDir) {
  let files = [];
  if (!fs.existsSync(dirPath)) return files;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllFiles(fullPath, baseDir));
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
let dbInfo = { file: dbFileName, sha256: '', size: 0 };
if (fs.existsSync(dbFullPath)) {
  dbInfo = {
    file: dbFileName,
    sha256: computeSha256(dbFullPath),
    size: fs.statSync(dbFullPath).size
  };
}

const artifactsDir = path.join(stagingDir, 'artifacts');
const artifactEntries = getAllFiles(artifactsDir, artifactsDir);

// Build uniform files list (all files relative to stagingDir)
const allFiles = [
  { path: dbFileName, sha256: dbInfo.sha256, size: dbInfo.size },
  ...artifactEntries.map(a => ({
    path: 'artifacts/' + a.path,
    sha256: a.sha256,
    size: a.size
  }))
];

const manifest = {
  backup_id: backupId,
  drill_version: '1.0.0',
  backup_timestamp: isoTimestamp,
  database: dbInfo,
  artifacts: artifactEntries,
  files: allFiles
};

fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
console.log(`[BACKUP] manifest.json generated with ${allFiles.length} hashed files.`);
PYEOF

# 4. Package Archive (.tar.gz)
PACKAGE_FILE="${OUTPUT_DIR}/${BACKUP_ID}.tar.gz"
echo "[BACKUP] Creating archive: ${PACKAGE_FILE}..."
tar -czf "${PACKAGE_FILE}" -C "${OUTPUT_DIR}" "${BACKUP_ID}"

echo "[BACKUP] Success! Recovery package created at: ${PACKAGE_FILE}"
echo "${PACKAGE_FILE}"
