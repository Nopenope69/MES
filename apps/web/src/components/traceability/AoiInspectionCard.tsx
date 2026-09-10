// apps/web/src/components/traceability/AoiInspectionCard.tsx
import React from 'react';
import { Crosshair, CheckCircle2, AlertOctagon, Image as ImageIcon } from 'lucide-react';

interface AoiInspectionCardProps {
  aoiInspections: Array<{
    inspectionId: string;
    phase: string;
    result: string;
    totalDefects: number;
    inspectedAt: string;
    opticalMachineId: string;
    unitDefects?: Array<{
      defectId: string;
      refDes: string;
      defectCategory: string;
      defectType: string;
      defectSignature: string;
      boardSide: string;
      status: string;
      imageRef?: string;
    }>;
  }>;
}

export const AoiInspectionCard: React.FC<AoiInspectionCardProps> = ({ aoiInspections }) => {
  if (!aoiInspections || aoiInspections.length === 0) {
    return (
      <div className="milled-panel rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2 border-b border-white/10 pb-3">
          <Crosshair className="w-4 h-4 text-[#00E699]" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            3D AUTOMATED OPTICAL INSPECTION (AOI)
          </h3>
        </div>
        <div className="py-6 text-center text-xs font-mono text-[#7A8A9E]">
          Zero 3D AOI optical inspection scans available for this board unit.
        </div>
      </div>
    );
  }

  const latest = aoiInspections[aoiInspections.length - 1];
  const unitDefects = latest.unitDefects || [];
  const isPass = latest.result === 'PASS' && unitDefects.length === 0;

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-[#00E699]" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            3D AUTOMATED OPTICAL INSPECTION (AOI)
          </h3>
        </div>

        <span
          className={`text-[10px] font-mono px-2.5 py-0.5 rounded border font-bold flex items-center gap-1 ${
            isPass
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/15 border-red-500/40 text-red-400 animate-pulse'
          }`}
        >
          {isPass ? <CheckCircle2 className="w-3 h-3" /> : <AlertOctagon className="w-3 h-3" />}
          {isPass ? 'PASS (0 DEFECTS)' : `DEFECTS FOUND (${unitDefects.length})`}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Inspection Phase</span>
          <span className="text-xs font-bold text-white block">{latest.phase}</span>
        </div>
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Total Panel Defects</span>
          <span className="text-xs font-bold text-white">{latest.totalDefects}</span>
        </div>
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Unit Defects</span>
          <span className={`text-xs font-bold ${unitDefects.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {unitDefects.length}
          </span>
        </div>
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Optical System</span>
          <span className="text-xs font-bold text-white truncate block" title={latest.opticalMachineId}>
            {latest.opticalMachineId}
          </span>
        </div>
      </div>

      {/* Discrete Unit Optical Defects List */}
      {unitDefects.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-mono text-[#7A8A9E] uppercase tracking-wider block">
            Optical Defect Signatures on this Unit
          </span>
          <div className="space-y-2">
            {unitDefects.map((def, idx) => (
              <div
                key={idx}
                className="bg-[#0A0E14] border border-red-500/30 p-3 rounded-lg text-xs font-mono flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-bold text-[10px]">
                      {def.defectType}
                    </span>
                    <span className="text-white font-bold text-xs">RefDes: {def.refDes}</span>
                    <span className="text-[10px] text-[#7A8A9E]">Side: {def.boardSide}</span>
                  </div>
                  <div className="text-[10px] text-[#7A8A9E] truncate max-w-xl" title={def.defectSignature}>
                    Signature: {def.defectSignature}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-amber-300">
                    STATUS: {def.status}
                  </span>
                  {def.imageRef && (
                    <span className="text-[10px] text-[#38BDF8] flex items-center gap-1 hover:underline cursor-pointer">
                      <ImageIcon className="w-3 h-3" />
                      View Image
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
