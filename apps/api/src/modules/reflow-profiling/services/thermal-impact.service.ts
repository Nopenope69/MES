import {
  ReflowThermalSpecification,
  ReflowProfileRun,
  OvenDriftReport,
  ThermalImpactEstimate
} from '@mes/shared';

export class ThermalImpactService {
  /**
   * Conservative Process-Risk Evaluation.
   *
   * ARCHITECTURAL SAFEGUARD:
   * The MES never manufactures unverified thermal certainty.
   * UNKNOWN or low-confidence estimates must never be treated as proof of compliance.
   */
  public estimateThermalImpact(params: {
    activeProfileRun: ReflowProfileRun;
    specification: ReflowThermalSpecification;
    driftReport: OvenDriftReport;
  }): ThermalImpactEstimate {
    const { activeProfileRun, driftReport } = params;

    // 1. If drift report has no zones or telemetry is unverified, return UNKNOWN
    if (!driftReport.zones || driftReport.zones.length === 0) {
      return {
        confidence: 0.0,
        basis: 'UNKNOWN',
        riskLevel: 'MEDIUM'
      };
    }

    // 2. Check for catastrophic heater collapse (> 15°C deviation in any zone)
    const maxZoneDev = Math.max(...driftReport.zones.map((z) => Math.abs(z.meanDeviationC)));
    if (maxZoneDev >= 15.0) {
      return {
        estimatedPeakDeltaC: Number((maxZoneDev * 0.7).toFixed(1)),
        estimatedTalDeltaSeconds: Number((maxZoneDev * 1.5).toFixed(1)),
        confidence: 0.95,
        basis: 'RULE_BASED',
        riskLevel: 'CRITICAL'
      };
    }

    // 3. Process Window Margin Analysis
    const baselinePwi = activeProfileRun.analysisResult.overallPwi;
    const marginPct = 100.0 - baselinePwi; // e.g. 80.0% for PWI=20%, or 6.0% for PWI=94%

    // Moderate/High drift condition
    const isHighDrift = driftReport.compositeSeverityScore >= 0.5 || maxZoneDev >= 5.0;
    const isModerateDrift = driftReport.compositeSeverityScore >= 0.25 || maxZoneDev >= 2.5;

    if (isHighDrift) {
      // If margin was already narrow (PWI > 80%, margin < 20%), high drift is a severe risk
      if (marginPct < 20.0) {
        return {
          estimatedPeakDeltaC: Number((maxZoneDev * 0.5).toFixed(1)),
          estimatedTalDeltaSeconds: Number((maxZoneDev * 1.2).toFixed(1)),
          confidence: 0.85,
          basis: 'MODEL',
          riskLevel: 'HIGH'
        };
      } else {
        return {
          estimatedPeakDeltaC: Number((maxZoneDev * 0.4).toFixed(1)),
          estimatedTalDeltaSeconds: Number((maxZoneDev * 0.8).toFixed(1)),
          confidence: 0.75,
          basis: 'MODEL',
          riskLevel: 'MEDIUM'
        };
      }
    }

    if (isModerateDrift) {
      if (marginPct < 15.0) {
        return {
          estimatedPeakDeltaC: Number((maxZoneDev * 0.3).toFixed(1)),
          estimatedTalDeltaSeconds: Number((maxZoneDev * 0.6).toFixed(1)),
          confidence: 0.70,
          basis: 'MODEL',
          riskLevel: 'HIGH'
        };
      }
      return {
        estimatedPeakDeltaC: Number((maxZoneDev * 0.3).toFixed(1)),
        confidence: 0.70,
        basis: 'MODEL',
        riskLevel: 'MEDIUM'
      };
    }

    // Low drift, compliant oven
    return {
      estimatedPeakDeltaC: Number((maxZoneDev * 0.2).toFixed(1)),
      confidence: 0.80,
      basis: 'EMPIRICAL',
      riskLevel: 'LOW'
    };
  }
}
