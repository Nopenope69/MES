import { z } from 'zod';

/**
 * Standard industrial equipment state enum for SMT & Discrete Lines.
 * Directly mirrors Fuji Nexim's finite state machine:
 * 5: RUN, 3: IDLE, 6: STOPPED_UNPLANNED, 8/9/10: STOPPED_PLANNED, 2: CHANGEOVER, 11: MAINTENANCE
 */
export const EquipmentStateEnum = z.enum([
  'IDLE',
  'RUNNING',
  'STOPPED_UNPLANNED',
  'STOPPED_PLANNED',
  'CHANGEOVER',
  'MAINTENANCE'
]);
export type EquipmentState = z.infer<typeof EquipmentStateEnum>;

/**
 * SMT specific stoppage categories.
 */
export const DowntimeCategoryEnum = z.enum([
  'FEEDER_MECHANISM',
  'NOZZLE_HEAD',
  'VISION_ALIGNMENT',
  'MATERIAL_SHORTAGE',
  'PCB_CONVEYOR',
  'SETUP_CHANGEOVER',
  'REFLOW_OVEN',
  'OTHER'
]);
export type DowntimeCategory = z.infer<typeof DowntimeCategoryEnum>;

export interface DowntimeReasonDefinition {
  code: string;
  category: DowntimeCategory;
  label: string;
  description?: string;
  defaultPlanned: boolean;
}

/**
 * Common pre-configured stoppage reasons tailored for high-speed SMT assembly plants.
 */
export const STANDARD_DOWNTIME_REASONS: DowntimeReasonDefinition[] = [
  // Feeder Mechanism & Tape
  { code: 'FEEDER_TAPE_JAM', category: 'FEEDER_MECHANISM', label: 'Feeder Tape Feed Jam', defaultPlanned: false },
  { code: 'FEEDER_SPLICE_FAIL', category: 'FEEDER_MECHANISM', label: 'Splice Tape Separation / Misaligned', defaultPlanned: false },
  { code: 'FEEDER_MOTOR_ERR', category: 'FEEDER_MECHANISM', label: 'Feeder Indexing Motor Error', defaultPlanned: false },

  // Nozzle & Placement Head
  { code: 'NOZZLE_CLOG_DIRT', category: 'NOZZLE_HEAD', label: 'Nozzle Tip Clogged / Solder Flux', defaultPlanned: false },
  { code: 'NOZZLE_VACUUM_TRIP', category: 'NOZZLE_HEAD', label: 'Placement Head Vacuum Level Drop', defaultPlanned: false },
  { code: 'NOZZLE_DROP_PART', category: 'NOZZLE_HEAD', label: 'Component Dislodged Before Placement', defaultPlanned: false },

  // Vision Processing & Alignment
  { code: 'VISION_FIDUCIAL_FAIL', category: 'VISION_ALIGNMENT', label: 'PCB Board Fiducial Mark Read Fail', defaultPlanned: false },
  { code: 'VISION_LEAD_DEFORM', category: 'VISION_ALIGNMENT', label: 'Component Lead / BGA Ball Deformed', defaultPlanned: false },
  { code: 'VISION_CAMERA_DIRT', category: 'VISION_ALIGNMENT', label: 'Vision Camera Lens Dirty / Stained', defaultPlanned: false },

  // Material & Component Logistics
  { code: 'MAT_PARTS_OUT', category: 'MATERIAL_SHORTAGE', label: 'Reel Exhausted (Parts Out)', defaultPlanned: false },
  { code: 'MAT_WAIT_SPLICE', category: 'MATERIAL_SHORTAGE', label: 'Waiting Operator Splicing Scan', defaultPlanned: true },
  { code: 'MAT_MSL_EXPIRED', category: 'MATERIAL_SHORTAGE', label: 'MSL Floor Life Expired on IC Reel', defaultPlanned: false },
  { code: 'MAT_SOLDER_LOW', category: 'MATERIAL_SHORTAGE', label: 'Printer Solder Paste Low', defaultPlanned: true },

  // PCB Conveyor & Infeed
  { code: 'CONV_BOARD_JAM', category: 'PCB_CONVEYOR', label: 'Panel Conveyor Infeed Jam', defaultPlanned: false },
  { code: 'CONV_WIDTH_ERR', category: 'PCB_CONVEYOR', label: 'Conveyor Rail Width Adjust Error', defaultPlanned: true },
  { code: 'CONV_DOWNSTREAM_FULL', category: 'PCB_CONVEYOR', label: 'Line Blocked (Wait Next Machine)', defaultPlanned: true },

  // Setup & Stencil Changeover
  { code: 'SETUP_STENCIL_CLEAN', category: 'SETUP_CHANGEOVER', label: 'Screen Stencil Underside Cleaning', defaultPlanned: true },
  { code: 'SETUP_FEEDER_SWAP', category: 'SETUP_CHANGEOVER', label: 'Feeder Cart Offline Changeover', defaultPlanned: true },
  { code: 'SETUP_PROGRAM_LOAD', category: 'SETUP_CHANGEOVER', label: 'New Product Program / Recipe Load', defaultPlanned: true },

  // Reflow & Thermal
  { code: 'REFLOW_TEMP_BREACH', category: 'REFLOW_OVEN', label: 'Oven Zone Temperature Out of Spec', defaultPlanned: false },
  { code: 'REFLOW_N2_PRESSURE', category: 'REFLOW_OVEN', label: 'Nitrogen (N2) Pressure Drop', defaultPlanned: false }
];

export const ALLOWED_TRANSITIONS: Record<EquipmentState, EquipmentState[]> = {
  IDLE: ['RUNNING', 'CHANGEOVER', 'MAINTENANCE', 'STOPPED_PLANNED'],
  RUNNING: ['STOPPED_UNPLANNED', 'STOPPED_PLANNED', 'CHANGEOVER', 'IDLE', 'MAINTENANCE'],
  STOPPED_UNPLANNED: ['RUNNING', 'MAINTENANCE', 'CHANGEOVER', 'IDLE'],
  STOPPED_PLANNED: ['RUNNING', 'CHANGEOVER', 'IDLE', 'MAINTENANCE'],
  CHANGEOVER: ['RUNNING', 'IDLE', 'STOPPED_UNPLANNED', 'MAINTENANCE'],
  MAINTENANCE: ['IDLE', 'CHANGEOVER', 'RUNNING']
};

export function isValidStateTransition(fromState: EquipmentState, toState: EquipmentState): boolean {
  if (fromState === toState) return true;
  return ALLOWED_TRANSITIONS[fromState]?.includes(toState) ?? false;
}
