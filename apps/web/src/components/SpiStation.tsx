import React, { useState, useEffect } from 'react';
import {
  Layers, Gauge, Activity, ShieldCheck, ShieldAlert, RefreshCw,
  Sliders, Droplet, CheckCircle2, AlertTriangle, AlertOctagon,
  Search, Eye, ArrowRight, Check, XCircle, Info, Database, Zap
} from 'lucide-react';

interface SpiInspectionHeader {
  id: string;
  sourceSystem: string;
  panelBarcode: string;
  batchId?: string;
  workCenterId: string;
  opticalMachineId: string;
  result: 'PASS' | 'WARNING' | 'FAIL';
  totalPadsInspected: number;
  defectivePadsCount: number;
  meanVolumePct: number;
  sigmaVolumePct: number;
  inspectedAt: string;
}

interface SpiPadMeasurement {
  padId: string;
  unitPosition: number;
  refDes: string;
  pinNo?: number;
  volumeRatioPct: number;
  heightUm: number;
  areaRatioPct: number;
  offsetXUm: number;
  offsetYUm: number;
  isCriticalPad: boolean;
  defectType?: string;
}

interface SpcData {
  sampleCount: number;
  isStatisticallyValid: boolean;
  meanVolumePct: number;
  sigmaVolumePct: number;
  cp?: number;
  cpk?: number;
  pp?: number;
  ppk?: number;
  trend: 'STABLE' | 'DRIFTING_LOW' | 'DRIFTING_HIGH' | 'INCREASED_VARIABILITY';
  usl: number;
  lsl: number;
}

interface PrinterCapabilities {
  equipmentId: string;
  manufacturer: string;
  model: string;
  cfxVersion: string;
  supports: {
    stencilCleaning: boolean;
    parameterModification: boolean;
    pressureControl: boolean;
    separationSpeedControl: boolean;
    printSpeedControl: boolean;
  };
}

interface TuningHistoryRecord {
  id: string;
  correctionId: string;
  actionType: 'STENCIL_CLEAN' | 'PARAMETER_MODIFY';
  cleaningMode?: string;
  parameterName?: string;
  oldValue?: number;
  proposedValue?: number;
  delta?: number;
  unit?: string;
  triggerCondition: string;
  status: string;
  commandedAt: string;
  acknowledgedAt?: string;
  verifiedAt?: string;
  verifiedByPanelBarcode?: string;
}

export const SpiStation: React.FC = () => {
  const [panelBarcode, setPanelBarcode] = useState('PNL-260901-0042');
  const [searchInput, setSearchInput] = useState('PNL-260901-0042');
  const [inspection, setInspection] = useState<SpiInspectionHeader | null>(null);
  const [measurements, setMeasurements] = useState<SpiPadMeasurement[]>([]);
  const [selectedPad, setSelectedPad] = useState<SpiPadMeasurement | null>(null);
  const [spc, setSpc] = useState<SpcData | null>(null);
  const [capabilities, setCapabilities] = useState<PrinterCapabilities | null>(null);
  const [tuningHistory, setTuningHistory] = useState<TuningHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isWiping, setIsWiping] = useState(false);

  useEffect(() => {
    loadStationData(panelBarcode);
  }, [panelBarcode]);

  const loadStationData = async (barcode: string) => {
    setIsLoading(true);
    try {
      // 1. Fetch Panel SPI details
      const panelRes = await fetch(`/api/v1/spi/panels/${barcode}`);
      if (panelRes.ok) {
        const json = await panelRes.json();
        if (json.success && json.data) {
          setInspection(json.data.inspection);
          setMeasurements(json.data.measurements);
          if (json.data.measurements.length > 0) {
            setSelectedPad(json.data.measurements[0]);
          }
        }
      }

      // 2. Fetch SPC
      const spcRes = await fetch('/api/v1/spi/spc/PROG-SM-METER-TOP-REV4');
      if (spcRes.ok) {
        const json = await spcRes.json();
        if (json.success) setSpc(json.data);
      }

      // 3. Fetch Capabilities
      const capRes = await fetch('/api/v1/spi/printer/capabilities?equipmentId=wc-spg-01');
      if (capRes.ok) {
        const json = await capRes.json();
        if (json.success) setCapabilities(json.data);
      }

      // 4. Fetch Tuning History
      const histRes = await fetch('/api/v1/spi/tuning-history?limit=15');
      if (histRes.ok) {
        const json = await histRes.json();
        if (json.success) setTuningHistory(json.data);
      }
    } catch (err) {
      console.error('Failed to load SPI station data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualWipe = async () => {
    setIsWiping(true);
    setActionFeedback(null);
    try {
      const res = await fetch('/api/v1/spi/printer/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId: 'wc-spg-01',
          workCenterId: 'wc-spg-01',
          cleaningMode: 'VACUUM_SOLVENT',
          triggerCondition: 'Manual Operator Trigger from 3D SPI Cockpit'
        })
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback(`Underside Wipe Dispatched via IPC-CFX: ${data.correctionId}`);
        loadStationData(panelBarcode);
      } else {
        setActionFeedback(`Command Failed: ${data.message}`);
      }
    } catch (err: any) {
      setActionFeedback(`Error: ${err.message}`);
    } finally {
      setIsWiping(false);
    }
  };

  const handleMicroTunePressure = async (deltaKgf: number) => {
    setActionFeedback(null);
    try {
      const res = await fetch('/api/v1/spi/printer/modify-parameter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId: 'wc-spg-01',
          workCenterId: 'wc-spg-01',
          parameterName: 'SQUEEGEE_PRESSURE',
          currentValue: 8.5,
          proposedValue: Number((8.5 + deltaKgf).toFixed(2)),
          unit: 'kgf',
          triggerCondition: `Manual operator micro-tune (${deltaKgf > 0 ? '+' : ''}${deltaKgf} kgf)`
        })
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback(`Pressure Tuned to ${data.appliedValue} kgf via IPC-CFX`);
        loadStationData(panelBarcode);
      } else {
        setActionFeedback(`Tuning Rejected: ${data.message}`);
      }
    } catch (err: any) {
      setActionFeedback(`Error: ${err.message}`);
    }
  };

  // Helper for heatmap pad colors
  const getPadColor = (volPct: number, hasDefect?: string) => {
    if (hasDefect || volPct < 70) return '#EF4444'; // Red (Collapse / Smear / Defect)
    if (volPct < 85) return '#F59E0B'; // Orange/Yellow (Low Warning)
    if (volPct > 135) return '#3B82F6'; // Blue (Excess Paste)
    if (volPct > 120) return '#60A5FA'; // Light Blue (High Warning)
    return '#10B981'; // Emerald Green (Nominal)
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar: Station Status & Panel Search */}
      <div className="bg-[#10161F] border border-white/10 rounded-2xl p-4 sm:p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#18222F] border border-white/15 flex items-center justify-center text-[#00E699] shadow-inner">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
                STATION 00 • PRE-REFLOW 3D SPI & SCREEN PRINTER IPC-CFX
              </span>
              <span className="w-2 h-2 rounded-full bg-[#00E699] animate-pulse" />
              <span className="text-[11px] font-mono text-[#00E699] font-bold">IPC-CFX v1.7 CONNECTED</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Koh Young Aspire3 3D SPI <span className="text-white/40 text-sm font-normal">⇄ Fuji GPX-C Closed-Loop</span>
            </h2>
          </div>
        </div>

        {/* Panel Barcode Search Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (searchInput.trim()) setPanelBarcode(searchInput.trim());
          }}
          className="flex items-center gap-2"
        >
          <div className="relative">
            <Search className="w-4 h-4 text-[#7A8A9E] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Enter Panel Barcode..."
              className="bg-[#0A0E13] border border-white/15 text-white text-xs font-mono rounded-lg pl-9 pr-3 py-2 w-64 focus:outline-none focus:border-[#00E699] transition-all"
            />
          </div>
          <button
            type="submit"
            className="bg-[#1D2735] hover:bg-[#253245] text-white border border-white/15 px-3 py-2 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#00E699]' : ''}`} />
            <span>LOAD</span>
          </button>
        </form>
      </div>

      {actionFeedback && (
        <div className="bg-[#13221B] border border-[#00E699]/30 rounded-xl px-4 py-3 text-xs font-mono text-[#00E699] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{actionFeedback}</span>
          </div>
          <button onClick={() => setActionFeedback(null)} className="text-[#7A8A9E] hover:text-white">✕</button>
        </div>
      )}

      {/* Main Grid: Stencil Aperture Heatmap & Auto-Tuning Control Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Vector Heatmap (8 Cols) */}
        <div className="lg:col-span-7 bg-[#10161F] border border-white/10 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#00E699]" />
                <h3 className="text-sm font-bold text-white tracking-wide font-mono">
                  STENCIL APERTURE VOLUME HEATMAP (3D SPI)
                </h3>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="text-[#7A8A9E]">PANEL:</span>
                <span className="text-white font-bold">{panelBarcode}</span>
                {inspection && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    inspection.result === 'PASS'
                      ? 'bg-[#00E699]/20 text-[#00E699] border border-[#00E699]/40'
                      : inspection.result === 'WARNING'
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                      : 'bg-red-500/20 text-red-400 border border-red-500/40'
                  }`}>
                    {inspection.result}
                  </span>
                )}
              </div>
            </div>

            {/* SVG Visual Board Map */}
            <div className="relative bg-[#070B0E] border border-white/10 rounded-xl p-6 h-80 flex items-center justify-center overflow-hidden">
              <svg viewBox="0 0 500 300" className="w-full h-full max-h-72">
                {/* PCB Outline */}
                <rect x="10" y="10" width="480" height="280" rx="8" fill="#0C151D" stroke="#1F2E3E" strokeWidth="2" />

                {/* Fiducials */}
                <circle cx="25" cy="25" r="4" fill="#00E699" />
                <circle cx="475" cy="275" r="4" fill="#00E699" />

                {/* Aperture Pads Grid */}
                {measurements.map((pad, idx) => {
                  // Synthetic spatial distribution across grid for visual clarity
                  const col = idx % 6;
                  const row = Math.floor(idx / 6);
                  const x = 50 + col * 70;
                  const y = 40 + row * 55;
                  const isSelected = selectedPad?.padId === pad.padId;
                  const color = getPadColor(pad.volumeRatioPct, pad.defectType);

                  return (
                    <g
                      key={pad.padId}
                      onClick={() => setSelectedPad(pad)}
                      className="cursor-pointer transition-transform hover:scale-110"
                    >
                      <rect
                        x={x}
                        y={y}
                        width={pad.isCriticalPad ? 38 : 28}
                        height={pad.isCriticalPad ? 26 : 18}
                        rx="3"
                        fill={color}
                        stroke={isSelected ? '#FFFFFF' : pad.isCriticalPad ? '#FFB800' : 'rgba(255,255,255,0.2)'}
                        strokeWidth={isSelected ? 2.5 : 1}
                        opacity={0.9}
                      />
                      <text
                        x={x + (pad.isCriticalPad ? 19 : 14)}
                        y={y + (pad.isCriticalPad ? 16 : 13)}
                        fill="#000000"
                        fontSize="9"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {pad.refDes}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Heatmap Legend */}
              <div className="absolute bottom-3 left-3 bg-[#10161F]/90 backdrop-blur border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-3 text-[10px] font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-red-500" />
                  <span className="text-white/70">&lt;75% / Defect</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                  <span className="text-white/70">75-85%</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                  <span className="text-white font-bold">85-115% (Nominal)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
                  <span className="text-white/70">&gt;135% (Excess)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Selected Aperture Detail Strip */}
          {selectedPad && (
            <div className="mt-4 bg-[#0A0E13] border border-white/10 rounded-xl p-3.5 text-xs font-mono grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <span className="text-[#7A8A9E] block text-[10px]">APERTURE / REF</span>
                <strong className="text-white">{selectedPad.refDes}</strong>
                {selectedPad.isCriticalPad && (
                  <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                    CRITICAL
                  </span>
                )}
              </div>
              <div>
                <span className="text-[#7A8A9E] block text-[10px]">VOLUME RATIO</span>
                <span className={`font-bold ${
                  selectedPad.volumeRatioPct >= 85 && selectedPad.volumeRatioPct <= 115
                    ? 'text-[#00E699]'
                    : 'text-amber-400'
                }`}>
                  {selectedPad.volumeRatioPct}%
                </span>
              </div>
              <div>
                <span className="text-[#7A8A9E] block text-[10px]">HEIGHT / AREA</span>
                <span className="text-white">{selectedPad.heightUm} µm / {selectedPad.areaRatioPct}%</span>
              </div>
              <div>
                <span className="text-[#7A8A9E] block text-[10px]">OFFSET (X/Y)</span>
                <span className="text-white">
                  {selectedPad.offsetXUm > 0 ? `+${selectedPad.offsetXUm}` : selectedPad.offsetXUm} / {selectedPad.offsetYUm} µm
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Screen Printer Closed-Loop & IPC-CFX Controls (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Printer Real-Time Parameters Card */}
          <div className="bg-[#10161F] border border-white/10 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-[#00E699]" />
                <h3 className="text-sm font-bold text-white tracking-wide font-mono">
                  FUJI GPX-C PRINTER (IPC-CFX v1.7)
                </h3>
              </div>
              <span className="text-[10px] font-mono bg-[#18222F] text-[#00E699] px-2 py-0.5 rounded border border-[#00E699]/30">
                AUTO-TUNING READY
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-[#0A0E13] border border-white/10 rounded-xl p-3">
                <span className="text-[10px] font-mono text-[#7A8A9E] block">SQUEEGEE PRESSURE</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-bold font-mono text-white">8.50</span>
                  <span className="text-xs font-mono text-[#7A8A9E]">kgf</span>
                </div>
                <div className="flex items-center justify-between text-[9px] font-mono text-[#7A8A9E] mt-1.5 border-t border-white/5 pt-1">
                  <span>WIN: [6.0 - 12.0]</span>
                  <span className="text-[#00E699]">NOMINAL</span>
                </div>
              </div>

              <div className="bg-[#0A0E13] border border-white/10 rounded-xl p-3">
                <span className="text-[10px] font-mono text-[#7A8A9E] block">SEPARATION SPEED</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-bold font-mono text-white">1.20</span>
                  <span className="text-xs font-mono text-[#7A8A9E]">mm/s</span>
                </div>
                <div className="flex items-center justify-between text-[9px] font-mono text-[#7A8A9E] mt-1.5 border-t border-white/5 pt-1">
                  <span>WIN: [0.5 - 3.0]</span>
                  <span className="text-[#00E699]">NOMINAL</span>
                </div>
              </div>
            </div>

            {/* Micro-Adjustment and Cleaning Action Buttons */}
            <div className="space-y-2">
              <button
                onClick={handleManualWipe}
                disabled={isWiping}
                className="w-full bg-[#18222F] hover:bg-[#202E3F] text-[#00E699] border border-[#00E699]/30 hover:border-[#00E699] py-2.5 px-4 rounded-xl text-xs font-mono font-bold transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
              >
                <Droplet className={`w-4 h-4 ${isWiping ? 'animate-bounce text-[#00E699]' : ''}`} />
                <span>{isWiping ? 'EXECUTING WIPE...' : 'COMMAND CFX UNDERSIDE WIPE (VACUUM+SOLVENT)'}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleMicroTunePressure(-0.2)}
                  className="flex-1 bg-[#0A0E13] hover:bg-[#151D28] text-white border border-white/10 py-2 rounded-lg text-xs font-mono transition-all"
                >
                  PRESSURE -0.2 kgf
                </button>
                <button
                  onClick={() => handleMicroTunePressure(0.2)}
                  className="flex-1 bg-[#0A0E13] hover:bg-[#151D28] text-white border border-white/10 py-2 rounded-lg text-xs font-mono transition-all"
                >
                  PRESSURE +0.2 kgf
                </button>
              </div>
            </div>
          </div>

          {/* Statistically Defensible SPC Card (Pillar 9) */}
          <div className="bg-[#10161F] border border-white/10 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#00E699]" />
                <h3 className="text-sm font-bold text-white tracking-wide font-mono">
                  STATISTICALLY DEFENSIBLE SPC
                </h3>
              </div>
              {spc?.isStatisticallyValid ? (
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30 font-bold">
                  VALID (N ≥ 30)
                </span>
              ) : (
                <span className="text-[10px] font-mono bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded border border-amber-500/30">
                  PRELIMINARY (N &lt; 30)
                </span>
              )}
            </div>

            <div className="bg-[#0A0E13] border border-white/10 rounded-xl p-3.5 space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center">
                <span className="text-[#7A8A9E]">SAMPLE COUNT (N):</span>
                <strong className="text-white">{spc?.sampleCount || 0} PANELS</strong>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#7A8A9E]">MEAN VOLUME (µ):</span>
                <span className="text-white font-bold">{spc?.meanVolumePct || 100.0}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#7A8A9E]">SIGMA (σ):</span>
                <span className="text-white">{spc?.sigmaVolumePct || 0.0}%</span>
              </div>
              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                <span className="text-[#7A8A9E]">PROCESS CAPABILITY (Cpk):</span>
                {spc?.isStatisticallyValid && spc.cpk !== undefined ? (
                  <strong className="text-[#00E699] text-sm">{spc.cpk}</strong>
                ) : (
                  <span className="text-[#7A8A9E] italic text-[11px]">REQUIRES N ≥ 30</span>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#7A8A9E]">PROCESS TREND:</span>
                <span className="text-white font-bold">{spc?.trend || 'STABLE'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Closed-Loop Tuning History Audit Trail (Pillar 4 & 10) */}
      <div className="bg-[#10161F] border border-white/10 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#00E699]" />
            <h3 className="text-sm font-bold text-white tracking-wide font-mono">
              CLOSED-LOOP TUNING AUDIT LOG & MANDATORY VERIFICATION TRAIL
            </h3>
          </div>
          <span className="text-xs font-mono text-[#7A8A9E]">
            UNBROKEN TRACEABILITY (STENCIL → PRINTER → SPI → VERIFY)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-white/10 text-[#7A8A9E] text-[10px] uppercase">
                <th className="py-2.5 px-3">CORRECTION ID</th>
                <th className="py-2.5 px-3">ACTION</th>
                <th className="py-2.5 px-3">DELTA / MODE</th>
                <th className="py-2.5 px-3">TRIGGER REASON</th>
                <th className="py-2.5 px-3">STATUS</th>
                <th className="py-2.5 px-3">COMMANDED AT</th>
                <th className="py-2.5 px-3">VERIFIED BY PANEL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/90">
              {tuningHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-[#7A8A9E]">
                    No closed loop parameter tuning events recorded yet.
                  </td>
                </tr>
              ) : (
                tuningHistory.map((rec) => (
                  <tr key={rec.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-3 font-bold text-[#00E699]">{rec.correctionId}</td>
                    <td className="py-3 px-3">{rec.actionType}</td>
                    <td className="py-3 px-3">
                      {rec.actionType === 'STENCIL_CLEAN'
                        ? rec.cleaningMode || 'VACUUM_SOLVENT'
                        : `${rec.delta && rec.delta > 0 ? '+' : ''}${rec.delta} ${rec.unit || 'kgf'}`}
                    </td>
                    <td className="py-3 px-3 max-w-xs truncate text-[#7A8A9E]" title={rec.triggerCondition}>
                      {rec.triggerCondition}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        rec.status === 'VERIFIED_RECOVERED'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : rec.status === 'ACKNOWLEDGED' || rec.status === 'COMMANDED'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}>
                        {rec.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[#7A8A9E]">{new Date(rec.commandedAt).toLocaleTimeString()}</td>
                    <td className="py-3 px-3 text-white font-bold">{rec.verifiedByPanelBarcode || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
