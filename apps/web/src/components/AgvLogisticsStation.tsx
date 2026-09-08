import React, { useState, useEffect } from 'react';
import { 
  Truck, Package, Battery, ShieldAlert, CheckCircle2, 
  Clock, RefreshCw, AlertTriangle, ArrowRight, ShieldCheck,
  Lock, Unlock, Radio, Send, Play, Layers
} from 'lucide-react';

interface AgvUnit {
  id: string;
  code: string;
  name: string;
  model: string;
  status: 'IDLE' | 'IN_TRANSIT' | 'DELIVERING' | 'CHARGING' | 'ERROR' | 'MAINTENANCE';
  currentLocation: string;
  batteryPercent: number;
  currentMissionId?: string;
  lastHeartbeatAt: string;
}

interface AgvMission {
  id: string;
  missionType: string;
  materialType: string;
  materialId: string;
  sourceLocation: string;
  targetLineId: string;
  targetWorkCenterId: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  status: string;
  agvId?: string;
  deliveryAuthorizedBy?: string;
  deliveryAuthorizedAt?: string;
  createdAt: string;
}

interface MaterialReservation {
  id: string;
  reelId: string;
  lineId: string;
  slotNo: number;
  partNumber: string;
  purpose: string;
  status: 'RESERVED' | 'MOUNTED' | 'CONSUMED' | 'RELEASED';
  reservedAt: string;
}

interface FeederDepletion {
  slotNo: number;
  partNumber: string;
  currentReelId: string;
  remainingQuantity: number;
  consumptionRatePerMinute: number;
  estimatedMinutesRemaining: number;
  confidence: string;
}

export const AgvLogisticsStation: React.FC = () => {
  const [agvs, setAgvs] = useState<AgvUnit[]>([]);
  const [missions, setMissions] = useState<AgvMission[]>([]);
  const [reservations, setReservations] = useState<MaterialReservation[]>([]);
  const [depletionLine, setDepletionLine] = useState<string>('line-smt-01');
  const [depletionSlot, setDepletionSlot] = useState<number>(1);
  const [depletion, setDepletion] = useState<FeederDepletion | null>(null);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [authorizingMissionId, setAuthorizingMissionId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadData = async () => {
    try {
      setRefreshing(true);
      const [agvRes, missionRes, resRes, depRes] = await Promise.all([
        fetch('/api/v1/logistics/agv/units'),
        fetch('/api/v1/logistics/agv/missions'),
        fetch('/api/v1/logistics/reservations'),
        fetch(`/api/v1/logistics/feeders/${depletionLine}/${depletionSlot}/depletion`)
      ]);

      if (agvRes.ok) setAgvs(await agvRes.json());
      if (missionRes.ok) setMissions(await missionRes.json());
      if (resRes.ok) setReservations(await resRes.json());
      if (depRes.ok) setDepletion(await depRes.json());
    } catch (err: any) {
      console.error('Failed to load logistics telemetry', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, [depletionLine, depletionSlot]);

  const authorizeDockDelivery = async (missionId: string) => {
    try {
      setAuthorizingMissionId(missionId);
      const res = await fetch(`/api/v1/logistics/agv/missions/${missionId}/dock-delivery-authorization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: 'op-smt-01',
          targetLineId: 'line-smt-01',
          targetWorkCenterId: 'wc-nxt-01',
          targetSlotNo: 1,
          expectedPartNumber: 'C0402-100NF-16V'
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setActionNotice({
          type: 'success',
          message: `DOCK DELIVERY AUTHORIZED: Mission ${missionId.slice(0, 8)} physical interlock disengaged. Handoff cleared.`
        });
        loadData();
      } else {
        setActionNotice({
          type: 'error',
          message: `DOCK AUTHORIZATION REJECTED: ${data.reason || 'Verification check failed'}`
        });
      }
    } catch (err: any) {
      setActionNotice({ type: 'error', message: err.message || 'Authorization failed' });
    } finally {
      setAuthorizingMissionId(null);
      setTimeout(() => setActionNotice(null), 5000);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-[#7A8A9E] font-mono text-sm tracking-widest uppercase animate-pulse flex flex-col items-center gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-[#00E699]" />
        <span>Synchronizing AGV Autonomous Material Fleet...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Station Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#10161F] p-4 rounded-xl border border-white/10 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#18222F] border border-white/15 flex items-center justify-center text-[#00E699]">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
                SMT AUTOMATED MATERIAL LOGISTICS (AML)
              </span>
              <span className="w-2 h-2 rounded-full bg-[#00E699] animate-pulse" />
              <span className="text-[10px] font-mono text-[#00E699] font-bold uppercase">
                AGV FLEET DISPATCH ACTIVE
              </span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              AGV Material Transport & Dock Delivery Safety Gate
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
            <span>POLL FLEET</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className={`p-4 rounded-xl border text-xs font-mono flex items-center gap-3 ${
          actionNotice.type === 'success' 
            ? 'bg-[#00E699]/10 border-[#00E699]/40 text-[#00E699]' 
            : 'bg-red-950/40 border-red-500/50 text-red-300'
        }`}>
          {actionNotice.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <span>{actionNotice.message}</span>
        </div>
      )}

      {/* Autonomous AGV Units Grid */}
      <div>
        <h3 className="text-xs font-mono uppercase tracking-wider text-[#7A8A9E] mb-3 flex items-center gap-2">
          <Truck className="w-4 h-4 text-[#38BDF8]" />
          <span>Active Autonomous Mobile Robots (AMR / AGV)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agvs.map((agv) => {
            const isDelivering = agv.status === 'DELIVERING';
            const isTransit = agv.status === 'IN_TRANSIT';
            const isIdle = agv.status === 'IDLE';

            return (
              <div 
                key={agv.id}
                className="bg-[#10161F] p-4 rounded-xl border border-white/10 shadow-lg space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-3 h-3 rounded-full ${
                      isDelivering ? 'bg-[#FFB800] animate-pulse' :
                      isTransit ? 'bg-[#38BDF8] animate-pulse' :
                      'bg-[#00E699]'
                    }`} />
                    <div>
                      <span className="text-sm font-bold text-white font-mono">{agv.code}</span>
                      <span className="text-xs text-[#7A8A9E] block">{agv.name} ({agv.model})</span>
                    </div>
                  </div>

                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                    isDelivering ? 'bg-[#FFB800]/10 text-[#FFB800] border-[#FFB800]/40' :
                    isTransit ? 'bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8]/40' :
                    'bg-[#00E699]/10 text-[#00E699] border-[#00E699]/40'
                  }`}>
                    {agv.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                  <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                    <span className="text-[10px] text-[#7A8A9E] block">BATTERY</span>
                    <span className={`text-sm font-bold mt-1 flex items-center justify-center gap-1 ${
                      agv.batteryPercent > 40 ? 'text-[#00E699]' : 'text-[#FFB800]'
                    }`}>
                      <Battery className="w-3.5 h-3.5" />
                      {agv.batteryPercent}%
                    </span>
                  </div>

                  <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                    <span className="text-[10px] text-[#7A8A9E] block">CURRENT BAY</span>
                    <span className="text-xs font-bold text-white mt-1 block truncate">
                      {agv.currentLocation}
                    </span>
                  </div>

                  <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                    <span className="text-[10px] text-[#7A8A9E] block">MISSION</span>
                    <span className="text-xs font-bold text-[#38BDF8] mt-1 block truncate">
                      {agv.currentMissionId ? agv.currentMissionId.slice(0, 8) : 'NONE'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Transport Missions & Dock Delivery Safety Gate */}
      <div className="bg-[#10161F] p-5 rounded-xl border border-white/10 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-[#00E699]" />
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Active AGV Material Transport Orders
              </h3>
              <p className="text-xs text-[#7A8A9E] font-mono">
                Decoupled Replenishment Requests with Line Dock Interlock
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-[#7A8A9E]">
            {missions.length} Orders In System
          </span>
        </div>

        {missions.length === 0 ? (
          <div className="p-8 text-center text-[#7A8A9E] font-mono text-xs">
            No active AGV transport missions. Feeder banks fully replenished.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="text-[10px] uppercase tracking-wider text-[#7A8A9E] border-b border-white/10 bg-[#0C1117]">
                <tr>
                  <th className="p-3">Mission ID</th>
                  <th className="p-3">Material Reel</th>
                  <th className="p-3">Source → Target</th>
                  <th className="p-3">Assigned AGV</th>
                  <th className="p-3">State</th>
                  <th className="p-3 text-right">Dock Authorization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {missions.map((m) => {
                  const isDelivering = m.status === 'DELIVERING';
                  const isAuthorized = !!m.deliveryAuthorizedBy;

                  return (
                    <tr key={m.id} className="hover:bg-white/[0.02]">
                      <td className="p-3 font-bold text-white">
                        {m.id.slice(0, 8)}...
                      </td>
                      <td className="p-3 text-[#38BDF8]">
                        {m.materialId}
                      </td>
                      <td className="p-3 text-[#CAD4E0]">
                        {m.sourceLocation} → <span className="text-white font-bold">{m.targetLineId}</span>
                      </td>
                      <td className="p-3">
                        {m.agvId ? (
                          <span className="px-2 py-0.5 rounded bg-white/10 text-white font-bold">
                            {m.agvId}
                          </span>
                        ) : (
                          <span className="text-[#7A8A9E]">PENDING</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.status === 'COMPLETED' ? 'bg-[#00E699]/10 text-[#00E699]' :
                          isDelivering ? 'bg-[#FFB800]/10 text-[#FFB800]' :
                          'bg-[#38BDF8]/10 text-[#38BDF8]'
                        }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {isAuthorized ? (
                          <span className="inline-flex items-center gap-1 text-[#00E699] font-bold">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            AUTHORIZED ({m.deliveryAuthorizedBy})
                          </span>
                        ) : isDelivering ? (
                          <button
                            onClick={() => authorizeDockDelivery(m.id)}
                            disabled={authorizingMissionId === m.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#00E699] hover:bg-[#00E699]/90 text-black font-bold rounded shadow transition-colors"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>{authorizingMissionId === m.id ? 'VERIFYING...' : 'AUTHORIZE DOCK'}</span>
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#7A8A9E]">
                            <Lock className="w-3 h-3" />
                            LOCKED (EN ROUTE)
                          </span>
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

      {/* Dual Section: Active Material Reservations & Feeder Depletion Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Material Reservations Ledger (Cross-Line Concurrency Lock) */}
        <div className="bg-[#10161F] p-5 rounded-xl border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <Lock className="w-4 h-4 text-[#38BDF8]" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                Cross-Line Material Mutual Exclusion Ledger
              </h3>
            </div>
            <span className="text-[10px] font-mono text-[#00E699] bg-[#00E699]/10 px-2 py-0.5 rounded border border-[#00E699]/30">
              UNIQUE INDEX LOCKED
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="text-[10px] uppercase tracking-wider text-[#7A8A9E] border-b border-white/10 bg-[#0C1117]">
                <tr>
                  <th className="p-2.5">Reel Barcode</th>
                  <th className="p-2.5">Owner Line</th>
                  <th className="p-2.5">Slot</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reservations.slice(0, 5).map((r) => (
                  <tr key={r.id}>
                    <td className="p-2.5 font-bold text-white">{r.reelId}</td>
                    <td className="p-2.5 text-[#38BDF8]">{r.lineId}</td>
                    <td className="p-2.5">{r.slotNo}</td>
                    <td className="p-2.5">
                      <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-[#00E699] font-bold">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {reservations.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-[#7A8A9E]">
                      No active cross-line material reservations.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Feeder Depletion & Placement Priority Calculator */}
        <div className="bg-[#10161F] p-5 rounded-xl border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-[#FFB800]" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                Placement-Based Depletion Radar
              </h3>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <select
                value={depletionLine}
                onChange={(e) => setDepletionLine(e.target.value)}
                className="bg-[#0C1117] border border-white/10 rounded px-2 py-1 text-white text-[11px]"
              >
                <option value="line-smt-01">Line 01</option>
                <option value="line-smt-02">Line 02</option>
              </select>
              <select
                value={depletionSlot}
                onChange={(e) => setDepletionSlot(Number(e.target.value))}
                className="bg-[#0C1117] border border-white/10 rounded px-2 py-1 text-white text-[11px]"
              >
                <option value={1}>Slot 01</option>
                <option value={2}>Slot 02</option>
                <option value={3}>Slot 03</option>
              </select>
            </div>
          </div>

          {depletion ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">REMAINING QTY</span>
                  <span className="text-base font-bold text-white mt-1 block">
                    {depletion.remainingQuantity} pcs
                  </span>
                </div>

                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">BURN RATE</span>
                  <span className="text-base font-bold text-[#00E699] mt-1 block">
                    {depletion.consumptionRatePerMinute} /min
                  </span>
                </div>

                <div className="bg-[#0C1117] p-2.5 rounded border border-white/5">
                  <span className="text-[10px] text-[#7A8A9E] block">EST. RUNOUT</span>
                  <span className={`text-base font-bold mt-1 block ${
                    depletion.estimatedMinutesRemaining < 15 ? 'text-[#FFB800]' : 'text-white'
                  }`}>
                    {depletion.estimatedMinutesRemaining} mins
                  </span>
                </div>
              </div>

              <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5 flex items-center justify-between text-xs font-mono">
                <span className="text-[#7A8A9E]">Depletion Confidence Model:</span>
                <span className="text-[#00E699] font-bold">
                  {depletion.confidence.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-[#7A8A9E] font-mono text-xs">
              Calibrating feeder depletion telemetry...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
