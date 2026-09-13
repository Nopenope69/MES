import express from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDatabase, getDatabase } from './db/database';
import { seedDatabase } from './db/seed';
import { eventsRouter } from './routes/events.router';
import { workCentersRouter } from './routes/work-centers.router';
import { batchesRouter } from './routes/batches.router';
import { reportsRouter } from './routes/reports.router';
import { genealogyRouter } from './routes/genealogy.router';
import { smtRouter } from './routes/smt.router';
import { complianceRouter } from './routes/compliance.router';
import { sreRouter } from './routes/sre.router';
import { aoiRouter } from './routes/aoi.router';
import { spiRouter } from './routes/spi.router';
import { fleetRouter } from './routes/fleet.router';
import { logisticsRouter } from './routes/logistics.router';
import { predictiveRouter } from './routes/predictive.router';
import { reflowRouter } from './routes/reflow.router';
import { MetricsService } from './services/metrics.service';
import { FujiNeximAdapter } from './adapters/fuji-nexim.adapter';
import { MachineControlModule } from './modules/machine-control';
import { securityHeadersMiddleware, SimpleRateLimiter, timingSafeCompare } from './security/http-security';
import { SecretsConfigManager } from './config/secrets';
import { authRouter } from './routes/auth.router';
import { healthRouter, setFujiAdapterForHealth } from './routes/health.router';
import { authenticateToken, requirePermission } from './middleware/auth.middleware';
import { Permission } from './security/permissions';
import { OnboardingService } from './services/onboarding.service';
import { RepeatDefectSentinelService } from './services/repeat-defect-sentinel.service';
import { featureGate } from './middleware/feature-gate.middleware';

dotenv.config();

const app = express();
const metrics = MetricsService.getInstance();
const spliceRateLimiter = new SimpleRateLimiter(60000, 100);
let fujiAdapter: FujiNeximAdapter | null = null;

// Enterprise Security Hardening Middleware
app.use(securityHeadersMiddleware);

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://cleanroom.local')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'test') {
      callback(null, true);
    } else {
      callback(new Error('CORS policy violation: Origin not allowed'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));
app.use('/api/v1/smt/splice-verify', spliceRateLimiter.middleware());

// HTTP RED Metrics Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const durationSec = (Date.now() - start) / 1000;
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    metrics.httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    metrics.httpRequestDuration.observe({ method: req.method, route }, durationSec);
  });
  next();
});

// Public Allowlist for Unauthenticated Endpoints
const PUBLIC_ALLOWLIST = [
  '/health',
  '/api/health',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/bootstrap',
  '/api/v1/openapi.json',
  '/api-docs',
  '/metrics'
] as const;

function isAllowlisted(urlPath: string): boolean {
  const clean = urlPath.split('?')[0].replace(/\/+$/, '') || '/';
  return PUBLIC_ALLOWLIST.some((p) => {
    const cleanP = p.replace(/\/+$/, '') || '/';
    return clean === cleanP;
  });
}

// Global Authentication Guard for /api/v1/* routes
app.use('/api/v1', (req, res, next) => {
  const fullPath = (req.baseUrl + req.path).replace(/\/+$/, '') || '/';
  if (isAllowlisted(fullPath)) {
    return next();
  }
  return authenticateToken(req, res, next);
});

// Register API routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/work-centers', workCentersRouter);
app.use('/api/v1/batches', batchesRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/genealogy', genealogyRouter);
app.use('/api/v1/smt', smtRouter);
app.use('/api/v1/compliance', complianceRouter);

// Experimental Modules Parked Behind Feature Flags (X-01)
app.use('/api/v1/sre/chaos', featureGate('ENABLE_CHAOS_ENGINEERING'));
app.use('/api/v1/sre', sreRouter);

app.use('/api/v1/aoi', aoiRouter);

app.use('/api/v1/spi/printer/modify-parameter', featureGate('ENABLE_PRINTER_AUTO_TUNE'));
app.use('/api/v1/spi', spiRouter);

app.use('/api/v1/fleet', fleetRouter);

app.use('/api/v1/logistics/agv', featureGate('ENABLE_AGV'));
app.use('/api/v1/logistics', logisticsRouter);

app.use('/api/v1/predictive', featureGate('ENABLE_PREDICTIVE_QUALITY'));
app.use('/api/v1/predictive', predictiveRouter);

app.use('/api/v1/reflow', reflowRouter);

// Prometheus Metrics Endpoint (Secured via dedicated Prometheus service token when configured)
app.get('/metrics', (req, res) => {
  const expectedToken = process.env.PROMETHEUS_METRICS_KEY || process.env.PROMETHEUS_TOKEN;
  if (expectedToken) {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];
    let providedToken = '';
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.substring(7).trim();
    } else if (typeof apiKey === 'string') {
      providedToken = apiKey.trim();
    }

    if (!providedToken || !timingSafeCompare(providedToken, expectedToken)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid Prometheus service token required' });
      return;
    }
  }

  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(metrics.getPrometheusMetrics());
});

// OpenAPI 3.1 Specification Endpoint
app.get('/api/v1/openapi.json', (_req, res) => {
  const specPath = path.resolve(__dirname, 'docs/openapi.json');
  res.sendFile(specPath);
});

// Interactive API Documentation Explorer
app.get('/api-docs', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Antigravity SMT MES - Interactive API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/v1/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true
    });
  </script>
</body>
</html>`);
});

// Sanitized Security Posture & Secrets Audit Endpoint (Protected by SECURITY_ADMIN capability)
app.get('/api/v1/security/audit', requirePermission(Permission.SECURITY_ADMIN), (_req, res) => {
  res.json({
    success: true,
    data: SecretsConfigManager.getSanitizedReport()
  });
});

// Deep Health check & readiness probes (public allowlist)
app.use(['/health', '/api/health', '/api/v1/health'], healthRouter);

// Static frontend serving if public/dist folder exists
const possiblePublicDirs = [
  process.env.PUBLIC_DIR,
  path.resolve(__dirname, 'public'),
  path.resolve(process.cwd(), 'public'),
  path.resolve(__dirname, '../../web/dist'),
  path.resolve(__dirname, '../web/dist')
].filter(Boolean) as string[];

for (const dir of possiblePublicDirs) {
  if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
    console.log(`[Static] Serving Cleanroom Web Cockpit from: ${dir}`);
    app.use(express.static(dir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/metrics') || req.path.startsWith('/health') || req.path.startsWith('/api-docs')) {
        return next();
      }
      res.sendFile(path.join(dir, 'index.html'));
    });
    break;
  }
}

function printBanner(port: string | number, fujiPort: number) {
  const line = '='.repeat(80);
  console.log(`\n${line}`);
  console.log('   🏭 ANTIGRAVITY SMT CLEANROOM MES - STANDALONE SIMULATOR & WORKSTATION');
  console.log('   Complete Event-Driven Manufacturing Execution System (Phases 1-6)');
  console.log(`${line}`);
  console.log(`  [System Architecture]  TypeScript + Node.js Engine (Dual Dialect SQLite / Postgres)`);
  console.log(`  [Operating Mode]        STANDALONE EMBEDDED SIMULATOR`);
  console.log(`  [Local Database]        ${process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'mes_local.db')}`);
  console.log(`  [Cleanroom Cockpit UI]  http://localhost:${port}/`);
  console.log(`  [Interactive API Docs]  http://localhost:${port}/api-docs`);
  console.log(`  [OpenAPI 3.1 Spec]      http://localhost:${port}/api/v1/openapi.json`);
  console.log(`  [Prometheus Metrics]    http://localhost:${port}/metrics`);
  console.log(`  [Fuji Nexim TCP Port]   tcp://localhost:${fujiPort}`);
  console.log(`${line}`);
  console.log('  [AVAILABLE CLEANROOM COCKPIT STATIONS]');
  console.log('   • Tab 1:  Operator Station        - SMT Assembly Line Execution & Barcode Dispatch');
  console.log('   • Tab 2:  Supervisor Dashboard    - eBR Electronic Batch Records & Part 11 Sign-off');
  console.log('   • Tab 3:  Traceability Genealogy  - Deep Component & PCB Panel Genealogy Trees');
  console.log('   • Tab 4:  Component Splicing      - Feeder Reel Setup, MSL Clocks & Interlocks');
  console.log('   • Tab 5:  Solder Paste & 3D SPI   - Stencil Lifespan, Inspection & Squeegee Tuning');
  console.log('   • Tab 6:  3D AOI & Defect Sentinel- Optical Inspection & Repeat Defect Production Halt');
  console.log('   • Tab 7:  Reflow Profiling (Ph.6) - KIC/Datapaq/MOLE PWI Engine & Oven Drift Actuation');
  console.log('   • Tab 8:  Autonomous AGV Fleet    - Floor Navigation, Missions & Replenishment Dispatch');
  console.log('   • Tab 9:  Predictive Intelligence - Weibull Reliability, SPC Cpk & Mahalanobis Distance');
  console.log('   • Tab 10: SRE & Topology Health   - System RED Metrics, Ingress Pipeline & SLO Status');
  console.log(`${line}`);
  console.log('  Press Ctrl+C at any time to gracefully shut down the simulator.\n');
}

function launchBrowser(url: string) {
  if (process.env.NO_BROWSER || process.env.CI || process.env.NODE_ENV === 'test') return;
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(cmd, () => {});
}

async function bootstrap() {
  try {
    console.log('[API] Bootstrapping Antigravity SMT MES Engine...');
    SecretsConfigManager.loadConfig();
    await initDatabase();

    // Check database population status
    const db = getDatabase();
    const countRows = await db.query<{ cnt: number | string }>('SELECT COUNT(*) as cnt FROM component_reels');
    const isEmpty = countRows.length === 0 || Number(countRows[0].cnt) === 0;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isEmpty) {
      if (!isProduction) {
        console.log('[API] Empty database detected in development mode, running initial seed...');
        await seedDatabase();
        await OnboardingService.setState('PRODUCTION_ACTIVE');
      } else {
        console.log('[API] Fresh production deployment detected. Auto-seed disabled. Awaiting bootstrap via /api/v1/auth/bootstrap.');
        await OnboardingService.setState('PROVISIONING_REQUIRED');
      }
    } else {
      await OnboardingService.refreshStateFromDb();
    }

    // Start Fuji Nexim TCP Socket Gateway (Default Port 30040)
    const PORT = parseInt(process.env.PORT || '4000', 10);
    const fujiPort = parseInt(process.env.FUJI_PORT || '30040', 10);
    fujiAdapter = new FujiNeximAdapter();
    fujiAdapter.startListener(fujiPort);
    setFujiAdapterForHealth(fujiAdapter);
    MachineControlModule.getInstance().registerAdapter(fujiAdapter);

    RepeatDefectSentinelService.registerFujiCommander(
      (reason: string) => fujiAdapter?.tripProductionHold(reason) ?? Promise.resolve(),
      () => fujiAdapter?.clearProductionHold() ?? Promise.resolve()
    );

    const server = app.listen(PORT, () => {
      printBanner(PORT, fujiPort);
      if (!process.env.CI && process.env.NODE_ENV !== 'test' && !process.env.HEADLESS) {
        launchBrowser(`http://localhost:${PORT}`);
      }
    });

    return server;
  } catch (err) {
    console.error('[API] Bootstrapping failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  bootstrap();
}

export { app, fujiAdapter, bootstrap, isAllowlisted, PUBLIC_ALLOWLIST };
