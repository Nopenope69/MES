// apps/web/src/components/traceability/ReworkLedger.tsx
import React from 'react';
import { Wrench, CheckCircle2, User, Clock, ArrowRight } from 'lucide-react';

interface ReworkLedgerProps {
  reworkHistory: Array<{
    defectId: string;
    refDes: string;
    disposition: string;
    dispositionReason: string;
    authorizedBy: string;
    dispositionAt: string;
    execution?: {
      technicianId: string;
      stationId: string;
      oldMpn: string;
      oldReelId?: string;
      replacementMpn: string;
      replacementReelId: string;
      reworkMethod: string;
      reworkCycle: number;
      reworkedAt: string;
    };
    postReworkInspection?: {
      result: string;
      inspectorId: string;
      inspectedAt: string;
    };
  }>;
}

export const ReworkLedger: React.FC<ReworkLedgerProps> = ({ reworkHistory }) => {
  if (!reworkHistory || reworkHistory.length === 0) {
    return (
      <div className="milled-panel rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2 border-b border-white/10 pb-3">
          <Wrench className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            CLEANROOM REWORK & COMPONENT REPLACEMENT LEDGER
          </h3>
        </div>
        <div className="py-6 text-center text-xs font-mono text-[#7A8A9E]">
          Zero rework operations logged for this board unit (virgin assembly state).
        </div>
      </div>
    );
  }

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            CLEANROOM REWORK & COMPONENT REPLACEMENT LEDGER
          </h3>
        </div>

        <span className="text-[10px] font-mono px-2.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/40 text-purple-400 font-bold">
          {reworkHistory.length} REWORK CYCLE(S)
        </span>
      </div>

      <div className="space-y-3">
        {reworkHistory.map((item, idx) => (
          <div
            key={idx}
            className="bg-[#070A0E] border border-white/10 rounded-xl p-4 space-y-3 text-xs font-mono"
          >
            {/* Disposition Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">RefDes: {item.refDes}</span>
                <span className="text-[#7A8A9E]">•</span>
                <span className="text-purple-300 font-bold">DISPOSITION: {item.disposition}</span>
              </div>
              <div className="text-[10px] text-[#7A8A9E] flex items-center gap-2">
                <span>Auth by: <strong className="text-white">{item.authorizedBy}</strong></span>
                <span>•</span>
                <span>{new Date(item.dispositionAt).toLocaleDateString()}</span>
              </div>
            </div>

            <p className="text-xs text-white/80 italic">
              "{item.dispositionReason}"
            </p>

            {/* Execution Details */}
            {item.execution && (
              <div className="bg-[#0C1118] p-3 rounded-lg border border-white/5 space-y-2">
                <div className="flex flex-wrap items-center justify-between text-[11px]">
                  <span className="text-white/60">
                    Method: <strong className="text-white">{item.execution.reworkMethod.replace(/_/g, ' ')}</strong>
                  </span>
                  <span className="text-white/60">
                    Cycle: <strong className="text-white">#{item.execution.reworkCycle}</strong>
                  </span>
                  <span className="text-white/60">
                    Station: <strong className="text-white">{item.execution.stationId}</strong>
                  </span>
                  <span className="text-white/60">
                    Tech: <strong className="text-white">{item.execution.technicianId}</strong>
                  </span>
                </div>

                {/* Replacement Material Flow */}
                <div className="pt-2 border-t border-white/5 flex flex-wrap items-center gap-3 text-xs">
                  <div className="bg-red-500/10 border border-red-500/20 px-2 py-1 rounded">
                    <span className="text-[10px] text-red-300 block uppercase">Desoldered Reel</span>
                    <span className="text-red-200 font-bold">{item.execution.oldReelId || 'N/A'}</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#7A8A9E]" />
                  <div className="bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                    <span className="text-[10px] text-emerald-300 block uppercase">Replacement Reel</span>
                    <span className="text-emerald-300 font-bold">{item.execution.replacementReelId}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Post-Rework Re-Qualification Inspection */}
            {item.postReworkInspection && (
              <div className="flex items-center justify-between text-[11px] bg-emerald-500/5 p-2 rounded border border-emerald-500/20 text-emerald-400">
                <div className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  POST-REWORK OPTICAL RE-QUALIFICATION: {item.postReworkInspection.result}
                </div>
                <div className="text-[10px] text-emerald-300/70">
                  Inspector: {item.postReworkInspection.inspectorId} • {new Date(item.postReworkInspection.inspectedAt).toLocaleTimeString()}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
