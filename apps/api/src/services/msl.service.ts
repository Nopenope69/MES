import { getDatabase } from '../db/database';
import { EventIngestionService } from './event-ingestion.service';
import { Clock, SystemClock } from '../utils/clock';
import { JEDEC_NOMINAL_FLOOR_LIFE_MINUTES, MslClass } from '@mes/shared';
import { v4 as uuidv4 } from 'uuid';

export interface ReelMslStatus {
  reelId: string;
  partNumber: string;
  mslClass: MslClass;
  storageState: 'SEALED_MBB' | 'AMBIENT_EXPOSURE' | 'DRY_STORAGE' | 'BAKING';
  floorClockState: 'SEALED' | 'FLOOR_EXPOSURE' | 'DRY_STORAGE' | 'BAKE_REQUIRED' | 'BAKING';
  nominalFloorLifeMinutes: number;
  cumulativeAmbientSeconds: number;
  remainingFloorLifeSeconds: number;
  remainingFloorLifeMinutes: number;
  floorLifeExpiresAt: string | null;
  isExpired: boolean;
  bakeStatus: string;
}

export class MslService {
  constructor(private clock: Clock = new SystemClock()) {}

  public setClock(clock: Clock): void {
    this.clock = clock;
  }

  /**
   * Computed-on-Read MSL Floor-Life Engine (JEDEC J-STD-033D Standard).
   * Computes remaining floor-life dynamically from the auditable sequence of recorded intervals.
   * Never maintains compliance time via periodic decrement jobs.
   */
  public async getReelMslStatus(reelId: string): Promise<ReelMslStatus> {
    const db = getDatabase();
    const rows = await db.query<any>('SELECT * FROM component_reels WHERE reel_id = ?', [reelId]);
    if (rows.length === 0) {
      throw new Error(`Reel ${reelId} not found in inventory.`);
    }

    const reel = rows[0];
    const mslClass: MslClass = (reel.msl_class as MslClass) || (reel.msl_level ? `MSL_${reel.msl_level}` as MslClass : 'MSL_1');
    const nominalMinutes = JEDEC_NOMINAL_FLOOR_LIFE_MINUTES[mslClass] ?? 999999;
    const nominalSeconds = nominalMinutes * 60;

    // MSL 1 has unlimited floor life
    if (mslClass === 'MSL_1') {
      return {
        reelId,
        partNumber: reel.part_number,
        mslClass: 'MSL_1',
        storageState: reel.storage_state || 'AMBIENT_EXPOSURE',
        floorClockState: 'FLOOR_EXPOSURE',
        nominalFloorLifeMinutes: 999999,
        cumulativeAmbientSeconds: 0,
        remainingFloorLifeSeconds: 999999 * 60,
        remainingFloorLifeMinutes: 999999,
        floorLifeExpiresAt: null,
        isExpired: false,
        bakeStatus: 'NOT_REQUIRED'
      };
    }

    // If still sealed in Moisture Barrier Bag
    if (!reel.mbb_opened_at && reel.storage_state === 'SEALED_MBB') {
      return {
        reelId,
        partNumber: reel.part_number,
        mslClass,
        storageState: 'SEALED_MBB',
        floorClockState: 'SEALED',
        nominalFloorLifeMinutes: nominalMinutes,
        cumulativeAmbientSeconds: 0,
        remainingFloorLifeSeconds: nominalSeconds,
        remainingFloorLifeMinutes: nominalMinutes,
        floorLifeExpiresAt: null,
        isExpired: false,
        bakeStatus: reel.bake_status || 'NOT_REQUIRED'
      };
    }

    // Query exposure logs since last successful bake or unseal
    const now = this.clock.now();
    const nowMs = now.getTime();

    // Sum completed ambient exposure intervals
    const completedLogs = await db.query<{ duration_seconds: number }>(
      `SELECT duration_seconds FROM msl_exposure_logs 
       WHERE reel_id = ? AND state = 'AMBIENT_EXPOSURE' AND ended_at IS NOT NULL`,
      [reelId]
    );

    let cumulativeAmbientSeconds = completedLogs.reduce((acc, log) => acc + (log.duration_seconds || 0), 0);

    // Check for active (open) ambient exposure interval
    const openLogs = await db.query<any>(
      `SELECT started_at FROM msl_exposure_logs 
       WHERE reel_id = ? AND state = 'AMBIENT_EXPOSURE' AND ended_at IS NULL 
       ORDER BY started_at DESC LIMIT 1`,
      [reelId]
    );

    if (openLogs.length > 0) {
      const startMs = new Date(openLogs[0].started_at).getTime();
      const currentIntervalSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      cumulativeAmbientSeconds += currentIntervalSeconds;
    }

    const remainingSeconds = Math.max(0, nominalSeconds - cumulativeAmbientSeconds);
    const remainingMinutes = Math.floor(remainingSeconds / 60);
    const isExpired = remainingSeconds <= 0;

    let floorClockState: 'SEALED' | 'FLOOR_EXPOSURE' | 'DRY_STORAGE' | 'BAKE_REQUIRED' | 'BAKING' = 'FLOOR_EXPOSURE';
    if (reel.storage_state === 'DRY_STORAGE') {
      floorClockState = isExpired ? 'BAKE_REQUIRED' : 'DRY_STORAGE';
    } else if (reel.storage_state === 'BAKING') {
      floorClockState = 'BAKING';
    } else if (isExpired) {
      floorClockState = 'BAKE_REQUIRED';
    }

    // Calculate expiry timestamp (only active if currently in ambient exposure)
    let floorLifeExpiresAt: string | null = null;
    if (floorClockState === 'FLOOR_EXPOSURE' && !isExpired) {
      floorLifeExpiresAt = new Date(nowMs + remainingSeconds * 1000).toISOString();
    }

    return {
      reelId,
      partNumber: reel.part_number,
      mslClass,
      storageState: reel.storage_state || 'AMBIENT_EXPOSURE',
      floorClockState,
      nominalFloorLifeMinutes: nominalMinutes,
      cumulativeAmbientSeconds,
      remainingFloorLifeSeconds: remainingSeconds,
      remainingFloorLifeMinutes: remainingMinutes,
      floorLifeExpiresAt,
      isExpired,
      bakeStatus: reel.bake_status || 'NOT_REQUIRED'
    };
  }

  /**
   * Unseals reel from Moisture Barrier Bag (MBB), starting floor life exposure.
   */
  public async unsealReel(reelId: string, operatorId?: string): Promise<void> {
    const db = getDatabase();
    const rows = await db.query<any>('SELECT * FROM component_reels WHERE reel_id = ?', [reelId]);
    if (rows.length === 0) throw new Error(`Reel ${reelId} not found.`);

    const reel = rows[0];
    const mslClass = reel.msl_class || 'MSL_3';
    const nominal = JEDEC_NOMINAL_FLOOR_LIFE_MINUTES[mslClass as MslClass] || 10080;
    const now = this.clock.now().toISOString();

    await EventIngestionService.ingest({
      eventType: 'REEL_UNSEALED',
      eventTime: now,
      workCenterId: 'wc-nxt-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'cleanroom-msl-station',
      payload: {
        reelId,
        partNumber: reel.part_number,
        mslClass,
        nominalFloorLifeMinutes: nominal,
        hicStatus: 'OK',
        operatorId
      }
    });
  }

  /**
   * Moves reel into a qualified Dry Cabinet (RH <= 5%), pausing ambient exposure countdown.
   */
  public async enterDryStorage(reelId: string, cabinetId = 'DRY-CAB-01', operatorId?: string): Promise<void> {
    const now = this.clock.now().toISOString();

    await EventIngestionService.ingest({
      eventType: 'REEL_DRY_STORAGE_ENTERED',
      eventTime: now,
      workCenterId: 'wc-nxt-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'dry-cabinet-kiosk',
      payload: {
        reelId,
        cabinetId,
        operatorId
      }
    });
  }

  /**
   * Exits reel from Dry Cabinet back to cleanroom ambient floor exposure, resuming countdown.
   */
  public async exitDryStorage(reelId: string, cabinetId = 'DRY-CAB-01', operatorId?: string): Promise<void> {
    const now = this.clock.now().toISOString();

    await EventIngestionService.ingest({
      eventType: 'REEL_DRY_STORAGE_EXITED',
      eventTime: now,
      workCenterId: 'wc-nxt-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'dry-cabinet-kiosk',
      payload: {
        reelId,
        cabinetId,
        operatorId
      }
    });
  }

  /**
   * Starts high-temperature desiccation in an approved bake oven.
   */
  public async startBake(
    reelId: string,
    ovenId = 'OVEN-01',
    bakeProfileId = 'BAKE-JEDEC-125C-24H',
    operatorId?: string
  ): Promise<void> {
    const db = getDatabase();
    const profiles = await db.query<any>('SELECT * FROM msl_bake_profiles WHERE id = ?', [bakeProfileId]);
    const tempC = profiles.length > 0 ? profiles[0].temperature_c : 125;
    const durationMins = profiles.length > 0 ? profiles[0].minimum_duration_minutes : 1440;
    const now = this.clock.now().toISOString();

    await EventIngestionService.ingest({
      eventType: 'REEL_BAKE_STARTED',
      eventTime: now,
      workCenterId: 'wc-nxt-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'bake-oven-kiosk',
      payload: {
        reelId,
        ovenId,
        bakeProfileId,
        temperatureC: tempC,
        targetDurationMinutes: durationMins,
        operatorId
      }
    });
  }

  /**
   * Completes high-temperature desiccation.
   * Resets floor life ONLY IF recorded bake satisfies the configured JEDEC bake profile.
   */
  public async completeBake(
    reelId: string,
    ovenId = 'OVEN-01',
    operatorId?: string
  ): Promise<{ bakeSufficient: boolean; message: string }> {
    const db = getDatabase();
    const reelRows = await db.query<any>('SELECT * FROM component_reels WHERE reel_id = ?', [reelId]);
    if (reelRows.length === 0) throw new Error(`Reel ${reelId} not found.`);

    const reel = reelRows[0];
    if (!reel.bake_started_at) {
      throw new Error(`Reel ${reelId} has no active bake session.`);
    }

    const now = this.clock.now();
    const startMs = new Date(reel.bake_started_at).getTime();
    const actualDurationMinutes = Math.floor((now.getTime() - startMs) / 60000);

    // Look up bake profile
    const profileId = reel.last_bake_profile_id || 'BAKE-JEDEC-125C-24H';
    const profileRows = await db.query<any>('SELECT * FROM msl_bake_profiles WHERE id = ?', [profileId]);
    const minDuration = profileRows.length > 0 ? profileRows[0].minimum_duration_minutes : 1440;
    const reqTemp = profileRows.length > 0 ? profileRows[0].temperature_c : 125;

    // Validate bake sufficiency: must satisfy minimum duration
    const bakeSufficient = actualDurationMinutes >= minDuration;

    await EventIngestionService.ingest({
      eventType: 'REEL_BAKE_COMPLETED',
      eventTime: now.toISOString(),
      workCenterId: 'wc-nxt-01',
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'bake-oven-kiosk',
      payload: {
        reelId,
        ovenId,
        bakeProfileId: profileId,
        actualDurationMinutes,
        actualTemperatureC: reqTemp,
        bakeSufficient,
        operatorId
      }
    });

    return {
      bakeSufficient,
      message: bakeSufficient
        ? `Bake successful (${actualDurationMinutes}m >= ${minDuration}m at ${reqTemp}°C). Floor life restored to 100%.`
        : `Bake INSUFFICIENT: recorded ${actualDurationMinutes}m, required ${minDuration}m. Floor life not restored.`
    };
  }
}

// Global default instance with SystemClock
export const defaultMslService = new MslService();
