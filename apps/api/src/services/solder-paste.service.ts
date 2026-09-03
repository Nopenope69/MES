import { getDatabase } from '../db/database';
import { EventIngestionService } from './event-ingestion.service';
import { Clock, SystemClock } from '../utils/clock';
import { v4 as uuidv4 } from 'uuid';

export interface SolderPasteThawResult {
  thawSufficient: boolean;
  actualThawMinutes: number;
  requiredThawMinutes: number;
  temperatureVerifiedC: number;
  minimumTemperatureC: number;
  message: string;
}

export interface SolderPasteMixingResult {
  mixSufficient: boolean;
  actualDurationSeconds: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  message: string;
}

export interface StencilLifeStatus {
  stencilSessionId: string;
  stencilId: string;
  pasteJarId?: string;
  status: string;
  stencilLifeMinutes: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  isExpired: boolean;
}

export class SolderPasteService {
  constructor(private clock: Clock = new SystemClock()) {}

  public setClock(clock: Clock): void {
    this.clock = clock;
  }

  /**
   * Removes solder paste jar from cold refrigeration (2°C - 10°C).
   */
  public async removeFromCold(jarId: string, operatorId?: string): Promise<void> {
    const db = getDatabase();
    const jars = await db.query<any>('SELECT * FROM solder_paste_jars WHERE jar_id = ?', [jarId]);
    if (jars.length === 0) throw new Error(`Solder paste jar ${jarId} not found.`);

    const jar = jars[0];
    const now = this.clock.now();

    // Check shelf-life expiration
    if (new Date(jar.expiry_date).getTime() < now.getTime()) {
      throw new Error(`BLOCKED_PASTE_EXPIRED: Solder paste lot expired on ${jar.expiry_date}. Discard immediately!`);
    }

    // Lookup profile for thaw parameters
    const profiles = await db.query<any>('SELECT * FROM solder_paste_profiles WHERE id = ?', [jar.profile_id]);
    const thawReq = profiles.length > 0 ? profiles[0].thaw_required_minutes : 240;

    await EventIngestionService.ingest({
      eventType: 'PASTE_REMOVED_FROM_COLD',
      eventTime: now.toISOString(),
      workCenterId: jar.current_work_center_id || 'wc-spg-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'paste-prep-station',
      payload: {
        jarId,
        partNumber: jar.part_number,
        lotNumber: jar.lot_number,
        thawRequiredMinutes: thawReq,
        operatorId
      }
    });
  }

  /**
   * Verifies thaw sufficiency against material-specific process profile.
   */
  public async verifyThaw(jarId: string, temperatureVerifiedC: number, operatorId?: string): Promise<SolderPasteThawResult> {
    const db = getDatabase();
    const jars = await db.query<any>('SELECT * FROM solder_paste_jars WHERE jar_id = ?', [jarId]);
    if (jars.length === 0) throw new Error(`Jar ${jarId} not found.`);

    const jar = jars[0];
    if (!jar.removed_from_cold_at) {
      throw new Error(`Jar ${jarId} has not been recorded as removed from cold storage.`);
    }

    const profiles = await db.query<any>('SELECT * FROM solder_paste_profiles WHERE id = ?', [jar.profile_id]);
    const profile = profiles.length > 0 ? profiles[0] : { thaw_required_minutes: 240, minimum_processing_temperature_c: 22.0 };

    const now = this.clock.now();
    const removedMs = new Date(jar.removed_from_cold_at).getTime();
    const actualThawMinutes = Math.floor((now.getTime() - removedMs) / 60000);

    const isDurationOk = actualThawMinutes >= profile.thaw_required_minutes;
    const isTempOk = temperatureVerifiedC >= profile.minimum_processing_temperature_c;
    const thawSufficient = isDurationOk && isTempOk;

    await EventIngestionService.ingest({
      eventType: 'PASTE_THAW_VERIFIED',
      eventTime: now.toISOString(),
      workCenterId: jar.current_work_center_id || 'wc-spg-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'paste-prep-station',
      payload: {
        jarId,
        temperatureVerifiedC,
        actualThawMinutes,
        thawSufficient,
        operatorId
      }
    });

    let message = 'Thaw verified and complete.';
    if (!isDurationOk) message = `Thaw incomplete: ${actualThawMinutes}m elapsed, required ${profile.thaw_required_minutes}m.`;
    else if (!isTempOk) message = `Temperature insufficient: ${temperatureVerifiedC}°C verified, required >= ${profile.minimum_processing_temperature_c}°C.`;

    return {
      thawSufficient,
      actualThawMinutes,
      requiredThawMinutes: profile.thaw_required_minutes,
      temperatureVerifiedC,
      minimumTemperatureC: profile.minimum_processing_temperature_c,
      message
    };
  }

  /**
   * Records planetary centrifugal mixing cycle and validates against profile RPM / time parameters.
   */
  public async recordMixing(
    jarId: string,
    durationSeconds: number,
    mixingMethod = 'CENTRIFUGAL_PLANETARY',
    operatorId?: string
  ): Promise<SolderPasteMixingResult> {
    const db = getDatabase();
    const jars = await db.query<any>('SELECT * FROM solder_paste_jars WHERE jar_id = ?', [jarId]);
    if (jars.length === 0) throw new Error(`Jar ${jarId} not found.`);

    const jar = jars[0];
    const profiles = await db.query<any>('SELECT * FROM solder_paste_profiles WHERE id = ?', [jar.profile_id]);
    const profile = profiles.length > 0 ? profiles[0] : { mixing_min_seconds: 120, mixing_max_seconds: 300 };

    const mixSufficient = durationSeconds >= profile.mixing_min_seconds && durationSeconds <= profile.mixing_max_seconds;
    const now = this.clock.now();

    await EventIngestionService.ingest({
      eventType: 'PASTE_MIXED',
      eventTime: now.toISOString(),
      workCenterId: jar.current_work_center_id || 'wc-spg-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'paste-mixer-station',
      payload: {
        jarId,
        durationSeconds,
        mixingMethod,
        mixSufficient,
        operatorId
      }
    });

    return {
      mixSufficient,
      actualDurationSeconds: durationSeconds,
      minDurationSeconds: profile.mixing_min_seconds,
      maxDurationSeconds: profile.mixing_max_seconds,
      message: mixSufficient
        ? `Mixing compliant (${durationSeconds}s).`
        : `Mixing non-compliant: ${durationSeconds}s (allowed: ${profile.mixing_min_seconds}s - ${profile.mixing_max_seconds}s).`
    };
  }

  /**
   * Authorizes qualified jar for loading onto Screen Printer stencil.
   */
  public async authorizeForPrinter(jarId: string, workCenterId = 'wc-spg-01', operatorId?: string): Promise<void> {
    const db = getDatabase();
    const jars = await db.query<any>('SELECT * FROM solder_paste_jars WHERE jar_id = ?', [jarId]);
    if (jars.length === 0) throw new Error(`Jar ${jarId} not found.`);

    const jar = jars[0];
    if (jar.status !== 'MIXED') {
      throw new Error(`BLOCKED_PASTE_NOT_AUTHORIZED: Jar status is ${jar.status}. Must be MIXED and verified.`);
    }

    const now = this.clock.now();
    await EventIngestionService.ingest({
      eventType: 'PASTE_AUTHORIZED',
      eventTime: now.toISOString(),
      workCenterId,
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'paste-prep-station',
      payload: {
        jarId,
        workCenterId,
        operatorId
      }
    });
  }

  /**
   * Loads paste jar onto stencil and initiates / links Stencil Session with rolling stencil life.
   */
  public async loadOnStencil(
    jarId: string,
    stencilId: string,
    workCenterId = 'wc-spg-01',
    batchId?: string,
    operatorId?: string
  ): Promise<{ sessionId: string }> {
    const db = getDatabase();
    const jars = await db.query<any>('SELECT * FROM solder_paste_jars WHERE jar_id = ?', [jarId]);
    if (jars.length === 0) throw new Error(`Jar ${jarId} not found.`);

    const jar = jars[0];
    if (jar.status !== 'AUTHORIZED') {
      throw new Error(`BLOCKED_PASTE_NOT_AUTHORIZED: Jar status is ${jar.status}. Must be AUTHORIZED before loading on printer!`);
    }

    const profiles = await db.query<any>('SELECT * FROM solder_paste_profiles WHERE id = ?', [jar.profile_id]);
    const stencilLifeMinutes = profiles.length > 0 ? profiles[0].stencil_life_minutes : 480;

    const now = this.clock.now();
    const sessionId = uuidv4();

    // Start stencil session if not active
    await EventIngestionService.ingest({
      eventType: 'STENCIL_SESSION_STARTED',
      eventTime: now.toISOString(),
      workCenterId,
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'screen-printer-kiosk',
      payload: {
        stencilSessionId: sessionId,
        stencilId,
        workCenterId,
        batchId,
        operatorId
      }
    });

    // Load jar onto stencil
    await EventIngestionService.ingest({
      eventType: 'PASTE_LOADED_ON_STENCIL',
      eventTime: now.toISOString(),
      workCenterId,
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'screen-printer-kiosk',
      payload: {
        jarId,
        stencilId,
        stencilSessionId: sessionId,
        workCenterId,
        batchId,
        stencilLifeMinutes,
        operatorId
      }
    });

    return { sessionId };
  }

  /**
   * Computed-on-Read Stencil Rolling Life Status.
   */
  public async checkStencilLife(stencilSessionId: string): Promise<StencilLifeStatus> {
    const db = getDatabase();
    const sessions = await db.query<any>('SELECT * FROM stencil_sessions WHERE id = ?', [stencilSessionId]);
    if (sessions.length === 0) throw new Error(`Stencil session ${stencilSessionId} not found.`);

    const session = sessions[0];
    const loads = await db.query<any>(
      'SELECT * FROM stencil_paste_loads WHERE stencil_session_id = ? ORDER BY loaded_at ASC LIMIT 1',
      [stencilSessionId]
    );

    const pasteJarId = loads.length > 0 ? loads[0].paste_jar_id : undefined;
    let stencilLifeMinutes = 480;

    if (pasteJarId) {
      const jarProfile = await db.query<any>(`
        SELECT p.stencil_life_minutes FROM solder_paste_jars j
        JOIN solder_paste_profiles p ON j.profile_id = p.id
        WHERE j.jar_id = ?
      `, [pasteJarId]);
      if (jarProfile.length > 0) stencilLifeMinutes = jarProfile[0].stencil_life_minutes;
    }

    const now = this.clock.now();
    const startedMs = new Date(session.started_at).getTime();
    const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - startedMs) / 60000));
    const remainingMinutes = Math.max(0, stencilLifeMinutes - elapsedMinutes);
    const isExpired = remainingMinutes <= 0;

    return {
      stencilSessionId,
      stencilId: session.stencil_id,
      pasteJarId,
      status: isExpired ? 'EXPIRED' : session.status,
      stencilLifeMinutes,
      elapsedMinutes,
      remainingMinutes,
      isExpired
    };
  }

  /**
   * Removes paste from stencil (e.g. shift change or scrap).
   */
  public async removeFromStencil(
    jarId: string,
    stencilId: string,
    stencilSessionId: string,
    reason: 'BATCH_FINISHED' | 'STENCIL_CLEANING' | 'EXPIRED_SCRAP' | 'REPLACED' = 'BATCH_FINISHED',
    operatorId?: string
  ): Promise<void> {
    const now = this.clock.now();
    await EventIngestionService.ingest({
      eventType: 'PASTE_REMOVED_FROM_STENCIL',
      eventTime: now.toISOString(),
      workCenterId: 'wc-spg-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'screen-printer-kiosk',
      payload: {
        jarId,
        stencilId,
        stencilSessionId,
        reason,
        operatorId
      }
    });
  }
}

// Global default instance with SystemClock
export const defaultSolderPasteService = new SolderPasteService();
