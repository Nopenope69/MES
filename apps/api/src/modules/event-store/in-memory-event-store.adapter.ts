import { v4 as uuidv4 } from 'uuid';
import { MesEventEnvelope } from '@mes/shared';
import { IEventProjector } from '../../services/projectors/projector.interface';
import {
  IEventStoreModule,
  EventAppendResult,
  EventReplayOptions,
  EventReplayResult,
  ProjectionCheckpoint,
  AggregateSnapshot
} from './event-store.interface';
import { EventSchemaRegistry } from './event-schema.registry';
import { EventUpcasterService } from '../../services/event-upcaster.service';

export class InMemoryEventStoreAdapter implements IEventStoreModule {
  private events: MesEventEnvelope[] = [];
  private checkpoints: Map<string, ProjectionCheckpoint> = new Map();
  private snapshots: AggregateSnapshot[] = [];
  private projectors: IEventProjector[] = [];

  constructor(initialProjectors: IEventProjector[] = []) {
    this.projectors = [...initialProjectors];
  }

  public registerProjector(projector: IEventProjector): void {
    this.projectors.push(projector);
  }

  public getEvents(): MesEventEnvelope[] {
    return [...this.events];
  }

  public clear(): void {
    this.events = [];
    this.checkpoints.clear();
    this.snapshots = [];
  }

  public async append(rawEvent: Partial<MesEventEnvelope>): Promise<EventAppendResult> {
    const now = new Date().toISOString();
    const eventId = rawEvent.eventId || uuidv4();

    if (this.events.some((e) => e.eventId === eventId)) {
      return { success: true, eventId, message: 'idempotent duplicate skipped' };
    }

    const envelope: MesEventEnvelope = {
      eventId,
      eventType: rawEvent.eventType!,
      schemaVersion: rawEvent.schemaVersion || '1.0.0',
      eventTime: rawEvent.eventTime || now,
      receivedTime: now,
      sourceType: rawEvent.sourceType || 'SYSTEM',
      sourceId: rawEvent.sourceId || 'in-memory-test',
      sequenceId: rawEvent.sequenceId || this.events.length + 1,
      siteId: rawEvent.siteId || 'site-test',
      workCenterId: rawEvent.workCenterId || 'wc-test',
      assetPath: rawEvent.assetPath,
      ingressEventId: rawEvent.ingressEventId,
      batchId: rawEvent.batchId,
      workOrderId: rawEvent.workOrderId,
      operatorId: rawEvent.operatorId,
      correlationId: rawEvent.correlationId,
      payload: rawEvent.payload || {}
    };

    const upcasted = EventUpcasterService.upcast(envelope);
    EventSchemaRegistry.validate(upcasted.eventType, upcasted.payload);

    this.events.push(upcasted);

    // Update checkpoints in memory
    for (const projector of this.projectors) {
      if (projector.supports(upcasted.eventType)) {
        const name = projector.constructor.name;
        const cp = this.checkpoints.get(name) || {
          projectionName: name,
          lastEventId: null,
          lastEventTime: null,
          eventsProcessed: 0,
          updatedAt: now
        };
        cp.lastEventId = upcasted.eventId;
        cp.lastEventTime = upcasted.eventTime;
        cp.eventsProcessed += 1;
        cp.updatedAt = now;
        this.checkpoints.set(name, cp);
      }
    }

    return { success: true, eventId: upcasted.eventId };
  }

  public async replay(_options?: EventReplayOptions): Promise<EventReplayResult> {
    return {
      eventsReplayed: this.events.length,
      status: 'SUCCESS'
    };
  }

  public async getCheckpoints(): Promise<ProjectionCheckpoint[]> {
    return Array.from(this.checkpoints.values());
  }

  public async saveSnapshot<T = any>(
    aggregateType: string,
    aggregateId: string,
    version: number,
    state: T
  ): Promise<string> {
    const id = uuidv4();
    this.snapshots.push({
      id,
      aggregateType,
      aggregateId,
      snapshotVersion: version,
      state,
      createdAt: new Date().toISOString()
    });
    return id;
  }

  public async getLatestSnapshot<T = any>(
    aggregateType: string,
    aggregateId: string
  ): Promise<AggregateSnapshot<T> | null> {
    const matches = this.snapshots
      .filter((s) => s.aggregateType === aggregateType && s.aggregateId === aggregateId)
      .sort((a, b) => b.snapshotVersion - a.snapshotVersion);
    return matches.length > 0 ? matches[0] : null;
  }
}
