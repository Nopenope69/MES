#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Antigravity MES - Automated End-to-End Disaster Recovery Drill (Task 8)
# Executes complete point-in-time recovery pipeline:
# 1. Backup package creation
# 2. Package restore and SHA-256 digest validation
# 3. Post-restore deep verification via DrVerificationService
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRILL_ROOT=$(mktemp -d 2>/dev/null || mktemp -d -t 'mes-dr-drill')
BACKUP_DIR="${DRILL_ROOT}/backup"
RESTORE_DIR="${DRILL_ROOT}/restore"
RESTORE_DATA_DIR="${RESTORE_DIR}/data"
RESTORE_DB_PATH="${RESTORE_DIR}/mes_local.db"

cleanup() {
  echo "[DR-DRILL] Cleaning up temporary drill sandbox..."
  rm -rf "$DRILL_ROOT"
}
trap cleanup EXIT

echo "================================================================================"
echo "   🛡️  ANTIGRAVITY MES AUTOMATED DISASTER RECOVERY DRILL PIPELINE"
echo "================================================================================"
DRILL_START_ISO="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[DR-DRILL] Drill Initiated: ${DRILL_START_ISO}"
echo "[DR-DRILL] Drill Sandbox:   ${DRILL_ROOT}"

mkdir -p "$BACKUP_DIR" "$RESTORE_DIR" "$RESTORE_DATA_DIR"

# Stage 1: Execute Backup
echo -e "\n--- [Stage 1/3] Creating Point-in-Time Recovery Package ---"
PACKAGE_PATH=$("$REPO_ROOT/scripts/backup.sh" "$BACKUP_DIR" | tail -n 1)
echo "[DR-DRILL] Backup archive created: ${PACKAGE_PATH}"

# Stage 2: Execute Restore
echo -e "\n--- [Stage 2/3] Restoring and Verifying Archive Digests ---"
"$REPO_ROOT/scripts/restore.sh" "$PACKAGE_PATH" "$RESTORE_DIR" "$RESTORE_DATA_DIR" "$RESTORE_DB_PATH"
echo "[DR-DRILL] Unpack & SHA-256 digest verification passed."

# Stage 3: Execute Full DR Verification Service
echo -e "\n--- [Stage 3/3] Executing DrVerificationService Pipeline ---"
export SQLITE_DB_PATH="$RESTORE_DB_PATH"
export DATA_DIR="$RESTORE_DATA_DIR"

npx tsx - "$REPO_ROOT" "$RESTORE_DB_PATH" "$RESTORE_DATA_DIR" "$DRILL_START_ISO" << 'PYEOF'
const path = require('path');

async function run() {
  const repoRoot = process.argv[2];
  const dbPath = process.argv[3];
  const dataDir = process.argv[4];
  const startIso = process.argv[5];

  process.env.SQLITE_DB_PATH = dbPath;
  process.env.DATA_DIR = dataDir;

  // Use tsx to dynamically load DrVerificationService
  const { initDatabase } = await import(path.join(repoRoot, 'apps/api/src/db/database.ts'));
  const { DrVerificationService } = await import(path.join(repoRoot, 'apps/api/src/services/dr-verification.service.ts'));

  await initDatabase();

  const report = await DrVerificationService.verifyRestoredState({
    dataDir,
    startTime: new Date(startIso),
    backupTimestamp: new Date(startIso)
  });

  console.log('\n[DR-DRILL] Drill Verification Report:');
  console.log(JSON.stringify(report, null, 2));

  if (report.status !== 'PASS') {
    console.error('\n[DR-DRILL] ❌ DRILL FAILED:', report.failureReason);
    process.exit(1);
  }

  console.log('\n[DR-DRILL] ✅ DRILL PASSED: RPO and RTO within SLA, 100% integrity verified.');
}

run().catch(err => {
  console.error('[DR-DRILL] Unexpected error during verification:', err);
  process.exit(1);
});
PYEOF

echo -e "\n================================================================================"
echo "   🎉 DISASTER RECOVERY DRILL COMPLETE: STATUS PASS"
echo "================================================================================"
