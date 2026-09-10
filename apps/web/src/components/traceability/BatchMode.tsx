// apps/web/src/components/traceability/BatchMode.tsx
import React, { useState } from 'react';
import { Layers, CheckCircle2, AlertTriangle, XCircle, Search, Package, ShieldCheck, ArrowRight } from 'lucide-react';

interface BatchModeProps {
  batchData: any | null;
  onSelectPanel?: (panelBarcode: string) => void;
}

export const BatchMode: React.FC<BatchModeProps> = ({ batchData, onSelectPanel }) => {
  const [panelFilter, setPanelFilter] = useState('');

  if (!batchData) {
    return (
      <div className="milled-panel rounded-xl p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400">
          <Layers className="w-6 h-6" />
        </div>
        <div className="max-w-md mx-auto">
          <h3 className="text-sm font-bold text-white font-sans uppercase tracking-wider">
            No Batch Selected
          </h3>
          <p className="text-xs text-[#7A8A9E] mt-1 font-sans">
            Enter a Batch / Job number above to inspect aggregated production yield, panel completions, and materials consumption.
          </p>
        </div>
        <div className="text-[11px] font-mono text-[#7A8A9E]">
          Try quick demo preset: <code className="text-[#00E699]">JOB-SM-260901</code>
        </div>
      </div>
    );
  }

  const { batch, dhr, summary, panels = [], materialsConsumed = [] } = batchData;
  const yieldPct = summary.totalUnits > 0
    ? ((summary.passedUnits / summary.totalUnits) * 100).toFixed(1)
    : '0.0';

  const filteredPanels = panels.filter((p: any) => {
    const q = panelFilter.trim().toLowerCase();
    if (!q) return true;
    return p.panelBarcode.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Batch Header & Identity */}
      <div className="milled-panel rounded-xl p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
                BATCH PRODUCTION ROLLUP
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span className="text-[10px] font-mono text-blue-400 font-bold">{batch?.productCode || 'SMT-RUN'}</span>
            </div>
            <h2 className="text-lg font-bold text-white font-sans mt-0.5 flex items-center gap-3">
              Batch: <span className="text-[#00E699] font-mono">{batch?.batchNumber || 'N/A'}</span>
              <span className="text-xs font-mono font-normal text-[#7A8A9E]">
                WO: {batch?.workOrderNumber || 'N/A'}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-[#7A8A9E]">DHR Status:</span>
            <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${
              dhr?.status === 'RELEASED'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              {dhr?.status || 'PENDING_QA_REVIEW'}
            </span>
          </div>
        </div>

        {/* Batch Yield & Volume KPI Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-4">
          <div className="bg-[#070A0E] border border-white/10 rounded-lg p-3">
            <span className="text-[10px] font-mono uppercase text-[#7A8A9E]">Total Panels</span>
            <p className="text-xl font-mono font-bold text-white mt-1">{summary?.totalPanels ?? 0}</p>
          </div>
          <div className="bg-[#070A0E] border border-white/10 rounded-lg p-3">
            <span className="text-[10px] font-mono uppercase text-[#7A8A9E]">Total Units</span>
            <p className="text-xl font-mono font-bold text-white mt-1">{summary?.totalUnits ?? 0}</p>
          </div>
          <div className="bg-[#070A0E] border border-white/10 rounded-lg p-3">
            <span className="text-[10px] font-mono uppercase text-emerald-400">Passed Units</span>
            <p className="text-xl font-mono font-bold text-emerald-400 mt-1">{summary?.passedUnits ?? 0}</p>
          </div>
          <div className="bg-[#070A0E] border border-white/10 rounded-lg p-3">
            <span className="text-[10px] font-mono uppercase text-amber-400">Held Units</span>
            <p className="text-xl font-mono font-bold text-amber-400 mt-1">{summary?.heldUnits ?? 0}</p>
          </div>
          <div className="bg-[#070A0E] border border-white/10 rounded-lg p-3">
            <span className="text-[10px] font-mono uppercase text-red-400">Defects</span>
            <p className="text-xl font-mono font-bold text-red-400 mt-1">{summary?.totalDefects ?? 0}</p>
          </div>
          <div className="bg-[#070A0E] border border-white/10 rounded-lg p-3">
            <span className="text-[10px] font-mono uppercase text-purple-400">Reworks</span>
            <p className="text-xl font-mono font-bold text-purple-400 mt-1">{summary?.reworkCount ?? 0}</p>
          </div>
          <div className="bg-[#070A0E] border border-white/10 rounded-lg p-3 col-span-2 sm:col-span-1 lg:col-span-1">
            <span className="text-[10px] font-mono uppercase text-[#00E699]">Yield</span>
            <p className="text-xl font-mono font-bold text-[#00E699] mt-1">{yieldPct}%</p>
          </div>
        </div>
      </div>

      {/* Panels Summary Table */}
      <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
              PANELS IN BATCH ({panels.length})
            </h3>
            <p className="text-xs text-[#7A8A9E] mt-0.5">
              Individual PCB panels assembled and processed under batch run.
            </p>
          </div>

          <div className="relative min-w-[200px]">
            <input
              type="text"
              value={panelFilter}
              onChange={(e) => setPanelFilter(e.target.value)}
              placeholder="Search panel..."
              className="w-full bg-[#070A0E] border border-white/15 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-[#00E699]"
            />
            <Search className="w-3.5 h-3.5 text-[#7A8A9E] absolute left-2.5 top-2.5" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] font-mono uppercase tracking-wider text-[#7A8A9E]">
                <th className="py-2.5 px-3">Panel Barcode</th>
                <th className="py-2.5 px-3">Units</th>
                <th className="py-2.5 px-3">Quality Status</th>
                <th className="py-2.5 px-3">Completion Time</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-xs">
              {filteredPanels.map((p: any) => (
                <tr key={p.panelBarcode} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3 text-white font-bold">{p.panelBarcode}</td>
                  <td className="py-2.5 px-3 text-[#7A8A9E]">{p.unitCount} Units</td>
                  <td className="py-2.5 px-3">
                    {p.hasDefects ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                        <AlertTriangle className="w-3 h-3" /> DEFECT RECORDED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" /> PASSED
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-[#7A8A9E]">
                    {p.completedAt ? new Date(p.completedAt).toLocaleString() : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {onSelectPanel && (
                      <button
                        onClick={() => onSelectPanel(p.panelBarcode)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#00E699]/10 hover:bg-[#00E699]/20 text-[#00E699] text-[11px] font-bold transition-colors"
                      >
                        Inspect <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredPanels.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#7A8A9E] text-xs">
                    No matching panels found in this batch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Materials Consumed Rollup Table */}
      <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
        <div className="border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-[#00E699]" />
            <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
              MATERIALS CONSUMED IN BATCH ({materialsConsumed.length})
            </h3>
          </div>
          <p className="text-xs text-[#7A8A9E] mt-0.5">
            Component reels and bulk lots consumed during pick-and-place assembly.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[10px] font-mono uppercase tracking-wider text-[#7A8A9E]">
                <th className="py-2.5 px-3">Part Number</th>
                <th className="py-2.5 px-3">Reel / Lot ID</th>
                <th className="py-2.5 px-3">Lot Number</th>
                <th className="py-2.5 px-3">Supplier</th>
                <th className="py-2.5 px-3 text-right">Qty Consumed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-xs">
              {materialsConsumed.map((m: any, idx: number) => (
                <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3 text-white font-bold">{m.partNumber}</td>
                  <td className="py-2.5 px-3 text-[#00E699]">{m.reelId}</td>
                  <td className="py-2.5 px-3 text-[#7A8A9E]">{m.lotNumber || '—'}</td>
                  <td className="py-2.5 px-3 text-[#7A8A9E]">{m.supplierName || '—'}</td>
                  <td className="py-2.5 px-3 text-right text-white font-bold">
                    {m.quantityConsumed?.toLocaleString() ?? 0}
                  </td>
                </tr>
              ))}
              {materialsConsumed.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#7A8A9E] text-xs">
                    No material consumption records found for this batch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
