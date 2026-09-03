import { getDatabase } from '../db/database';
import { SolderPasteService } from './solder-paste.service';
import { Clock, SystemClock } from '../utils/clock';

export interface PrinterAuthorizationRequest {
  workCenterId: string;
  batchId?: string;
  stencilId?: string;
  pasteJarId?: string;
}

export type PrinterDecisionCode =
  | 'APPROVED'
  | 'BLOCKED_NO_STENCIL'
  | 'BLOCKED_NO_PASTE'
  | 'BLOCKED_PASTE_NOT_AUTHORIZED'
  | 'BLOCKED_STENCIL_EXPIRED'
  | 'BLOCKED_STENCIL_CLEANING_REQUIRED';

export interface PrinterAuthorizationDecision {
  allowed: boolean;
  decisionCode: PrinterDecisionCode;
  workCenterId: string;
  stencilId?: string;
  pasteJarId?: string;
  stencilSessionId?: string;
  remainingLifeMinutes?: number;
  reason: string;
}

/**
 * Screen Printer Quality Gate (Stage 01 SPG-01 Interlock).
 * Authorizes screen printer cycle initiation only when validated stencil and
 * compliant solder paste (thaw + mix + stencil life) are actively mounted.
 */
export class PrinterAuthorizationService {
  constructor(private clock: Clock = new SystemClock()) {}

  public async authorizeScreenPrinter(
    request: PrinterAuthorizationRequest
  ): Promise<PrinterAuthorizationDecision> {
    const db = getDatabase();
    const { workCenterId, stencilId, pasteJarId } = request;

    // 1. Check Stencil validity
    let activeStencilId = stencilId;
    if (!activeStencilId) {
      const activeSessions = await db.query<any>(
        "SELECT stencil_id, id FROM stencil_sessions WHERE work_center_id = ? AND status = 'ACTIVE' ORDER BY started_at DESC LIMIT 1",
        [workCenterId]
      );
      if (activeSessions.length > 0) {
        activeStencilId = activeSessions[0].stencil_id;
      }
    }

    if (!activeStencilId) {
      return {
        allowed: false,
        decisionCode: 'BLOCKED_NO_STENCIL',
        workCenterId,
        reason: `No stencil is currently loaded on screen printer ${workCenterId}.`
      };
    }

    const stencils = await db.query<any>('SELECT * FROM stencils WHERE stencil_id = ?', [activeStencilId]);
    if (stencils.length === 0 || stencils[0].status === 'SCRAPPED' || stencils[0].status === 'CLEANING_REQUIRED') {
      return {
        allowed: false,
        decisionCode: 'BLOCKED_STENCIL_CLEANING_REQUIRED',
        workCenterId,
        stencilId: activeStencilId,
        reason: `Stencil ${activeStencilId} status is ${stencils.length > 0 ? stencils[0].status : 'NOT_FOUND'}. Cleaning / inspection required.`
      };
    }

    // 2. Check Active Stencil Session & Rolling Stencil Life
    const sessions = await db.query<any>(
      "SELECT id, started_at, status FROM stencil_sessions WHERE work_center_id = ? AND stencil_id = ? AND status = 'ACTIVE' ORDER BY started_at DESC LIMIT 1",
      [workCenterId, activeStencilId]
    );

    if (sessions.length === 0) {
      return {
        allowed: false,
        decisionCode: 'BLOCKED_NO_PASTE',
        workCenterId,
        stencilId: activeStencilId,
        reason: `No active printing session found for stencil ${activeStencilId}. Paste must be loaded.`
      };
    }

    const session = sessions[0];
    const solderService = new SolderPasteService(this.clock);
    const lifeStatus = await solderService.checkStencilLife(session.id);

    if (lifeStatus.isExpired) {
      return {
        allowed: false,
        decisionCode: 'BLOCKED_STENCIL_EXPIRED',
        workCenterId,
        stencilId: activeStencilId,
        stencilSessionId: session.id,
        remainingLifeMinutes: 0,
        reason: `Stencil paste life has expired (${lifeStatus.elapsedMinutes}m elapsed > ${lifeStatus.stencilLifeMinutes}m max). Paste must be cleaned and replaced.`
      };
    }

    // 3. Check Solder Paste Jar on Stencil
    const activeJarId = pasteJarId || lifeStatus.pasteJarId;
    if (!activeJarId) {
      return {
        allowed: false,
        decisionCode: 'BLOCKED_NO_PASTE',
        workCenterId,
        stencilId: activeStencilId,
        stencilSessionId: session.id,
        reason: `No solder paste jar is registered on stencil ${activeStencilId}.`
      };
    }

    const jars = await db.query<any>('SELECT * FROM solder_paste_jars WHERE jar_id = ?', [activeJarId]);
    if (jars.length === 0 || (jars[0].status !== 'ON_STENCIL' && jars[0].status !== 'AUTHORIZED')) {
      return {
        allowed: false,
        decisionCode: 'BLOCKED_PASTE_NOT_AUTHORIZED',
        workCenterId,
        stencilId: activeStencilId,
        pasteJarId: activeJarId,
        stencilSessionId: session.id,
        reason: `Solder paste jar ${activeJarId} status is ${jars.length > 0 ? jars[0].status : 'NOT_FOUND'}. Must be AUTHORIZED or ON_STENCIL.`
      };
    }

    return {
      allowed: true,
      decisionCode: 'APPROVED',
      workCenterId,
      stencilId: activeStencilId,
      pasteJarId: activeJarId,
      stencilSessionId: session.id,
      remainingLifeMinutes: lifeStatus.remainingMinutes,
      reason: `Quality Gate Cleared: Stencil ${activeStencilId} and Paste ${activeJarId} authorized (${lifeStatus.remainingMinutes}m life remaining).`
    };
  }
}
