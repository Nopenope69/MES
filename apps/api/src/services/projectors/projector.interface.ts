import { MesEventEnvelope, MesEventType } from '@mes/shared';
import { IDatabase } from '../../db/database';

/**
 * Interface for domain-specific state projectors.
 * Decouples Core MES state projections from Vertical Pack projections (e.g. SMT, Pharma, Chemical).
 */
export interface IEventProjector {
  readonly name: string;
  supports(eventType: MesEventType): boolean;
  project(event: MesEventEnvelope, tx: IDatabase): Promise<void>;
}
