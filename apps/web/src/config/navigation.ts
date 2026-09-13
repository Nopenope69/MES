import { OperatorRole, OperatorProfile, authService } from '../services/auth.service';

export type NavTab = 
  | 'FLEET' 
  | 'SUPERVISOR' 
  | 'OPERATOR' 
  | 'SPI' 
  | 'SOLDER_PASTE' 
  | 'REFLOW' 
  | 'AGV_LOGISTICS'
  | 'COMPLIANCE' 
  | 'GENEALOGY' 
  | 'REWORK' 
  | 'PREDICTIVE'
  | 'AUDIT_TRAIL';

export type DomainId = 'EXECUTIVE' | 'OPERATIONS' | 'QUALITY' | 'DIAGNOSTICS';

export interface StationConfig {
  id: NavTab;
  domainId: DomainId;
  label: string;
  shortLabel: string;
  code: string;
  requiredRoles: OperatorRole[];
  description: string;
  shortcut: string;
  allowGuestReadOnly: boolean;
  iconName: string;
}

export interface DomainConfig {
  id: DomainId;
  label: string;
  shortLabel: string;
  iconName: string;
  description: string;
}

export const DOMAINS: DomainConfig[] = [
  {
    id: 'EXECUTIVE',
    label: 'Executive & Operations',
    shortLabel: 'Executive',
    iconName: 'BarChart3',
    description: 'Multi-line plant OEE, bay balancing, and shift supervisor cockpit'
  },
  {
    id: 'OPERATIONS',
    label: 'SMT Line Operations',
    shortLabel: 'Line Ops',
    iconName: 'Cpu',
    description: 'Direct equipment stations: Feeder bay, 3D SPI, Paste, Reflow, and AGVs'
  },
  {
    id: 'QUALITY',
    label: 'Quality & Traceability',
    shortLabel: 'Quality',
    iconName: 'Shield',
    description: 'Cleanroom eDHR release, 4-level genealogy, AOI rework, and predictive SPC'
  },
  {
    id: 'DIAGNOSTICS',
    label: 'Diagnostics & Audit',
    shortLabel: 'Diagnostics',
    iconName: 'Terminal',
    description: 'OT gateway raw TCP frame monitoring and SHA-256 hash ledger'
  }
];

export const STATIONS: Record<NavTab, StationConfig> = {
  // Executive & Operations Domain
  FLEET: {
    id: 'FLEET',
    domainId: 'EXECUTIVE',
    label: 'Fleet Overview',
    shortLabel: 'Fleet OEE',
    code: 'FLT-01',
    requiredRoles: ['LINE_LEAD', 'QUALITY_LEAD', 'SYSTEM_ADMIN'],
    description: 'Multi-line bay OEE, takt time pacing, and bottleneck balancing',
    shortcut: '1',
    allowGuestReadOnly: false,
    iconName: 'Split'
  },
  SUPERVISOR: {
    id: 'SUPERVISOR',
    domainId: 'EXECUTIVE',
    label: 'Line 01 Supervisor',
    shortLabel: 'Supervisor',
    code: 'SUP-01',
    requiredRoles: ['LINE_LEAD', 'QUALITY_LEAD', 'SYSTEM_ADMIN'],
    description: 'Shift summary report, downtime Pareto, and feeder pickup health',
    shortcut: '2',
    allowGuestReadOnly: false,
    iconName: 'Activity'
  },

  // SMT Line Operations Domain
  OPERATOR: {
    id: 'OPERATOR',
    domainId: 'OPERATIONS',
    label: 'SMT Feeder Bay',
    shortLabel: 'Feeder Bay',
    code: 'FDR-01',
    requiredRoles: ['OPERATOR', 'MAINTENANCE', 'LINE_LEAD', 'SYSTEM_ADMIN'],
    description: 'Cassette slot loading, reel splicing verification, and barcode scanning',
    shortcut: '3',
    allowGuestReadOnly: true,
    iconName: 'Tablet'
  },
  SPI: {
    id: 'SPI',
    domainId: 'OPERATIONS',
    label: '3D Solder Paste Inspection',
    shortLabel: '3D SPI',
    code: 'SPI-01',
    requiredRoles: ['OPERATOR', 'QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
    description: 'Solder paste height, volume, and area inspection with auto-stencil wipe',
    shortcut: '4',
    allowGuestReadOnly: true,
    iconName: 'Sliders'
  },
  SOLDER_PASTE: {
    id: 'SOLDER_PASTE',
    domainId: 'OPERATIONS',
    label: 'Solder Paste & MSL',
    shortLabel: 'Paste & MSL',
    code: 'PST-01',
    requiredRoles: ['OPERATOR', 'QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
    description: 'Refrigerated jar thaw timer, jar-life tracking, and MSL floor life',
    shortcut: '5',
    allowGuestReadOnly: true,
    iconName: 'Layers'
  },
  REFLOW: {
    id: 'REFLOW',
    domainId: 'OPERATIONS',
    label: 'Reflow Thermal Profile',
    shortLabel: 'Reflow Profile',
    code: 'RFW-01',
    requiredRoles: ['OPERATOR', 'MAINTENANCE', 'LINE_LEAD', 'SYSTEM_ADMIN'],
    description: '10-zone oven temperatures, PWI index, and thermal drift alarms',
    shortcut: '6',
    allowGuestReadOnly: true,
    iconName: 'Flame'
  },
  AGV_LOGISTICS: {
    id: 'AGV_LOGISTICS',
    domainId: 'OPERATIONS',
    label: 'AGV Material Fleet',
    shortLabel: 'AGV Logistics',
    code: 'AGV-01',
    requiredRoles: ['OPERATOR', 'LINE_LEAD', 'MAINTENANCE', 'SYSTEM_ADMIN'],
    description: 'Autonomous mobile robot fleet, reel delivery missions, and docking',
    shortcut: '7',
    allowGuestReadOnly: true,
    iconName: 'Truck'
  },

  // Quality & Traceability Domain
  COMPLIANCE: {
    id: 'COMPLIANCE',
    domainId: 'QUALITY',
    label: 'Cleanroom eDHR Release',
    shortLabel: 'eDHR Release',
    code: 'DHR-01',
    requiredRoles: ['QUALITY_LEAD', 'SYSTEM_ADMIN'],
    description: '21 CFR Part 11 lot release gate, electronic signatures, and audit trails',
    shortcut: '8',
    allowGuestReadOnly: false,
    iconName: 'Shield'
  },
  GENEALOGY: {
    id: 'GENEALOGY',
    domainId: 'QUALITY',
    label: 'Traceability & Recall',
    shortLabel: 'Genealogy',
    code: 'TRC-01',
    requiredRoles: ['OPERATOR', 'MAINTENANCE', 'QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
    description: '4-level PCB genealogy tree, forward/backward component recall',
    shortcut: '9',
    allowGuestReadOnly: true,
    iconName: 'GitFork'
  },
  REWORK: {
    id: 'REWORK',
    domainId: 'QUALITY',
    label: 'AOI Defect Rework',
    shortLabel: 'Rework Kiosk',
    code: 'RWK-01',
    requiredRoles: ['OPERATOR', 'QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
    description: 'Defect inspection triage, component repair dispositions, and scrap log',
    shortcut: '0',
    allowGuestReadOnly: true,
    iconName: 'Crosshair'
  },
  PREDICTIVE: {
    id: 'PREDICTIVE',
    domainId: 'QUALITY',
    label: 'Predictive Intelligence & SPC',
    shortLabel: 'Predictive SPC',
    code: 'SPC-01',
    requiredRoles: ['QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
    description: 'EWMA / CUSUM thermal drift detection and automated machine interlocks',
    shortcut: 'p',
    allowGuestReadOnly: true,
    iconName: 'Activity'
  },

  // Diagnostics & Audit Domain
  AUDIT_TRAIL: {
    id: 'AUDIT_TRAIL',
    domainId: 'DIAGNOSTICS',
    label: 'OT Gateway & Hash Ledger',
    shortLabel: 'Raw OT Logs',
    code: 'LOG-01',
    requiredRoles: ['QUALITY_LEAD', 'SYSTEM_ADMIN'],
    description: 'Fuji Nexim raw TCP frames and SHA-256 cryptographic audit ledger',
    shortcut: 'l',
    allowGuestReadOnly: false,
    iconName: 'Terminal'
  }
};

export const CANONICAL_STATION_ORDER: NavTab[] = [
  'FLEET',
  'SUPERVISOR',
  'OPERATOR',
  'SPI',
  'SOLDER_PASTE',
  'REFLOW',
  'AGV_LOGISTICS',
  'COMPLIANCE',
  'GENEALOGY',
  'REWORK',
  'PREDICTIVE',
  'AUDIT_TRAIL'
];

/**
 * Returns all stations belonging to a specific operational domain in canonical order.
 */
export function getStationsForDomain(domainId: DomainId): StationConfig[] {
  return CANONICAL_STATION_ORDER
    .map(tab => STATIONS[tab])
    .filter(station => station.domainId === domainId);
}

/**
 * Checks whether a given tab is accessible for the specified operator or unauthenticated guest.
 */
export function isTabAllowed(tab: NavTab, operator: OperatorProfile | null): boolean {
  const config = STATIONS[tab];
  if (!config) return false;
  if (!operator) {
    return config.allowGuestReadOnly;
  }
  return authService.hasRole(...config.requiredRoles);
}

/**
 * Deterministically resolves the active tab on initial load or auth state change.
 * If the requested tab is authorized, it is returned.
 * If unauthorized, it deterministically falls back to the first permitted tab in canonical order.
 */
export function getInitialOrPermittedTab(
  requestedTab: NavTab,
  operator: OperatorProfile | null
): NavTab {
  if (isTabAllowed(requestedTab, operator)) {
    return requestedTab;
  }

  // Canonical fallback search
  const fallback = CANONICAL_STATION_ORDER.find(tab => isTabAllowed(tab, operator));
  // If even that fails, default to lowest privilege read-only station (SPI)
  return fallback ?? 'SPI';
}
