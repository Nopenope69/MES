// apps/web/src/components/traceability/PanelUnitMatrix.tsx
import React from 'react';
import { Cpu, CheckCircle2, AlertOctagon, Wrench, Slash, Layers } from 'lucide-react';

interface PanelUnitMatrixProps {
  panelBarcode: string;
  checkout: {
    workCenterId: string;
    programName: string;
    cycleTimeSeconds: number;
    completedAt: string;
    blockCount: number;
    profileRunId?: string | null;
  };
  units: Array<{
    unitPosition: number;
    unitSerialNumber: string | null;
    unitStatus: string;
    aoiInspections?: Array<{
      unitDefects?: any[];
      totalDefects?: number;
    }>;
    reworkHistory?: any[];
  }>;
  selectedUnitPosition: number;
  onSelectUnit: (unitPosition: number) => void;
}

export const PanelUnitMatrix: React.FC<PanelUnitMatrixProps> = ({
  panelBarcode,
  checkout,
  units,
  selectedUnitPosition,
  onSelectUnit
}) => {
  const getStatusBadge = (status: string, hasDefect: boolean, hasRework: boolean) => {
    switch (status) {
      case 'PASSED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">
            <CheckCircle2 className="w-3 h-3" />
            PASSED
          </span>
        );
      case 'QUALITY_HOLD':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-400 font-bold animate-pulse">
            <AlertOctagon className="w-3 h-3" />
            QUALITY HOLD
          </span>
        );
      case 'REWORKED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/40 text-purple-400 font-bold">
            <Wrench className="w-3 h-3" />
            REWORKED
          </span>
        );
      case 'SCRAPPED':
        return (
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-gray-500/15 border border-gray-500/30 text-gray-400 font-bold">
            <Slash className="w-3 h-3" />
            SCRAPPED
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/60">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4">
      {/* Panel Hardware Metadata Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#18222F] border border-white/15 flex items-center justify-center text-[#00E699]">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-[#7A8A9E] uppercase tracking-wider">
                PANEL BARCODE:
              </span>
              <span className="text-xs font-mono font-bold text-white bg-white/5 px-2 py-0.5 rounded border border-white/10">
                {panelBarcode}
              </span>
            </div>
            <div className="text-xs text-[#7A8A9E] font-mono mt-0.5 flex flex-wrap items-center gap-2">
              <span>Work Center: <strong className="text-white">{checkout.workCenterId}</strong></span>
              <span>•</span>
              <span>Program: <strong className="text-white">{checkout.programName}</strong></span>
              <span>•</span>
              <span>Cycle: <strong className="text-white">{checkout.cycleTimeSeconds}s</strong></span>
              {checkout.profileRunId && (
                <>
                  <span>•</span>
                  <span>Reflow Run: <strong className="text-orange-400">{checkout.profileRunId}</strong></span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] font-mono text-[#7A8A9E] uppercase tracking-wider block">
            Multi-Circuit Array
          </span>
          <span className="text-xs font-mono font-bold text-[#00E699]">
            {units.length} Discrete Units
          </span>
        </div>
      </div>

      {/* Multi-Up Discrete Circuit Matrix */}
      <div>
        <div className="text-[11px] font-mono text-[#7A8A9E] uppercase tracking-wider mb-2 flex items-center justify-between">
          <span>Multi-Up PCB Discretization Array (Click to Inspect Unit)</span>
          <span className="text-[10px] text-white/40">O(1) in-memory selection • Zero network roundtrips</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {units.map((u) => {
            const isSelected = u.unitPosition === selectedUnitPosition;
            const defectCount = u.aoiInspections?.reduce((acc, ins) => acc + (ins.unitDefects?.length || 0), 0) || 0;
            const hasRework = (u.reworkHistory && u.reworkHistory.length > 0) || false;

            return (
              <button
                key={u.unitPosition}
                onClick={() => onSelectUnit(u.unitPosition)}
                className={`text-left p-3 rounded-xl border transition-all duration-150 flex flex-col justify-between gap-2.5 active:scale-[0.98] ${
                  isSelected
                    ? 'bg-[#182332] border-[#00E699] shadow-lg shadow-[#00E699]/10'
                    : 'bg-[#0B0F15] border-white/10 hover:border-white/20 hover:bg-[#101620]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono font-bold ${isSelected ? 'text-[#00E699]' : 'text-white'}`}>
                    UNIT #{u.unitPosition}
                  </span>
                  {isSelected && (
                    <span className="text-[9px] font-mono font-bold bg-[#00E699] text-[#0B0F14] px-1.5 py-0.2 rounded">
                      ACTIVE
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] font-mono text-[#7A8A9E] truncate" title={u.unitSerialNumber || 'UNSERIALIZED'}>
                    {u.unitSerialNumber || 'SN: N/A'}
                  </div>
                  <div>
                    {getStatusBadge(u.unitStatus, defectCount > 0, hasRework)}
                  </div>
                </div>

                <div className="text-[10px] font-mono pt-1 border-t border-white/5 flex items-center justify-between text-[#7A8A9E]">
                  <span>{defectCount > 0 ? `${defectCount} Defect(s)` : '0 Defects'}</span>
                  {hasRework && <span className="text-purple-400 font-bold">Reworked</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
