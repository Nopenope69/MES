import React, { useState, useEffect } from 'react';
import {
  Layers, Clock, Thermometer, RotateCw, CheckCircle2,
  AlertTriangle, ShieldCheck, ShieldAlert, ArrowRight, Play, RefreshCw, XCircle
} from 'lucide-react';

interface SolderPasteJar {
  id: string;
  jar_id: string;
  part_number: string;
  profile_id: string;
  alloy_type: string;
  lot_number: string;
  expiry_date: string;
  status: 'REFRIGERATED' | 'THAWING' | 'THAWED' | 'MIXED' | 'AUTHORIZED' | 'ON_STENCIL' | 'DEPLETED' | 'EXPIRED' | 'DISCARDED';
  removed_from_cold_at?: string;
  thaw_verified_at?: string;
  thaw_duration_minutes: number;
  temperature_verified_at?: string;
  temperature_verified_c?: number;
  mixed_at?: string;
  mixed_duration_seconds: number;
  mixing_method?: string;
  current_work_center_id: string;
  manufacturer?: string;
  thaw_required_minutes?: number;
  minimum_processing_temperature_c?: number;
  mixing_min_seconds?: number;
  mixing_max_seconds?: number;
  stencil_life_minutes?: number;
}

export const SolderPasteStation: React.FC = () => {
  const [jars, setJars] = useState<SolderPasteJar[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJarId, setSelectedJarId] = useState<string>('');
  const [verifyTempInput, setVerifyTempInput] = useState<string>('23.5');
  const [mixDurationInput, setMixDurationInput] = useState<string>('120');
  const [actionFeedback, setActionFeedback] = useState<{ type: 'SUCCESS' | 'ERROR'; message: string } | null>(null);
  const [printerAuthStatus, setPrinterAuthStatus] = useState<any>(null);

  const fetchJars = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/smt/paste/jars');
      if (res.ok) {
        const data = await res.json();
        setJars(data);
        if (!selectedJarId && data.length > 0) {
          setSelectedJarId(data[0].jar_id);
        }
      }
    } catch (e: any) {
      console.error('Failed to fetch paste jars:', e);
    } finally {
      setLoading(false);
    }
  };

  const checkPrinterAuth = async () => {
    try {
      const res = await fetch('/api/v1/smt/printer/authorize-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workCenterId: 'wc-spg-01',
          stencilId: 'STC-SM-4G-TOP'
        })
      });
      const data = await res.json();
      setPrinterAuthStatus(data);
    } catch (e: any) {
      console.error('Printer auth check error:', e);
    }
  };

  useEffect(() => {
    fetchJars();
    checkPrinterAuth();
    const interval = setInterval(() => {
      fetchJars();
      checkPrinterAuth();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleRemoveFromCold = async (jarId: string) => {
    try {
      const res = await fetch('/api/v1/smt/paste/remove-from-cold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jarId, operatorId: 'op-spg-01' })
      });
      const data = await res.json();
      if (res.ok) {
        setActionFeedback({ type: 'SUCCESS', message: data.message });
        await fetchJars();
      } else {
        setActionFeedback({ type: 'ERROR', message: data.error || 'Failed to remove from cold.' });
      }
    } catch (e: any) {
      setActionFeedback({ type: 'ERROR', message: e.message });
    }
  };

  const handleVerifyThaw = async (jarId: string) => {
    try {
      const res = await fetch('/api/v1/smt/paste/verify-thaw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jarId,
          temperatureVerifiedC: parseFloat(verifyTempInput),
          operatorId: 'op-spg-01'
        })
      });
      const data = await res.json();
      if (data.thawSufficient) {
        setActionFeedback({ type: 'SUCCESS', message: `Thaw PASSED: ${data.temperatureVerifiedC}°C >= 22.0°C.` });
      } else {
        setActionFeedback({ type: 'ERROR', message: `Thaw FAILED: ${data.message}` });
      }
      await fetchJars();
    } catch (e: any) {
      setActionFeedback({ type: 'ERROR', message: e.message });
    }
  };

  const handleMix = async (jarId: string) => {
    try {
      const res = await fetch('/api/v1/smt/paste/mix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jarId,
          durationSeconds: parseInt(mixDurationInput, 10),
          mixingMethod: 'CENTRIFUGAL_PLANETARY',
          operatorId: 'op-spg-01'
        })
      });
      const data = await res.json();
      if (data.mixSufficient) {
        setActionFeedback({ type: 'SUCCESS', message: data.message });
      } else {
        setActionFeedback({ type: 'ERROR', message: data.message });
      }
      await fetchJars();
    } catch (e: any) {
      setActionFeedback({ type: 'ERROR', message: e.message });
    }
  };

  const handleAuthorize = async (jarId: string) => {
    try {
      const res = await fetch('/api/v1/smt/paste/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jarId, workCenterId: 'wc-spg-01', operatorId: 'op-spg-01' })
      });
      const data = await res.json();
      if (res.ok) {
        setActionFeedback({ type: 'SUCCESS', message: data.message });
        await fetchJars();
      } else {
        setActionFeedback({ type: 'ERROR', message: data.error });
      }
    } catch (e: any) {
      setActionFeedback({ type: 'ERROR', message: e.message });
    }
  };

  const handleLoadOnStencil = async (jarId: string) => {
    try {
      const res = await fetch('/api/v1/smt/paste/load-on-stencil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jarId,
          stencilId: 'STC-SM-4G-TOP',
          workCenterId: 'wc-spg-01',
          batchId: 'wo-dixon-01',
          operatorId: 'op-spg-01'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setActionFeedback({ type: 'SUCCESS', message: data.message });
        await fetchJars();
        await checkPrinterAuth();
      } else {
        setActionFeedback({ type: 'ERROR', message: data.error });
      }
    } catch (e: any) {
      setActionFeedback({ type: 'ERROR', message: e.message });
    }
  };

  const selectedJar = jars.find((j) => j.jar_id === selectedJarId) || jars[0];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'REFRIGERATED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-blue-500/15 text-blue-400 border border-blue-500/30">COLD (2-10°C)</span>;
      case 'THAWING':
        return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/15 text-amber-400 border border-amber-500/30">THAWING (240m)</span>;
      case 'THAWED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">THAWED (UNMIXED)</span>;
      case 'MIXED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-purple-500/15 text-purple-400 border border-purple-500/30">MIXED</span>;
      case 'AUTHORIZED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">AUTHORIZED</span>;
      case 'ON_STENCIL':
        return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#00E699]/15 text-[#00E699] border border-[#00E699]/40">ON STENCIL</span>;
      case 'EXPIRED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-red-500/15 text-red-400 border border-red-500/30">EXPIRED</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-gray-500/15 text-gray-400">{status}</span>;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      {/* Station Header & Screen Printer Quality Interlock Banner */}
      <div className="bg-[#10161F] border border-white/10 rounded-xl p-5 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#18222F] border border-white/15 flex items-center justify-center text-[#00E699] shadow-inner">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
                  STAGE 01 // DEK HORIZON 03IX SCREEN PRINTER
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  WORK CENTER: wc-spg-01
                </span>
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight mt-0.5 flex items-center gap-3">
                Solder Paste & Stencil Quality Gate Station
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => { fetchJars(); checkPrinterAuth(); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#18222F] text-[#7A8A9E] hover:text-white border border-white/10 text-xs font-mono transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>SYNC</span>
            </button>
            <div className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-mono font-bold ${
              printerAuthStatus?.allowed
                ? 'bg-emerald-500/10 text-[#00E699] border-emerald-500/30'
                : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}>
              {printerAuthStatus?.allowed ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
              <span>{printerAuthStatus?.allowed ? 'PRINTER GATE: PERMITTED' : 'PRINTER GATE: INTERLOCK TRIPPED'}</span>
            </div>
          </div>
        </div>

        {/* Live Stencil & Session Status Bar */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-white/10 text-xs font-mono">
          <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5">
            <div className="text-[#7A8A9E]">ACTIVE STENCIL</div>
            <div className="text-white font-bold mt-1 text-sm">STC-SM-4G-TOP (Rev A)</div>
            <div className="text-[#00E699] text-[11px] mt-0.5">Foil: 120µm Laser Electropolished</div>
          </div>

          <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5">
            <div className="text-[#7A8A9E]">STENCIL ROLLING LIFE</div>
            <div className="text-white font-bold mt-1 text-sm">
              {printerAuthStatus?.remainingLifeMinutes !== undefined ? `${printerAuthStatus.remainingLifeMinutes}m / 480m` : '480m / 480m'}
            </div>
            <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-[#00E699] h-full transition-all"
                style={{
                  width: `${Math.min(100, ((printerAuthStatus?.remainingLifeMinutes ?? 480) / 480) * 100)}%`
                }}
              />
            </div>
          </div>

          <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5">
            <div className="text-[#7A8A9E]">MOUNTED PASTE JAR</div>
            <div className="text-white font-bold mt-1 text-sm">
              {printerAuthStatus?.pasteJarId || 'JAR-ALPHA-2601-C'}
            </div>
            <div className="text-[#7A8A9E] text-[11px] mt-0.5">SAC305 Type 4 • Lot LOT-PASTE-2601</div>
          </div>

          <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5">
            <div className="text-[#7A8A9E]">GATE REASON</div>
            <div className="text-white font-semibold mt-1 text-[11px] truncate" title={printerAuthStatus?.reason}>
              {printerAuthStatus?.reason || 'Checking interlock parameters...'}
            </div>
          </div>
        </div>
      </div>

      {/* Action Notification Alert */}
      {actionFeedback && (
        <div className={`p-4 rounded-xl border flex items-center justify-between text-xs font-mono animate-fade-in ${
          actionFeedback.type === 'SUCCESS'
            ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
            : 'bg-red-950/40 border-red-500/40 text-red-300'
        }`}>
          <div className="flex items-center gap-3">
            {actionFeedback.type === 'SUCCESS' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
            <span>{actionFeedback.message}</span>
          </div>
          <button onClick={() => setActionFeedback(null)} className="text-white/60 hover:text-white">✕</button>
        </div>
      )}

      {/* Workspace Grid: Jars Inventory & Staging Execution Control */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Solder Paste Jars Inventory (7 Cols) */}
        <div className="lg:col-span-7 bg-[#10161F] border border-white/10 rounded-xl p-5 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#00E699]" />
              CONTROLLED SOLDER PASTE JARS ({jars.length})
            </h3>
            <span className="text-[11px] font-mono text-[#7A8A9E]">IPC J-STD-004B & Manufacturer TDS</span>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto">
            {jars.map((jar) => {
              const isSelected = selectedJar?.jar_id === jar.jar_id;
              return (
                <div
                  key={jar.jar_id}
                  onClick={() => setSelectedJarId(jar.jar_id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#18222F] border-[#00E699]/60 shadow-lg'
                      : 'bg-[#0C1117] border-white/5 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[#10161F] border border-white/10 flex items-center justify-center font-mono font-bold text-xs text-white">
                        {jar.alloy_type === 'SAC305' ? 'SAC' : 'PST'}
                      </div>
                      <div>
                        <div className="text-sm font-bold font-mono text-white flex items-center gap-2">
                          {jar.jar_id}
                          {getStatusBadge(jar.status)}
                        </div>
                        <div className="text-[11px] text-[#7A8A9E] font-mono mt-0.5">
                          {jar.part_number} • Lot: {jar.lot_number} • Exp: {jar.expiry_date?.slice(0, 10)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <div className="text-xs text-white font-bold">
                        {jar.status === 'ON_STENCIL' ? 'PRINTING' : jar.status}
                      </div>
                      <div className="text-[10px] text-[#7A8A9E]">
                        Thaw Req: {jar.thaw_required_minutes ?? 240}m
                      </div>
                    </div>
                  </div>

                  {/* Micro Metadata Footnote */}
                  <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[11px] font-mono text-[#7A8A9E]">
                    <span>Thaw Verified: {jar.thaw_verified_at ? 'YES' : 'PENDING'}</span>
                    <span>Mix Duration: {jar.mixed_duration_seconds > 0 ? `${jar.mixed_duration_seconds}s` : 'NONE'}</span>
                    <span>Surface Temp: {jar.temperature_verified_c ? `${jar.temperature_verified_c}°C` : 'N/A'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Controlled Process Workflow Actions (5 Cols) */}
        <div className="lg:col-span-5 bg-[#10161F] border border-white/10 rounded-xl p-5 shadow-2xl flex flex-col">
          <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2 mb-4">
            <RotateCw className="w-4 h-4 text-[#00E699]" />
            MATERIAL WORKFLOW EXECUTION
          </h3>

          {selectedJar ? (
            <div className="space-y-5 flex-1 flex flex-col justify-between">
              {/* Selected Jar Target Information */}
              <div className="bg-[#0C1117] p-4 rounded-xl border border-white/10">
                <div className="text-[11px] font-mono text-[#7A8A9E]">SELECTED MATERIAL UID</div>
                <div className="text-lg font-bold font-mono text-white mt-0.5">{selectedJar.jar_id}</div>
                <div className="text-xs font-mono text-[#00E699] mt-1">{selectedJar.part_number} ({selectedJar.alloy_type})</div>
                <div className="mt-3 flex items-center justify-between text-xs font-mono border-t border-white/5 pt-2 text-[#7A8A9E]">
                  <span>CURRENT STATE:</span>
                  <span className="font-bold text-white">{selectedJar.status}</span>
                </div>
              </div>

              {/* Step 1: Remove from Cold Refrigeration */}
              <div className="p-3.5 rounded-lg bg-[#0C1117] border border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-white">
                    <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px]">1</span>
                    COLD STORAGE RETRIEVAL
                  </div>
                  <button
                    disabled={selectedJar.status !== 'REFRIGERATED'}
                    onClick={() => handleRemoveFromCold(selectedJar.jar_id)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-mono font-bold transition-all"
                  >
                    START THAW
                  </button>
                </div>
                <p className="text-[11px] font-mono text-[#7A8A9E] mt-2">
                  Initiates 4-hour (240 min) ambient equilibrium window prior to opening lid.
                </p>
              </div>

              {/* Step 2: Verify Thaw & Surface Temperature */}
              <div className="p-3.5 rounded-lg bg-[#0C1117] border border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-white">
                    <span className="w-5 h-5 rounded bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px]">2</span>
                    THAW & TEMP VERIFICATION
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-[#18222F] px-2 py-1 rounded border border-white/10 text-xs font-mono">
                      <input
                        type="number"
                        step="0.1"
                        value={verifyTempInput}
                        onChange={(e) => setVerifyTempInput(e.target.value)}
                        className="w-12 bg-transparent text-white focus:outline-none text-right font-bold"
                      />
                      <span className="text-[#7A8A9E] ml-1">°C</span>
                    </div>
                    <button
                      disabled={selectedJar.status !== 'THAWING'}
                      onClick={() => handleVerifyThaw(selectedJar.jar_id)}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-mono font-bold transition-all"
                    >
                      VERIFY
                    </button>
                  </div>
                </div>
                <p className="text-[11px] font-mono text-[#7A8A9E] mt-2">
                  Requires ≥22.0°C surface thermal probe check to prevent moisture condensation.
                </p>
              </div>

              {/* Step 3: Planetary Centrifugal Mixing */}
              <div className="p-3.5 rounded-lg bg-[#0C1117] border border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-white">
                    <span className="w-5 h-5 rounded bg-purple-500/20 text-purple-400 flex items-center justify-center text-[10px]">3</span>
                    PLANETARY MIXING CYCLE
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-[#18222F] px-2 py-1 rounded border border-white/10 text-xs font-mono">
                      <input
                        type="number"
                        value={mixDurationInput}
                        onChange={(e) => setMixDurationInput(e.target.value)}
                        className="w-12 bg-transparent text-white focus:outline-none text-right font-bold"
                      />
                      <span className="text-[#7A8A9E] ml-1">sec</span>
                    </div>
                    <button
                      disabled={selectedJar.status !== 'THAWED'}
                      onClick={() => handleMix(selectedJar.jar_id)}
                      className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-mono font-bold transition-all"
                    >
                      RECORD MIX
                    </button>
                  </div>
                </div>
                <p className="text-[11px] font-mono text-[#7A8A9E] mt-2">
                  Profile mandates 120s – 300s planetary shear to achieve thixotropic rheology.
                </p>
              </div>

              {/* Step 4 & 5: Authorization & Mounting */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={selectedJar.status !== 'MIXED'}
                  onClick={() => handleAuthorize(selectedJar.jar_id)}
                  className="px-4 py-3 rounded-xl bg-[#1D2735] hover:bg-[#253245] border border-[#00E699]/40 disabled:opacity-30 disabled:cursor-not-allowed text-[#00E699] font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>AUTHORIZE JAR</span>
                </button>

                <button
                  disabled={selectedJar.status !== 'AUTHORIZED'}
                  onClick={() => handleLoadOnStencil(selectedJar.jar_id)}
                  className="px-4 py-3 rounded-xl bg-[#00E699] hover:bg-[#00c985] text-black font-mono text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>LOAD ON STENCIL</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs font-mono text-[#7A8A9E]">
              No solder paste jars found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
