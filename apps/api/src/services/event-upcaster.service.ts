import { MesEventEnvelope } from '@mes/shared';

export type UpcasterFn = (payload: Record<string, any>) => Record<string, any>;

/**
 * EventUpcaster Service (Track A: Architecture & Event Sourcing)
 *
 * Grounded in the Event Sourcing pattern:
 * Committed events in the event store are immutable facts. When event schemas evolve
 * over time (e.g. from v1.0.0 -> v1.1.0), the upcaster transforms historical payloads
 * on read so that downstream consumers and projectors only deal with the latest canonical format.
 */
export class EventUpcasterService {
  private static upcasters: Map<string, Map<string, UpcasterFn>> = new Map();

  /**
   * Register a version transformation migration for a given event type.
   * e.g. registerUpcaster('PANEL_CHECKOUT', '1.0.0', '1.1.0', (payload) => ({ ...payload, isInspected: true }));
   */
  public static registerUpcaster(
    eventType: string,
    fromVersion: string,
    toVersion: string,
    transformer: UpcasterFn
  ): void {
    if (!this.upcasters.has(eventType)) {
      this.upcasters.set(eventType, new Map());
    }
    const transitionKey = `${fromVersion}->${toVersion}`;
    this.upcasters.get(eventType)!.set(transitionKey, transformer);
  }

  /**
   * Upcast an envelope's payload to the target version (default: current system version '1.0.0').
   */
  public static upcast(envelope: MesEventEnvelope, targetVersion: string = '1.0.0'): MesEventEnvelope {
    const currentVersion = envelope.schemaVersion || '1.0.0';
    if (currentVersion === targetVersion) {
      return envelope;
    }

    const typeUpcasters = this.upcasters.get(envelope.eventType);
    if (!typeUpcasters) {
      // No upcaster registered, return with target version label
      return { ...envelope, schemaVersion: targetVersion };
    }

    const transitionKey = `${currentVersion}->${targetVersion}`;
    const transformer = typeUpcasters.get(transitionKey);
    if (transformer) {
      const transformedPayload = transformer(envelope.payload);
      return {
        ...envelope,
        schemaVersion: targetVersion,
        payload: transformedPayload
      };
    }

    return envelope;
  }
}
