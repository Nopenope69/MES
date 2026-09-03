import express from 'express';
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
import { FujiNeximAdapter } from './adapters/fuji-nexim.adapter';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
let fujiAdapter: FujiNeximAdapter | null = null;

app.use(cors());
app.use(express.json());

// Register API routes
app.use('/api/v1/events', eventsRouter);
app.use('/api/v1/work-centers', workCentersRouter);
app.use('/api/v1/batches', batchesRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/genealogy', genealogyRouter);
app.use('/api/v1/smt', smtRouter);

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
