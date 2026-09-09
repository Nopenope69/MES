import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { app } from '../src/server';
import { initDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { MetricsService } from '../src/services/metrics.service';
import { SloMonitorService } from '../src/services/slo-monitor.service';
import { ChaosInjectionService } from '../src/services/chaos-injection.service';
import { TokenManager } from '../src/security/jwt';

describe('Track E: Observability, SRE & Chaos Engineering Suite', () => {
  let server: http.Server;
  let baseUrl: string;
  let adminToken: string;
  const rootDir = path.resolve(__dirname, '../../..');

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    adminToken = TokenManager.generateAccessToken({
      sub: 'admin-01',
      code: 'SYS-ADMIN-01',
      name: 'SRE System Admin',
      role: 'SYSTEM_ADMIN',
      org: 'org-dixon',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('collects and formats Prometheus metrics for SMT telemetry and HTTP RED signals', () => {
    const metrics = MetricsService.getInstance();

    metrics.smtPlacementsTotal.inc({ line: 'LINE-01', module: 1 }, 100);
    metrics.fujiFramesTotal.inc({ direction: 'inbound', status: 'OK' }, 25);
    metrics.smtCurrentCph.set({ work_center: 'wc-nxt-01' }, 72500);
    metrics.fujiActiveConnections.set(2);
    metrics.fujiFrameLatency.observe({ line: 'LINE-01' }, 0.0035);

    const output = metrics.getPrometheusMetrics();

    expect(output).toContain('# HELP smt_placements_total');
    expect(output).toContain('# TYPE smt_placements_total counter');
    expect(output).toContain('smt_placements_total{line="LINE-01",module="1"} 100');

    expect(output).toContain('# HELP smt_current_cph');
    expect(output).toContain('smt_current_cph{work_center="wc-nxt-01"} 72500');

    expect(output).toContain('# HELP smt_fuji_frame_latency_seconds');
    expect(output).toContain('smt_fuji_frame_latency_seconds_bucket');
    expect(output).toContain('smt_fuji_frame_latency_seconds_count');
  });

  it('exposes /metrics endpoint formatted in Prometheus 2.0 text exposition standard', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const text = await res.text();
    expect(text).toContain('smt_placements_total');
    expect(text).toContain('smt_fuji_frames_total');
    expect(text).toContain('http_requests_total');
    expect(text).toContain('smt_ledger_integrity_status');
  });

  it('evaluates SLO compliance, error budgets, and multi-window burn rates', async () => {
    // Record sample telemetry
    SloMonitorService.recordFujiLatency(2.4);
    SloMonitorService.recordFujiLatency(3.1);
    SloMonitorService.recordQualityGateEvent(true);

    const report = await SloMonitorService.evaluateSlos();

    expect(report.service).toBe('smt-mes-engine');
    expect(report.slos.length).toBe(3);

    const latencySlo = report.slos.find(s => s.id === 'slo-fuji-ingestion-latency');
    expect(latencySlo).toBeDefined();
    expect(latencySlo?.target).toBe(99.9);
    expect(latencySlo?.currentSli).toBeGreaterThanOrEqual(99.0);
    expect(latencySlo?.errorBudgetRemainingPercent).toBeGreaterThan(0);

    const ledgerSlo = report.slos.find(s => s.id === 'slo-audit-ledger-integrity');
    expect(ledgerSlo).toBeDefined();
    expect(ledgerSlo?.target).toBe(100.0);
    expect(ledgerSlo?.currentSli).toBe(100.0);

    // Verify REST API endpoint /api/v1/sre/slos
    const apiRes = await fetch(`${baseUrl}/api/v1/sre/slos`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(apiRes.status).toBe(200);
    const apiData = await apiRes.json();
    expect(apiData.success).toBe(true);
    expect(apiData.data.slos.length).toBe(3);
  });

  it('executes controlled chaos experiments and triggers automated safety aborts', async () => {
    // 1. Successful bounded latency experiment
    const passResult = await ChaosInjectionService.runExperiment({
      experimentId: 'exp-network-jitter-01',
      target: 'fuji-socket-gateway',
      hypothesis: 'Frame accumulator handles +50ms jitter without frame drops',
      attackType: 'CHAOS_NETWORK_JITTER',
      durationSeconds: 5,
      blastRadius: {
        workCenterId: 'wc-nxt-01',
        trafficSharePercent: 10
      },
      abortCriteria: {
        maxBurnRate: 14.4,
        maxFailedEvents: 5
      }
    });

    expect(passResult.status).toBe('PASSED');
    expect(passResult.abortTriggered).toBe(false);
    expect(passResult.postmortem).toContain('Hypothesis verified');

    // 2. Experiment that trips safety abort criteria
    const abortResult = await ChaosInjectionService.runExperiment({
      experimentId: 'exp-db-timeout-02',
      target: 'event-ingestion-db',
      hypothesis: 'System tolerates database lock without exceeding error budget',
      attackType: 'CHAOS_DB_TRANSIENT_TIMEOUT',
      durationSeconds: 10,
      blastRadius: {
        trafficSharePercent: 50
      },
      abortCriteria: {
        maxBurnRate: 14.4,
        maxFailedEvents: 3 // Will be exceeded by 5th cycle
      }
    });

    expect(abortResult.status).toBe('ABORTED');
    expect(abortResult.abortTriggered).toBe(true);
    expect(abortResult.abortReason).toContain('Safety abort triggered');
    expect(abortResult.postmortem).toContain('Safety abort triggered');

    // 3. Verify REST API endpoint /api/v1/sre/chaos/run
    const apiRes = await fetch(`${baseUrl}/api/v1/sre/chaos/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        experimentId: 'exp-api-test-01',
        target: 'work-center-nxt',
        attackType: 'CHAOS_NETWORK_JITTER',
        durationSeconds: 2,
        blastRadius: { trafficSharePercent: 5 },
        abortCriteria: { maxBurnRate: 14.4, maxFailedEvents: 10 }
      })
    });

    expect(apiRes.status).toBe(200);
    const apiData = await apiRes.json();
    expect(apiData.success).toBe(true);
    expect(apiData.data.status).toBe('PASSED');
  });

  it('provides operational runbooks for SEV1/SEV2 factory incident response', () => {
    const runbookDir = path.join(rootDir, 'deploy/sre/runbooks');

    const rb1 = path.join(runbookDir, 'RUNBOOK-01-FUJI-SOCKET-DISCONNECT.md');
    const rb2 = path.join(runbookDir, 'RUNBOOK-02-LEDGER-HASH-BREAK.md');
    const rb3 = path.join(runbookDir, 'RUNBOOK-03-MSL-EXPIRY-CONTAINMENT.md');

    expect(fs.existsSync(rb1)).toBe(true);
    expect(fs.existsSync(rb2)).toBe(true);
    expect(fs.existsSync(rb3)).toBe(true);

    const c1 = fs.readFileSync(rb1, 'utf-8');
    expect(c1).toContain('SEV1 (Line Stoppage)');
    expect(c1).toContain('lsof -i :30040');

    const c2 = fs.readFileSync(rb2, 'utf-8');
    expect(c2).toContain('21 CFR Part 11');
    expect(c2).toContain('compliance_audit_ledger');

    const c3 = fs.readFileSync(rb3, 'utf-8');
    expect(c3).toContain('JEDEC J-STD-033D');
    expect(c3).toContain('msl_bake_profiles');
  });
});
