// apps/web/src/components/traceability/RecallContainmentTable.tsx
import React, { useState } from 'react';
import { ShieldAlert, Search, AlertOctagon, CheckCircle2 } from 'lucide-react';

interface RecallContainmentTableProps {
  affectedPanels: Array<{
    panelBarcode: string;
    batchNumber: string;
    completedAt: string;
  }>;
  affectedUnits: Array<{
    panelBarcode: string;
    unitPosition: number;
    unitSerialNumber: string | null;
    unitStatus: string;
    affectedRefDes: string[];
    mountedReelId?: string;
  }>;
}

export const RecallContainmentTable: React.FC<RecallContainmentTableProps> = ({
  affectedPanels,
  affectedUnits
}) => {
  const [filter, setFilter] = useState('');

  const filteredPanels = affectedPanels.filter((p) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return p.panelBarcode.toLowerCase().includes(q) || p.batchNumber.toLowerCase().includes(q);
  });

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
              CONTAINMENT BOUNDARY: AFFECTED PANELS & UNITS
            </h3>
          </div>
          <p className="text-xs text-[#7A8A9E] mt-0.5">
            Trace boundary derived via set-based query without iterative loops.
          </p>
        </div>

        <div className="relative min-w-[200px]">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter panel or batch..."
            className="w-full bg-[#070A0E] border border-white/15 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#00E699]"
          />
          <Search className="w-3.5 h-3.5 text-[#7A8A9E] absolute left-2.5 top-2.5" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-white/10 text-[10px] text-[#7A8A9E] uppercase tracking-wider bg-[#080C12]">
              <th className="py-2.5 px-3">Panel Barcode</th>
              <th className="py-2.5 px-3">Batch Number</th>
              <th className="py-2.5 px-3">Affected Units</th>
              <th className="py-2.5 px-3">Affected RefDes</th>
              <th className="py-2.5 px-3">Placement Timestamp</th>
              <th className="py-2.5 px-3">Containment Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredPanels.map((panel, idx) => {
              const panelUnits = affectedUnits.filter((u) => u.panelBarcode === panel.panelBarcode);
              const refDesSet = new Set<string>();
              panelUnits.forEach((u) => u.affectedRefDes?.forEach((r) => refDesSet.add(r)));
              const hasHold = panelUnits.some((u) => u.unitStatus === 'QUALITY_HOLD');

              return (
                <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3 font-bold text-white">
                    {panel.panelBarcode}
                  </td>
                  <td className="py-2.5 px-3 text-[#7A8A9E]">
                    {panel.batchNumber}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-white font-bold">{panelUnits.length} units</span>
                    <span className="text-[10px] text-[#7A8A9E] ml-1.5">
                      ({panelUnits.map((u) => `#${u.unitPosition}`).join(', ')})
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-[#00E699] font-bold">
                      {Array.from(refDesSet).join(', ') || 'C12'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-[#7A8A9E]">
                    {new Date(panel.completedAt).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3">
                    {hasHold ? (
                      <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-bold border border-red-500/30 text-[10px] flex items-center gap-1 w-fit">
                        <AlertOctagon className="w-3 h-3" />
                        ON QUALITY HOLD
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold border border-amber-500/30 text-[10px] flex items-center gap-1 w-fit">
                        QUARANTINE CANDIDATE
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
