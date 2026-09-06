import express from 'express';
import path from 'path';
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
import { MetricsService } from './services/metrics.service';
import { FujiNeximAdapter } from './adapters/fuji-nexim.adapter';
import { securityHeadersMiddleware, SimpleRateLimiter } from './security/http-security';
import { SecretsConfigManager } from './config/secrets';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
let fujiAdapter: FujiNeximAdapter | null = null;
const metrics = MetricsService.getInstance();
const spliceRateLimiter = new SimpleRateLimiter(60000, 100);

// Enterprise Security Hardening Middleware
app.use(securityHeadersMiddleware);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
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

// Register API routes
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/work-centers', workCentersRouter);
app.use('/api/v1/batches', batchesRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/genealogy', genealogyRouter);
app.use('/api/v1/smt', smtRouter);
app.use('/api/v1/compliance', complianceRouter);
app.use('/api/v1/sre', sreRouter);

// Prometheus Metrics Endpoint
app.get('/metrics', (_req, res) => {
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

// Sanitized Security Posture & Secrets Audit Endpoint
app.get('/api/v1/security/audit', (_req, res) => {
  res.json({
    success: true,
    data: SecretsConfigManager.getSanitizedReport()
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'HEALTHY',
    system: 'Antigravity SMT MES Engine',
    timestamp: new Date().toISOString(),
    version: '0.2.0-smt'
  });
});

async function bootstrap() {
  try {
    console.log('[API] Bootstrapping Antigravity SMT MES Engine...');
    SecretsConfigManager.loadConfig();
    await initDatabase();

    // Auto-seed if database is unpopulated
    const db = getDatabase();
    const countRows = await db.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM component_reels');
    if (countRows.length === 0 || countRows[0].cnt === 0) {
      console.log('[API] Empty database detected, running initial seed...');
      await seedDatabase();
    }

    // Start Fuji Nexim TCP Socket Gateway (Default Port 30040)
    const fujiPort = parseInt(process.env.FUJI_PORT || '30040', 10);
    fujiAdapter = new FujiNeximAdapter();
    fujiAdapter.startListener(fujiPort);

    app.listen(PORT, () => {
      console.log(`[API] MES HTTP Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[API] Bootstrapping failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  bootstrap();
}

export { app, fujiAdapter };
