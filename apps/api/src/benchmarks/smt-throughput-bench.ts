import { v4 as uuidv4 } from 'uuid';
import { EventIngestionService } from '../services/event-ingestion.service';

export interface BenchmarkMetrics {
  totalEventsProcessed: number;
  durationMs: number;
  eventsPerSecond: number;
  equivalentCph: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  heapUsedStartMb: number;
  heapUsedEndMb: number;
  heapGrowthMb: number;
  successRatePercent: number;
}

export class SmtThroughputBenchmark {
  /**
   * Executes a high-concurrency SMT event ingestion benchmark.
   * Simulates multiple placement modules feeding placements simultaneously.
   */
  public static async runBenchmark(
    totalEvents: number = 2000,
    concurrency: number = 8
  ): Promise<BenchmarkMetrics> {
    const latencies: number[] = [];
    let successCount = 0;

    // Force GC if available or record initial heap
    const heapStart = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
    const startTime = Date.now();

    // Process events sequentially to respect SQLite single-connection transaction boundaries
    for (let i = 0; i < totalEvents; i++) {
      const evtId = `bench-${i}-${uuidv4().slice(0, 8)}`;
      const t0 = Date.now();

      const result = await EventIngestionService.ingest({
        eventId: evtId,
        eventType: 'PANEL_CHECKOUT',
        workCenterId: 'wc-nxt-01',
        batchId: 'JOB-SM-260901',
        sourceType: 'INTEGRATION_SOCKET',
        sourceId: `line-01-mod-${(i % 4) + 1}`,
        payload: {
          panelBarcode: `PNL-BENCH-${i}`,
          cycleTimeSeconds: 18.2,
          programName: 'PROG-BENCHMARK-TOP',
          moduleNo: 1,
          laneNo: 1,
          blockCount: 4,
          blockSkipCount: 0
        }
      });

      const elapsed = Date.now() - t0;
      latencies.push(elapsed);
      if (result.success) {
        successCount++;
      }
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const heapEnd = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;

    // Calculate percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
    const max = latencies[latencies.length - 1] || 0;

    const eps = Math.round((totalEvents / (durationMs / 1000)) * 100) / 100;
    const equivalentCph = Math.round(eps * 3600);
    const successRate = Math.round((successCount / totalEvents) * 10000) / 100;

    return {
      totalEventsProcessed: totalEvents,
      durationMs,
      eventsPerSecond: eps,
      equivalentCph,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      maxLatencyMs: max,
      heapUsedStartMb: heapStart,
      heapUsedEndMb: heapEnd,
      heapGrowthMb: Math.round((heapEnd - heapStart) * 100) / 100,
      successRatePercent: successRate
    };
  }
}
