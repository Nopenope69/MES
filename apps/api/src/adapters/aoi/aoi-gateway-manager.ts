import { CanonicalAoiInspectionResult } from '@mes/shared';
import { IAoiAdapter, AoiParseContext } from './aoi-adapter.interface';
import { KohYoungAoiAdapter } from './koh-young.adapter';
import { OmronAoiAdapter } from './omron.adapter';

export class AoiGatewayManager {
  private adapters: Map<string, IAoiAdapter> = new Map();

  constructor() {
    this.registerAdapter(new KohYoungAoiAdapter());
    this.registerAdapter(new OmronAoiAdapter());
  }

  public registerAdapter(adapter: IAoiAdapter): void {
    this.adapters.set(adapter.vendor.toUpperCase(), adapter);
  }

  public getAdapter(vendor: string): IAoiAdapter {
    const key = vendor.toUpperCase();
    const adapter = this.adapters.get(key);
    if (!adapter) {
      // Fallback: check if matches Koh Young or Omron aliases
      if (key.includes('KOH') || key.includes('YOUNG')) {
        return this.adapters.get('KOH_YOUNG_3D_AOI')!;
      }
      if (key.includes('OMRON')) {
        return this.adapters.get('OMRON_VT_S_SERIES')!;
      }
      throw new Error(`Unsupported AOI vendor: '${vendor}'. Registered vendors: ${Array.from(this.adapters.keys()).join(', ')}`);
    }
    return adapter;
  }

  public async parse(
    vendor: string,
    payload: string | Buffer | Record<string, any>,
    context?: AoiParseContext
  ): Promise<CanonicalAoiInspectionResult> {
    const adapter = this.getAdapter(vendor);
    return await adapter.parseInspection(payload, context);
  }

  public getRegisteredVendors(): string[] {
    return Array.from(this.adapters.keys());
  }
}

export const defaultAoiGateway = new AoiGatewayManager();
