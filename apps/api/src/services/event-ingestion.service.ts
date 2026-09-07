import { MesEventEnvelope } from '@mes/shared';
import { IEventProjector } from './projectors/projector.interface';
import { EventStoreModule } from '../modules/event-store/event-store.module';

/**
 * EventIngestionService (Backward-compatible facade delegating to EventStoreModule).
 */
export class EventIngestionService {
  public static registerProjector(projector: IEventProjector): void {
    EventStoreModule.getInstance().registerProjector(projector);
  }

  public static async ingest(rawEnvelope: Partial<MesEventEnvelope>): Promise<{ success: boolean; eventId: string; message: string }> {
    const res = await EventStoreModule.getInstance().append(rawEnvelope);
    return {
      success: res.success,
      eventId: res.eventId,
      message: res.message || `Event [${res.eventId}] persisted to event log and projected successfully.`
    };
  }
}
