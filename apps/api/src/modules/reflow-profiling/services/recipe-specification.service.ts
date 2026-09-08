import { ReflowThermalSpecification } from '@mes/shared';
import { IReflowProfileDataStore } from '../storage/reflow-profile.store.interface';

export class RecipeSpecificationService {
  constructor(private store: IReflowProfileDataStore) {}

  public validateSpecification(spec: Partial<ReflowThermalSpecification>): void {
    if (!spec.recipeId) throw new Error('VALIDATION_ERROR: recipeId is required');
    if (!spec.boardPartNumber) throw new Error('VALIDATION_ERROR: boardPartNumber is required');
    if (!spec.boardRevision) throw new Error('VALIDATION_ERROR: boardRevision is required');

    // Ramp rate
    if (!spec.rampRate || spec.rampRate.minCPerSec >= spec.rampRate.maxCPerSec || spec.rampRate.minCPerSec <= 0) {
      throw new Error('VALIDATION_ERROR: rampRate.minCPerSec must be positive and less than maxCPerSec');
    }

    // Soak
    if (!spec.soak || spec.soak.minTempC >= spec.soak.maxTempC) {
      throw new Error('VALIDATION_ERROR: soak.minTempC must be strictly less than soak.maxTempC');
    }
    if (spec.soak.minSeconds >= spec.soak.maxSeconds || spec.soak.minSeconds <= 0) {
      throw new Error('VALIDATION_ERROR: soak.minSeconds must be positive and less than soak.maxSeconds');
    }

    // TAL
    if (!spec.tal || spec.tal.liquidusTempC <= 0) {
      throw new Error('VALIDATION_ERROR: tal.liquidusTempC must be positive');
    }
    if (spec.tal.minSeconds >= spec.tal.maxSeconds || spec.tal.minSeconds <= 0) {
      throw new Error('VALIDATION_ERROR: tal.minSeconds must be positive and less than tal.maxSeconds');
    }

    // Peak
    if (!spec.peak || spec.peak.minC >= spec.peak.maxC) {
      throw new Error('VALIDATION_ERROR: peak.minC must be strictly less than peak.maxC');
    }

    // Cooling
    if (!spec.cooling || spec.cooling.minCPerSec >= spec.cooling.maxCPerSec || spec.cooling.minCPerSec <= 0) {
      throw new Error('VALIDATION_ERROR: cooling.minCPerSec must be positive and less than cooling.maxCPerSec');
    }

    // Conveyor speed
    if (!spec.conveyorSpeedLimit || spec.conveyorSpeedLimit.minCmPerMin >= spec.conveyorSpeedLimit.maxCmPerMin || spec.conveyorSpeedLimit.minCmPerMin <= 0) {
      throw new Error('VALIDATION_ERROR: conveyorSpeedLimit.minCmPerMin must be positive and less than maxCmPerMin');
    }

    // Oxygen control (if present)
    if (spec.oxygenControl) {
      if (spec.oxygenControl.targetPpm <= 0 || spec.oxygenControl.tolerancePpm <= 0) {
        throw new Error('VALIDATION_ERROR: oxygenControl target and tolerance must be positive');
      }
      if (spec.oxygenControl.maxPpm !== undefined && spec.oxygenControl.maxPpm <= spec.oxygenControl.targetPpm) {
        throw new Error('VALIDATION_ERROR: oxygenControl.maxPpm must be greater than targetPpm');
      }
    }

    // Tolerances and variance limits
    if (spec.zoneTolerancesC !== undefined && spec.zoneTolerancesC <= 0) {
      throw new Error('VALIDATION_ERROR: zoneTolerancesC must be positive');
    }
    if (spec.variabilityLimitC !== undefined && spec.variabilityLimitC <= 0) {
      throw new Error('VALIDATION_ERROR: variabilityLimitC must be positive');
    }
    if (spec.minimumSigmaC !== undefined && spec.minimumSigmaC <= 0) {
      throw new Error('VALIDATION_ERROR: minimumSigmaC must be positive');
    }
  }

  public async registerSpecification(
    params: Omit<ReflowThermalSpecification, 'id' | 'specificationVersion' | 'status' | 'createdAt'>
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

    const newSpec: ReflowThermalSpecification = {
      ...params,
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
