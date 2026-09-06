import { IEquipmentAdapter, EquipmentAdapterStatus } from './equipment-adapter.interface';
import { FujiNeximAdapter } from './fuji-nexim.adapter';

/**
 * EquipmentGatewayManager (Track A: Architecture & Event Sourcing)
 *
 * Grounded in the Hardware Abstraction Layer (HAL) pattern:
 * Central manager overseeing the lifecycle and health of all physical machine integration gateways.
 * Manages Fuji Nexim, Panasonic PanaCIM, ASM SIPLACE, and Screen Printer protocol sockets.
 */
export class EquipmentGatewayManager {
  private static instance: EquipmentGatewayManager | null = null;
  private adapters: Map<string, IEquipmentAdapter> = new Map();

  private constructor() {
    // Register default factory line equipment
    const fujiAdapter = new FujiNeximAdapter();
    this.registerAdapter(fujiAdapter);
  }

  public static getInstance(): EquipmentGatewayManager {
    if (!this.instance) {
      this.instance = new EquipmentGatewayManager();
    }
    return this.instance;
  }

  public registerAdapter(adapter: IEquipmentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public getAdapter<T extends IEquipmentAdapter = IEquipmentAdapter>(id: string): T | undefined {
    return this.adapters.get(id) as T | undefined;
  }

  public getAllStatuses(): EquipmentAdapterStatus[] {
    return Array.from(this.adapters.values()).map(a => a.getStatus());
  }

  public async startAll(defaultPorts?: Record<string, number>): Promise<void> {
    for (const [id, adapter] of this.adapters.entries()) {
      const port = defaultPorts?.[id];
      await adapter.startListener(port);
    }
  }

  public async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stopListener();
    }
  }
}
