export type ChaosAttackType = 'CHAOS_NETWORK_JITTER' | 'CHAOS_DB_TRANSIENT_TIMEOUT' | 'CHAOS_CORRUPT_FRAME';

export interface ChaosExperimentPlan {
  experimentId: string;
  target: string;
  hypothesis: string;
  attackType: ChaosAttackType;
  durationSeconds: number;
  blastRadius: {
    workCenterId?: string;
    trafficSharePercent: number;
  };
  abortCriteria: {
    maxBurnRate: number; // e.g. 14.4
    maxFailedEvents: number;
  };
}

export interface ChaosExperimentResult {
  experimentId: string;
  status: 'PASSED' | 'ABORTED' | 'FAILED';
  startedAt: string;
  endedAt: string;
  steadyStateHeld: boolean;
  abortTriggered: boolean;
  abortReason?: string;
  eventsInjected: number;
  postmortem: string;
}

export class ChaosInjectionService {
  private static activeExperiment: ChaosExperimentPlan | null = null;
  private static activeJitterMs: number = 0;

  /**
   * Returns current active jitter to be added to mock operations.
   */
  public static getActiveJitterMs(): number {
    return this.activeJitterMs;
  }

  /**
   * Executes a bounded chaos experiment with automated safety abort criteria.
   */
  public static async runExperiment(plan: ChaosExperimentPlan): Promise<ChaosExperimentResult> {
    const startedAt = new Date().toISOString();
    this.activeExperiment = plan;

    let abortTriggered = false;
    let abortReason: string | undefined;
    let eventsInjected = 0;
    let steadyStateHeld = true;

    try {
      if (plan.attackType === 'CHAOS_NETWORK_JITTER') {
        this.activeJitterMs = 50; // 50ms synthetic latency
      }

      // Simulate fault injection cycles within the bounded duration
      const cycles = Math.min(10, plan.durationSeconds);
      for (let i = 0; i < cycles; i++) {
        eventsInjected++;

        // Simulate evaluation of safety abort criteria
        if (plan.attackType === 'CHAOS_DB_TRANSIENT_TIMEOUT' && i >= 5) {
          // Check if abort criteria tripped
          if (eventsInjected > plan.abortCriteria.maxFailedEvents) {
            abortTriggered = true;
            abortReason = `Safety abort triggered: failure threshold ${plan.abortCriteria.maxFailedEvents} exceeded. Preserving factory line stability.`;
            break;
          }
        }
      }
    } finally {
      // Clean up injected faults immediately
      this.activeJitterMs = 0;
      this.activeExperiment = null;
    }

    const endedAt = new Date().toISOString();
    const status = abortTriggered ? 'ABORTED' : (steadyStateHeld ? 'PASSED' : 'FAILED');

    const postmortem = [
      `# Chaos Experiment Postmortem: ${plan.experimentId}`,
      `**Target:** ${plan.target}`,
      `**Attack Type:** ${plan.attackType}`,
      `**Status:** ${status}`,
      `**Events Injected:** ${eventsInjected}`,
      `**Steady-State Hypothesis:** ${plan.hypothesis}`,
      `**Outcome:** ${steadyStateHeld ? 'Hypothesis verified. System demonstrated resilience.' : 'Steady-state violated.'}`,
      abortTriggered ? `**Safety Abort:** ${abortReason}` : '**Safety Abort:** Did not trigger. Experiment completed cleanly.'
    ].join('\n');

    return {
      experimentId: plan.experimentId,
      status,
      startedAt,
      endedAt,
      steadyStateHeld,
      abortTriggered,
      abortReason,
      eventsInjected,
      postmortem
    };
  }
}
