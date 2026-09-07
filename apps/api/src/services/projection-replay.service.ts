import { IEventProjector } from './projectors/projector.interface';
import { EventStoreModule } from '../modules/event-store/event-store.module';
import { ProjectionCheckpoint, AggregateSnapshot } from '../modules/event-store/event-store.interface';

export { ProjectionCheckpoint, AggregateSnapshot };

/**
 * ProjectionReplayService (Backward-compatible facade delegating to EventStoreModule).
 */
export class ProjectionReplayService {
  public static async saveSnapshot<T = any>(
    aggregateType: string,
    aggregateId: string,
    snapshotVersion: number,
    state: T
  ): Promise<string> {
    return EventStoreModule.getInstance().saveSnapshot(aggregateType, aggregateId, snapshotVersion, state);
  }

  public static async getLatestSnapshot<T = any>(
    aggregateType: string,
    aggregateId: string
  ): Promise<AggregateSnapshot<T> | null> {
    return EventStoreModule.getInstance().getLatestSnapshot(aggregateType, aggregateId);
  }

  public static async getCheckpoints(): Promise<ProjectionCheckpoint[]> {
    return EventStoreModule.getInstance().getCheckpoints();
  }

  public static async replayCatchup(options?: {
    fromTimestamp?: string;
    projectors?: IEventProjector[];
  }): Promise<{ eventsReplayed: number; status: 'SUCCESS' | 'ERROR' }> {
    return EventStoreModule.getInstance().replay(options);
  }
}
