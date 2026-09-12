import React, { useState, useEffect } from 'react';
import { 
  Cpu, AlertTriangle, CheckCircle2, RefreshCw, 
  TrendingDown, ShieldCheck, ShieldAlert, Zap,
  Play, Lock, Unlock, Sliders, Activity, Crosshair
} from 'lucide-react';

interface PredictiveAnomaly {
  id: string;
  anomalyType: string;
  severity: 'WARNING' | 'CRITICAL' | 'INFO';
  lineId: string;
  workCenterId: string;
  assetId: string;
  metric: string;
  observedValue: number;
  thresholdValue: number;
  confidence: number;
  details: string;
  detectedAt: string;
}

interface PredictiveAction {
  id: string;
  anomalyId?: string;
  actionType: 'CLEAN_STENCIL' | 'REPLACE_NOZZLE' | 'SLOW_CPH' | 'PAUSE_LINE' | 'CALIBRATE_FEEDER';
  targetEquipmentId: string;
  targetSlotNo?: number;
  status: 'PENDING' | 'AUTHORIZED' | 'EXECUTED' | 'REJECTED' | 'FAILED';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  safetyPolicyRequired: 'POLICY_MANUAL' | 'POLICY_AUTO';
  authorizedBy?: string;
  authorizedAt?: string;
  executedAt?: string;
  executionResult?: string;
}

interface ApertureTrendResult {
  apertureId: string;
  sampleCount: number;
  volumeSlopePerPanel: number;
  rSquared: number;
  latestVolumePercent: number;
  status: 'HEALTHY' | 'WARNING_DECAY' | 'CRITICAL_CLOGGING_RISK';
  recommendedActionId?: string;
}

interface NozzleEvaluationResult {
  assetId: string;
  headId: string;
  nozzleNo: number;
  feederSlot: number;
  sampleCount: number;
  ewmaMean: number;
  cusumPositive: number;
  status: 'HEALTHY' | 'ANOMALY_DETECTED';
  anomalyId?: string;
}

export const PredictiveIntelligenceStation: React.FC = () => {
  const [anomalies, setAnomalies] = useState<PredictiveAnomaly[]>([]);
  const [pendingActions, setPendingActions] = useState<PredictiveAction[]>([]);
  const [apertureTrend, setApertureTrend] = useState<ApertureTrendResult | null>(null);
  const [nozzleHealth, setNozzleHealth] = useState<NozzleEvaluationResult | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedNozzle, setSelectedNozzle] = useState<string>('nozzle-head-1-nz-08');
  const [actionProcessing, setActionProcessing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadData = async () => {
    try {
      setRefreshing(true);
      const [anomRes, actRes] = await Promise.all([
        fetch('/api/v1/predictive/anomalies'),
        fetch('/api/v1/predictive/actions/pending')
      ]);

      if (anomRes.ok) setAnomalies(await anomRes.json());
      if (actRes.ok) setPendingActions(await actRes.json());

      // Evaluate 3D SPI aperture clogging slope
      const aperRes = await fetch('/api/v1/predictive/evaluate/aperture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apertureId: 'aperture-U3-P1',
          recipeId: 'PROG-SM-METER-TOP-REV4'
        })
      });
      if (aperRes.ok) setApertureTrend(await aperRes.json());

      // Evaluate conditioned nozzle vacuum
      const nozRes = await fetch('/api/v1/predictive/evaluate/nozzle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: 'line-smt-01',
          workCenterId: 'wc-nxt-01',
          assetId: selectedNozzle,
          headId: selectedNozzle.includes('head-1') ? 'head-01' : 'head-02',
          nozzleNo: 8,
          feederSlot: 1,
          packageCode: '0402'
        })
      });
      if (nozRes.ok) setNozzleHealth(await nozRes.json());
    } catch (err: any) {
      console.error('Failed to load predictive analytics', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [selectedNozzle]);

  const authorizeAction = async (actionId: string) => {
    try {
      setActionProcessing(actionId);
      const res = await fetch(`/api/v1/predictive/actions/${actionId}/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizedBy: 'qa-lead-alpha',
          policy: 'POLICY_AUTO'
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setNotice({
          type: 'success',
          message: `ACTION AUTHORIZED: ${actionId.slice(0, 8)} unlocked for machine control execution.`
        });
        loadData();
      } else {
        setNotice({
          type: 'error',
          message: `AUTHORIZATION FAILED: ${data.reason || 'Safety criteria not met'}`
        });
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setActionProcessing(null);
      setTimeout(() => setNotice(null), 5000);
    }
  };

  const executeAction = async (actionId: string) => {
    try {
      setActionProcessing(actionId);
      const res = await fetch(`/api/v1/predictive/actions/${actionId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: 'op-smt-01'
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setNotice({
          type: 'success',
          message: `MACHINE CONTROL EXECUTED: Command dispatched to hardware controller cleanly.`
        });
        loadData();
      } else {
        setNotice({
          type: 'error',
          message: `SAFETY ABORT: ${data.reason || 'Hardware safety interlock prevented action'}`
        });
      }
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message });
    } finally {
      setActionProcessing(null);
      setTimeout(() => setNotice(null), 5000);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-[#7A8A9E] font-mono text-sm tracking-widest uppercase animate-pulse flex flex-col items-center gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-[#00E699]" />
        <span>Synthesizing Statistical Quality Intelligence Models...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Station Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#10161F] p-4 rounded-xl border border-white/10 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#18222F] border border-white/15 flex items-center justify-center text-[#00E699]">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
                SMT STATISTICAL PROCESS CONTROL (SPC & EWMA)
              </span>
              <span className="w-2 h-2 rounded-full bg-[#00E699] animate-pulse" />
              <span className="text-[10px] font-mono text-[#00E699] font-bold uppercase">
                PREDICTIVE QUALITY INFERENCE ACTIVE
              </span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Predictive Quality Intelligence & Machine Action Gate
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#18222F] hover:bg-[#223142] text-white rounded-lg border border-white/10 text-xs font-mono transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#00E699]' : ''}`} />
            <span>POLL MODELS</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className={`p-4 rounded-xl border text-xs font-mono flex items-center gap-3 ${
          notice.type === 'success' 
            ? 'bg-[#00E699]/10 border-[#00E699]/40 text-[#00E699]' 
            : 'bg-red-950/40 border-red-500/50 text-red-300'
        }`}>
          {notice.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Dual Core Analysis Grid: 3D SPI Aperture Decay vs Fuji Pick-and-Place Conditioned Nozzle */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 3D SPI Stencil Aperture Clogging Slope Analyzer */}
        <div className="bg-[#10161F] p-5 rounded-xl border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <TrendingDown className="w-4 h-4 text-[#FFB800]" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                3D SPI Aperture Clogging Linear Regression
              </h3>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-[#38BDF8]">
              aperture-U3-P1 (QFN-16)
            </span>
          </div>

          {apertureTrend ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">DECAY SLOPE</span>
                  <span className="text-base font-bold text-red-400 mt-1 block">
                    {apertureTrend.volumeSlopePerPanel}% / panel
                  </span>
                </div>

                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">R² FIT QUALITY</span>
                  <span className="text-base font-bold text-[#00E699] mt-1 block">
                    {(apertureTrend.rSquared * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">LATEST VOLUME</span>
                  <span className="text-base font-bold text-white mt-1 block">
                    {apertureTrend.latestVolumePercent}%
                  </span>
                </div>
              </div>

              <div className="p-3 bg-[#0C1117] rounded-lg border border-white/5 flex items-center justify-between text-xs font-mono">
                <span className="text-[#7A8A9E]">Aperture Status:</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  apertureTrend.status === 'CRITICAL_CLOGGING_RISK'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : 'bg-[#00E699]/10 text-[#00E699] border border-[#00E699]/40'
                }`}>
                  {apertureTrend.status.replace(/_/g, ' ')}
                </span>
              </div>

              {apertureTrend.status === 'CRITICAL_CLOGGING_RISK' && (
                <div className="bg-red-950/30 border border-red-500/40 p-3 rounded-lg text-xs font-mono flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div className="text-red-200">
                    <strong className="text-red-400">PREVENTATIVE STENCIL WIPE REQUIRED:</strong> Solder paste volume transfer efficiency decaying rapidly across 30 consecutive boards. Stencil wipe action recommended to prevent solder starvation.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-[#7A8A9E] font-mono text-xs">
              Calculating aperture regression trends...
            </div>
          )}
        </div>

        {/* Conditioned Pick-and-Place Nozzle Health (EWMA & CUSUM) */}
        <div className="bg-[#10161F] p-5 rounded-xl border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <Crosshair className="w-4 h-4 text-[#00E699]" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                Conditioned Nozzle Vacuum SPC (CUSUM)
              </h3>
            </div>
            <select
              value={selectedNozzle}
              onChange={(e) => setSelectedNozzle(e.target.value)}
              className="bg-[#0C1117] border border-white/10 rounded px-2 py-1 text-white text-[11px] font-mono"
            >
              <option value="nozzle-head-1-nz-08">Head 1 Nozzle 08 (C0402 Decaying)</option>
              <option value="nozzle-head-2-nz-01">Head 2 Nozzle 01 (Calibrated Normal)</option>
            </select>
          </div>

          {nozzleHealth ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">EWMA VACUUM</span>
                  <span className="text-base font-bold text-white mt-1 block">
                    {nozzleHealth.ewmaMean} kPa
                  </span>
                </div>

                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">CUSUM STATISTIC</span>
                  <span className={`text-base font-bold mt-1 block ${
                    nozzleHealth.cusumPositive > 4 ? 'text-red-400' : 'text-[#00E699]'
                  }`}>
                    {nozzleHealth.cusumPositive} σ
                  </span>
                </div>

                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">SAMPLES</span>
                  <span className="text-base font-bold text-[#38BDF8] mt-1 block">
                    {nozzleHealth.sampleCount} pts
                  </span>
                </div>
              </div>

              <div className="p-3 bg-[#0C1117] rounded-lg border border-white/5 flex items-center justify-between text-xs font-mono">
                <span className="text-[#7A8A9E]">Conditioning [Machine, Head, Package]:</span>
                <span className="text-white font-bold">Fuji NXT • Head 1 • 0402</span>
              </div>

              <div className={`p-3 rounded-lg border text-xs font-mono flex items-center justify-between ${
                nozzleHealth.status === 'ANOMALY_DETECTED'
                  ? 'bg-red-950/30 border-red-500/40 text-red-300'
                  : 'bg-[#00E699]/10 border-[#00E699]/30 text-[#00E699]'
              }`}>
                <span>SPC Evaluation Result:</span>
                <span className="font-bold">{nozzleHealth.status}</span>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-[#7A8A9E] font-mono text-xs">
              Sampling nozzle vacuum telemetry...
            </div>
          )}
        </div>
      </div>

      {/* Machine Control Safety Action Gate */}
      <div className="bg-[#10161F] p-5 rounded-xl border border-white/10 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-[#38BDF8]" />
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Machine Control Module Safety Execution Gate
              </h3>
              <p className="text-xs text-[#7A8A9E] font-mono">
                Physical action authorization policy — Prevents unauthorized machine state changes
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-[#00E699] bg-[#00E699]/10 px-2.5 py-1 rounded border border-[#00E699]/30">
            SAFETY INTERLOCK ENABLED
          </span>
        </div>

        {pendingActions.length === 0 ? (
          <div className="p-8 text-center text-[#7A8A9E] font-mono text-xs">
            No pending corrective actions. All equipment running within statistical control limits.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="text-[10px] uppercase tracking-wider text-[#7A8A9E] border-b border-white/10 bg-[#0C1117]">
                <tr>
                  <th className="p-3">Action ID</th>
                  <th className="p-3">Corrective Type</th>
                  <th className="p-3">Target Machine</th>
                  <th className="p-3">Urgency</th>
                  <th className="p-3">Policy Gate</th>
                  <th className="p-3 text-right">Physical Dispatch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {pendingActions.map((action) => {
                  const isAuthorized = action.status === 'AUTHORIZED';
                  const isProcessing = actionProcessing === action.id;

                  return (
                    <tr key={action.id} className="hover:bg-white/[0.02]">
                      <td className="p-3 font-bold text-white">
                        {action.id.slice(0, 8)}...
                      </td>
                      <td className="p-3 text-[#FFB800] font-bold">
                        {action.actionType.replace(/_/g, ' ')}
                      </td>
                      <td className="p-3 text-white">
                        {action.targetEquipmentId}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          action.urgency === 'HIGH' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                          'bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/30'
                        }`}>
                          {action.urgency}
                        </span>
                      </td>
                      <td className="p-3">
                        {isAuthorized ? (
                          <span className="inline-flex items-center gap-1 text-[#00E699] font-bold">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            AUTHORIZED ({action.authorizedBy})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#FFB800]">
                            <Lock className="w-3.5 h-3.5" />
                            AWAITING APPROVAL
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        {!isAuthorized ? (
                          <button
                            onClick={() => authorizeAction(action.id)}
                            disabled={isProcessing}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#18222F] hover:bg-[#223142] text-[#00E699] border border-[#00E699]/40 font-bold rounded shadow transition-colors"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>{isProcessing ? 'AUTHORIZING...' : 'AUTHORIZE'}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => executeAction(action.id)}
                            disabled={isProcessing}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#00E699] hover:bg-[#00E699]/90 text-black font-bold rounded shadow transition-colors"
                          >
                            <Play className="w-3 h-3" />
                            <span>{isProcessing ? 'EXECUTING...' : 'DISPATCH TO MACHINE'}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
