// apps/web/src/components/traceability/GenealogyMode.tsx
import React, { useState, useEffect } from 'react';
import { PanelUnitMatrix } from './PanelUnitMatrix';
import { LifecycleRibbon } from './LifecycleRibbon';
import { PlacementChainTable } from './PlacementChainTable';
import { SolderPasteCard } from './SolderPasteCard';
import { SpiInspectionCard } from './SpiInspectionCard';
import { ReflowProfileCard } from './ReflowProfileCard';
import { AoiInspectionCard } from './AoiInspectionCard';
import { ReworkLedger } from './ReworkLedger';
import { DhrLedgerCard } from './DhrLedgerCard';

interface GenealogyModeProps {
  panelData: any; // PanelGenealogyRecord
}

export const GenealogyMode: React.FC<GenealogyModeProps> = ({ panelData }) => {
  const units = panelData.units || [];
  
  // Default to first defective unit if present, else unit 1
  const initialUnitPos = units.find((u: any) => u.unitStatus === 'QUALITY_HOLD')?.unitPosition || units[0]?.unitPosition || 1;
  const [selectedUnitPos, setSelectedUnitPos] = useState<number>(initialUnitPos);

  // Sync if panelData changes
  useEffect(() => {
    const defectUnit = units.find((u: any) => u.unitStatus === 'QUALITY_HOLD');
    setSelectedUnitPos(defectUnit ? defectUnit.unitPosition : (units[0]?.unitPosition || 1));
  }, [panelData.panelBarcode]);

  // Local O(1) resolution — ZERO network roundtrips when switching units
  const currentUnit = units.find((u: any) => u.unitPosition === selectedUnitPos) || units[0];

  if (!currentUnit) {
    return (
      <div className="milled-panel rounded-xl p-8 text-center text-xs font-mono text-[#7A8A9E]">
        Zero multi-up circuit units recorded for panel {panelData.panelBarcode}.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1. Multi-Up PCB Panel Discretization Matrix & Unit Selector */}
      <PanelUnitMatrix
        panelBarcode={panelData.panelBarcode}
        checkout={panelData.checkout}
        units={units}
        selectedUnitPosition={selectedUnitPos}
        onSelectUnit={(pos) => setSelectedUnitPos(pos)}
      />

      {/* 2. 7-Stage Chronological Manufacturing Lifecycle Ribbon */}
      <LifecycleRibbon unitGenealogy={currentUnit} />

      {/* 3. Placement Chain Table (RefDes, CAD, Feeder, Reel, MSL) */}
      <PlacementChainTable placementChain={currentUnit.placementChain || []} />

      {/* 4. Inspection & Manufacturing Process Domain Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SolderPasteCard
          solderPaste={currentUnit.solderPaste || []}
          stencil={currentUnit.stencil}
        />
        <SpiInspectionCard spiInspection={currentUnit.spiInspection} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReflowProfileCard reflowProfile={currentUnit.reflowProfile} />
        <AoiInspectionCard aoiInspections={currentUnit.aoiInspections || []} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReworkLedger reworkHistory={currentUnit.reworkHistory || []} />
        <DhrLedgerCard
          dhr={currentUnit.dhr}
          complianceLedger={currentUnit.complianceLedger}
        />
      </div>
    </div>
  );
};
