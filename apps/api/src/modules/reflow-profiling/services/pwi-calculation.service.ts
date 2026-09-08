import {
  ReflowThermalSpecification,
  ReflowProfileProbe,
  CalculatedProfilePwi
} from '@mes/shared';
import { RawProfilerProbe } from '../adapters/profiler-importer.interface';

export interface ExtractedProbeMetrics {
  maxRampRateCPerSec: number;
  soakDurationSeconds: number;
  timeAboveLiquidusSeconds: number;
  peakTemperatureC: number;
  maxCoolingRateCPerSec: number;
}

export interface ProbePwiBreakdown {
  overall: number;
  ramp: number;
  soak: number;
  tal: number;
  peak: number;
  cooling: number;
}

export class PwiCalculationService {
  readonly calculationVersion = 'PWI-MIDPOINT-v1.0.0';

  /**
   * Linear interpolation for temperature threshold crossing.
   * Returns interpolated time in seconds, or null if no crossing exists.
   */
  findThresholdCrossing(
    samples: Array<{ timeSeconds: number; temperatureC: number }>,
    thresholdTempC: number,
    direction: 'UP' | 'DOWN',
    startIndex: number = 0,
    endIndex?: number
  ): number | null {
    if (!samples || samples.length < 2) return null;

    const lastIdx = endIndex !== undefined ? Math.min(endIndex, samples.length - 1) : samples.length - 1;

    for (let i = startIndex; i < lastIdx; i++) {
      const p1 = samples[i];
      const p2 = samples[i + 1];

      if (direction === 'UP') {
        if (p1.temperatureC <= thresholdTempC && p2.temperatureC > thresholdTempC) {
          const dt = p2.timeSeconds - p1.timeSeconds;
          const dTemp = p2.temperatureC - p1.temperatureC;
          if (dTemp === 0) return p1.timeSeconds;
          return p1.timeSeconds + dt * ((thresholdTempC - p1.temperatureC) / dTemp);
        }
      } else {
        if (p1.temperatureC >= thresholdTempC && p2.temperatureC < thresholdTempC) {
          const dt = p2.timeSeconds - p1.timeSeconds;
          const dTemp = p1.temperatureC - p2.temperatureC;
          if (dTemp === 0) return p1.timeSeconds;
          return p1.timeSeconds + dt * ((p1.temperatureC - thresholdTempC) / dTemp);
        }
      }
    }

    return null;
  }

  /**
   * Rolling least-squares linear regression slope.
   * Over a sliding window of windowSeconds, returns maximum positive slope or negative slope magnitude.
   */
  calculateRollingSlope(
    samples: Array<{ timeSeconds: number; temperatureC: number }>,
    windowSeconds: number = 5.0,
    startIndex: number = 0,
    endIndex?: number,
    mode: 'MAX_POSITIVE' | 'MAX_NEGATIVE_MAGNITUDE' = 'MAX_POSITIVE'
  ): number {
    if (!samples || samples.length < 2) return 0;

    const lastIdx = endIndex !== undefined ? Math.min(endIndex, samples.length - 1) : samples.length - 1;
    let maxSlope = 0;

    for (let i = startIndex; i <= lastIdx; i++) {
      const tStart = samples[i].timeSeconds;
      const windowPoints: Array<{ timeSeconds: number; temperatureC: number }> = [];

      for (let j = i; j <= lastIdx; j++) {
        if (samples[j].timeSeconds - tStart > windowSeconds) break;
        windowPoints.push(samples[j]);
      }

      if (windowPoints.length >= 2) {
        const n = windowPoints.length;
        let sumT = 0;
        let sumY = 0;
        let sumTY = 0;
        let sumTT = 0;

        for (const p of windowPoints) {
          sumT += p.timeSeconds;
          sumY += p.temperatureC;
          sumTY += p.timeSeconds * p.temperatureC;
          sumTT += p.timeSeconds * p.timeSeconds;
        }

        const denom = n * sumTT - sumT * sumT;
        if (denom !== 0) {
          const slope = (n * sumTY - sumT * sumY) / denom;
          if (mode === 'MAX_POSITIVE') {
            if (slope > maxSlope) maxSlope = slope;
          } else {
            const mag = Math.abs(slope);
            if (mag > maxSlope) maxSlope = mag;
          }
        }
      }
    }

    return Number(maxSlope.toFixed(3));
  }

  /**
   * Extract physical thermal characteristics from raw thermocouple samples.
   */
  extractMetrics(
    samples: Array<{ timeSeconds: number; temperatureC: number }>,
    spec: ReflowThermalSpecification
  ): ExtractedProbeMetrics {
    if (!samples || samples.length === 0) {
      return {
        maxRampRateCPerSec: 0,
        soakDurationSeconds: 0,
        timeAboveLiquidusSeconds: 0,
        peakTemperatureC: 0,
        maxCoolingRateCPerSec: 0
      };
    }

    // 1. Peak temperature and index
    let peakTemp = -Infinity;
    let peakIndex = 0;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].temperatureC > peakTemp) {
        peakTemp = samples[i].temperatureC;
        peakIndex = i;
      }
    }

    // 2. Soak duration: time from soak start temp up to soak end temp
    const soakStartTemp = spec.soak.minTempC;
    const soakEndTemp = spec.soak.maxTempC;
    const tSoakStart = this.findThresholdCrossing(samples, soakStartTemp, 'UP', 0, peakIndex);
    const tSoakEnd = tSoakStart !== null
      ? this.findThresholdCrossing(samples, soakEndTemp, 'UP', 0, peakIndex)
      : null;

    const soakDuration = (tSoakStart !== null && tSoakEnd !== null && tSoakEnd >= tSoakStart)
      ? Number((tSoakEnd - tSoakStart).toFixed(2))
      : 0;

    // 3. Time Above Liquidus (TAL)
    const liquidus = spec.tal.liquidusTempC;
    const tTalUp = this.findThresholdCrossing(samples, liquidus, 'UP', 0, peakIndex);
    const tTalDown = tTalUp !== null
      ? this.findThresholdCrossing(samples, liquidus, 'DOWN', peakIndex)
      : null;

    const talSeconds = (tTalUp !== null && tTalDown !== null && tTalDown >= tTalUp)
      ? Number((tTalDown - tTalUp).toFixed(2))
      : 0;

    // 4. Max Heating Ramp Rate (evaluation up to soakStartTemp or peak)
    const rampEndIdx = tSoakStart !== null
      ? samples.findIndex((s) => s.timeSeconds >= tSoakStart)
      : peakIndex;
    const maxRamp = this.calculateRollingSlope(
      samples,
      5.0,
      0,
      rampEndIdx > 0 ? rampEndIdx : peakIndex,
      'MAX_POSITIVE'
    );

    // 5. Max Cooling Rate (from peak to end)
    const maxCooling = this.calculateRollingSlope(
      samples,
      5.0,
      peakIndex,
      samples.length - 1,
      'MAX_NEGATIVE_MAGNITUDE'
    );

    return {
      maxRampRateCPerSec: maxRamp,
      soakDurationSeconds: soakDuration,
      timeAboveLiquidusSeconds: talSeconds,
      peakTemperatureC: Number(peakTemp.toFixed(2)),
      maxCoolingRateCPerSec: maxCooling
    };
  }

  /**
   * Calculate single characteristic PWI given bounds [LSL, USL].
   * PWI = (|measured - C| / W) * 100%
   */
  calculateStatisticPwi(measured: number, lsl: number, usl: number): number {
    if (usl <= lsl) {
      throw new Error(`INVALID_SPECIFICATION_BOUNDS: USL (${usl}) must be strictly greater than LSL (${lsl})`);
    }

    const center = (usl + lsl) / 2.0;
    const halfWindow = (usl - lsl) / 2.0;
    const pwi = (Math.abs(measured - center) / halfWindow) * 100.0;
    return Number(pwi.toFixed(2));
  }

  /**
   * Calculate PWI breakdown for a probe given its extracted metrics and specification.
   */
  calculateProbePwi(
    metrics: ExtractedProbeMetrics,
    spec: ReflowThermalSpecification
  ): ProbePwiBreakdown {
    const rampPwi = this.calculateStatisticPwi(
      metrics.maxRampRateCPerSec,
      spec.rampRate.minCPerSec,
      spec.rampRate.maxCPerSec
    );

    const soakPwi = this.calculateStatisticPwi(
      metrics.soakDurationSeconds,
      spec.soak.minSeconds,
      spec.soak.maxSeconds
    );

    const talPwi = this.calculateStatisticPwi(
      metrics.timeAboveLiquidusSeconds,
      spec.tal.minSeconds,
      spec.tal.maxSeconds
    );

    const peakPwi = this.calculateStatisticPwi(
      metrics.peakTemperatureC,
      spec.peak.minC,
      spec.peak.maxC
    );

    const coolingPwi = this.calculateStatisticPwi(
      metrics.maxCoolingRateCPerSec,
      spec.cooling.minCPerSec,
      spec.cooling.maxCPerSec
    );

    const overall = Math.max(rampPwi, soakPwi, talPwi, peakPwi, coolingPwi);

    return {
      overall: Number(overall.toFixed(2)),
      ramp: rampPwi,
      soak: soakPwi,
      tal: talPwi,
      peak: peakPwi,
      cooling: coolingPwi
    };
  }

  /**
   * Comprehensive PWI calculation across all probes of a profile run.
   */
  evaluateRun(
    probes: Array<RawProfilerProbe | ReflowProfileProbe>,
    spec: ReflowThermalSpecification
  ): CalculatedProfilePwi {
    if (!probes || probes.length === 0) {
      throw new Error('NO_PROBES: Cannot calculate PWI without at least one thermocouple probe');
    }

    let overallPwi = 0;
    let worstProbeIndex = probes[0].probeIndex;
    let worstChar: 'RAMP' | 'SOAK' | 'TAL' | 'PEAK' | 'COOLING' = 'PEAK';

    const probeResults = probes.map((p) => {
      // If probe already has metrics (e.g. from seed or DB), use them; otherwise extract from samples
      const metrics: ExtractedProbeMetrics = ('metrics' in p && p.metrics && p.metrics.peakTemperatureC > 0)
        ? p.metrics
        : this.extractMetrics(p.samples, spec);

      const pwi = this.calculateProbePwi(metrics, spec);

      if (pwi.overall > overallPwi) {
        overallPwi = pwi.overall;
        worstProbeIndex = p.probeIndex;

        // Determine which characteristic was worst on this probe
        let maxVal = -1;
        if (pwi.ramp > maxVal) { maxVal = pwi.ramp; worstChar = 'RAMP'; }
        if (pwi.soak > maxVal) { maxVal = pwi.soak; worstChar = 'SOAK'; }
        if (pwi.tal > maxVal) { maxVal = pwi.tal; worstChar = 'TAL'; }
        if (pwi.peak > maxVal) { maxVal = pwi.peak; worstChar = 'PEAK'; }
        if (pwi.cooling > maxVal) { maxVal = pwi.cooling; worstChar = 'COOLING'; }
      }

      return {
        probeIndex: p.probeIndex,
        label: p.label,
        metrics,
        pwi
      };
    });

    overallPwi = Number(overallPwi.toFixed(2));
    const processMarginPct = Number((100.0 - overallPwi).toFixed(2));

    let complianceResult: 'PASS' | 'WARNING' | 'FAIL';
    if (overallPwi <= 80.0) {
      complianceResult = 'PASS';
    } else if (overallPwi <= 100.0) {
      complianceResult = 'WARNING';
    } else {
      complianceResult = 'FAIL';
    }

    return {
      overallPwi,
      worstProbeIndex,
      worstCharacteristic: worstChar,
      complianceResult,
      processMarginPct,
      probes: probeResults
    };
  }
}
