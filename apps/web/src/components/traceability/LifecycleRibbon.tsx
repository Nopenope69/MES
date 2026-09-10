// apps/web/src/components/traceability/LifecycleRibbon.tsx
import React from 'react';
import { Layers, Sliders, Cpu, Flame, Crosshair, Wrench, ShieldCheck, Check, AlertTriangle, AlertOctagon } from 'lucide-react';

export type StageState =
  | 'COMPLETE'
  | 'PASS'
  | 'FAIL'
  | 'HOLD'
  | 'NOT_REQUIRED'
  | 'NOT_AVAILABLE'
  | 'INFERRED'
  | 'AMBIGUOUS';

interface StageItem {
  id: string;
  name: string;
  subtext: string;
  state: StageState;
  icon: React.ReactNode;
}

interface LifecycleRibbonProps {
  unitGenealogy: any;
  activeStageId?: string;
  onSelectStage?: (stageId: string) => void;
}

export const LifecycleRibbon: React.FC<LifecycleRibbonProps> = ({
  unitGenealogy,
  activeStageId,
  onSelectStage
}) => {
  // Derive factual state of each stage from unit data
  const hasStencilPaste = unitGenealogy.solderPaste?.length > 0 || unitGenealogy.stencil;
  const spiResult = unitGenealogy.spiInspection?.result;
  const placementCount = unitGenealogy.placementChain?.length || 0;
  
  const reflowConfidence = unitGenealogy.reflowProfile?.linkage?.confidence;
  const aoiInspections = unitGenealogy.aoiInspections || [];
  const latestAoi = aoiInspections[aoiInspections.length - 1];
  const hasRework = unitGenealogy.reworkHistory && unitGenealogy.reworkHistory.length > 0;
  const dhrStatus = unitGenealogy.dhr?.status;

  const stages: StageItem[] = [
    {
      id: 'STENCIL_PASTE',
      name: '01. STENCIL / PASTE',
      subtext: hasStencilPaste ? (unitGenealogy.solderPaste?.[0]?.lotNumber || 'SESSION ACTIVE') : 'NO DATA',
      state: hasStencilPaste ? 'COMPLETE' : 'NOT_AVAILABLE',
      icon: <Layers className="w-3.5 h-3.5" />
    },
    {
      id: 'SPI',
      name: '02. 3D SPI',
      subtext: spiResult ? `${unitGenealogy.spiInspection.totalPads} PADS (${unitGenealogy.spiInspection.result})` : 'NOT INSPECTED',
      state: spiResult === 'PASS' ? 'PASS' : spiResult === 'FAIL' ? 'FAIL' : 'NOT_AVAILABLE',
      icon: <Sliders className="w-3.5 h-3.5" />
    },
    {
      id: 'PLACEMENT',
      name: '03. FUJI PLACEMENT',
      subtext: `${placementCount} MOUNTED REFS`,
      state: placementCount > 0 ? 'COMPLETE' : 'NOT_AVAILABLE',
      icon: <Cpu className="w-3.5 h-3.5" />
    },
    {
      id: 'REFLOW',
      name: '04. REFLOW THERMAL',
      subtext: unitGenealogy.reflowProfile
        ? `PWI ${unitGenealogy.reflowProfile.overallPwi}% (${reflowConfidence || 'EXACT'})`
        : 'UNLINKED',
      state: reflowConfidence === 'AMBIGUOUS'
        ? 'AMBIGUOUS'
        : reflowConfidence === 'INFERRED'
        ? 'INFERRED'
        : unitGenealogy.reflowProfile?.complianceResult === 'PASS'
        ? 'PASS'
        : unitGenealogy.reflowProfile ? 'FAIL' : 'NOT_AVAILABLE',
      icon: <Flame className="w-3.5 h-3.5" />
    },
    {
      id: 'AOI',
      name: '05. 3D AOI OPTICAL',
      subtext: latestAoi
        ? `${latestAoi.result} (${latestAoi.unitDefects?.length || 0} DFX)`
        : 'NOT INSPECTED',
      state: latestAoi?.result === 'PASS' ? 'PASS' : latestAoi?.result === 'FAIL' ? 'FAIL' : 'NOT_AVAILABLE',
      icon: <Crosshair className="w-3.5 h-3.5" />
    },
    {
      id: 'REWORK',
      name: '06. CLEANROOM REWORK',
      subtext: hasRework
        ? `${unitGenealogy.reworkHistory.length} CYCLE(S)`
        : latestAoi?.result === 'FAIL'
        ? 'ACTION REQUIRED'
        : 'NOT REQUIRED',
      state: hasRework ? 'COMPLETE' : latestAoi?.result === 'FAIL' ? 'HOLD' : 'NOT_REQUIRED',
      icon: <Wrench className="w-3.5 h-3.5" />
    },
    {
      id: 'DHR',
      name: '07. eDHR & AUDIT',
      subtext: dhrStatus ? dhrStatus.replace('_', ' ') : 'UNISSUED',
      state: dhrStatus === 'RELEASED' ? 'PASS' : dhrStatus === 'PENDING_QA_REVIEW' ? 'HOLD' : 'NOT_AVAILABLE',
      icon: <ShieldCheck className="w-3.5 h-3.5" />
    }
  ];

  const getStageColorClasses = (state: StageState) => {
    switch (state) {
      case 'PASS':
      case 'COMPLETE':
        return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400';
      case 'FAIL':
        return 'bg-red-500/15 border-red-500/40 text-red-400 font-bold';
      case 'HOLD':
        return 'bg-amber-500/15 border-amber-500/40 text-amber-300 animate-pulse';
      case 'INFERRED':
        return 'bg-amber-500/10 border-amber-500/30 text-amber-300';
      case 'AMBIGUOUS':
        return 'bg-red-500/10 border-red-500/40 text-red-300 font-bold';
      case 'NOT_REQUIRED':
        return 'bg-white/5 border-white/10 text-white/40';
      case 'NOT_AVAILABLE':
      default:
        return 'bg-[#0B0F15] border-white/10 text-[#7A8A9E]';
    }
  };

  return (
    <div className="milled-panel rounded-xl p-4 space-y-2">
      <div className="text-[11px] font-mono text-[#7A8A9E] uppercase tracking-wider flex items-center justify-between">
        <span>7-Stage Chronological Manufacturing Lifecycle Journey</span>
        <span className="text-[10px] text-white/40">Discrete Unit Progression</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {stages.map((st) => {
          const isActive = activeStageId === st.id;
          const colorClasses = getStageColorClasses(st.state);

          return (
            <div
              key={st.id}
              onClick={() => onSelectStage && onSelectStage(st.id)}
              className={`p-2.5 rounded-lg border text-xs font-mono transition-all flex flex-col justify-between gap-1.5 cursor-pointer hover:border-white/30 ${colorClasses} ${
                isActive ? 'ring-1 ring-white/40 shadow-md' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-white/60 flex items-center gap-1">
                  {st.icon}
                  <span className="truncate">{st.name}</span>
                </span>
                <span className="text-[9px] font-bold uppercase">
                  {st.state}
                </span>
              </div>

              <div className="text-[10px] font-bold text-white truncate" title={st.subtext}>
                {st.subtext}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
