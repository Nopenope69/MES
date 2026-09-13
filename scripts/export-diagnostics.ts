#!/usr/bin/env npx tsx

// ==============================================================================
// Antigravity SMT MES - Remote Diagnostics Bundle Exporter (Stage 5 / O-03)
//
// Generates a cryptographically hashed, redacted diagnostic bundle containing:
// 1. System runtime & platform metrics (sanitized of secrets/tokens)
// 2. Deep health probe telemetry (database pool, OT socket listener, memory)
// 3. Database table statistics & migration history
// 4. Disaster Recovery & audit history summary
// 5. Redacted system logs
// 6. manifest.json with SHA-256 digests
// ==============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { getDatabase, initDatabase } from '../apps/api/src/db/database';
import { MigrationRunner } from '../apps/api/src/db/migration-runner';
import { DrVerificationService } from '../apps/api/src/services/dr-verification.service';

const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /auth/i,
  /credential/i,
  /signature/i
];

function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Redact JWT tokens
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(obj)) {
      return '[REDACTED_JWT_TOKEN]';
    }
    // Redact hex secrets
    if (/^[a-f0-9]{32,128}$/i.test(obj)) {
      return '[REDACTED_HEX_KEY]';
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_PATTERNS.some(p => p.test(k))) {
        cleaned[k] = '[REDACTED]';
      } else {
        cleaned[k] = sanitizeObject(v);
      }
    }
    return cleaned;
  }
  return obj;
}

function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function exportDiagnostics() {
  console.log('================================================================================');
  console.log('   📦 ANTIGRAVITY SMT MES REMOTE DIAGNOSTICS BUNDLE EXPORTER (O-03)');
  console.log('================================================================================');

  const repoRoot = path.resolve(__dirname, '..');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bundleId = `mes-diagnostics-${timestamp}`;
  const outputBaseDir = process.env.DIAGNOSTICS_DIR || path.join(repoRoot, 'diagnostics');
  const stagingDir = path.join(outputBaseDir, bundleId);

  fs.mkdirSync(stagingDir, { recursive: true });
  console.log(`[DIAGNOSTICS] Staging Directory: ${stagingDir}`);

  // 1. System & Runtime Information
  console.log('[DIAGNOSTICS] 1. Gathering system & runtime metadata...');
  const memUsage = process.memoryUsage();
  const systemInfo = {
    bundleId,
    exportedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    uptimeSeconds: Math.floor(process.uptime()),
    systemUptimeSeconds: Math.floor(os.uptime()),
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    v8Memory: {
      heapUsedBytes: memUsage.heapUsed,
      heapTotalBytes: memUsage.heapTotal,
      rssBytes: memUsage.rss,
      externalBytes: memUsage.external
    },
    env: sanitizeObject({
      NODE_ENV: process.env.NODE_ENV || 'production',
      PORT: process.env.PORT || '4000',
      FUJI_PORT: process.env.FUJI_PORT || '30040',
      DATABASE_ENGINE: process.env.DATABASE_URL ? 'POSTGRESQL' : 'SQLITE',
      DATA_DIR: process.env.DATA_DIR || '/var/data',
      LOG_LEVEL: process.env.LOG_LEVEL || 'info'
    })
  };
  fs.writeFileSync(path.join(stagingDir, 'system.json'), JSON.stringify(systemInfo, null, 2), 'utf-8');

  // 2. Database Connectivity & Deep Health Probes
  console.log('[DIAGNOSTICS] 2. Inspecting live database connection & probes...');
  await initDatabase();
  const db = getDatabase();

  let dbStatus = 'UNKNOWN';
  let dbLatencyMs = -1;
  try {
    const t0 = performance.now();
    await db.query('SELECT 1 as alive');
    dbLatencyMs = Math.round((performance.now() - t0) * 100) / 100;
    dbStatus = 'UP';
  } catch (err: any) {
    dbStatus = `DOWN: ${err.message}`;
  }

  const fujiPort = parseInt(process.env.FUJI_PORT || '30040', 10);
  let otGatewayActive = false;
  try {
    const net = await import('net');
    await new Promise<void>((resolve) => {
      const sock = net.createConnection({ port: fujiPort, host: '127.0.0.1' });
      sock.setTimeout(300);
      sock.on('connect', () => {
        otGatewayActive = true;
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        resolve();
      });
      sock.on('timeout', () => {
        sock.destroy();
        resolve();
      });
    });
  } catch {
    otGatewayActive = false;
  }

  const healthData = {
    status: dbStatus === 'UP' ? 'HEALTHY' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    probes: {
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        engine: process.env.DATABASE_URL ? 'postgresql' : 'sqlite'
      },
      otGateway: {
        interface: 'FUJI_NEXIM_TCP',
        port: fujiPort,
        activeListener: otGatewayActive
      },
      v8Memory: {
        heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 1000) / 10,
        heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
        rssMb: Math.round(memUsage.rss / 1024 / 1024)
      }
    }
  };
  fs.writeFileSync(path.join(stagingDir, 'health.json'), JSON.stringify(healthData, null, 2), 'utf-8');

  // 3. Database Statistics
  console.log('[DIAGNOSTICS] 3. Collecting table statistics & schema counts...');
  const tableStats: Record<string, number> = {};
  for (const tbl of DrVerificationService.CORE_TABLES) {
    try {
      const res = await db.query(`SELECT COUNT(*) as count FROM "${tbl}"`);
      tableStats[tbl] = Number(res[0]?.count ?? Object.values(res[0] ?? {})[0] ?? 0);
    } catch {
      tableStats[tbl] = -1; // Missing or unreadable
    }
  }

  // Additional production telemetry tables
  const additionalTables = ['production_line_holds', 'stencils', 'solder_paste_jars', 'spi_inspections', 'aoi_inspections'];
  for (const tbl of additionalTables) {
    try {
      const res = await db.query(`SELECT COUNT(*) as count FROM "${tbl}"`);
      tableStats[tbl] = Number(res[0]?.count ?? Object.values(res[0] ?? {})[0] ?? 0);
    } catch {
      tableStats[tbl] = -1;
    }
  }
  fs.writeFileSync(path.join(stagingDir, 'db-stats.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    tables: tableStats
  }, null, 2), 'utf-8');

  // 4. Migration History & DR Records
  console.log('[DIAGNOSTICS] 4. Reading schema migration and disaster recovery history...');
  let migrations: any[] = [];
  try {
    migrations = await db.query('SELECT * FROM schema_migrations ORDER BY version ASC');
  } catch {
    migrations = [];
  }

  let latestDrill: any = null;
  try {
    latestDrill = await DrVerificationService.getLatestVerifiedDrill();
  } catch {
    latestDrill = null;
  }

  fs.writeFileSync(path.join(stagingDir, 'migrations.json'), JSON.stringify({
    appliedMigrations: migrations,
    latestVerifiedDrill: latestDrill
  }, null, 2), 'utf-8');

  // 5. Sanitized Operational Logs
  console.log('[DIAGNOSTICS] 5. Packaging sanitized application logs...');
  const logCandidates = [
    path.join(repoRoot, 'apps/api/logs/app.log'),
    path.join(repoRoot, 'logs/app.log'),
    path.join(repoRoot, 'server.log')
  ];

  let logSnippet = `[${new Date().toISOString()}] Diagnostics bundle generated for ${bundleId}\n`;
  for (const logPath of logCandidates) {
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf-8').split('\n').slice(-500); // Last 500 lines
      const sanitizedLines = lines.map(line => {
        return line
          .replace(/bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED_TOKEN]')
          .replace(/pin[=:]\s*["']?[^"'\s,]+["']?/gi, 'pin=[REDACTED]')
          .replace(/password[=:]\s*["']?[^"'\s,]+["']?/gi, 'password=[REDACTED]');
      });
      logSnippet += `\n--- Log Source: ${path.basename(logPath)} ---\n` + sanitizedLines.join('\n');
    }
  }
  fs.writeFileSync(path.join(stagingDir, 'logs.txt'), logSnippet, 'utf-8');

  // 6. Cryptographic Manifest (SHA-256)
  console.log('[DIAGNOSTICS] 6. Building cryptographic manifest.json...');
  const filesToHash = ['system.json', 'health.json', 'db-stats.json', 'migrations.json', 'logs.txt'];
  const manifestFiles = filesToHash.map(relName => {
    const full = path.join(stagingDir, relName);
    return {
      file: relName,
      sha256: computeSha256(full),
      sizeBytes: fs.statSync(full).size
    };
  });

  const manifest = {
    bundleId,
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    files: manifestFiles
  };
  fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 7. Compress into .tar.gz
  console.log('[DIAGNOSTICS] 7. Compressing bundle archive...');
  const tarballPath = path.join(outputBaseDir, `${bundleId}.tar.gz`);
  execSync(`tar -czf "${tarballPath}" -C "${outputBaseDir}" "${bundleId}"`);

  // Remove temporary staging directory
  fs.rmSync(stagingDir, { recursive: true, force: true });

  const finalSize = fs.statSync(tarballPath).size;
  console.log('\n================================================================================');
  console.log('   🎉 DIAGNOSTICS BUNDLE READY');
  console.log('================================================================================');
  console.log(`[DIAGNOSTICS] Archive: ${tarballPath}`);
  console.log(`[DIAGNOSTICS] Size:    ${Math.round(finalSize / 1024)} KB`);
  console.log(`[DIAGNOSTICS] SHA-256: ${computeSha256(tarballPath)}`);
  console.log('================================================================================\n');

  return tarballPath;
}

if (require.main === module || (process.argv[1] && process.argv[1].includes('export-diagnostics'))) {
  exportDiagnostics()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Failed to export diagnostics:', err);
      process.exit(1);
    });
}

export { exportDiagnostics };
