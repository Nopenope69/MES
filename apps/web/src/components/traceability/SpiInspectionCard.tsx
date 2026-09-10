// apps/web/src/components/traceability/SpiInspectionCard.tsx
import React from 'react';
import { Sliders, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

interface SpiInspectionCardProps {
  spiInspection: {
    inspectionId: string;
    result: 'PASS' | 'WARNING' | 'FAIL';
    totalPads: number;
    defectivePads: number;
    meanVolumePct?: number;
    sigmaVolumePct?: number;
    inspectedAt: string;
    opticalMachineId: string;
    unitCriticalPads?: Array<{
      padId: string;
      refDes: string;
      volumeRatioPct: number;
      heightUm: number;
      areaRatioPct: number;
      offsetXUm: number;
      offsetYUm: number;
      defectType?: string;
    }>;
  } | null;
}

export const SpiInspectionCard: React.FC<SpiInspectionCardProps> = ({ spiInspection }) => {
  if (!spiInspection) {
    return (
      <div className="milled-panel rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2 border-b border-white/10 pb-3">
          <Sliders className="w-4 h-4 text-[#38BDF8]" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            3D SOLDER PASTE INSPECTION (SPI)
          </h3>
        </div>
        <div className="py-6 text-center text-xs font-mono text-[#7A8A9E]">
          No 3D SPI optical inspection records registered for this panel.
        </div>
      </div>
    );
  }

  const isPass = spiInspection.result === 'PASS';

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#38BDF8]" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            3D SOLDER PASTE INSPECTION (SPI)
          </h3>
        </div>

        <span
          className={`text-[10px] font-mono px-2.5 py-0.5 rounded border font-bold flex items-center gap-1 ${
            isPass
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/15 border-red-500/40 text-red-400'
          }`}
        >
          {isPass ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          {spiInspection.result}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Inspected Pads</span>
          <span className="text-sm font-bold text-white">{spiInspection.totalPads}</span>
        </div>
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Defective Pads</span>
          <span className={`text-sm font-bold ${spiInspection.defectivePads > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {spiInspection.defectivePads}
          </span>
        </div>
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Mean Volume</span>
          <span className="text-sm font-bold text-[#38BDF8]">
            {spiInspection.meanVolumePct ? `${spiInspection.meanVolumePct}%` : '—'}
          </span>
        </div>
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">Optical System</span>
          <span className="text-xs font-bold text-white truncate block" title={spiInspection.opticalMachineId}>
            {spiInspection.opticalMachineId}
          </span>
        </div>
      </div>

      {/* Critical Pad Geometry Samples */}
      {spiInspection.unitCriticalPads && spiInspection.unitCriticalPads.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-mono text-[#7A8A9E] uppercase tracking-wider block">
            Critical RefDes Aperture Measurements
          </span>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-white/5 text-[10px] text-[#7A8A9E] uppercase bg-[#080C12]">
                  <th className="py-1.5 px-2">Pad ID</th>
                  <th className="py-1.5 px-2">RefDes</th>
                  <th className="py-1.5 px-2">Volume %</th>
                  <th className="py-1.5 px-2">Height (µm)</th>
                  <th className="py-1.5 px-2">Area %</th>
                  <th className="py-1.5 px-2">XY Offset</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {spiInspection.unitCriticalPads.map((pad, i) => (
                  <tr key={i}>
                    <td className="py-1 px-2 text-[#7A8A9E]">{pad.padId}</td>
                    <td className="py-1 px-2 font-bold text-white">{pad.refDes}</td>
                    <td className="py-1 px-2 text-[#38BDF8]">{pad.volumeRatioPct.toFixed(1)}%</td>
                    <td className="py-1 px-2 text-white/80">{pad.heightUm.toFixed(1)} µm</td>
                    <td className="py-1 px-2 text-white/80">{pad.areaRatioPct.toFixed(1)}%</td>
                    <td className="py-1 px-2 text-[#7A8A9E]">
                      ({pad.offsetXUm.toFixed(1)}, {pad.offsetYUm.toFixed(1)}) µm
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
