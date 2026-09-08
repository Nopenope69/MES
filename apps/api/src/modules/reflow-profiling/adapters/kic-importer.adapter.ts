import {
  IProfilerImporter,
  ProfilerFile,
  RawProfilerRun,
  RawProfilerProbe
} from './profiler-importer.interface';

export class KicImporterAdapter implements IProfilerImporter {
  readonly vendorFormat = 'KIC' as const;

  canParse(file: ProfilerFile): boolean {
    const name = file.fileName.toLowerCase();
    if (name.endsWith('.kic2000profile') || name.endsWith('.kic2000mvp') || name.endsWith('.kic')) {
      return true;
    }

    // Sniff buffer header
    const head = file.buffer.toString('utf8', 0, Math.min(file.buffer.length, 1024));
    if (head.includes('[KIC') || head.includes('KIC 2000') || head.includes('SlimKIC') || head.includes('KIC Explorer')) {
      return true;
    }

    return false;
  }

  async parse(file: ProfilerFile): Promise<RawProfilerRun> {
    if (file.fileSizeBytes > 15 * 1024 * 1024) {
      throw new Error('FILE_SIZE_EXCEEDED: File size exceeds 15MB security limit');
    }

    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');

    // Security: Reject XML External Entity injection attempts
    if (/<!ENTITY/i.test(text) || /SYSTEM\s+["']/i.test(text)) {
      throw new Error('SECURITY_VIOLATION: XML external entity (XXE) expansion attempt detected');
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));

    let inData = false;
    let sampleInterval = 0.5;
    let model = 'SlimKIC 2000';
    let serial = 'KIC-UNKNOWN';
    let recipeName: string | undefined;
    let conveyorSpeed: number | undefined;
    let isFahrenheit = false;
    let isMinutes = false;
    const probeLabels: Record<number, string> = {};
    const probeOffsets: Record<number, number> = {};

    const probeSamples: Record<number, Array<{ timeSeconds: number; temperatureC: number }>> = {};
    let dataHeaders: string[] = [];

    for (const line of lines) {
      if (line.startsWith('[') && line.endsWith(']')) {
        const section = line.slice(1, -1).toUpperCase();
        if (section === 'DATA' || section === 'READINGS') {
          inData = true;
        }
        continue;
      }

      if (!inData) {
        // Parse metadata key-value
        const eqIdx = line.indexOf('=');
        if (eqIdx !== -1) {
          const key = line.slice(0, eqIdx).trim().toUpperCase();
          const val = line.slice(eqIdx + 1).trim();

          if (key === 'MODEL') model = val;
          else if (key === 'SERIAL') serial = val;
          else if (key === 'SAMPLEINTERVAL') sampleInterval = parseFloat(val) || 0.5;
          else if (key === 'RECIPE') recipeName = val;
          else if (key === 'SPEED' || key === 'CONVEYORSPEED') conveyorSpeed = parseFloat(val);
          else if (key === 'TEMPERATUREUNIT' && val.toUpperCase().startsWith('F')) isFahrenheit = true;
          else if (key === 'TIMEUNIT' && val.toUpperCase().startsWith('MIN')) isMinutes = true;
          else if (/^TC\d+$/.test(key)) {
            const tcNum = parseInt(key.replace('TC', ''), 10);
            probeLabels[tcNum] = val;
          } else if (/^OFFSET\d+$/.test(key)) {
            const tcNum = parseInt(key.replace('OFFSET', ''), 10);
            probeOffsets[tcNum] = parseFloat(val) || 0;
          }
        }
      } else {
        // We are in data section
        // Check for CSV header line
        if (dataHeaders.length === 0) {
          const parts = line.split(/[,\t;]/).map((p) => p.trim());
          if (parts[0].toLowerCase().includes('time') || parts[0].toLowerCase().includes('sec')) {
            dataHeaders = parts;
            for (let i = 1; i < parts.length; i++) {
              probeSamples[i] = [];
              if (!probeLabels[i]) {
                probeLabels[i] = parts[i] || `TC ${i}`;
              }
            }
            continue;
          } else {
            // No header, synthesize headers
            dataHeaders = ['Time'];
            for (let i = 1; i < parts.length; i++) {
              dataHeaders.push(`TC${i}`);
              probeSamples[i] = [];
              if (!probeLabels[i]) {
                probeLabels[i] = `TC ${i}`;
              }
            }
          }
        }

        const cols = line.split(/[,\t;]/).map((c) => c.trim());
        if (cols.length < 2) continue;

        let rawTime = parseFloat(cols[0]);
        if (isNaN(rawTime) || !isFinite(rawTime)) {
          throw new Error(`INVALID_DATA: Non-numeric timestamp "${cols[0]}" encountered`);
        }

        const timeSeconds = isMinutes ? rawTime * 60 : rawTime;

        for (let i = 1; i < cols.length; i++) {
          if (!probeSamples[i]) probeSamples[i] = [];
          let rawTemp = parseFloat(cols[i]);
          if (isNaN(rawTemp) || !isFinite(rawTemp)) {
            throw new Error(`INVALID_DATA: Non-numeric temperature value "${cols[i]}" on probe ${i}`);
          }

          let tempC = isFahrenheit ? ((rawTemp - 32) * 5) / 9 : rawTemp;
          const offset = probeOffsets[i] || 0;
          tempC += offset;

          if (tempC < -50 || tempC > 400) {
            throw new Error(`TEMPERATURE_OUT_OF_BOUNDS: Temperature ${tempC}°C on probe ${i} exceeds physical limits (-50°C to 400°C)`);
          }

          probeSamples[i].push({
            timeSeconds: Number(timeSeconds.toFixed(3)),
            temperatureC: Number(tempC.toFixed(2))
          });
        }
      }
    }

    const probeIndices = Object.keys(probeSamples)
      .map(Number)
      .sort((a, b) => a - b);

    if (probeIndices.length === 0) {
      throw new Error('PARSE_FAILED: No valid thermocouple probe readings found in KIC profile file');
    }

    const probes: RawProfilerProbe[] = probeIndices.map((idx) => {
      const samples = probeSamples[idx];
      // Structural validation: monotonic timestamps
      for (let s = 1; s < samples.length; s++) {
        if (samples[s].timeSeconds < samples[s - 1].timeSeconds) {
          throw new Error(
            `NON_MONOTONIC_TIMESTAMPS: Sample timestamp at index ${s} (${samples[s].timeSeconds}s) is earlier than preceding sample (${samples[s - 1].timeSeconds}s)`
          );
        }
      }

      // Infer thermal role if indicated in label
      const label = probeLabels[idx] || `TC ${idx}`;
      let thermalRole: RawProfilerProbe['thermalRole'];
      const lLower = label.toLowerCase();
      if (lLower.includes('hot') || lLower.includes('peak')) thermalRole = 'HOTSPOT';
      else if (lLower.includes('cold') || lLower.includes('inductor')) thermalRole = 'COLDSPOT';
      else if (lLower.includes('limit') || lLower.includes('bga')) thermalRole = 'COMPONENT_LIMIT';
      else if (lLower.includes('joint') || lLower.includes('lead') || lLower.includes('solder')) thermalRole = 'SOLDER_JOINT';
      else if (lLower.includes('surface') || lLower.includes('board')) thermalRole = 'BOARD_SURFACE';

      return {
        probeIndex: idx,
        label,
        thermalRole,
        calibrationOffsetC: probeOffsets[idx],
        samples
      };
    });

    const maxSamples = Math.max(...probes.map((p) => p.samples.length));

    return {
      vendorFormat: 'KIC',
      profilerHardware: {
        manufacturer: 'KIC',
        model,
        serialNumber: serial,
        totalProbesUsed: probes.length,
        sampleIntervalSeconds: sampleInterval,
        sampleCount: maxSamples
      },
      ovenSettings: {
        recipeName,
        conveyorSpeedCmPerMin: conveyorSpeed
      },
      probes
    };
  }
}
