// apps/web/src/components/traceability/SolderPasteCard.tsx
import React from 'react';
import { Layers, Thermometer, ShieldCheck } from 'lucide-react';

interface SolderPasteCardProps {
  solderPaste: Array<{
    jarId: string;
    lotNumber: string;
    alloyType: string;
    thawVerifiedAt?: string;
    mixedAt?: string;
    temperatureVerifiedC?: number | null;
    linkage: {
      source: string;
      confidence: string;
      detail?: string;
    };
  }>;
  stencil: {
    stencilId: string;
    serialNumber: string;
    revision: string;
    sessionStartedAt: string;
    linkage: {
      source: string;
      confidence: string;
      detail?: string;
    };
  } | null;
}

export const SolderPasteCard: React.FC<SolderPasteCardProps> = ({ solderPaste, stencil }) => {
  const paste = solderPaste?.[0];

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#00E699]" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            STENCIL & SOLDER PASTE LIFECYCLE
          </h3>
        </div>
        {paste?.linkage && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-1 font-bold">
            <ShieldCheck className="w-3 h-3" />
            {paste.linkage.source} • {paste.linkage.confidence}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
        {/* Stencil Master Data */}
        <div className="bg-[#070A0E] p-3.5 rounded-lg border border-white/10 space-y-2">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block font-bold">
            SMT Foil Stencil
          </span>
          {stencil ? (
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#7A8A9E]">Stencil ID:</span>
                <span className="text-white font-bold">{stencil.stencilId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A8A9E]">Serial Number:</span>
                <span className="text-[#00E699] font-bold">{stencil.serialNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A8A9E]">Revision:</span>
                <span className="text-white">Rev {stencil.revision}</span>
              </div>
              <div className="flex justify-between text-[11px] pt-1 border-t border-white/5 text-[#7A8A9E]">
                <span>Session Started:</span>
                <span>{new Date(stencil.sessionStartedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          ) : (
            <div className="text-[#7A8A9E] py-3 text-center">No active stencil session mapped.</div>
          )}
        </div>

        {/* Solder Paste Jar */}
        <div className="bg-[#070A0E] p-3.5 rounded-lg border border-white/10 space-y-2">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block font-bold">
            Solder Paste Jar
          </span>
          {paste ? (
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#7A8A9E]">Jar ID:</span>
                <span className="text-white font-bold">{paste.jarId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A8A9E]">Paste Lot:</span>
                <span className="text-white font-bold">{paste.lotNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A8A9E]">Alloy:</span>
                <span className="text-white">{paste.alloyType}</span>
              </div>
              {paste.temperatureVerifiedC && (
                <div className="flex justify-between text-[11px] pt-1 border-t border-white/5 text-[#7A8A9E]">
                  <span>Verified Temp:</span>
                  <span className="text-[#00E699] font-bold">{paste.temperatureVerifiedC}°C</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[#7A8A9E] py-3 text-center">No paste jar assigned.</div>
          )}
        </div>
      </div>
    </div>
  );
};
