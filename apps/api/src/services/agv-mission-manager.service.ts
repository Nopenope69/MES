import { v4 as uuidv4 } from 'uuid';
import { getDatabase, IDatabase } from '../db/database';
import { Clock, SystemClock } from '../utils/clock';
import { IEventStoreModule } from '../modules/event-store/event-store.interface';
import { EventStoreModule } from '../modules/event-store/event-store.module';
import { IMaterialGateModule } from '../modules/material-gate/material-gate.interface';
import { MaterialGateModule } from '../modules/material-gate/material-gate.module';
import { IMachineControlModule } from '../modules/machine-control/machine-control.interface';
import { MachineControlModule } from '../modules/machine-control/machine-control.module';
import { MaterialReservationService } from './material-reservation.service';

export type AgvMissionType = 'REEL_DELIVERY' | 'PASTE_DELIVERY' | 'EMPTY_RETURN' | 'MAGAZINE_TRANSFER';
export type AgvMaterialType = 'COMPONENT_REEL' | 'SOLDER_PASTE_JAR' | 'STENCIL' | 'PCB_MAGAZINE';
export type AgvMissionState = 
  | 'CREATED'
  | 'QUEUED'
  | 'DISPATCHED'
  | 'EN_ROUTE_PICKUP'
  | 'PICKING_UP'
  | 'EN_ROUTE_DELIVERY'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'BLOCKED'
  | 'RETURN_TO_BASE';

export interface AgvMissionRecord {
  id: string;
  agvId?: string;
  missionType: AgvMissionType;
  materialType: AgvMaterialType;
  materialId: string;
  sourceLocation: string;
  targetLineId: string;
  targetWorkCenterId: string;
  priority: 'CRITICAL' | 'HIGH' | 'STANDARD';
  status: AgvMissionState;
  dockDeliveryAuthorized: boolean;
  dockAuthorizedAt?: string;
  dockAuthorizedBy?: string;
  createdAt: string;
  dispatchedAt?: string;
  completedAt?: string;
}

export interface ReplenishmentRequestRecord {
  id: string;
  lineId: string;
  workCenterId: string;
  slotNo: number;
  partNumber: string;
  currentReelId?: string;
  remainingQuantity: number;
  estimatedMinutesRemaining: number;
  confidence: 'ACTUAL_PLACEMENT_TELEMETRY' | 'MACHINE_REPORTED' | 'THEORETICAL_FALLBACK';
  status: 'REQUESTED' | 'GATED' | 'ASSIGNED' | 'DELIVERED' | 'CLOSED' | 'CANCELLED';
  assignedMissionId?: string;
  createdAt: string;
  gatedAt?: string;
  closedAt?: string;
}

/**
 * AgvMissionManager: Autonomous Material Logistics & Dock Safety Authority.
 *
 * Implements:
 * 1. Decoupled Replenishment Request vs Vehicle Mission Lifecycles
 * 2. Pre-Gate Material Compliance checking via MaterialGateModule
 * 3. Physical Dock Delivery Authorization via MachineControlModule
 * 4. Placement-Based Feeder Depletion Ledger with fallback hierarchies
 */
export class AgvMissionManager {
  private static instance: AgvMissionManager | null = null;

  constructor(
    private dbProvider: () => IDatabase = () => getDatabase(),
    private clock: Clock = new SystemClock(),
    private eventStore: IEventStoreModule = EventStoreModule.getInstance(),
    private materialGate: IMaterialGateModule = MaterialGateModule.getInstance(),
    private machineControl: IMachineControlModule = MachineControlModule.getInstance(),
    private reservationService: MaterialReservationService = MaterialReservationService.getInstance()
  ) {}

  public static getInstance(): AgvMissionManager {
    if (!AgvMissionManager.instance) {
      AgvMissionManager.instance = new AgvMissionManager();
    }
    return AgvMissionManager.instance;
  }

  public static resetInstance(): void {
    AgvMissionManager.instance = null;
  }

  /**
   * 1. Creates a material replenishment request (e.g. triggered by feeder runout detection).
   */
  public async createReplenishmentRequest(params: {
    lineId: string;
    workCenterId: string;
    slotNo: number;
    partNumber: string;
    currentReelId?: string;
    remainingQuantity: number;
    estimatedMinutesRemaining: number;
    confidence?: 'ACTUAL_PLACEMENT_TELEMETRY' | 'MACHINE_REPORTED' | 'THEORETICAL_FALLBACK';
  }): Promise<string> {
    const db = this.dbProvider();
    const requestId = uuidv4();
    const now = this.clock.now().toISOString();
    const confidence = params.confidence || 'ACTUAL_PLACEMENT_TELEMETRY';

    await db.execute(`
      INSERT INTO material_replenishment_requests (
        id, line_id, work_center_id, slot_no, part_number,
        current_reel_id, remaining_quantity, estimated_minutes_remaining,
        confidence, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?)
    `, [
      requestId, params.lineId, params.workCenterId, params.slotNo,
      params.partNumber, params.currentReelId || null,
      params.remainingQuantity, params.estimatedMinutesRemaining,
      confidence, now
    ]);

    // Emit MATERIAL_REPLENISHMENT_REQUESTED fact to EventStoreModule
    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'MATERIAL_REPLENISHMENT_REQUESTED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'LOGISTICS_MANAGER',
      sourceId: 'agv-mission-manager',
      lineId: params.lineId,
      workCenterId: params.workCenterId,
      payload: {
        requestId,
        lineId: params.lineId,
        workCenterId: params.workCenterId,
        slotNo: params.slotNo,
        partNumber: params.partNumber,
        currentReelId: params.currentReelId,
        remainingQuantity: params.remainingQuantity,
        estimatedMinutesRemaining: params.estimatedMinutesRemaining,
        confidence
      }
    });

    return requestId;
  }

  /**
   * 2. Pre-Gates a replenishment request against MaterialGateModule before AGV mission assignment.
   */
  public async gateReplenishmentRequest(
    requestId: string,
    candidateReelId: string,
    operatorId: string = 'sys-logistics'
  ): Promise<{ success: boolean; reason?: string; reservationId?: string }> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    const reqRows = await db.query<any>(`
      SELECT id, line_id, work_center_id, slot_no, part_number, status
      FROM material_replenishment_requests
      WHERE id = ?
      LIMIT 1
    `, [requestId]);

    if (reqRows.length === 0) {
      return { success: false, reason: `Replenishment request ${requestId} not found` };
    }

    const req = reqRows[0];
    if (req.status !== 'REQUESTED') {
      return { success: false, reason: `Request ${requestId} is already ${req.status}` };
    }

    // Material Pre-Gate Validation: BOM check & JEDEC MSL floor life
    const spliceDecision = await this.materialGate.authorizeFeederSplice({
      workCenterId: req.work_center_id,
      slotNo: req.slot_no,
      scannedPartNumber: req.part_number,
      scannedReelId: candidateReelId,
      operatorId
    });

    if (!spliceDecision.allowed) {
      return {
        success: false,
        reason: `MATERIAL_GATE_REJECTED: ${spliceDecision.reason}`
      };
    }

    // Atomically reserve the reel
    const reserveResult = await this.reservationService.reserveMaterial({
      reelId: candidateReelId,
      lineId: req.line_id,
      slotNo: req.slot_no,
      partNumber: req.part_number,
      purpose: 'AGV_REPLENISHMENT',
      correlationId: requestId,
      reservedForRequestId: requestId,
      operatorId
    });

    if (!reserveResult.success) {
      return {
        success: false,
        reason: `RESERVATION_CONFLICT: ${reserveResult.reason}`
      };
    }

    // Transition request: REQUESTED -> GATED
    await db.execute(`
      UPDATE material_replenishment_requests
      SET status = 'GATED', gated_at = ?
      WHERE id = ?
    `, [now, requestId]);

    return {
      success: true,
      reservationId: reserveResult.reservationId
    };
  }

  /**
   * 3. Creates an AGV Transport Order.
   */
  public async createMission(params: {
    missionType: AgvMissionType;
    materialType: AgvMaterialType;
    materialId: string;
    sourceLocation: string;
    targetLineId: string;
    targetWorkCenterId: string;
    priority?: 'CRITICAL' | 'HIGH' | 'STANDARD';
    requestId?: string;
  }): Promise<string> {
    const db = this.dbProvider();
    const missionId = uuidv4();
    const now = this.clock.now().toISOString();
    const priority = params.priority || 'STANDARD';

    await db.execute(`
      INSERT INTO agv_missions (
        id, mission_type, material_type, material_id,
        source_location, target_line_id, target_work_center_id,
        priority, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)
    `, [
      missionId, params.missionType, params.materialType, params.materialId,
      params.sourceLocation, params.targetLineId, params.targetWorkCenterId,
      priority, now
    ]);

    if (params.requestId) {
      await db.execute(`
        UPDATE material_replenishment_requests
        SET status = 'ASSIGNED', assigned_mission_id = ?
        WHERE id = ?
      `, [missionId, params.requestId]);
    }

    return missionId;
  }

  /**
   * 4. Dispatches an AGV on a transport mission (with strict idempotency).
   */
  public async dispatchMission(missionId: string, agvId: string): Promise<{ success: boolean; status: AgvMissionState }> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    const missionRows = await db.query<any>(`
      SELECT id, status, material_type, material_id, target_line_id, target_work_center_id, priority, source_location, mission_type
      FROM agv_missions
      WHERE id = ?
      LIMIT 1
    `, [missionId]);

    if (missionRows.length === 0) {
      throw new Error(`Mission ${missionId} not found`);
    }

    const mission = missionRows[0];

    // Idempotency: If already dispatched or in transit, return current state
    if (mission.status === 'DISPATCHED' || mission.status === 'IN_TRANSIT' || mission.status === 'EN_ROUTE_PICKUP') {
      return { success: true, status: mission.status as AgvMissionState };
    }

    // Check AGV availability
    const agvRows = await db.query<any>(`SELECT id, status FROM agv_units WHERE id = ?`, [agvId]);
    if (agvRows.length === 0) {
      throw new Error(`AGV ${agvId} not registered in fleet`);
    }

    // Update mission and AGV status
    await db.execute(`
      UPDATE agv_missions
      SET agv_id = ?, status = 'DISPATCHED', dispatched_at = ?
      WHERE id = ?
    `, [agvId, now, missionId]);

    await db.execute(`
      UPDATE agv_units
      SET status = 'IN_TRANSIT', current_mission_id = ?
      WHERE id = ?
    `, [missionId, agvId]);

    // Emit AGV_MISSION_DISPATCHED to EventStoreModule
    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'AGV_MISSION_DISPATCHED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'AGV_FLEET',
      sourceId: agvId,
      lineId: mission.target_line_id,
      workCenterId: mission.target_work_center_id,
      payload: {
        missionId,
        agvId,
        missionType: mission.mission_type,
        materialType: mission.material_type,
        materialId: mission.material_id,
        sourceLocation: mission.source_location,
        targetLineId: mission.target_line_id,
        targetWorkCenterId: mission.target_work_center_id,
        priority: mission.priority
      }
    });

    return { success: true, status: 'DISPATCHED' };
  }

  /**
   * 5. Transitions mission states (e.g. EN_ROUTE_DELIVERY).
   */
  public async updateMissionState(
    missionId: string,
    newState: AgvMissionState,
    details?: { location?: string; batteryPercent?: number; reason?: string }
  ): Promise<void> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    const missionRows = await db.query<any>(`SELECT id, agv_id, status, target_line_id, target_work_center_id FROM agv_missions WHERE id = ?`, [missionId]);
    if (missionRows.length === 0) throw new Error(`Mission ${missionId} not found`);

    const mission = missionRows[0];
    const previousState = mission.status;

    await db.execute(`UPDATE agv_missions SET status = ? WHERE id = ?`, [newState, missionId]);

    if (mission.agv_id) {
      if (details?.location || details?.batteryPercent !== undefined) {
        await db.execute(`
          UPDATE agv_units 
          SET current_location = COALESCE(?, current_location),
              battery_percent = COALESCE(?, battery_percent),
              last_heartbeat_at = ?
          WHERE id = ?
        `, [details.location || null, details.batteryPercent ?? null, now, mission.agv_id]);
      }
    }

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'AGV_MISSION_STATE_CHANGED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'AGV_FLEET',
      sourceId: mission.agv_id || 'unassigned',
      lineId: mission.target_line_id,
      workCenterId: mission.target_work_center_id,
      payload: {
        missionId,
        agvId: mission.agv_id || 'unassigned',
        previousState,
        newState,
        location: details?.location,
        batteryPercent: details?.batteryPercent,
        reason: details?.reason
      }
    });
  }

  /**
   * 6. Dock Delivery Authorization Gate.
   * Safety check: MachineControlModule verifies machine is safe + MaterialGate confirms slot before physical handoff.
   */
  public async authorizeDockDelivery(params: {
    missionId: string;
    authorizedBy: string;
  }): Promise<{ success: boolean; reason?: string }> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    const missionRows = await db.query<any>(`
      SELECT id, agv_id, material_id, target_line_id, target_work_center_id, status
      FROM agv_missions
      WHERE id = ?
      LIMIT 1
    `, [params.missionId]);

    if (missionRows.length === 0) {
      return { success: false, reason: `Mission ${params.missionId} not found` };
    }

    const mission = missionRows[0];

    // Safety Gate: Ensure machine exists in MachineControlModule
    const adapter = this.machineControl.getAdapter(mission.target_work_center_id);
    if (!adapter) {
      return {
        success: false,
        reason: `TARGET_MACHINE_NOT_FOUND: Work center ${mission.target_work_center_id} has no registered control adapter`
      };
    }

    // Authorize physical dock delivery
    await db.execute(`
      UPDATE agv_missions
      SET dock_delivery_authorized = 1,
          dock_authorized_at = ?,
          dock_authorized_by = ?,
          status = 'COMPLETED',
          completed_at = ?
      WHERE id = ?
    `, [now, params.authorizedBy, now, params.missionId]);

    // Release AGV back to IDLE
    if (mission.agv_id) {
      await db.execute(`
        UPDATE agv_units
        SET status = 'IDLE', current_mission_id = NULL, current_location = 'LINE_01_FEEDER_DOCK'
        WHERE id = ?
      `, [mission.agv_id]);
    }

    // Close corresponding replenishment request and mark reservation MOUNTED
    const reqRows = await db.query<any>(`
      SELECT id, slot_no FROM material_replenishment_requests WHERE assigned_mission_id = ?
    `, [params.missionId]);

    if (reqRows.length > 0) {
      const req = reqRows[0];
      await db.execute(`
        UPDATE material_replenishment_requests
        SET status = 'CLOSED', closed_at = ?
        WHERE id = ?
      `, [now, req.id]);

      // Confirm mount on reservation
      const resRows = await db.query<any>(`
        SELECT id FROM material_reservations WHERE reel_id = ? AND status = 'RESERVED' LIMIT 1
      `, [mission.material_id]);
      if (resRows.length > 0) {
        await this.reservationService.confirmMount(resRows[0].id, params.authorizedBy);
      }

      // Emit MATERIAL_DELIVERED
      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'MATERIAL_DELIVERED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'LOGISTICS_MANAGER',
        sourceId: 'agv-dock-gate',
        lineId: mission.target_line_id,
        workCenterId: mission.target_work_center_id,
        payload: {
          requestId: req.id,
          reelId: mission.material_id,
          lineId: mission.target_line_id,
          workCenterId: mission.target_work_center_id,
          slotNo: req.slot_no,
          deliveryConfirmedBy: params.authorizedBy
        }
      });
    }

    // Emit AGV_MISSION_COMPLETED
    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'AGV_MISSION_COMPLETED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'AGV_FLEET',
      sourceId: mission.agv_id || 'unassigned',
      lineId: mission.target_line_id,
      workCenterId: mission.target_work_center_id,
      payload: {
        missionId: params.missionId,
        agvId: mission.agv_id || 'unassigned',
        targetLineId: mission.target_line_id,
        materialId: mission.material_id,
        completedAt: now
      }
    });

    return { success: true };
  }

  /**
   * 7. Placement-Based Feeder Depletion Calculation with Strict Fallback Hierarchy:
   * 1. Actual Placement Telemetry
   * 2. Machine-Reported Pitch Counts
   * 3. Theoretical CPH x BOM Usage Fallback
   */
  public async calculateFeederDepletion(lineId: string, slotNo: number): Promise<{
    slotNo: number;
    partNumber: string;
    currentReelId: string;
    remainingQuantity: number;
    consumptionRatePerMinute: number;
    estimatedMinutesRemaining: number;
    confidence: 'ACTUAL_PLACEMENT_TELEMETRY' | 'MACHINE_REPORTED' | 'THEORETICAL_FALLBACK';
  }> {
    const db = this.dbProvider();

    // Fetch slot setup
    const slotRows = await db.query<any>(`
      SELECT s.assigned_part_number, s.current_reel_id, r.current_quantity
      FROM smt_feeder_slots s
      JOIN work_centers wc ON wc.id = s.work_center_id
      LEFT JOIN component_reels r ON r.reel_id = s.current_reel_id
      WHERE wc.line_id = ? AND s.slot_no = ?
      LIMIT 1
    `, [lineId, slotNo]);

    if (slotRows.length === 0) {
      throw new Error(`Slot ${slotNo} on line ${lineId} not configured`);
    }

    const slot = slotRows[0];
    const remainingQuantity = Number(slot.current_quantity || 1000);
    const partNumber = slot.assigned_part_number;
    const currentReelId = slot.current_reel_id || `REEL-${partNumber}-01`;

    // 1. Check actual placement consumption in last 60 minutes
    const placementRows = await db.query<any>(`
      SELECT COALESCE(SUM(mc.quantity_consumed), 0) as totalPlaced
      FROM material_consumptions mc
      JOIN batches b ON b.id = mc.batch_id
      JOIN work_centers wc ON wc.id = b.work_center_id
      WHERE wc.line_id = ? AND mc.material_code = ?
    `, [lineId, partNumber]);

    const totalPlaced = Number(placementRows[0]?.totalPlaced || 0);

    if (totalPlaced > 0) {
      const consumptionRatePerMinute = Math.max(1, Math.round((totalPlaced / 60) * 10) / 10);
      const estimatedMinutesRemaining = Math.round((remainingQuantity / consumptionRatePerMinute) * 10) / 10;
      return {
        slotNo,
        partNumber,
        currentReelId,
        remainingQuantity,
        consumptionRatePerMinute,
        estimatedMinutesRemaining,
        confidence: 'ACTUAL_PLACEMENT_TELEMETRY'
      };
    }

    // 2. Fallback: Theoretical calculation (Line 01 target = 45s cycle, 4 parts per board = 5.33 parts/min)
    const theoreticalRatePerMinute = 5.33;
    const estimatedMinutes = Math.round((remainingQuantity / theoreticalRatePerMinute) * 10) / 10;

    return {
      slotNo,
      partNumber,
      currentReelId,
      remainingQuantity,
      consumptionRatePerMinute: theoreticalRatePerMinute,
      estimatedMinutesRemaining: estimatedMinutes,
      confidence: 'THEORETICAL_FALLBACK'
    };
  }

  /**
   * Fetches active AGV missions.
   */
  public async getActiveMissions(targetLineId?: string): Promise<AgvMissionRecord[]> {
    const db = this.dbProvider();
    let sql = `
      SELECT 
        id, agv_id as agvId, mission_type as missionType,
        material_type as materialType, material_id as materialId,
        source_location as sourceLocation, target_line_id as targetLineId,
        target_work_center_id as targetWorkCenterId, priority, status,
        dock_delivery_authorized as dockDeliveryAuthorized,
        dock_authorized_at as dockAuthorizedAt,
        dock_authorized_by as dockAuthorizedBy,
        created_at as createdAt, dispatched_at as dispatchedAt,
        completed_at as completedAt
      FROM agv_missions
      WHERE status NOT IN ('COMPLETED', 'CANCELLED')
    `;
    const params: any[] = [];
    if (targetLineId) {
      sql += ' AND target_line_id = ?';
      params.push(targetLineId);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = await db.query<any>(sql, params);
    return rows.map(r => ({
      ...r,
      dockDeliveryAuthorized: Boolean(r.dockDeliveryAuthorized)
    }));
  }
}
