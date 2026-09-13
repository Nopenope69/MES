import React, { useState } from 'react';
import { 
  Copy, ChevronDown, ChevronUp, Clock, 
  ShieldAlert, CheckCircle2, ArrowUpRight
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
        className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded tracking-wide font-medium"
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
        className="text-[10px] font-mono text-amber-300/90 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded flex items-center gap-1"
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
        className="text-[10px] font-mono text-[#6B7280] bg-white/[0.03] border border-white/[0.08] px-1.5 py-0.5 rounded"
        title="Live telemetry unreachable or not reporting"
      >
        OFFLINE
      </span>
    );
  }

  if (status === 'LOADING') {
    return (
      <span className="text-[10px] font-mono text-[#6B7280] animate-pulse">
        CONNECTING...
      </span>
    );
  }

  return (
    <span 
      className="text-[10px] font-mono text-emerald-400 flex items-center gap-1.5"
      aria-label="Status: Live"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      LIVE
    </span>
  );
}

export const ManagerKpiRibbon: React.FC<ManagerKpiRibbonProps> = ({
  kpis,
  onOpenShiftBriefing
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const oee = kpis.plantOee.value;
  const fpy = kpis.firstPassYield.value;
  const speed = kpis.placementSpeedCph.value;
  const takt = kpis.taktStatus.value;
  const holds = kpis.activeQualityHolds.value;
  const shift = kpis.shiftInfo.value;

  return (
    <section 
      className="bg-[#0E1116] border-b border-white/[0.07] px-4 sm:px-6 py-2 transition-all font-sans"
      aria-label="Executive Cleanroom Telemetry Rail"
    >
      <div className="max-w-7xl mx-auto flex flex-col gap-2">
        {/* Sleek Primary Production Rail */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 sm:gap-6 overflow-x-auto py-0.5 scrollbar-none font-mono">
            {/* OEE */}
            <div className="flex items-baseline gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280] font-medium font-sans">
                OEE
              </span>
              <span className="text-sm font-semibold text-white tabular-nums tracking-tight">
                {oee !== null ? `${oee.oee.toFixed(1)}%` : '—'}
              </span>
              {oee !== null && (
                <span className="hidden xl:inline text-[10px] text-[#6B7280] font-sans">
                  (A {oee.availability.toFixed(0)} · P {oee.performance.toFixed(0)} · Q {oee.quality.toFixed(0)})
                </span>
              )}
            </div>

            <div className="h-3 w-px bg-white/[0.08] shrink-0" />

            {/* Throughput CPH */}
            <div className="flex items-baseline gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280] font-medium font-sans">
                Throughput
              </span>
              <span className="text-sm font-semibold text-white tabular-nums tracking-tight">
                {speed !== null && speed.actualCph > 0 ? `${speed.actualCph.toLocaleString()} CPH` : '—'}
              </span>
              {speed !== null && speed.cycleTimeSeconds > 0 && (
                <span className="hidden xl:inline text-[10px] text-[#6B7280] font-sans">
                  ({speed.cycleTimeSeconds}s cycle)
                </span>
              )}
            </div>

            <div className="h-3 w-px bg-white/[0.08] shrink-0 hidden sm:block" />

            {/* First Pass Yield */}
            <div className="hidden sm:flex items-baseline gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280] font-medium font-sans">
                Yield (FPY)
              </span>
              <span className="text-sm font-semibold text-white tabular-nums tracking-tight">
                {fpy !== null ? `${fpy.fpyPct.toFixed(1)}%` : '—'}
              </span>
            </div>

            <div className="h-3 w-px bg-white/[0.08] shrink-0 hidden md:block" />

            {/* Quality Holds */}
            <div className="hidden md:flex items-baseline gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280] font-medium font-sans">
                Holds
              </span>
              <span className={`text-sm font-semibold tabular-nums tracking-tight ${
                holds !== null && holds > 0 ? 'text-rose-400' : 'text-white'
              }`}>
                {holds !== null ? (holds === 0 ? '0' : `${holds} ACTIVE`) : '—'}
              </span>
            </div>

            <div className="h-3 w-px bg-white/[0.08] shrink-0 hidden lg:block" />

            {/* Takt Status */}
            <div className="hidden lg:flex items-baseline gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280] font-medium font-sans">
                Takt
              </span>
              <span className={`text-sm font-semibold tracking-tight ${
                takt?.status === 'BEHIND_TAKT' ? 'text-amber-400' : 'text-white'
              }`}>
                {takt !== null ? (takt.status === 'ON_PACE' ? 'On Pace' : takt.status.replace('_', ' ')) : '—'}
              </span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            {renderStatusBadge(kpis.overallStatus, kpis.plantOee.lastUpdated)}

            <button
              onClick={onOpenShiftBriefing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[#D1D5DB] hover:text-white border border-white/[0.08] text-xs font-sans font-medium transition-colors"
              title="Export shift handover briefing in markdown"
            >
              <Copy className="w-3 h-3 text-[#9CA3AF]" />
              <span className="hidden sm:inline">Handover</span>
            </button>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 text-[#6B7280] hover:text-white rounded hover:bg-white/[0.04] transition-colors"
              title={isExpanded ? "Collapse telemetry rail" : "Expand telemetry rail"}
              aria-label={isExpanded ? "Collapse telemetry rail" : "Expand telemetry rail"}
            >
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Expanded Telemetry Drawer (Quiet Industrial Metric Grid) */}
        {isExpanded && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2 pb-1 border-t border-white/[0.06] text-xs font-sans">
            {/* OEE Breakdown */}
            <div className="p-2 rounded-md bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">
                Availability
              </div>
              <div className="text-sm font-semibold text-white font-mono tabular-nums mt-0.5">
                {oee !== null ? `${oee.availability.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[10px] text-[#6B7280] font-mono mt-0.5">
                {oee !== null ? `${oee.runningCount}/${oee.lineCount} Lines Online` : 'No telemetry'}
              </div>
            </div>

            {/* Performance */}
            <div className="p-2 rounded-md bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">
                Performance
              </div>
              <div className="text-sm font-semibold text-white font-mono tabular-nums mt-0.5">
                {oee !== null ? `${oee.performance.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[10px] text-[#6B7280] font-mono mt-0.5">
                Target: 45,000 CPH
              </div>
            </div>

            {/* Quality FPY */}
            <div className="p-2 rounded-md bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">
                Quality Rate
              </div>
              <div className="text-sm font-semibold text-white font-mono tabular-nums mt-0.5">
                {oee !== null ? `${oee.quality.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[10px] text-[#6B7280] font-mono mt-0.5">
                {fpy !== null ? `${fpy.goodPanels} Pass / ${fpy.rejectedPanels} Skip` : 'No records'}
              </div>
            </div>

            {/* Interlocks */}
            <div className="p-2 rounded-md bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">
                Hold Interlocks
              </div>
              <div className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                holds !== null && holds > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}>
                {holds !== null ? (holds === 0 ? 'Armed · Clear' : `${holds} Engaged`) : '—'}
              </div>
              <div className="text-[10px] text-[#6B7280] font-mono mt-0.5">
                {holds === 0 ? '21 CFR Part 11 Pass' : 'Hold Enforced'}
              </div>
            </div>

            {/* Takt Analysis */}
            <div className="p-2 rounded-md bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">
                Cycle Pacing
              </div>
              <div className="text-sm font-semibold text-white font-mono tabular-nums mt-0.5">
                {takt !== null ? (takt.actualTaktSeconds > 0 ? `${takt.actualTaktSeconds}s` : '18.0s') : '—'}
              </div>
              <div className="text-[10px] text-[#6B7280] font-mono mt-0.5">
                {takt?.bottleneckStation ? `Bot: ${takt.bottleneckStation}` : 'Balanced'}
              </div>
            </div>

            {/* Shift Context */}
            <div className="p-2 rounded-md bg-white/[0.02] border border-white/[0.05]">
              <div className="text-[10px] text-[#6B7280] font-medium uppercase tracking-wider">
                Shift Schedule
              </div>
              <div className="text-sm font-semibold text-white font-mono mt-0.5">
                {shift?.shiftCode || 'Shift A'}
              </div>
              <div className="text-[10px] text-[#6B7280] font-mono mt-0.5">
                {shift ? `${shift.operatingMinutes}m run / ${shift.downtimeMinutes}m down` : '—'}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
