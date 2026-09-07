import { PrinterCapability } from '@mes/shared';
import { getDatabase } from '../db/database';

export class PrinterCapabilityService {
  /**
   * Retrieves declared CFX capabilities for a screen printer.
   */
  public static async getPrinterCapabilities(equipmentId: string = 'wc-spg-01'): Promise<PrinterCapability> {
    const db = getDatabase();
    const rows = await db.query<{
      equipment_id: string;
      manufacturer: string;
      model: string;
      cfx_version: string;
      supports_stencil_cleaning: number;
      supports_parameter_modification: number;
      supports_pressure_control: number;
      supports_separation_speed_control: number;
      supports_print_speed_control: number;
    }>(
      `SELECT equipment_id, manufacturer, model, cfx_version,
              supports_stencil_cleaning, supports_parameter_modification,
              supports_pressure_control, supports_separation_speed_control, supports_print_speed_control
       FROM printer_capabilities
       WHERE equipment_id = ?
       LIMIT 1`,
      [equipmentId]
    );

    if (rows.length === 0) {
      // Default baseline if not registered
      return {
        equipmentId,
        manufacturer: 'Fuji Machine MFG',
        model: 'Fuji GPX-C',
        cfxVersion: '1.7',
        supports: {
          stencilCleaning: true,
          parameterModification: true,
          pressureControl: true,
          separationSpeedControl: true,
          printSpeedControl: true
        }
      };
    }

    const r = rows[0];
    return {
      equipmentId: r.equipment_id,
      manufacturer: r.manufacturer,
      model: r.model,
      cfxVersion: r.cfx_version || '1.7',
      supports: {
        stencilCleaning: Boolean(r.supports_stencil_cleaning),
        parameterModification: Boolean(r.supports_parameter_modification),
        pressureControl: Boolean(r.supports_pressure_control),
        separationSpeedControl: Boolean(r.supports_separation_speed_control),
        printSpeedControl: Boolean(r.supports_print_speed_control)
      }
    };
  }

  /**
   * Checks if an action is supported by the active printer equipment.
   */
  public static async isActionSupported(
    equipmentId: string,
    action: 'CLEANING' | 'PRESSURE' | 'SEPARATION_SPEED' | 'PRINT_SPEED'
  ): Promise<boolean> {
    const caps = await this.getPrinterCapabilities(equipmentId);
    switch (action) {
      case 'CLEANING':
        return caps.supports.stencilCleaning;
      case 'PRESSURE':
        return caps.supports.parameterModification && caps.supports.pressureControl;
      case 'SEPARATION_SPEED':
        return caps.supports.parameterModification && caps.supports.separationSpeedControl;
      case 'PRINT_SPEED':
        return caps.supports.parameterModification && caps.supports.printSpeedControl;
      default:
        return false;
    }
  }
}
