import { v4 as uuidv4 } from 'uuid';
import {
  ReflowProfileRun,
  ReflowProfileApprovedPayload,
  ReflowProfileRejectedPayload,
  ReflowProfileActivatedPayload,
  MesEventEnvelope
} from '@mes/shared';
import { IReflowProfileDataStore } from '../storage/reflow-profile.store.interface';
import { EventStoreModule } from '../../event-store/event-store.module';

export class ProfileLifecycleService {
  constructor(
    private store: IReflowProfileDataStore,
    private eventStore: EventStoreModule = EventStoreModule.getInstance()
  ) {}

  public async submitForReview(runId: string): Promise<ReflowProfileRun> {
    const runResult = await this.store.getProfileRunById(runId, false);
    if (!runResult) {
      throw new Error(`Profile run not found: ${runId}`);
    }

    const { run } = runResult;
    run.status = 'REVIEW_REQUIRED';
    await this.store.saveProfileRun(run);
    return run;
  }

  public async approveProfileRun(params: {
    runId: string;
    approvedBy: string;
    electronicSignature?: {
      signerName: string;
      signerRole: string;
      meaning: string;
      timestamp: string;
    };
    comments?: string;
  }): Promise<ReflowProfileRun> {
    const runResult = await this.store.getProfileRunById(params.runId, false);
    if (!runResult) {
      throw new Error(`Profile run not found: ${params.runId}`);
    }

    const { run } = runResult;
    if (run.status !== 'REVIEW_REQUIRED' && run.status !== 'VALIDATED') {
      throw new Error(`ILLEGAL_STATE_TRANSITION: Cannot approve profile run in status ${run.status} (must be REVIEW_REQUIRED or VALIDATED)`);
    }

    if (run.analysisResult.complianceResult === 'FAIL' || run.analysisResult.overallPwi > 100.0) {
      throw new Error('CANNOT_APPROVE_NON_COMPLIANT_PROFILE: Profile with PWI > 100% (FAIL) cannot be approved for production');
    }

    const now = new Date().toISOString();
    const signature = params.electronicSignature || {
      signerName: params.approvedBy,
      signerRole: 'SMT Quality Engineer',
      meaning: 'I have verified and approved this physical reflow thermal profile',
      timestamp: now
    };

    run.status = 'APPROVED';
    run.approvalAudit = {
      approvedBy: params.approvedBy,
      approvedAt: now,
      comments: params.comments,
      electronicSignature: signature
    };

    await this.store.saveProfileRun(run);

    // Emit REFLOW_PROFILE_APPROVED domain event
    const payload: ReflowProfileApprovedPayload = {
      profileRunId: run.id,
      approvedBy: params.approvedBy,
      approvedAt: now,
      overallPwi: run.analysisResult.overallPwi,
      complianceResult: run.analysisResult.complianceResult as 'PASS' | 'WARNING',
      comments: params.comments,
      electronicSignature: signature
    };

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'REFLOW_PROFILE_APPROVED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'PROFILER_GATEWAY',
      sourceId: run.applicabilityKey.equipmentId,
      lineId: run.applicabilityKey.lineId,
      workCenterId: run.applicabilityKey.equipmentId,
      operatorId: params.approvedBy,
      payload
    });

    return run;
  }

  public async rejectProfileRun(params: {
    runId: string;
    rejectedBy: string;
    reason: string;
  }): Promise<ReflowProfileRun> {
    const runResult = await this.store.getProfileRunById(params.runId, false);
    if (!runResult) {
      throw new Error(`Profile run not found: ${params.runId}`);
    }

    const { run } = runResult;
    if (run.status !== 'REVIEW_REQUIRED' && run.status !== 'VALIDATED') {
      throw new Error(`ILLEGAL_STATE_TRANSITION: Cannot reject profile run in status ${run.status}`);
    }

    const now = new Date().toISOString();
    run.status = 'REJECTED';
    await this.store.saveProfileRun(run);

    const payload: ReflowProfileRejectedPayload = {
      profileRunId: run.id,
      rejectedBy: params.rejectedBy,
      rejectedAt: now,
      reason: params.reason,
      overallPwi: run.analysisResult.overallPwi
    };

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'REFLOW_PROFILE_REJECTED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'PROFILER_GATEWAY',
      sourceId: run.applicabilityKey.equipmentId,
      lineId: run.applicabilityKey.lineId,
      workCenterId: run.applicabilityKey.equipmentId,
      operatorId: params.rejectedBy,
      payload
    });

    return run;
  }

  public async activateProfileRun(params: {
    runId: string;
    activatedBy: string;
  }): Promise<ReflowProfileRun> {
    const runResult = await this.store.getProfileRunById(params.runId, false);
    if (!runResult) {
      throw new Error(`Profile run not found: ${params.runId}`);
    }

    const { run } = runResult;

    // Strict PWI-FAIL Guard Invariant
    if (run.analysisResult.complianceResult === 'FAIL' || run.analysisResult.overallPwi > 100.0) {
      throw new Error(
        `CANNOT_ACTIVATE_NON_COMPLIANT_PROFILE: Profile run has PWI ${run.analysisResult.overallPwi}% (> 100%) and cannot be activated for production`
      );
    }

    if (run.status !== 'APPROVED') {
      throw new Error(
        `CANNOT_ACTIVATE_UNAPPROVED_PROFILE: Profile run is in status "${run.status}". It must be APPROVED before activation.`
      );
    }

    // Atomic activation
    await this.store.activateProfileRunAtomic({
      runId: run.id,
      lineId: run.applicabilityKey.lineId,
      equipmentId: run.applicabilityKey.equipmentId,
      recipeId: run.applicabilityKey.recipeId,
      boardPartNumber: run.applicabilityKey.boardPartNumber,
      boardRevision: run.applicabilityKey.boardRevision,
      activatedBy: params.activatedBy
    });

    const now = new Date().toISOString();
    const payload: ReflowProfileActivatedPayload = {
      profileRunId: run.id,
      lineId: run.applicabilityKey.lineId,
      equipmentId: run.applicabilityKey.equipmentId,
      recipeId: run.applicabilityKey.recipeId,
      boardPartNumber: run.applicabilityKey.boardPartNumber,
      boardRevision: run.applicabilityKey.boardRevision,
      activatedBy: params.activatedBy,
      activatedAt: now
    };

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'REFLOW_PROFILE_ACTIVATED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'PROFILER_GATEWAY',
      sourceId: run.applicabilityKey.equipmentId,
      lineId: run.applicabilityKey.lineId,
      workCenterId: run.applicabilityKey.equipmentId,
      operatorId: params.activatedBy,
      payload
    });

    const updated = await this.store.getProfileRunById(params.runId, false);
    return updated!.run;
  }
}
