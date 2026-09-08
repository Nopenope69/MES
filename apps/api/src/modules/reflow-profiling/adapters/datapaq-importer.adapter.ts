import {
  IProfilerImporter,
  ProfilerFile,
  RawProfilerRun,
  RawProfilerProbe
} from './profiler-importer.interface';

export class DatapaqImporterAdapter implements IProfilerImporter {
  readonly vendorFormat = 'DATAPAQ' as const;

  canParse(file: ProfilerFile): boolean {
    const name = file.fileName.toLowerCase();
    if (name.endsWith('.paqfile') || name.endsWith('.paq')) {
      return true;
    }

    const head = file.buffer.toString('utf8', 0, Math.min(file.buffer.length, 1024));
    if (head.includes('Datapaq') || head.includes('Insight') || head.includes('Q18') || head.includes('DATAPAQ')) {
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

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('//'));

    let model = 'Datapaq Q18';
    let serial = 'DPQ-UNKNOWN';
    let sampleInterval = 0.5;
    let isFahrenheit = false;
    const probeLabels: Record<number, string> = {};
    const probeSamples: Record<number, Array<{ timeSeconds: number; temperatureC: number }>> = {};

    let dataStarted = false;
    let columnIndices: number[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      // Metadata detection
      if (line.toLowerCase().includes('serial:') || line.toLowerCase().includes('serial number:')) {
        serial = line.split(':')[1]?.trim() || serial;
        continue;
      }
      if (line.toLowerCase().includes('logger:') || line.toLowerCase().includes('paq model:')) {
        model = line.split(':')[1]?.trim() || model;
        continue;
      }
      if (line.toLowerCase().includes('interval:')) {
        const rawInt = parseFloat(line.split(':')[1]?.trim());
        if (!isNaN(rawInt)) sampleInterval = rawInt;
        continue;
      }
      if (line.toLowerCase().includes('unit: °f') || line.toLowerCase().includes('unit: f') || line.toLowerCase().includes('[fahrenheit]')) {
        isFahrenheit = true;
        continue;
      }

      // Check for table header line: usually "Time" or "Date/Time" followed by probes
      const parts = line.split(/[,\t;]/).map((p) => p.trim());
      const firstCol = parts[0].toLowerCase();
      if (!dataStarted && (firstCol === 'time' || firstCol === 'time (s)' || firstCol === 'time (sec)' || firstCol === 'time (min)' || firstCol === 'elapsed time')) {
        dataStarted = true;
        for (let c = 1; c < parts.length; c++) {
          columnIndices.push(c);
          probeLabels[c] = parts[c] || `Channel ${c}`;
          probeSamples[c] = [];
        }
        continue;
      }

      if (dataStarted) {
        if (parts.length < 2) continue;

        // Parse timestamp: supports seconds or HH:MM:SS or MM:SS
        let timeSeconds: number;
        if (parts[0].includes(':')) {
          const timeParts = parts[0].split(':').map(parseFloat);
          if (timeParts.length === 3) {
            timeSeconds = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
          } else if (timeParts.length === 2) {
            timeSeconds = timeParts[0] * 60 + timeParts[1];
          } else {
            throw new Error(`INVALID_DATA: Unrecognized time format "${parts[0]}"`);
          }
        } else {
          timeSeconds = parseFloat(parts[0]);
        }

        if (isNaN(timeSeconds) || !isFinite(timeSeconds)) {
          throw new Error(`INVALID_DATA: Non-numeric timestamp "${parts[0]}"`);
        }

        for (const c of columnIndices) {
          if (c >= parts.length) continue;
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
      throw new Error('PARSE_FAILED: No valid thermocouple probe readings found in Datapaq file');
    }

    const probes: RawProfilerProbe[] = channelKeys.map((c, i) => {
      const samples = probeSamples[c];
      for (let s = 1; s < samples.length; s++) {
        if (samples[s].timeSeconds < samples[s - 1].timeSeconds) {
          throw new Error(
            `NON_MONOTONIC_TIMESTAMPS: Sample timestamp at index ${s} (${samples[s].timeSeconds}s) is earlier than preceding sample (${samples[s - 1].timeSeconds}s)`
          );
        }
      }

      const label = probeLabels[c] || `Channel ${i + 1}`;
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
      vendorFormat: 'DATAPAQ',
      profilerHardware: {
        manufacturer: 'Fluke / Datapaq',
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
