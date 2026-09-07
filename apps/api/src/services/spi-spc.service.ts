import { SpiSpcMetrics } from '@mes/shared';
import { getDatabase } from '../db/database';
import { PrinterControlService } from './printer-control.service';

export class SpiSpcService {
  /**
   * Calculates statistically defensible SPC metrics for an SMT recipe or program.
   * Cpk and Ppk are computed ONLY when sample size N >= 30.
   */
  public static async calculateSpc(recipeId: string = 'PROG-SM-METER-TOP-REV4', limit: number = 100): Promise<SpiSpcMetrics> {
    const db = getDatabase();
    const processWindow = await PrinterControlService.getProcessWindow(recipeId);

    const usl = processWindow.volumeUpperLimitPct || 135.0;
    const lsl = processWindow.volumeLowerLimitPct || 75.0;

    // Fetch recent inspections filtered by recipe
    let querySql = `
      SELECT s.mean_volume_pct FROM spi_inspections s
      LEFT JOIN batches b ON s.batch_id = b.id
      WHERE s.mean_volume_pct IS NOT NULL
    `;
    const queryParams: any[] = [];

    if (recipeId) {
      querySql += ` AND (b.recipe_code = ? OR s.batch_id = ? OR s.batch_id IS NULL)`;
      queryParams.push(recipeId, recipeId);
    }

    querySql += ` ORDER BY s.inspected_at DESC LIMIT ?`;
    queryParams.push(limit);

    const rows = await db.query<{
      mean_volume_pct: number;
    }>(querySql, queryParams);

    const samples = rows.map((r) => Number(r.mean_volume_pct)).filter((v) => !isNaN(v) && v > 0);
    const n = samples.length;

    if (n === 0) {
      return {
        sampleCount: 0,
        isStatisticallyValid: false,
        meanVolumePct: 100.0,
        sigmaVolumePct: 0.0,
        trend: 'STABLE',
        usl,
        lsl
      };
    }

    const mean = samples.reduce((acc, v) => acc + v, 0) / n;

    let sigma = 0;
    if (n > 1) {
      const variance = samples.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1);
      sigma = Math.sqrt(variance);
    }

    let trend: 'STABLE' | 'DRIFTING_LOW' | 'DRIFTING_HIGH' | 'INCREASED_VARIABILITY' = 'STABLE';
    if (sigma > 12.0) {
      trend = 'INCREASED_VARIABILITY';
    } else if (mean < 92.0) {
      trend = 'DRIFTING_LOW';
    } else if (mean > 108.0) {
      trend = 'DRIFTING_HIGH';
    }

    // Pillar 9: Cpk/Ppk calculated ONLY when statistically valid (N >= 30)
    const isStatisticallyValid = n >= 30;

    let cp: number | undefined;
    let cpk: number | undefined;
    let pp: number | undefined;
    let ppk: number | undefined;

    if (isStatisticallyValid && sigma > 0.0001) {
      cp = Number(((usl - lsl) / (6 * sigma)).toFixed(2));
      const cpu = (usl - mean) / (3 * sigma);
      const cpl = (mean - lsl) / (3 * sigma);
      cpk = Number(Math.min(cpu, cpl).toFixed(2));
      pp = cp;
      ppk = cpk;
    }

    return {
      sampleCount: n,
      isStatisticallyValid,
      meanVolumePct: Number(mean.toFixed(2)),
      sigmaVolumePct: Number(sigma.toFixed(2)),
      cp,
      cpk,
      pp,
      ppk,
      trend,
      usl,
      lsl
    };
  }
}
