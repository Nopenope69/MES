import { Clock, SystemClock } from '../utils/clock';
import { MaterialGateModule } from '../modules/material-gate/material-gate.module';
import { SolderPasteService } from './solder-paste.service';
import {
  PrinterDecisionCode,
  PrinterAuthParams as PrinterAuthorizationRequest,
  PrinterAuthDecision as PrinterAuthorizationDecision
} from '../modules/material-gate/material-gate.interface';

export type { PrinterDecisionCode, PrinterAuthorizationRequest, PrinterAuthorizationDecision };

/**
 * Screen Printer Quality Gate (Stage 01 SPG-01 Interlock).
 * Backward-compatible facade delegating to MaterialGateModule.
 */
export class PrinterAuthorizationService {
  private gateModule: MaterialGateModule;

  constructor(private clock: Clock = new SystemClock()) {
    this.gateModule = new MaterialGateModule(
      undefined,
      clock,
      undefined,
      undefined,
      new SolderPasteService(clock)
    );
  }

  public async authorizeScreenPrinter(
    request: PrinterAuthorizationRequest
  ): Promise<PrinterAuthorizationDecision> {
    return this.gateModule.authorizeScreenPrinter(request);
  }
}
