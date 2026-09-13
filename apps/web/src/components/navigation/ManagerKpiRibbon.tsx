import React, { useState } from 'react';
import { 
  Activity, Gauge, CheckCircle2, AlertTriangle, 
  Clock, Copy, ChevronDown, ChevronUp, RefreshCw,
  Zap, AlertCircle, ShieldAlert
} from 'lucide-react';
import { ManagerKpisState, KpiDataStatus } from '../../services/kpi-adapter';

interface ManagerKpiRibbonProps {
  kpis: ManagerKpisState;
  onOpenShiftBriefing: () => void;
}

function renderStatusBadge(status: KpiDataStatus, lastUpdated: number | null) {
  if (status === 'SAMPLE_DATA') {
    return (
      <span 
        className="text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold tracking-wider"
        title="Offline mock fixture data active. Not live telemetry."
      >
        SAMPLE DATA
      </span>
    );
  }

  if (status === 'STALE') {
    const secondsAgo = lastUpdated ? Math.round((Date.now() - lastUpdated) / 1000) : 0;
    return (
      <span 
        className="text-[9px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded flex items-center gap-1"
        title={`Telemetry stale. Last updated ${secondsAgo}s ago.`}
      >
        <Clock className="w-2.5 h-2.5" />
        STALE ({secondsAgo}s)
      </span>
    );
  }

  if (status === 'UNAVAILABLE') {
    return (
      <span 
        className="text-[9px] font-mono text-[#7A8A9E] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded"
        title="Live telemetry unreachable or not reporting"
      >
        OFFLINE
      </span>
    );
  }

  if (status === 'LOADING') {
    return (
      <span className="text-[9px] font-mono text-[#7A8A9E] animate-pulse">
        CONNECTING...
      </span>
    );
  }

  return (
    <span 
      className="text-[9px] font-mono text-[#00E699] flex items-center gap-1"
      aria-label="Status: Live"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#00E699] animate-pulse" />
      LIVE
    </span>
  );
}

export const ManagerKpiRibbon: React.FC<ManagerKpiRibbonProps> = ({
  kpis,
  onOpenShiftBriefing
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const oee = kpis.plantOee.value;
  const fpy = kpis.firstPassYield.value;
  const speed = kpis.placementSpeedCph.value;
  const takt = kpis.taktStatus.value;
  const holds = kpis.activeQualityHolds.value;
  const shift = kpis.shiftInfo.value;

  return (
    <div 
      className="bg-[#0D1219] border-b border-white/10 px-4 sm:px-6 py-2 transition-all font-sans"
      role="region"
      aria-label="Executive KPI Telemetry Ribbon"
    >
      <div className="max-w-7xl mx-auto flex flex-col gap-2">
        {/* Compact Tablet / Mobile Summary Bar */}
        <div className="flex items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-3 overflow-x-auto py-0.5 scrollbar-none">
            {/* OEE Metric */}
            <div className="flex items-center gap-1.5 shrink-0">
              <Gauge className="w-3.5 h-3.5 text-[#00E699]" />
              <span className="text-[#7A8A9E]">PLANT OEE:</span>
              <span className="text-white font-bold">
                {oee !== null ? `${oee.oee.toFixed(1)}%` : '—'}
              </span>
            </div>

            <span className="text-white/20">•</span>

            {/* Placement Speed CPH */}
            <div className="flex items-center gap-1.5 shrink-0">
              <Zap className="w-3.5 h-3.5 text-[#00E699]" />
              <span className="text-[#7A8A9E]">SPEED:</span>
              <span className="text-white font-bold">
                {speed !== null && speed.actualCph > 0 ? `${speed.actualCph.toLocaleString()} CPH` : '—'}
              </span>
            </div>

            <span className="text-white/20 hidden sm:inline">•</span>

            {/* First Pass Yield */}
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span className="text-[#7A8A9E]">FPY:</span>
              <span className="text-white font-bold">
                {fpy !== null ? `${fpy.fpyPct.toFixed(1)}%` : '—'}
              </span>
            </div>

            <span className="text-white/20 hidden md:inline">•</span>

            {/* Active Holds */}
            <div className="hidden md:flex items-center gap-1.5 shrink-0">
              {holds !== null && holds > 0 ? (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-rose-400 font-bold">{holds} ACTIVE HOLDS</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#00E699]" />
                  <span className="text-[#7A8A9E]">HOLDS:</span>
                  <span className="text-white font-bold">{holds !== null ? '0 HOLDS' : '—'}</span>
                </>
              )}
            </div>

            <span className="text-white/20 hidden lg:inline">•</span>

            {/* Takt Status */}
            <div className="hidden lg:flex items-center gap-1.5 shrink-0">
              <Clock className="w-3.5 h-3.5 text-[#FFB800]" />
              <span className="text-[#7A8A9E]">TAKT:</span>
              <span className={`font-bold ${
                takt?.status === 'BEHIND_TAKT' ? 'text-amber-400' : 'text-[#00E699]'
              }`}>
                {takt !== null ? takt.status.replace('_', ' ') : '—'}
              </span>
            </div>
          </div>

          {/* Quick Actions & View Mode Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {renderStatusBadge(kpis.overallStatus, kpis.plantOee.lastUpdated)}

            <button
              onClick={onOpenShiftBriefing}
              className="flex items-center gap-1.5 bg-[#18222F] hover:bg-[#223042] text-white hover:text-[#00E699] px-2.5 py-1 rounded-lg border border-white/10 text-[11px] font-mono transition-all"
              title="Export shift handover briefing to markdown"
              aria-label="Export shift handover briefing"
            >
              <Copy className="w-3 h-3 text-[#00E699]" />
              <span className="hidden sm:inline">HANDOVER</span>
            </button>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 text-[#7A8A9E] hover:text-white rounded hover:bg-white/5 transition-all"
              title={isExpanded ? "Collapse KPI drawer (reclaim cleanroom vertical budget)" : "Expand executive metrics drawer"}
              aria-label={isExpanded ? "Collapse executive metrics" : "Expand executive metrics"}
            >
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Expanded Executive Telemetry Drawer (Desktop / Detailed Mode) */}
        {isExpanded && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-white/5 text-xs font-mono">
            {/* Card 1: SEMI E10 Plant OEE */}
            <div className="bg-[#10161F] p-2.5 rounded-xl border border-white/10 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#7A8A9E] text-[10px]">
                <span>PLANT OEE</span>
                <Gauge className="w-3 h-3 text-[#00E699]" />
              </div>
              <div className="text-base font-bold text-white mt-1">
                {oee !== null ? `${oee.oee.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[10px] text-[#7A8A9E] mt-1 flex justify-between">
                <span>A: {oee !== null ? `${oee.availability.toFixed(0)}%` : '—'}</span>
                <span>P: {oee !== null ? `${oee.performance.toFixed(0)}%` : '—'}</span>
                <span>Q: {oee !== null ? `${oee.quality.toFixed(0)}%` : '—'}</span>
              </div>
            </div>

            {/* Card 2: Placement Throughput (CPH) */}
            <div className="bg-[#10161F] p-2.5 rounded-xl border border-white/10 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#7A8A9E] text-[10px]">
                <span>PLACEMENT CPH</span>
                <Zap className="w-3 h-3 text-[#00E699]" />
              </div>
              <div className="text-base font-bold text-white mt-1">
                {speed !== null && speed.actualCph > 0 ? speed.actualCph.toLocaleString() : '—'}
              </div>
              <div className="text-[10px] text-[#7A8A9E] mt-1 flex justify-between">
                <span>TARGET: {speed !== null ? `${speed.targetCph.toLocaleString()}` : '—'}</span>
                <span className="text-[#00E699]">{speed !== null && speed.cycleTimeSeconds > 0 ? `${speed.cycleTimeSeconds}s` : ''}</span>
              </div>
            </div>

            {/* Card 3: First Pass Yield */}
            <div className="bg-[#10161F] p-2.5 rounded-xl border border-white/10 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#7A8A9E] text-[10px]">
                <span>FIRST PASS YIELD</span>
                <CheckCircle2 className="w-3 h-3 text-[#38BDF8]" />
              </div>
              <div className="text-base font-bold text-white mt-1">
                {fpy !== null ? `${fpy.fpyPct.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[10px] text-[#7A8A9E] mt-1 flex justify-between">
                <span>GOOD: {fpy !== null ? fpy.goodPanels : '—'}</span>
                <span>SKIPS: {fpy !== null ? fpy.rejectedPanels : '—'}</span>
              </div>
            </div>

            {/* Card 4: Quality Interlocks & Holds */}
            <div className="bg-[#10161F] p-2.5 rounded-xl border border-white/10 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#7A8A9E] text-[10px]">
                <span>QUALITY HOLDS</span>
                <ShieldAlert className="w-3 h-3 text-rose-400" />
              </div>
              <div className={`text-base font-bold mt-1 ${
                holds !== null && holds > 0 ? 'text-rose-400' : 'text-[#00E699]'
              }`}>
                {holds !== null ? (holds === 0 ? '0 ACTIVE' : `${holds} HELD`) : '—'}
              </div>
              <div className="text-[10px] text-[#7A8A9E] mt-1">
                <span>{holds === 0 ? 'ALL LINES CLEARED' : 'INTERLOCK ENGAGED'}</span>
              </div>
            </div>

            {/* Card 5: Takt Balancing */}
            <div className="bg-[#10161F] p-2.5 rounded-xl border border-white/10 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#7A8A9E] text-[10px]">
                <span>TAKT PACING</span>
                <Clock className="w-3 h-3 text-[#FFB800]" />
              </div>
              <div className={`text-base font-bold mt-1 ${
                takt?.status === 'BEHIND_TAKT' ? 'text-amber-400' : 'text-[#00E699]'
              }`}>
                {takt !== null ? (takt.actualTaktSeconds > 0 ? `${takt.actualTaktSeconds}s` : takt.status) : '—'}
              </div>
              <div className="text-[10px] text-[#7A8A9E] mt-1 flex justify-between">
                <span>TARGET: {takt !== null ? `${takt.targetTaktSeconds}s` : '—'}</span>
                <span>{takt?.bottleneckStation ? `BOT: ${takt.bottleneckStation}` : ''}</span>
              </div>
            </div>

            {/* Card 6: Active Shift Operation */}
            <div className="bg-[#10161F] p-2.5 rounded-xl border border-white/10 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[#7A8A9E] text-[10px]">
                <span>ACTIVE SHIFT</span>
                <Activity className="w-3 h-3 text-[#7A8A9E]" />
              </div>
              <div className="text-base font-bold text-white mt-1">
                {shift?.shiftCode || 'Shift A'}
              </div>
              <div className="text-[10px] text-[#7A8A9E] mt-1 flex justify-between">
                <span>RUN: {shift ? `${shift.operatingMinutes}m` : '—'}</span>
                <span>DOWN: {shift ? `${shift.downtimeMinutes}m` : '—'}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
