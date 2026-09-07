import { MesEventEnvelope } from '@mes/shared';
import { IEventProjector } from '../../services/projectors/projector.interface';

export interface ProjectionCheckpoint {
  projectionName: string;
  lastEventId: string | null;
  lastEventTime: string | null;
  eventsProcessed: number;
  updatedAt: string;
}

export interface AggregateSnapshot<T = any> {
  id: string;
  aggregateType: string;
  aggregateId: string;
  snapshotVersion: number;
  state: T;
  createdAt: string;
}

export interface EventAppendResult {
  success: boolean;
  eventId: string;
  message?: string;
}

export interface EventReplayOptions {
  fromTimestamp?: string;
  projectors?: IEventProjector[];
}

export interface EventReplayResult {
  eventsReplayed: number;
  status: 'SUCCESS' | 'ERROR';
  error?: string;
}

export interface IEventStoreModule {
  append(rawEvent: Partial<MesEventEnvelope>): Promise<EventAppendResult>;
  replay(options?: EventReplayOptions): Promise<EventReplayResult>;
  getCheckpoints(): Promise<ProjectionCheckpoint[]>;
  saveSnapshot<T = any>(aggregateType: string, aggregateId: string, version: number, state: T): Promise<string>;
  getLatestSnapshot<T = any>(aggregateType: string, aggregateId: string): Promise<AggregateSnapshot<T> | null>;
  registerProjector(projector: IEventProjector): void;
}
