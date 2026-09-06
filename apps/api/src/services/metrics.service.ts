/**
 * MetricsService (Track E: Observability & Golden Signals)
 *
 * Lightweight, high-throughput Prometheus metrics registry tailored for
 * high-speed SMT manufacturing lines and industrial edge deployments.
 */

export interface MetricLabels {
  [key: string]: string | number;
}

class Counter {
  private values: Map<string, number> = new Map();

  constructor(public name: string, public help: string) {}

  public inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.formatLabels(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  public get(labels: MetricLabels = {}): number {
    return this.values.get(this.formatLabels(labels)) || 0;
  }

  public toPrometheus(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`
    ];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, val] of this.values.entries()) {
        lines.push(`${this.name}${key} ${val}`);
      }
    }
    return lines.join('\n');
  }

  private formatLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    const formatted = entries.map(([k, v]) => `${k}="${v}"`).join(',');
    return `{${formatted}}`;
  }
}

class Gauge {
  private values: Map<string, number> = new Map();

  constructor(public name: string, public help: string) {}

  public set(labels: MetricLabels, value: number): void;
  public set(value: number): void;
  public set(labelsOrVal: MetricLabels | number, val?: number): void {
    if (typeof labelsOrVal === 'number') {
      this.values.set('', labelsOrVal);
    } else {
      const key = this.formatLabels(labelsOrVal);
      this.values.set(key, val ?? 0);
    }
  }

  public get(labels: MetricLabels = {}): number {
    return this.values.get(this.formatLabels(labels)) || 0;
  }

  public toPrometheus(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`
    ];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, val] of this.values.entries()) {
        lines.push(`${this.name}${key} ${val}`);
      }
    }
    return lines.join('\n');
  }

  private formatLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    const formatted = entries.map(([k, v]) => `${k}="${v}"`).join(',');
    return `{${formatted}}`;
  }
}

class Histogram {
  private count: Map<string, number> = new Map();
  private sum: Map<string, number> = new Map();
  private bucketCounts: Map<string, Map<number, number>> = new Map();

  constructor(public name: string, public help: string, public buckets: number[]) {
    this.buckets.sort((a, b) => a - b);
  }

  public observe(labels: MetricLabels = {}, value: number): void {
    const key = this.formatLabels(labels);

    // Sum and count
    this.count.set(key, (this.count.get(key) || 0) + 1);
    this.sum.set(key, (this.sum.get(key) || 0) + value);

    // Bucket counts
    if (!this.bucketCounts.has(key)) {
      this.bucketCounts.set(key, new Map());
    }
    const bMap = this.bucketCounts.get(key)!;

    for (const b of this.buckets) {
      if (value <= b) {
        bMap.set(b, (bMap.get(b) || 0) + 1);
      }
    }
  }

  public toPrometheus(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`
    ];

    for (const [key, cnt] of this.count.entries()) {
      const bMap = this.bucketCounts.get(key) || new Map();
      let cumulative = 0;

      for (const b of this.buckets) {
        cumulative += bMap.get(b) || 0;
        const bucketLabels = key.length > 0
          ? `{${key.slice(1, -1)},le="${b}"}`
          : `{le="${b}"}`;
        lines.push(`${this.name}_bucket${bucketLabels} ${cumulative}`);
      }

      const infLabels = key.length > 0 ? `{${key.slice(1, -1)},le="+Inf"}` : `{le="+Inf"}`;
      lines.push(`${this.name}_bucket${infLabels} ${cnt}`);
      lines.push(`${this.name}_sum${key} ${this.sum.get(key) || 0}`);
      lines.push(`${this.name}_count${key} ${cnt}`);
    }

    return lines.join('\n');
  }

  private formatLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    const formatted = entries.map(([k, v]) => `${k}="${v}"`).join(',');
    return `{${formatted}}`;
  }
}

export class MetricsService {
  private static instance: MetricsService;

  // 1. SMT Placement & Quality Metrics
  public readonly smtPlacementsTotal = new Counter(
    'smt_placements_total',
    'Total component placements verified and recorded on SMT lines'
  );
  public readonly smtCurrentCph = new Gauge(
    'smt_current_cph',
    'Live instantaneous placements per hour (CPH) calculated on read'
  );
  public readonly smtFeederErrorsTotal = new Counter(
    'smt_feeder_errors_total',
    'Feeder errors recorded (dropped parts, vision reject, empty pickup)'
  );

  // 2. Hardware Socket Telemetry
  public readonly fujiFramesTotal = new Counter(
    'smt_fuji_frames_total',
    'Total Fuji Nexim host communication frames received/sent'
  );
  public readonly fujiActiveConnections = new Gauge(
    'smt_fuji_active_connections',
    'Number of active machine TCP sockets connected to the gateway'
  );
  public readonly fujiFrameLatency = new Histogram(
    'smt_fuji_frame_latency_seconds',
    'End-to-end frame ingestion to projection commit latency in seconds',
    [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1]
  );

  // 3. HTTP RED (Rate, Errors, Duration)
  public readonly httpRequestsTotal = new Counter(
    'http_requests_total',
    'Total HTTP requests processed by endpoint and response status'
  );
  public readonly httpRequestDuration = new Histogram(
    'http_request_duration_seconds',
    'HTTP request latency in seconds',
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]
  );

  // 4. Compliance & Material Safety
  public readonly mslExpiredReels = new Gauge(
    'smt_msl_expired_reels_count',
    'Number of active component reels with expired JEDEC floor life'
  );
  public readonly pasteJarsExpiringSoon = new Gauge(
    'smt_paste_jars_expiring_soon_count',
    'Solder paste jars within 60 minutes of stencil-life expiration'
  );
  public readonly ledgerIntegrityStatus = new Gauge(
    'smt_ledger_integrity_status',
    '21 CFR Part 11 ledger integrity status (1 = unbroken, 0 = tampered)'
  );

  private constructor() {
    this.ledgerIntegrityStatus.set(1);
    this.fujiActiveConnections.set(0);
  }

  public static getInstance(): MetricsService {
    if (!this.instance) {
      this.instance = new MetricsService();
    }
    return this.instance;
  }

  /**
   * Generates the Prometheus text exposition payload.
   */
  public getPrometheusMetrics(): string {
    const sections = [
      this.smtPlacementsTotal.toPrometheus(),
      this.smtCurrentCph.toPrometheus(),
      this.smtFeederErrorsTotal.toPrometheus(),
      this.fujiFramesTotal.toPrometheus(),
      this.fujiActiveConnections.toPrometheus(),
      this.fujiFrameLatency.toPrometheus(),
      this.httpRequestsTotal.toPrometheus(),
      this.httpRequestDuration.toPrometheus(),
      this.mslExpiredReels.toPrometheus(),
      this.pasteJarsExpiringSoon.toPrometheus(),
      this.ledgerIntegrityStatus.toPrometheus()
    ];

    return sections.filter(Boolean).join('\n\n') + '\n';
  }
}
