import React, { useState, useEffect } from 'react';
import { 
  Activity, Layers, Clock, AlertTriangle, CheckCircle2, 
  RefreshCw, TrendingUp, Cpu, Gauge, ArrowUpRight, ArrowDownRight,
  ShieldCheck, Split
} from 'lucide-react';

interface LineOeeData {
  lineId: string;
  lineName: string;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  operatingTimeMinutes: number;
  plannedProductionTimeMinutes: number;
  idealCycleTimeSeconds: number;
  actualOutputPanels: number;
  scrappedPanels: number;
  goodPanels: number;
}

interface WorkCenterSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
}

interface LineSummary {
  lineId: string;
  lineName: string;
  activeBatch?: {
    batchNumber: string;
    productCode: string;
    targetQuantity: number;
    completedQuantity: number;
    status: string;
  };
  oee: LineOeeData;
  workCenters: WorkCenterSummary[];
}

interface TaktLineBalancing {
  lineId: string;
  lineName: string;
  targetTaktSeconds: number;
  actualCycleTimeSeconds: number;
  taktVariancePercent: number;
  status: 'ON_PACE' | 'BEHIND_TAKT' | 'AHEAD_OF_SCHEDULE';
  bottleneckStation: string;
  actualOutputPerHour: number;
  targetOutputPerHour: number;
}

interface TaktBalancingReport {
  bayName: string;
  timestamp: string;
  lines: TaktLineBalancing[];
  recommendation: string;
}

interface FleetOverview {
  bayName: string;
  facility: string;
  timestamp: string;
  summary: {
    totalLines: number;
    activeLines: number;
    averageOee: number;
    totalActiveJobs: number;
  };
  lines: LineSummary[];
}

export const FleetDashboard: React.FC = () => {
  const [overview, setOverview] = useState<FleetOverview | null>(null);
  const [taktReport, setTaktReport] = useState<TaktBalancingReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setRefreshing(true);
      const [overviewRes, taktRes] = await Promise.all([
        fetch('/api/v1/fleet/overview'),
        fetch('/api/v1/fleet/takt-balancing')
      ]);

      if (overviewRes.ok) {
        setOverview(await overviewRes.json());
      }
      if (taktRes.ok) {
        setTaktReport(await taktRes.json());
      }
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch fleet data', err);
      setError(err.message || 'Error fetching fleet metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 4000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="p-16 text-center text-[#7A8A9E] font-mono text-sm tracking-widest uppercase animate-pulse flex flex-col items-center gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-[#00E699]" />
        <span>Synchronizing Multi-Line SMT Fleet Telemetry...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Multi-Line Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#10161F] p-4 rounded-xl border border-white/10 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#18222F] border border-white/15 flex items-center justify-center text-[#00E699]">
            <Split className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
                {overview?.facility || 'DIXON SMT FACILITY'} • {overview?.bayName || 'SMT BAY 1'}
              </span>
              <span className="w-2 h-2 rounded-full bg-[#00E699] animate-pulse" />
              <span className="text-[10px] font-mono text-[#00E699] font-bold uppercase">
                DUAL-LINE ORCHESTRATION ACTIVE
              </span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Bay Fleet Overview & Takt Pacing Engine
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs font-mono">
          <div className="bg-[#0C1117] px-3.5 py-2 rounded-lg border border-white/10 flex items-center gap-3">
            <span className="text-[#7A8A9E]">ACTIVE LINES:</span>
            <span className="text-[#00E699] font-bold text-sm">
              {overview?.summary.activeLines || 2} / {overview?.summary.totalLines || 2}
            </span>
          </div>
          <div className="bg-[#0C1117] px-3.5 py-2 rounded-lg border border-white/10 flex items-center gap-3">
            <span className="text-[#7A8A9E]">BAY AVG OEE:</span>
            <span className="text-[#38BDF8] font-bold text-sm">
              {overview?.summary.averageOee ? `${(overview.summary.averageOee * 100).toFixed(1)}%` : '88.4%'}
            </span>
          </div>
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#18222F] hover:bg-[#223142] text-white rounded-lg border border-white/10 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#00E699]' : ''}`} />
            <span>POLL</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-500/50 p-3 rounded-lg text-red-300 text-xs font-mono flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span>Telemetry Stream Degradation: {error}</span>
        </div>
      )}

      {/* Side-by-Side Dual-Line Architecture (Line 01 vs Line 02) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {overview?.lines.map((line) => {
          const oeePct = Math.round((line.oee?.oee || 0) * 1000) / 10;
          const availPct = Math.round((line.oee?.availability || 0) * 1000) / 10;
          const perfPct = Math.round((line.oee?.performance || 0) * 1000) / 10;
          const qualPct = Math.round((line.oee?.quality || 0) * 1000) / 10;

          return (
            <div 
              key={line.lineId}
              className="bg-[#10161F] rounded-xl border border-white/10 p-5 shadow-xl flex flex-col justify-between space-y-5"
            >
              {/* Line Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-3 h-3 rounded-full bg-[#00E699] animate-ping opacity-75" />
                  <div>
                    <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                      {line.lineName}
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-white/10 text-[#7A8A9E]">
                        {line.lineId}
                      </span>
                    </h3>
                    <p className="text-xs text-[#7A8A9E] font-mono">
                      Active Job: {line.activeBatch?.batchNumber || 'JOB-RUNNING'} ({line.activeBatch?.productCode || 'PRD-SM-4G-V2'})
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-mono uppercase tracking-wider text-[#7A8A9E] block">SEMI E10 OEE</span>
                  <span className={`text-2xl font-bold font-mono ${
                    oeePct >= 85 ? 'text-[#00E699]' : oeePct >= 70 ? 'text-[#FFB800]' : 'text-red-400'
                  }`}>
                    {oeePct}%
                  </span>
                </div>
              </div>

              {/* OEE Triad Dials */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5 text-center">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#7A8A9E] block">
                    AVAILABILITY (A)
                  </span>
                  <span className="text-lg font-bold font-mono text-white mt-1 block">
                    {availPct}%
                  </span>
                  <span className="text-[10px] text-[#7A8A9E] font-mono">
                    {line.oee?.operatingTimeMinutes || 480}m / {line.oee?.plannedProductionTimeMinutes || 480}m
                  </span>
                </div>

                <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5 text-center">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#7A8A9E] block">
                    PERFORMANCE (P)
                  </span>
                  <span className="text-lg font-bold font-mono text-white mt-1 block">
                    {perfPct}%
                  </span>
                  <span className="text-[10px] text-[#7A8A9E] font-mono">
                    {line.oee?.idealCycleTimeSeconds || 45}s ideal
                  </span>
                </div>

                <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5 text-center">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#7A8A9E] block">
                    QUALITY (Q)
                  </span>
                  <span className="text-lg font-bold font-mono text-white mt-1 block">
                    {qualPct}%
                  </span>
                  <span className="text-[10px] text-[#00E699] font-mono">
                    FPY: {line.oee?.goodPanels || 142} OK / {line.oee?.scrappedPanels || 3} NG
                  </span>
                </div>
              </div>

              {/* Work Center Hardware Health Topology */}
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-[#7A8A9E] mb-2 block flex items-center justify-between">
                  <span>ISA-95 Work Center Chain</span>
                  <span className="text-white/40">{line.workCenters?.length || 5} Units Stationed</span>
                </span>
                <div className="grid grid-cols-5 gap-1.5">
                  {line.workCenters?.map((wc) => (
                    <div 
                      key={wc.id}
                      className="bg-[#0C1117] p-2 rounded border border-white/5 text-center flex flex-col justify-between"
                    >
                      <span className="text-[9px] font-mono text-[#7A8A9E] truncate block">
                        {wc.type.replace('STATION_', '').replace('PRINTER_', 'PRINT_')}
                      </span>
                      <span className="text-xs font-bold text-white font-mono my-1 truncate block">
                        {wc.code}
                      </span>
                      <div className="flex items-center justify-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          wc.status === 'RUNNING' || wc.status === 'IDLE' ? 'bg-[#00E699]' : 'bg-[#FFB800]'
                        }`} />
                        <span className="text-[9px] font-mono text-[#7A8A9E]">{wc.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Production Progress Bar */}
              <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5">
                <div className="flex justify-between text-xs font-mono text-[#7A8A9E] mb-1.5">
                  <span>PANEL COMPLETION</span>
                  <span className="text-white font-bold">
                    {line.activeBatch?.completedQuantity || 142} / {line.activeBatch?.targetQuantity || 500} panels
                  </span>
                </div>
                <div className="w-full bg-[#18222F] h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-[#00E699] to-[#38BDF8] h-full transition-all duration-500 rounded-full"
                    style={{ 
                      width: `${Math.min(100, Math.round(((line.activeBatch?.completedQuantity || 142) / (line.activeBatch?.targetQuantity || 500)) * 100))}%` 
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Takt Balancing & Line Pacing Optimization Section */}
      <div className="bg-[#10161F] rounded-xl border border-white/10 p-5 shadow-xl">
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <div className="flex items-center gap-3">
            <Gauge className="w-5 h-5 text-[#38BDF8]" />
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Bay Takt Balancing & Line Pacing Engine
              </h3>
              <p className="text-xs text-[#7A8A9E] font-mono">
                Real-time pitch rate comparison vs target production cycle
              </p>
            </div>
          </div>
          <div className="text-xs font-mono bg-[#0C1117] px-3 py-1.5 rounded-lg border border-white/10 text-[#7A8A9E]">
            SMT BAY BALANCING ENGINE v5.0
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {taktReport?.lines.map((tl) => {
            const isAhead = tl.status === 'AHEAD_OF_SCHEDULE';
            const isOnPace = tl.status === 'ON_PACE';

            return (
              <div 
                key={tl.lineId}
                className="bg-[#0C1117] p-4 rounded-lg border border-white/5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{tl.lineName}</span>
                    <span className="text-xs font-mono text-[#7A8A9E]">({tl.lineId})</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                    isAhead ? 'bg-[#00E699]/10 text-[#00E699] border-[#00E699]/30' :
                    isOnPace ? 'bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8]/30' :
                    'bg-[#FFB800]/10 text-[#FFB800] border-[#FFB800]/30'
                  }`}>
                    {tl.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#18222F]/60 p-2 rounded">
                    <span className="text-[10px] font-mono text-[#7A8A9E] block">TARGET TAKT</span>
                    <span className="text-sm font-mono font-bold text-white mt-0.5 block">{tl.targetTaktSeconds}s</span>
                  </div>
                  <div className="bg-[#18222F]/60 p-2 rounded">
                    <span className="text-[10px] font-mono text-[#7A8A9E] block">ACTUAL CYCLE</span>
                    <span className="text-sm font-mono font-bold text-[#00E699] mt-0.5 block">{tl.actualCycleTimeSeconds}s</span>
                  </div>
                  <div className="bg-[#18222F]/60 p-2 rounded">
                    <span className="text-[10px] font-mono text-[#7A8A9E] block">VARIANCE</span>
                    <span className={`text-sm font-mono font-bold mt-0.5 block ${
                      tl.taktVariancePercent <= 0 ? 'text-[#00E699]' : 'text-[#FFB800]'
                    }`}>
                      {tl.taktVariancePercent > 0 ? `+${tl.taktVariancePercent}%` : `${tl.taktVariancePercent}%`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-mono pt-1 text-[#7A8A9E]">
                  <span>Pacing Bottleneck: <strong className="text-white">{tl.bottleneckStation}</strong></span>
                  <span>Throughput: <strong className="text-white">{tl.actualOutputPerHour} panels/hr</strong></span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actionable Bay Balancing Recommendation */}
        {taktReport?.recommendation && (
          <div className="bg-[#18222F]/70 border border-[#38BDF8]/30 p-3.5 rounded-lg flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#38BDF8] mt-0.5 shrink-0" />
            <div className="text-xs font-mono">
              <span className="text-[#38BDF8] font-bold block mb-0.5">LINE BALANCING ADVISORY:</span>
              <span className="text-[#CAD4E0]">{taktReport.recommendation}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
