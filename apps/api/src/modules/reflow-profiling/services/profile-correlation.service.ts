import { ProfileTelemetryCorrelation, ReflowProfileRun } from '@mes/shared';
import { IReflowProfileDataStore } from '../storage/reflow-profile.store.interface';
import { ITelemetryStore, TelemetryStore } from '../../../services/telemetry-store.service';

export class ProfileCorrelationService {
  constructor(
    private store: IReflowProfileDataStore,
    private telemetryStore: ITelemetryStore = TelemetryStore.getInstance()
  ) {}

  public async correlateProfileWithTelemetry(
    profileRunId: string,
    windowMinutes: number = 10
  ): Promise<ProfileTelemetryCorrelation> {
    const runResult = await this.store.getProfileRunById(profileRunId, false);
    if (!runResult) {
      throw new Error(`Profile run not found: ${profileRunId}`);
    }

    const { run } = runResult;
    const { lineId, equipmentId } = run.applicabilityKey;

    // Use imported_at or now as center of correlation window
    const centerTime = new Date(run.fileMetadata.uploadedAt || Date.now()).getTime();
    const halfWindowMs = (windowMinutes / 2) * 60 * 1000;
    const windowStart = new Date(centerTime - halfWindowMs).toISOString();
    const windowEnd = new Date(centerTime + halfWindowMs).toISOString();

    // Query line telemetry points for this equipment
    const points = await this.telemetryStore.getLineTelemetry(lineId, 'temperature_c', windowMinutes);
    const ovenPoints = points.filter((p) => !p.equipmentId || p.equipmentId === equipmentId);

    // Group by zone assetId (e.g. "zone-1", "zone-2"...)
    const zonePointsMap: Record<string, number[]> = {};
    for (const p of ovenPoints) {
      if (!zonePointsMap[p.assetId]) zonePointsMap[p.assetId] = [];
      zonePointsMap[p.assetId].push(p.value);
    }

    const zones: ProfileTelemetryCorrelation['zones'] = [];
    const zoneKeys = Object.keys(zonePointsMap).sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return na - nb;
    });

    for (let i = 0; i < zoneKeys.length; i++) {
      const zKey = zoneKeys[i];
      const vals = zonePointsMap[zKey];
      const zoneIdx = parseInt(zKey.replace(/\D/g, ''), 10) || i + 1;

      const sum = vals.reduce((a, b) => a + b, 0);
      const mean = vals.length > 0 ? sum / vals.length : 0;
      const variance = vals.length > 1
        ? vals.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (vals.length - 1)
        : 0;
      const stdDev = Math.sqrt(variance);
      const min = vals.length > 0 ? Math.min(...vals) : 0;
      const max = vals.length > 0 ? Math.max(...vals) : 0;

      zones.push({
        zoneIndex: zoneIdx,
        zoneName: `Zone ${zoneIdx}`,
        meanC: Number(mean.toFixed(2)),
        stdDevC: Number(stdDev.toFixed(2)),
        minC: Number(min.toFixed(2)),
        maxC: Number(max.toFixed(2))
      });
    }

    // Conveyor speed points
    const speedPoints = await this.telemetryStore.getLineTelemetry(lineId, 'speed_cm_per_min', windowMinutes);
    const ovenSpeedPoints = speedPoints.filter((p) => !p.equipmentId || p.equipmentId === equipmentId);
    const speedVals = ovenSpeedPoints.map((p) => p.value);
    const speedMean = speedVals.length > 0 ? speedVals.reduce((a, b) => a + b, 0) / speedVals.length : 90.0;
    const speedStdDev = speedVals.length > 1
      ? Math.sqrt(speedVals.reduce((acc, v) => acc + Math.pow(v - speedMean, 2), 0) / (speedVals.length - 1))
      : 0.1;

    // Expected sample count for e.g. 10 zones * 1 Hz * 600s = 6000 points
    const totalSamples = ovenPoints.length;
    const expectedSamples = Math.max(1, zones.length * (windowMinutes * 60) * 0.8);
    const integrityScore = Math.min(1.0, totalSamples / expectedSamples);

    const correlation: ProfileTelemetryCorrelation = {
      profileRunId,
      lineId,
      equipmentId,
      windowStart,
      windowEnd,
      sampleCount: totalSamples,
      telemetryIntegrityScore: Number(integrityScore.toFixed(4)),
      zones,
      conveyorSpeed: {
        meanCmPerMin: Number(speedMean.toFixed(2)),
        stdDevCmPerMin: Number(speedStdDev.toFixed(2)),
        minCmPerMin: speedVals.length > 0 ? Math.min(...speedVals) : 90.0,
        maxCmPerMin: speedVals.length > 0 ? Math.max(...speedVals) : 90.0
      }
    };

    await this.store.saveCorrelation(correlation);
    return correlation;
  }
}
