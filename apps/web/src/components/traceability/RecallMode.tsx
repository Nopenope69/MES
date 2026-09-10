// apps/web/src/components/traceability/RecallMode.tsx
import React from 'react';
import { GitFork, AlertCircle, HelpCircle } from 'lucide-react';
import { RecallDashboard } from './RecallDashboard';
import { RecallContainmentTable } from './RecallContainmentTable';

interface RecallModeProps {
  recallData: any | null;
  onSelectPanel?: (panelBarcode: string) => void;
}

export const RecallMode: React.FC<RecallModeProps> = ({ recallData, onSelectPanel }) => {
  if (!recallData) {
    return (
      <div className="milled-panel rounded-xl p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
          <GitFork className="w-6 h-6" />
        </div>
        <div className="max-w-md mx-auto">
          <h3 className="text-sm font-bold text-white font-sans uppercase tracking-wider">
            No Active Containment Investigation
          </h3>
          <p className="text-xs text-[#7A8A9E] mt-1 font-sans">
            Enter a Component Reel ID, Material Lot, Solder Paste Jar, or Stencil ID above to run a set-based containment trace across all production panels.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-[#7A8A9E]">
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Try quick demo preset: <code className="text-[#00E699]">REEL-MUR-98124</code></span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Scope KPIs & Containment Status */}
      <RecallDashboard recallData={recallData} />

      {/* Affected Panels & Discrete Units Boundary */}
      <RecallContainmentTable
        affectedPanels={recallData.affectedPanels || []}
        affectedUnits={recallData.affectedUnits || []}
      />
    </div>
  );
};
