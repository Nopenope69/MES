export interface ProfilerFile {
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
  fileSizeBytes: number;
}

export interface RawProfilerProbe {
  probeIndex: number;
  label: string;
  thermalRole?: 'HOTSPOT' | 'COLDSPOT' | 'COMPONENT_LIMIT' | 'SOLDER_JOINT' | 'BOARD_SURFACE';
  componentRefDes?: string;
  packageType?: string;
  calibrationOffsetC?: number;
  samples: Array<{ timeSeconds: number; temperatureC: number }>;
}

export interface RawProfilerRun {
  vendorFormat: 'KIC' | 'DATAPAQ' | 'MOLE' | 'GENERIC_CSV';
  profilerHardware: {
    manufacturer: string;
    model: string;
    serialNumber: string;
    totalProbesUsed: number;
    sampleIntervalSeconds: number;
    sampleCount: number;
  };
  ovenSettings?: {
    recipeName?: string;
    conveyorSpeedCmPerMin?: number;
    zoneSetpointsC?: number[];
  };
  probes: RawProfilerProbe[];
  startTime?: string;
}

export interface IProfilerImporter {
  readonly vendorFormat: 'KIC' | 'DATAPAQ' | 'MOLE' | 'GENERIC_CSV';
  canParse(file: ProfilerFile): boolean;
  parse(file: ProfilerFile): Promise<RawProfilerRun>;
}
