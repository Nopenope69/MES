import { MaterialGateModule } from '../modules/material-gate/material-gate.module';
import {
  SplicingDecisionCode,
  SplicingAuthParams as SplicingAuthorizationRequest,
  SplicingDecision as SplicingAuthorizationDecision
} from '../modules/material-gate/material-gate.interface';

export type { SplicingDecisionCode, SplicingAuthorizationRequest, SplicingAuthorizationDecision };

/**
 * SplicingAuthorizationService (Backward-compatible facade delegating to MaterialGateModule).
 */
export class SplicingAuthorizationService {
  public static async authorizeSplicing(
    request: SplicingAuthorizationRequest
  ): Promise<SplicingAuthorizationDecision> {
    return MaterialGateModule.getInstance().authorizeFeederSplice(request);
  }
}
