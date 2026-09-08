import {
  IProfilerImporter,
  ProfilerFile,
  RawProfilerRun,
  RawProfilerProbe
} from './profiler-importer.interface';

export class MoleImporterAdapter implements IProfilerImporter {
  readonly vendorFormat = 'MOLE' as const;

  canParse(file: ProfilerFile): boolean {
    const name = file.fileName.toLowerCase();
    if (name.endsWith('.mdm') || name.endsWith('.xmg') || name.endsWith('.mole')) {
      return true;
    }

    const head = file.buffer.toString('utf8', 0, Math.min(file.buffer.length, 1024));
    if (head.includes('M.O.L.E.') || head.includes('ECD') || head.includes('SuperM.O.L.E.') || head.includes('MEGAM.O.L.E.')) {
      return true;
    }

    return false;
  }

  async parse(file: ProfilerFile): Promise<RawProfilerRun> {
    if (file.fileSizeBytes > 15 * 1024 * 1024) {
      throw new Error('FILE_SIZE_EXCEEDED: File size exceeds 15MB security limit');
    }

    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');

    // Security: XXE prevention
    if (/<!ENTITY/i.test(text) || /SYSTEM\s+["']/i.test(text)) {
      throw new Error('SECURITY_VIOLATION: XML external entity (XXE) expansion attempt detected');
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith(';'));

    let model = 'SuperM.O.L.E. Gold 2';
    let serial = 'ECD-UNKNOWN';
    let sampleInterval = 0.5;
    let isFahrenheit = false;
    let isMinutes = false;
    const probeLabels: Record<number, string> = {};
    const probeSamples: Record<number, Array<{ timeSeconds: number; temperatureC: number }>> = {};

    let dataStarted = false;
    let columnCount = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      if (line.toLowerCase().startsWith('instrument:') || line.toLowerCase().startsWith('model:')) {
        model = line.split(':')[1]?.trim() || model;
        continue;
      }
      if (line.toLowerCase().startsWith('serial:') || line.toLowerCase().startsWith('s/n:')) {
        serial = line.split(':')[1]?.trim() || serial;
        continue;
      }
      if (line.toLowerCase().startsWith('sample rate:') || line.toLowerCase().startsWith('interval:')) {
        const parsed = parseFloat(line.split(':')[1]?.trim());
        if (!isNaN(parsed) && parsed > 0) sampleInterval = parsed;
        continue;
      }
      if (line.toLowerCase().includes('scale: fahrenheit') || line.toLowerCase().includes('units: f')) {
        isFahrenheit = true;
        continue;
      }
      if (line.toLowerCase().includes('time scale: minutes')) {
        isMinutes = true;
        continue;
      }

      // Check for start of data table
      const parts = line.split(/[,\t;]/).map((p) => p.trim());
      const first = parts[0].toLowerCase();
      if (!dataStarted && (first === 'time' || first === 'secs' || first === 'seconds' || first === 'offset')) {
        dataStarted = true;
        columnCount = parts.length - 1;
        for (let c = 1; c < parts.length; c++) {
          probeLabels[c] = parts[c] || `Channel ${c}`;
          probeSamples[c] = [];
        }
        continue;
      }

      if (dataStarted) {
        if (parts.length < 2) continue;

        let rawTime = parseFloat(parts[0]);
        if (isNaN(rawTime) || !isFinite(rawTime)) {
          throw new Error(`INVALID_DATA: Non-numeric timestamp "${parts[0]}" encountered in M.O.L.E. file`);
        }

        const timeSeconds = isMinutes ? rawTime * 60 : rawTime;

        for (let c = 1; c <= columnCount && c < parts.length; c++) {
          if (!probeSamples[c]) probeSamples[c] = [];
          const rawVal = parseFloat(parts[c]);
          if (isNaN(rawVal) || !isFinite(rawVal)) {
            throw new Error(`INVALID_DATA: Non-numeric temperature value "${parts[c]}" on channel ${c}`);
          }

          let tempC = isFahrenheit ? ((rawVal - 32) * 5) / 9 : rawVal;

          if (tempC < -50 || tempC > 400) {
            throw new Error(`TEMPERATURE_OUT_OF_BOUNDS: Temperature ${tempC}°C on channel ${c} exceeds physical limits (-50°C to 400°C)`);
          }

          probeSamples[c].push({
            timeSeconds: Number(timeSeconds.toFixed(3)),
            temperatureC: Number(tempC.toFixed(2))
          });
        }
      }
    }

    const channelKeys = Object.keys(probeSamples).map(Number).sort((a, b) => a - b);
    if (channelKeys.length === 0) {
      throw new Error('PARSE_FAILED: No valid thermocouple readings found in M.O.L.E. file');
    }

    const probes: RawProfilerProbe[] = channelKeys.map((c, i) => {
      const samples = probeSamples[c];
      const label = probeLabels[c] || `Ch ${i + 1}`;
      let thermalRole: RawProfilerProbe['thermalRole'];
      const lLower = label.toLowerCase();
      if (lLower.includes('hot') || lLower.includes('peak')) thermalRole = 'HOTSPOT';
      else if (lLower.includes('cold') || lLower.includes('inductor')) thermalRole = 'COLDSPOT';
      else if (lLower.includes('limit') || lLower.includes('bga')) thermalRole = 'COMPONENT_LIMIT';
      else if (lLower.includes('joint') || lLower.includes('lead') || lLower.includes('solder')) thermalRole = 'SOLDER_JOINT';
      else if (lLower.includes('surface') || lLower.includes('board')) thermalRole = 'BOARD_SURFACE';

      return {
        probeIndex: i + 1,
        label,
        thermalRole,
        samples
      };
    });

    const maxSamples = Math.max(...probes.map((p) => p.samples.length));

    return {
      vendorFormat: 'MOLE',
      profilerHardware: {
        manufacturer: 'ECD',
        model,
        serialNumber: serial,
        totalProbesUsed: probes.length,
        sampleIntervalSeconds: sampleInterval,
        sampleCount: maxSamples
      },
      probes
    };
  }
}
