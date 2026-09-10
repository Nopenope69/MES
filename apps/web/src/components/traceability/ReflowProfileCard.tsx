// apps/web/src/components/traceability/ReflowProfileCard.tsx
import React from 'react';
import { Flame, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface ReflowProfileCardProps {
  reflowProfile: {
    profileRunId: string;
    overallPwi: number;
    complianceResult: 'PASS' | 'WARNING' | 'FAIL';
    worstCharacteristic?: string;
    recipeId: string;
    equipmentId: string;
    lineId: string;
    approvedBy?: string;
    approvedAt?: string;
    linkage: {
      source: string;
      confidence: string;
      detail?: string;
    };
  } | null;
}

export const ReflowProfileCard: React.FC<ReflowProfileCardProps> = ({ reflowProfile }) => {
  if (!reflowProfile) {
    return (
      <div className="milled-panel rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2 border-b border-white/10 pb-3">
          <Flame className="w-4 h-4 text-orange-400" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            CLOSED-LOOP REFLOW THERMAL PROFILE
          </h3>
        </div>
        <div className="py-6 text-center text-xs font-mono text-[#7A8A9E]">
          Zero reflow thermal profile linkage recorded for this checkout.
        </div>
      </div>
    );
  }

  const { linkage, overallPwi, complianceResult } = reflowProfile;
  const isDirectFk = linkage.source === 'DIRECT_FK' && linkage.confidence === 'EXACT';
  const isInferred = linkage.confidence === 'INFERRED';
  const isAmbiguous = linkage.confidence === 'AMBIGUOUS';

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-400" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            CLOSED-LOOP REFLOW THERMAL PROFILE
          </h3>
        </div>

        {/* Dynamic Linkage Provenance Badge — strictly data-driven */}
        <div className="flex items-center gap-2 font-mono text-[10px]">
          {isDirectFk ? (
            <span className="px-2.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              DIRECT FK • EXACT
            </span>
          ) : isInferred ? (
            <span className="px-2.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              TEMPORAL MATCH • INFERRED
            </span>
          ) : isAmbiguous ? (
            <span className="px-2.5 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-300 font-bold flex items-center gap-1 animate-pulse">
              <AlertTriangle className="w-3 h-3" />
              OVERLAPPING RUNS • AMBIGUOUS
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/60">
              {linkage.source} • {linkage.confidence}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Profile Run UID</span>
          <span className="text-xs font-bold text-orange-400 truncate block" title={reflowProfile.profileRunId}>
            {reflowProfile.profileRunId}
          </span>
        </div>

        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Overall PWI</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-base font-bold ${overallPwi <= 100 ? 'text-emerald-400' : 'text-red-400'}`}>
              {overallPwi.toFixed(1)}%
            </span>
            <span className="text-[10px] text-[#7A8A9E]">
              {overallPwi <= 100 ? '(COMPLIANT)' : '(PWI FAIL)'}
            </span>
          </div>
        </div>

        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Oven Work Center</span>
          <span className="text-xs font-bold text-white block">{reflowProfile.equipmentId}</span>
          <span className="text-[10px] text-[#7A8A9E]">{reflowProfile.lineId}</span>
        </div>

        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Process Compliance</span>
          <span
            className={`text-xs font-bold flex items-center gap-1 mt-0.5 ${
              complianceResult === 'PASS' ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {complianceResult === 'PASS' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {complianceResult}
          </span>
        </div>
      </div>

      {reflowProfile.worstCharacteristic && (
        <div className="text-[11px] font-mono text-[#7A8A9E] bg-[#070A0E] p-2 rounded border border-white/5 flex items-center justify-between">
          <span>Worst Process Window Index Characteristic:</span>
          <span className="text-white font-bold">{reflowProfile.worstCharacteristic}</span>
        </div>
      )}

      {linkage.detail && (
        <div className="text-[10px] font-mono text-white/50 italic">
          Provenance Note: {linkage.detail}
        </div>
      )}
    </div>
  );
};
