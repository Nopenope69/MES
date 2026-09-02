import { ShiftSummaryReport } from '@mes/shared';
import { getDatabase } from '../db/database';

export class OeeReportService {
  /**
   * Generates a shift-level OEE and downtime Pareto breakdown.
   */
  public static async getShiftSummary(workCenterId?: string, shiftCode = 'SHIFT_A'): Promise<ShiftSummaryReport> {
    const db = getDatabase();
    const todayStr = new Date().toISOString().split('T')[0];

    // 1. Shift duration (assume standard 8-hour shift = 480 mins)
    const totalPlannedMinutes = 480;

    // 2. Fetch all downtime slices for today
    let downtimeSql = `
      SELECT 
        COALESCE(da.reason_code, esl.current_state) as reason_code,
        COALESCE(da.reason_category, 'OTHER') as category,
        COALESCE(da.comment, '') as comment,
        COALESCE(SUM(esl.duration_seconds), 0) as total_seconds,
        COUNT(esl.id) as occurrences
      FROM equipment_state_logs esl
      LEFT JOIN downtime_attributions da ON esl.id = da.state_log_id
      WHERE esl.current_state IN ('STOPPED_UNPLANNED', 'STOPPED_PLANNED', 'CHANGEOVER', 'MAINTENANCE')
    `;
    const params: any[] = [];

    if (workCenterId) {
      downtimeSql += ' AND esl.work_center_id = ?';
      params.push(workCenterId);
    }

    downtimeSql += ' GROUP BY da.reason_code, da.reason_category, da.comment ORDER BY total_seconds DESC';

    const downtimeRows = await db.query(downtimeSql, params);

    let totalDowntimeSeconds = 0;
    const topDowntimeReasons = downtimeRows.map((r: any) => {
      const minutes = Math.round(Number(r.total_seconds) / 60);
      totalDowntimeSeconds += Number(r.total_seconds);
      return {
        reasonCode: r.reason_code || 'UNSPECIFIED',
        reasonLabel: r.comment ? `${r.reason_code}: ${r.comment}` : (r.reason_code || 'Unspecified Stoppage'),
        category: r.category,
        durationMinutes: minutes,
        occurrences: Number(r.occurrences)
      };
    });

    const downtimeMinutes = Math.min(totalPlannedMinutes, Math.round(totalDowntimeSeconds / 60));
    const operatingMinutes = Math.max(0, totalPlannedMinutes - downtimeMinutes);
    const availabilityPercentage = Math.round((operatingMinutes / totalPlannedMinutes) * 100);

    // 3. Output counts
    let batchSql = 'SELECT SUM(actual_quantity) as good_qty, SUM(rejected_quantity) as rej_qty, COUNT(id) as batch_count FROM batches WHERE 1=1';
    const batchParams: any[] = [];
    if (workCenterId) {
      batchSql += ' AND work_center_id = ?';
      batchParams.push(workCenterId);
    }

    const batchStats = await db.query(batchSql, batchParams);
    const goodQuantity = Number(batchStats[0]?.good_qty || 0);
    const rejectedQuantity = Number(batchStats[0]?.rej_qty || 0);
    const batchesCompleted = Number(batchStats[0]?.batch_count || 0);

    const totalProduced = goodQuantity + rejectedQuantity;
    const qualityPercentage = totalProduced > 0 ? Math.round((goodQuantity / totalProduced) * 100) : 100;

    return {
      shiftCode,
      date: todayStr,
      totalPlannedMinutes,
      operatingMinutes,
      downtimeMinutes,
      availabilityPercentage,
      goodQuantity,
      rejectedQuantity,
      qualityPercentage,
      batchesCompleted,
      topDowntimeReasons: topDowntimeReasons.slice(0, 5) // Top 5 Pareto
    };
  }
}
