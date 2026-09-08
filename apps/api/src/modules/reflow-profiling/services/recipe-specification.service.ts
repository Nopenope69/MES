import { ReflowThermalSpecification } from '@mes/shared';
import { IReflowProfileDataStore } from '../storage/reflow-profile.store.interface';

export class RecipeSpecificationService {
  constructor(private store: IReflowProfileDataStore) {}

  public validateSpecification(spec: Partial<ReflowThermalSpecification>): void {
    if (!spec.recipeId) throw new Error('INVALID_SPECIFICATION_BOUNDS: recipeId is required');
    if (!spec.boardPartNumber) throw new Error('INVALID_SPECIFICATION_BOUNDS: boardPartNumber is required');
    if (!spec.boardRevision) throw new Error('INVALID_SPECIFICATION_BOUNDS: boardRevision is required');

    // Ramp rate
    const anyRamp = (spec as any).rampRate || {};
    const minRamp = anyRamp.minCPerSec ?? anyRamp.minSlopeCPerSec;
    const maxRamp = anyRamp.maxCPerSec ?? anyRamp.maxSlopeCPerSec;
    if (minRamp === undefined || maxRamp === undefined || minRamp >= maxRamp || minRamp <= 0) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: rampRate.minCPerSec must be positive and less than maxCPerSec');
    }

    // Soak
    const anySoak = (spec as any).soak || {};
    const minSoakSec = anySoak.minSeconds ?? anySoak.minDurationSeconds;
    const maxSoakSec = anySoak.maxSeconds ?? anySoak.maxDurationSeconds;
    if (anySoak.minTempC >= anySoak.maxTempC) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: soak.minTempC must be strictly less than soak.maxTempC');
    }
    if (minSoakSec === undefined || maxSoakSec === undefined || minSoakSec >= maxSoakSec || minSoakSec <= 0) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: soak.minSeconds must be positive and less than soak.maxSeconds');
    }

    // TAL
    const anyTal = (spec as any).tal || {};
    const minTalSec = anyTal.minSeconds ?? anyTal.minDurationSeconds;
    const maxTalSec = anyTal.maxSeconds ?? anyTal.maxDurationSeconds;
    if (!anyTal.liquidusTempC || anyTal.liquidusTempC <= 0) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: tal.liquidusTempC must be positive');
    }
    if (minTalSec === undefined || maxTalSec === undefined || minTalSec >= maxTalSec || minTalSec <= 0) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: tal.minSeconds must be positive and less than tal.maxSeconds');
    }

    // Peak
    const anyPeak = (spec as any).peak || (spec as any).peakTemperature || {};
    const minPeak = anyPeak.minC ?? anyPeak.minPeakTempC;
    const maxPeak = anyPeak.maxC ?? anyPeak.maxPeakTempC;
    if (minPeak === undefined || maxPeak === undefined || minPeak >= maxPeak) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: peak.minC must be strictly less than peak.maxC');
    }

    // Cooling
    const anyCool = (spec as any).cooling || (spec as any).coolingRate || {};
    const minCool = anyCool.minCPerSec ?? anyCool.minSlopeCPerSec;
    const maxCool = anyCool.maxCPerSec ?? anyCool.maxSlopeCPerSec;
    if (minCool === undefined || maxCool === undefined || minCool >= maxCool || minCool <= 0) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: cooling.minCPerSec must be positive and less than cooling.maxCPerSec');
    }

    // Conveyor speed
    if (spec.conveyorSpeedLimit) {
      if (spec.conveyorSpeedLimit.minCmPerMin >= spec.conveyorSpeedLimit.maxCmPerMin || spec.conveyorSpeedLimit.minCmPerMin <= 0) {
        throw new Error('INVALID_SPECIFICATION_BOUNDS: conveyorSpeedLimit.minCmPerMin must be positive and less than maxCmPerMin');
      }
    }

    // Oxygen control (if present)
    if (spec.oxygenControl) {
      if (spec.oxygenControl.targetPpm <= 0 || spec.oxygenControl.tolerancePpm <= 0) {
        throw new Error('INVALID_SPECIFICATION_BOUNDS: oxygenControl target and tolerance must be positive');
      }
      if (spec.oxygenControl.maxPpm !== undefined && spec.oxygenControl.maxPpm <= spec.oxygenControl.targetPpm) {
        throw new Error('INVALID_SPECIFICATION_BOUNDS: oxygenControl.maxPpm must be greater than targetPpm');
      }
    }

    // Tolerances and variance limits
    if (spec.zoneTolerancesC !== undefined && spec.zoneTolerancesC <= 0) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: zoneTolerancesC must be positive');
    }
    if (spec.variabilityLimitC !== undefined && spec.variabilityLimitC <= 0) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: variabilityLimitC must be positive');
    }
    if (spec.minimumSigmaC !== undefined && spec.minimumSigmaC <= 0) {
      throw new Error('INVALID_SPECIFICATION_BOUNDS: minimumSigmaC must be positive');
    }
  }

  public async createSpecification(params: any): Promise<ReflowThermalSpecification> {
    return this.registerSpecification(params);
  }

  public async registerSpecification(
    params: any
  ): Promise<ReflowThermalSpecification> {
    this.validateSpecification(params);

    const existingLatest = await this.store.getSpecification(
      params.recipeId,
      params.boardPartNumber,
      params.boardRevision
    );

    const version = existingLatest ? existingLatest.specificationVersion + 1 : 1;

    // Retire previous version if it was ACTIVE
    if (existingLatest && existingLatest.status === 'ACTIVE') {
      existingLatest.status = 'RETIRED';
      await this.store.saveSpecification(existingLatest);
    }

    const anyRamp = params.rampRate || {};
    const anySoak = params.soak || {};
    const anyTal = params.tal || {};
    const anyPeak = params.peak || params.peakTemperature || {};
    const anyCool = params.cooling || params.coolingRate || {};

    const normalizedRamp = {
      minCPerSec: anyRamp.minCPerSec ?? anyRamp.minSlopeCPerSec,
      maxCPerSec: anyRamp.maxCPerSec ?? anyRamp.maxSlopeCPerSec,
      targetCPerSec: anyRamp.targetCPerSec ?? (anyRamp.minCPerSec + anyRamp.maxCPerSec) / 2,
      evaluationStartTempC: anyRamp.evaluationStartTempC ?? 30,
      evaluationEndTempC: anyRamp.evaluationEndTempC ?? anySoak.minTempC ?? 150
    };

    const normalizedSoak = {
      minTempC: anySoak.minTempC,
      maxTempC: anySoak.maxTempC,
      minSeconds: anySoak.minSeconds ?? anySoak.minDurationSeconds,
      maxSeconds: anySoak.maxSeconds ?? anySoak.maxDurationSeconds,
      targetSeconds: anySoak.targetSeconds ?? ((anySoak.minSeconds ?? anySoak.minDurationSeconds) + (anySoak.maxSeconds ?? anySoak.maxDurationSeconds)) / 2
    };

    const normalizedTal = {
      liquidusTempC: anyTal.liquidusTempC,
      minSeconds: anyTal.minSeconds ?? anyTal.minDurationSeconds,
      maxSeconds: anyTal.maxSeconds ?? anyTal.maxDurationSeconds,
      targetSeconds: anyTal.targetSeconds ?? ((anyTal.minSeconds ?? anyTal.minDurationSeconds) + (anyTal.maxSeconds ?? anyTal.maxDurationSeconds)) / 2
    };

    const normalizedPeak = {
      minC: anyPeak.minC ?? anyPeak.minPeakTempC,
      maxC: anyPeak.maxC ?? anyPeak.maxPeakTempC,
      targetC: anyPeak.targetC ?? ((anyPeak.minC ?? anyPeak.minPeakTempC) + (anyPeak.maxC ?? anyPeak.maxPeakTempC)) / 2
    };

    const normalizedCooling = {
      minCPerSec: anyCool.minCPerSec ?? anyCool.minSlopeCPerSec,
      maxCPerSec: anyCool.maxCPerSec ?? anyCool.maxSlopeCPerSec,
      evaluationStartTempC: anyCool.evaluationStartTempC ?? normalizedPeak.targetC,
      evaluationEndTempC: anyCool.evaluationEndTempC ?? normalizedTal.liquidusTempC
    };

    const normalizedConveyor = params.conveyorSpeedLimit || {
      minCmPerMin: 80,
      maxCmPerMin: 100,
      targetCmPerMin: 90,
      toleranceCmPerMin: 2.0
    };

    const newSpec: ReflowThermalSpecification = {
      ...params,
      rampRate: normalizedRamp,
      soak: normalizedSoak,
      tal: normalizedTal,
      peak: normalizedPeak,
      cooling: normalizedCooling,
      conveyorSpeedLimit: normalizedConveyor,
      id: `spec-${params.recipeId.toLowerCase()}-${params.boardPartNumber.toLowerCase()}-v${version}`,
      specificationVersion: version,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      zoneTolerancesC: params.zoneTolerancesC || 2.5,
      variabilityLimitC: params.variabilityLimitC || 1.2,
      minimumSigmaC: params.minimumSigmaC || 0.5
    };

    await this.store.saveSpecification(newSpec);
    return newSpec;
  }

  public async getSpecification(
    recipeId: string,
    boardPartNumber: string,
    boardRevision: string,
    version?: number
  ): Promise<ReflowThermalSpecification | null> {
    return this.store.getSpecification(recipeId, boardPartNumber, boardRevision, version);
  }

  public async getActiveSpecification(
    recipeId: string,
    boardPartNumber: string,
    boardRevision: string
  ): Promise<ReflowThermalSpecification | null> {
    return this.store.getActiveSpecification(recipeId, boardPartNumber, boardRevision);
  }
}
