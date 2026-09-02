import React, { useState } from 'react';
import { Search, GitFork, ArrowRight, Package, Box, ShieldCheck, Cpu, Layers } from 'lucide-react';
import { GenealogyTree } from '@mes/shared';

export const GenealogyExplorer: React.FC = () => {
  const [query, setQuery] = useState<string>('PNL-SM-00140');
  const [searchType, setSearchType] = useState<'PANEL' | 'REEL'>('PANEL');
  const [tree, setTree] = useState<GenealogyTree | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const executeTrace = async (searchVal = query, type = searchType) => {
    if (!searchVal.trim()) return;
    setLoading(true);
    setError('');

    try {
      const endpoint = type === 'PANEL' 
        ? `/api/v1/genealogy/batch/${encodeURIComponent(searchVal.trim())}`
        : `/api/v1/genealogy/lot/${encodeURIComponent(searchVal.trim())}`;

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('Record not found');

      const data: GenealogyTree = await res.json();
      if (!data.nodes || data.nodes.length === 0) {
        setError(`Zero genealogical placement records for ${searchVal}`);
        setTree(null);
      } else {
        setTree(data);
      }
    } catch (err: any) {
      setError(err.message || 'Trace lookup failed');
      setTree(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Console */}
      <div className="milled-panel rounded-xl p-6 space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
              TRACEABILITY & RECALL ENGINE
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#00E699]" />
            <span className="text-[10px] font-mono text-[#00E699] font-bold">ALCOA+ AUDIT COMPLIANT</span>
          </div>
          <h2 className="text-lg font-bold text-white font-sans mt-0.5">
            Bidirectional SMT Component Genealogy & Recall
          </h2>
          <p className="text-xs text-[#7A8A9E]">
            Backward trace from panel barcode to mounted reels, or forward recall from defective component reel to all affected boards.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-[#0A0E13] p-1 rounded-lg border border-white/10 text-xs font-mono">
            <button
              onClick={() => { setSearchType('PANEL'); setQuery('PNL-SM-00140'); }}
              className={`px-3 py-1.5 rounded-md transition-all ${
                searchType === 'PANEL' ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/30' : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              [PANEL BARCODE TRACE]
            </button>
            <button
              onClick={() => { setSearchType('REEL'); setQuery('REEL-MUR-98124'); }}
              className={`px-3 py-1.5 rounded-md transition-all ${
                searchType === 'REEL' ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/30' : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              [REEL DEFECT RECALL]
            </button>
          </div>

          <div className="flex-1 min-w-[260px] relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executeTrace()}
              placeholder={searchType === 'PANEL' ? 'Scan Panel Serial (e.g. PNL-SM-00140)...' : 'Scan Reel Barcode UID (e.g. REEL-MUR-98124)...'}
              className="w-full bg-[#070A0E] border border-white/15 rounded-lg pl-10 pr-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-[#00E699]"
            />
            <Search className="w-4 h-4 text-[#7A8A9E] absolute left-3 top-3" />
          </div>

          <button
            onClick={() => executeTrace()}
            disabled={loading}
            className="bg-[#00E699] hover:bg-[#00E699]/90 active:bg-[#00E699]/80 text-[#0B0F14] font-bold font-mono text-xs px-5 py-2.5 rounded-lg shadow-lg active:scale-95 transition-all"
          >
            {loading ? 'QUERYING BUS...' : 'RUN TRACE'}
          </button>
        </div>

        {/* Quick Demo Pre-sets */}
        <div className="flex items-center gap-2 text-xs font-mono text-[#7A8A9E] pt-1">
          <span>SAMPLE UIDs:</span>
          <button 
            onClick={() => { setSearchType('PANEL'); setQuery('PNL-SM-00140'); executeTrace('PNL-SM-00140', 'PANEL'); }}
            className="text-[#00E699] hover:underline font-bold"
          >
            PNL-SM-00140
          </button>
          <span>•</span>
          <button 
            onClick={() => { setSearchType('REEL'); setQuery('REEL-MUR-98124'); executeTrace('REEL-MUR-98124', 'REEL'); }}
            className="text-[#00E699] hover:underline font-bold"
          >
            REEL-MUR-98124 (0402 Cap)
          </button>
          <span>•</span>
          <button 
            onClick={() => { setSearchType('REEL'); setQuery('REEL-STM-11029'); executeTrace('REEL-STM-11029', 'REEL'); }}
            className="text-[#00E699] hover:underline font-bold"
          >
            REEL-STM-11029 (MCU)
          </button>
        </div>
      </div>

      {error && (
        <div className="milled-panel border-[#FF334B]/40 text-[#FF334B] p-4 rounded-xl text-xs font-mono">
          {error}
        </div>
      )}

      {/* Visualized Genealogy Nodes */}
      {tree && (
        <div className="milled-panel rounded-xl p-6 space-y-6">
          <div className="flex justify-between items-center border-b border-white/10 pb-3 font-mono">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#00E699]" />
              Lineage Graph: <span className="text-[#00E699]">{query}</span>
            </h3>
            <span className="text-xs text-[#7A8A9E]">
              {tree.nodes.length} Physical Nodes • {tree.edges.length} Placement Links
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tree.nodes.map((node) => {
              const isPanel = node.type === 'FINISHED_PANEL';
              const isReel = node.type === 'COMPONENT_REEL';
              const isEquipment = node.type === 'SMT_EQUIPMENT';

              let borderColor = 'border-white/10';
              let accentColor = 'text-[#7A8A9E]';
              if (isPanel) {
                borderColor = 'border-[#00C2FF]/40';
                accentColor = 'text-[#00C2FF]';
              } else if (isReel) {
                borderColor = 'border-[#00E699]/40';
                accentColor = 'text-[#00E699]';
              }

              return (
                <div
                  key={node.id}
                  className={`milled-slot p-4 rounded-xl text-xs space-y-3 relative border ${borderColor}`}
                >
                  <div className="flex justify-between items-center font-mono">
                    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-[#0A0E13] border border-white/10 text-[#7A8A9E]">
                      {node.type.replace('_', ' ')}
                    </span>
                    <span className={`font-bold ${accentColor}`}>{node.code}</span>
                  </div>

                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    {isPanel && <Box className="w-4 h-4 text-[#00C2FF]" />}
                    {isReel && <Package className="w-4 h-4 text-[#00E699]" />}
                    {isEquipment && <Cpu className="w-4 h-4 text-[#FFB800]" />}
                    <span className="truncate">{node.label}</span>
                  </h4>

                  <div className="bg-[#0A0E13] p-3 rounded-lg border border-white/5 space-y-1.5 font-mono text-[11px]">
                    {Object.entries(node.details).map(([key, val]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-[#7A8A9E] capitalize">{key}:</span>
                        <span className="text-white truncate max-w-[170px]">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Placement Edge Table */}
          <div className="pt-2 font-mono">
            <div className="text-[10px] uppercase tracking-widest text-[#7A8A9E] mb-2">
              COMPONENT PLACEMENT EDGES
            </div>
            <div className="bg-[#0A0E13] rounded-lg border border-white/10 divide-y divide-white/5 text-xs">
              {tree.edges.map((edge, i) => (
                <div key={i} className="p-2.5 flex items-center justify-between text-[#7A8A9E]">
                  <span className="text-[#00E699] font-bold">{edge.from}</span>
                  <span className="flex items-center gap-1 text-[10px]">
                    ── {edge.relation} ──<ArrowRight className="w-3.5 h-3.5 text-white/40" />
                  </span>
                  <span className="text-[#00C2FF] font-bold">{edge.to}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
