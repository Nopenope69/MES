// apps/web/src/components/traceability/RecallDashboard.tsx
import React, { useState } from 'react';
import { GitFork, AlertOctagon, ShieldAlert, FileText, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { isFixtureModeEnabled } from '../../services/traceability.api';

interface RecallDashboardProps {
  recallData: {
    queryTarget: string;
    targetType: string;
    status: string;
    containmentRecommendation: string;
    affectedBatches: any[];
    affectedPanels: any[];
    affectedUnits: any[];
    summary: {
      totalBatchesAffected: number;
      totalPanelsAffected: number;
      totalUnitsAffected: number;
      quarantineScope: string;
    };
  };
}

export const RecallDashboard: React.FC<RecallDashboardProps> = ({ recallData }) => {
  const [recommendationGenerated, setRecommendationGenerated] = useState(false);
  const fixtureMode = isFixtureModeEnabled();

  const handleGenerateRecommendation = () => {
    setRecommendationGenerated(true);
  };

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      {/* Target & Containment Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <GitFork className="w-4 h-4 text-red-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
              CONTAINMENT RECALL SCOPE
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="text-[10px] font-mono text-red-400 font-bold">SET-BASED FORWARD TRACE</span>
          </div>
          <h2 className="text-base font-bold text-white font-sans mt-0.5 flex items-center gap-2">
            Target UID: <span className="text-[#00E699] font-mono">{recallData.queryTarget}</span>
            <span className="text-xs font-mono font-normal text-[#7A8A9E]">
              ({recallData.targetType.replace(/_/g, ' ')})
            </span>
          </h2>
        </div>

        {/* Read-Only Safety Buttons */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <button
            onClick={handleGenerateRecommendation}
            className="px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold transition-all active:scale-95"
          >
            [ GENERATE QUARANTINE RECOMMENDATION ]
          </button>
          <button
            onClick={() => alert(`Containment manifest exported for ${recallData.queryTarget} (ALCOA+ audit compliant report).`)}
            className="px-3 py-2 rounded-lg bg-[#0A0E13] hover:bg-[#121822] text-[#7A8A9E] hover:text-white border border-white/10 transition-all flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>EXPORT MANIFEST</span>
          </button>
        </div>
      </div>

      {/* Safety Notice Strip */}
      <div className="bg-[#0B0F15] border border-white/5 px-3 py-1.5 rounded text-[10px] font-mono text-[#7A8A9E] flex items-center justify-between">
        <span>READ-ONLY CONTAINMENT INTERFACE • PRODUCTION STATE MUTATIONS REQUIRE QUALITY_HOLD_WRITE PERMISSION</span>
        {fixtureMode && (
          <span className="text-amber-400/80 font-bold">DEMO ACTION — NO PRODUCTION STATE CHANGE</span>
        )}
      </div>

      {/* Containment Metrics KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        <div className="bg-[#070A0E] p-3.5 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Affected Batches</span>
          <span className="text-lg font-bold text-white block mt-0.5">
            {recallData.summary.totalBatchesAffected}
          </span>
          <span className="text-[10px] text-[#7A8A9E]">
            {recallData.affectedBatches[0]?.batchNumber || '—'}
          </span>
        </div>

        <div className="bg-[#070A0E] p-3.5 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Affected Panels</span>
          <span className="text-lg font-bold text-amber-300 block mt-0.5">
            {recallData.summary.totalPanelsAffected}
          </span>
          <span className="text-[10px] text-[#7A8A9E]">Across production line</span>
        </div>

        <div className="bg-[#070A0E] p-3.5 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Total Discrete Units</span>
          <span className="text-lg font-bold text-red-400 block mt-0.5">
            {recallData.summary.totalUnitsAffected}
          </span>
          <span className="text-[10px] text-[#7A8A9E]">Multi-up circuits</span>
        </div>

        <div className="bg-[#070A0E] p-3.5 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Containment Rec.</span>
          <span
            className={`text-xs font-bold block mt-1 uppercase ${
              recallData.containmentRecommendation === 'QUARANTINE_REQUIRED'
                ? 'text-red-400'
                : 'text-emerald-400'
            }`}
          >
            {recallData.containmentRecommendation.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Quarantine Recommendation Review Box */}
      {recommendationGenerated && (
        <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl space-y-2 text-xs font-mono animate-fadeIn">
          <div className="flex items-center gap-2 text-amber-300 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>CONTAINMENT ACTION RECOMMENDATION GENERATED</span>
          </div>
          <p className="text-amber-200/80">
            Scope: {recallData.summary.quarantineScope}. Advise placing {recallData.summary.totalPanelsAffected} panels on immediate physical and optical hold. Forwarding recommendation to SMT Quality Inspector.
          </p>
        </div>
      )}
    </div>
  );
};
