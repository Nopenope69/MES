// apps/web/src/components/traceability/TraceabilitySearch.tsx
import React, { useState } from 'react';
import { Search, AlertCircle, Layers, GitFork, Package, AlertTriangle } from 'lucide-react';
import { isFixtureModeEnabled } from '../../services/traceability.api';

export type StationMode = 'GENEALOGY' | 'RECALL' | 'BATCH';

interface TraceabilitySearchProps {
  mode: StationMode;
  onModeChange: (mode: StationMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSearch: (overrideQuery?: string, overrideMode?: StationMode) => void;
  loading: boolean;
  ambiguousDetail?: string;
  onSelectDisambiguation?: (namespace: string) => void;
}

export const TraceabilitySearch: React.FC<TraceabilitySearchProps> = ({
  mode,
  onModeChange,
  query,
  onQueryChange,
  onSearch,
  loading,
  ambiguousDetail,
  onSelectDisambiguation
}) => {
  const fixtureMode = isFixtureModeEnabled();
  const demoPrefix = fixtureMode ? '[DEMO] ' : '';

  const presets = [
    { label: `${demoPrefix}PNL-260901-0042 (Defect U3)`, val: 'PNL-260901-0042', targetMode: 'GENEALOGY' as StationMode },
    { label: `${demoPrefix}PNL-SM-00140 (Clean Pass)`, val: 'PNL-SM-00140', targetMode: 'GENEALOGY' as StationMode },
    { label: `${demoPrefix}REEL-MUR-98124 (Reel Recall)`, val: 'REEL-MUR-98124', targetMode: 'RECALL' as StationMode },
    { label: `${demoPrefix}JOB-SM-260901 (Batch Yield)`, val: 'JOB-SM-260901', targetMode: 'BATCH' as StationMode }
  ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearch();
    }
  };

  const handlePresetClick = (presetVal: string, targetMode: StationMode) => {
    onQueryChange(presetVal);
    onModeChange(targetMode);
    onSearch(presetVal, targetMode);
  };

  const getPlaceholderText = () => {
    switch (mode) {
      case 'GENEALOGY':
        return 'Scan Panel Barcode (PNL-...) or Unit Serial (SN-...)...';
      case 'RECALL':
        return 'Scan Component Reel ID (REEL-...), Lot (LOT-...), or Stencil Serial (STN-...)...';
      case 'BATCH':
        return 'Enter Batch Job Number (JOB-... or WO-...)...';
    }
  };

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      {/* Station Title & Workflow Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
              HIGH-SPEED SMT TRACEABILITY
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#00E699]" />
            <span className="text-[10px] font-mono text-[#00E699] font-bold">AS-BUILT LINEAGE</span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-white font-sans mt-0.5 flex items-center gap-2">
            As-Built Genealogy & Containment Recall Station
          </h2>
        </div>

        {/* Tactical 3-Mode Controller */}
        <div className="flex bg-[#070A0E] p-1 rounded-xl border border-white/10 text-xs font-mono">
          <button
            onClick={() => onModeChange('GENEALOGY')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              mode === 'GENEALOGY'
                ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm'
                : 'text-[#7A8A9E] hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>01 // AS-BUILT GENEALOGY</span>
          </button>

          <button
            onClick={() => onModeChange('RECALL')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              mode === 'RECALL'
                ? 'bg-[#1D2735] text-red-400 font-bold border border-red-500/40 shadow-sm'
                : 'text-[#7A8A9E] hover:text-white'
            }`}
          >
            <GitFork className="w-3.5 h-3.5" />
            <span>02 // SET RECALL</span>
          </button>

          <button
            onClick={() => onModeChange('BATCH')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              mode === 'BATCH'
                ? 'bg-[#1D2735] text-[#38BDF8] font-bold border border-[#38BDF8]/40 shadow-sm'
                : 'text-[#7A8A9E] hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>03 // BATCH SUMMARY</span>
          </button>
        </div>
      </div>

      {/* Cross-Namespace Ambiguity Alert (when backend returns collision) */}
      {ambiguousDetail && (
        <div className="bg-amber-500/15 border border-amber-500/40 text-amber-300 p-3 rounded-lg text-xs font-mono flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold uppercase tracking-wider">AMBIGUOUS IDENTIFIER RESOLUTION</span>
            <p className="text-amber-200/80">{ambiguousDetail}</p>
            {onSelectDisambiguation && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => onSelectDisambiguation('COMPONENT_REEL')}
                  className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 rounded border border-amber-500/40 text-[11px]"
                >
                  Query as Component Reel
                </button>
                <button
                  onClick={() => onSelectDisambiguation('PANEL_BARCODE')}
                  className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 rounded border border-amber-500/40 text-[11px]"
                >
                  Query as Panel Barcode
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Omni-Search Input & Execute Button */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[280px] relative">
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholderText()}
            className="w-full bg-[#070A0E] border border-white/15 rounded-lg pl-10 pr-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-[#00E699] transition-all"
          />
          <Search className="w-4 h-4 text-[#7A8A9E] absolute left-3.5 top-3" />
        </div>

        <button
          onClick={() => onSearch()}
          disabled={loading}
          className="bg-[#00E699] hover:bg-[#00E699]/90 active:bg-[#00E699]/80 text-[#0B0F14] font-bold font-mono text-xs px-6 py-2.5 rounded-lg shadow-lg active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? 'ANALYZING BUS...' : 'RUN TRACE'}
        </button>
      </div>

      {/* Quick Presets Strip */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-[10px] font-mono text-[#7A8A9E] uppercase tracking-wider">
          Quick Presets:
        </span>
        {presets.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handlePresetClick(p.val, p.targetMode)}
            className="text-[11px] font-mono px-2.5 py-1 rounded bg-[#0A0E13] border border-white/10 text-[#7A8A9E] hover:text-[#00E699] hover:border-[#00E699]/30 transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
};
