import fs from 'fs';
import path from 'path';
import { ComplianceLedgerService } from './compliance-ledger.service';

export interface SloStatus {
  id: string;
  name: string;
  target: number;
  currentSli: number;
  errorBudgetTotalPercent: number;
  errorBudgetRemainingPercent: number;
  burnRate1h: number;
  status: 'HEALTHY' | 'BURNING' | 'EXHAUSTED';
  alert: 'NONE' | 'PAGE_IMMEDIATE' | 'TICKET_INVESTIGATE';
}

export interface SloReport {
  timestamp: string;
  service: string;
  overallCompliance: boolean;
  slos: SloStatus[];
  errorBudgetPolicyActions: string[];
}

export class SloMonitorService {
  private static mockLatencySamples: number[] = [2.1, 1.8, 3.4, 2.9, 4.1, 2.2, 1.9, 3.0, 2.5, 2.8];
  private static mockQualityGateEvents: { total: number; failed: number } = { total: 1250, failed: 0 };

  /**
   * Records a latency sample for the Fuji frame ingestion SLI.
   */
  public static recordFujiLatency(latencyMs: number): void {
    this.mockLatencySamples.push(latencyMs);
    if (this.mockLatencySamples.length > 1000) {
      this.mockLatencySamples.shift();
    }
  }

  /**
   * Records a quality gate verification event (e.g. splice check).
   */
  public static recordQualityGateEvent(success: boolean): void {
    this.mockQualityGateEvents.total += 1;
    if (!success) {
      this.mockQualityGateEvents.failed += 1;
    }
  }

  /**
   * Evaluates current SLIs against configured SLO targets and computes error budget burn rates.
   */
  public static async evaluateSlos(): Promise<SloReport> {
    const now = new Date().toISOString();

    // 1. Fuji Frame Latency SLI (% of events < 10ms)
    const validLatencySamples = this.mockLatencySamples.filter(s => s <= 10).length;
    const totalLatencySamples = Math.max(1, this.mockLatencySamples.length);
    const latencySli = Math.round((validLatencySamples / totalLatencySamples) * 10000) / 100;
    const latencyTarget = 99.9;
    const latencyBudget = 100 - latencyTarget; // 0.1%
    const latencyBadRatio = 100 - latencySli;
    const latencyBudgetConsumed = Math.min(100, (latencyBadRatio / latencyBudget) * 100);
    const latencyBudgetRemaining = Math.max(0, 100 - latencyBudgetConsumed);
    const latencyBurnRate = latencyBudgetRemaining === 100 ? 0 : Math.round((latencyBadRatio / latencyBudget) * 14.4 * 10) / 10;

    // 2. SMT Quality Gate Interlock Availability SLI
    const qgTotal = Math.max(1, this.mockQualityGateEvents.total);
    const qgSuccess = qgTotal - this.mockQualityGateEvents.failed;
    const qgSli = Math.round((qgSuccess / qgTotal) * 10000) / 100;
    const qgTarget = 99.99;
    const qgBudget = 100 - qgTarget; // 0.01%
    const qgBadRatio = 100 - qgSli;
    const qgBudgetConsumed = Math.min(100, (qgBadRatio / qgBudget) * 100);
    const qgBudgetRemaining = Math.max(0, 100 - qgBudgetConsumed);
    const qgBurnRate = qgBudgetRemaining === 100 ? 0 : Math.round((qgBadRatio / qgBudget) * 14.4 * 10) / 10;

    // 3. 21 CFR Part 11 Audit Ledger Integrity SLI
    const ledgerCheck = await ComplianceLedgerService.verifyIntegrity();
    const ledgerSli = ledgerCheck.valid ? 100.0 : 0.0;
    const ledgerBudgetRemaining = ledgerCheck.valid ? 100.0 : 0.0;
    const ledgerBurnRate = ledgerCheck.valid ? 0.0 : 100.0;

    const slos: SloStatus[] = [
      {
        id: 'slo-fuji-ingestion-latency',
        name: 'Fuji Nexim TCP Socket Frame Ingestion Latency (<10ms)',
        target: latencyTarget,
        currentSli: latencySli,
        errorBudgetTotalPercent: latencyBudget,
        errorBudgetRemainingPercent: latencyBudgetRemaining,
        burnRate1h: latencyBurnRate,
        status: latencyBurnRate >= 14.4 ? 'BURNING' : (latencyBudgetRemaining === 0 ? 'EXHAUSTED' : 'HEALTHY'),
        alert: latencyBurnRate >= 14.4 ? 'PAGE_IMMEDIATE' : (latencyBurnRate >= 6.0 ? 'TICKET_INVESTIGATE' : 'NONE')
      },
      {
        id: 'slo-quality-gate-availability',
        name: 'SMT Interlock & Splice Verification Availability',
        target: qgTarget,
        currentSli: qgSli,
        errorBudgetTotalPercent: qgBudget,
        errorBudgetRemainingPercent: qgBudgetRemaining,
        burnRate1h: qgBurnRate,
        status: qgBurnRate >= 14.4 ? 'BURNING' : (qgBudgetRemaining === 0 ? 'EXHAUSTED' : 'HEALTHY'),
        alert: qgBurnRate >= 14.4 ? 'PAGE_IMMEDIATE' : (qgBurnRate >= 6.0 ? 'TICKET_INVESTIGATE' : 'NONE')
      },
      {
        id: 'slo-audit-ledger-integrity',
        name: '21 CFR Part 11 Compliance Ledger Integrity',
        target: 100.0,
        currentSli: ledgerSli,
        errorBudgetTotalPercent: 0.0,
        errorBudgetRemainingPercent: ledgerBudgetRemaining,
        burnRate1h: ledgerBurnRate,
        status: ledgerCheck.valid ? 'HEALTHY' : 'EXHAUSTED',
        alert: ledgerCheck.valid ? 'NONE' : 'PAGE_IMMEDIATE'
      }
    ];

    const overall = slos.every(s => s.status !== 'EXHAUSTED' && s.alert === 'NONE');

    return {
      timestamp: now,
      service: 'smt-mes-engine',
      overallCompliance: overall,
      slos,
      errorBudgetPolicyActions: [
        'Freeze non-critical production schema migrations if 30-day budget drops below 10%',
        'Halt automated background replays during peak shift operating hours',
        'Prioritize telemetry ingest and hardware interlock stability over ad-hoc reporting'
      ]
    };
  }
}
