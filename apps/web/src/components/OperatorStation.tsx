import React, { useState, useEffect } from 'react';
import { 
  Play, AlertOctagon, CheckCircle2, QrCode, 
  Cpu, Layers, ShieldCheck, ShieldAlert, ArrowRight,
  Radio, Clock, AlertTriangle, Disc
} from 'lucide-react';
import { STANDARD_DOWNTIME_REASONS } from '@mes/shared';

interface WorkCenter {
  id: string;
  code: string;
  name: string;
  area: string;
  type: string;
  current_state: string;
  current_batch_id?: string;
  current_program_name?: string;
  current_operator_id?: string;
  batch_number?: string;
  product_name?: string;
  operator_name?: string;
  module_count?: number;
  last_state_change_time: string;
}

interface FeederSlot {
  id: string;
  module_no: number;
  stage_no: number;
  slot_no: number;
  feeder_id: string;
  feeder_type: string;
  assigned_part_number: string;
  current_reel_id?: string;
  part_name?: string;
  supplier_name?: string;
  lot_number?: string;
  date_code?: string;
  reel_remaining_quantity?: number;
  msl_level?: number;
  msl_remaining_minutes?: number;
  status: string;
}

export const OperatorStation: React.FC = () => {
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [selectedWcId, setSelectedWcId] = useState<string>('wc-nxt-01');
  const [feeders, setFeeders] = useState<FeederSlot[]>([]);
  const [activeSlotNo, setActiveSlotNo] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);

  // Splicing Dock State
  const [scannedReelId, setScannedReelId] = useState<string>('REEL-MUR-98125-SPLICE');
  const [scannedPartNumber, setScannedPartNumber] = useState<string>('C0402-100NF-16V');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [spliceResult, setSpliceResult] = useState<{
    verified: boolean;
    status: 'IDLE' | 'VERIFIED' | 'TRIPPED';
    message: string;
  }>({
    verified: true,
    status: 'IDLE',
    message: 'Awaiting operator barcode scan...'
  });

  // Stoppage Drawer
  const [showStoppageDrawer, setShowStoppageDrawer] = useState<boolean>(false);
  const [stoppageComment, setStoppageComment] = useState<string>('');

  const fetchWorkCenters = async () => {
    try {
      const res = await fetch('/api/v1/work-centers');
      if (res.ok) setWorkCenters(await res.json());
    } catch (err) {
      console.error('Failed to load stations', err);
    }
  };

  const fetchFeeders = async () => {
    try {
      const res = await fetch(`/api/v1/smt/feeders?workCenterId=${selectedWcId}`);
      if (res.ok) {
        const data: FeederSlot[] = await res.json();
        setFeeders(data);
        if (data.length > 0 && !data.find(s => s.slot_no === activeSlotNo)) {
          setActiveSlotNo(data[0].slot_no);
        }
      }
    } catch (err) {
      console.error('Failed to load feeders', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkCenters();
    fetchFeeders();
    const interval = setInterval(() => {
      fetchWorkCenters();
      fetchFeeders();
    }, 4000);
    return () => clearInterval(interval);
  }, [selectedWcId]);

  const activeWc = workCenters.find(w => w.id === selectedWcId) || workCenters[1] || workCenters[0];
  const activeSlot = feeders.find(s => s.slot_no === activeSlotNo) || feeders[0];

  const handleSelectSlot = (slot: FeederSlot) => {
    setActiveSlotNo(slot.slot_no);
    setScannedPartNumber(slot.assigned_part_number);
    setScannedReelId(`REEL-${slot.assigned_part_number.slice(0, 3)}-${Math.floor(10000 + Math.random() * 90000)}`);
    setSpliceResult({
      verified: true,
      status: 'IDLE',
      message: `Selected Slot ${slot.slot_no} (${slot.assigned_part_number}). Ready to scan splice reel.`
    });
  };

  const executeSplicingInterlock = async () => {
    setIsScanning(true);
    setSpliceResult({ verified: false, status: 'IDLE', message: 'Optical laser scanning reel barcode UID...' });

    await new Promise(r => setTimeout(r, 600));

    try {
      const res = await fetch('/api/v1/smt/splice-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workCenterId: selectedWcId,
          slotNo: activeSlotNo,
          scannedReelId,
          scannedPartNumber,
          operatorId: 'OP-SMT-01'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setSpliceResult({
          verified: false,
          status: 'TRIPPED',
          message: data.message || 'FATAL: Reel rejected. SMT feeder interlock engaged.'
        });
      } else {
        setSpliceResult({
          verified: true,
          status: 'VERIFIED',
          message: `SAFE TO SPLICE: Reel ${scannedReelId} verified against BOM program. Cassette unlocked.`
        });
        await fetchFeeders();
      }
    } catch (err: any) {
      setSpliceResult({
        verified: false,
        status: 'TRIPPED',
        message: `Network error: ${err.message}`
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleQuickStoppage = async (reasonCode: string, label: string) => {
    try {
      await fetch('/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'STATE_CHANGED',
          workCenterId: selectedWcId,
          batchId: activeWc?.current_batch_id || 'JOB-SM-260901',
          operatorId: 'OP-SMT-01',
          sourceType: 'MANUAL_UI',
          sourceId: `tablet-${selectedWcId}`,
          payload: {
            previousState: activeWc?.current_state || 'RUNNING',
            currentState: 'STOPPED_UNPLANNED',
            reasonCategory: 'FEEDER_MECHANISM',
            reasonCode,
            comment: stoppageComment || label
          }
        })
      });
      setShowStoppageDrawer(false);
      setStoppageComment('');
      await fetchWorkCenters();
    } catch (err: any) {
      alert(`Failed to log stoppage: ${err.message}`);
    }
  };

  const handleResumeLine = async () => {
    try {
      await fetch('/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'STATE_CHANGED',
          workCenterId: selectedWcId,
          operatorId: 'OP-SMT-01',
          sourceType: 'MANUAL_UI',
          sourceId: `tablet-${selectedWcId}`,
          payload: {
            previousState: activeWc?.current_state || 'STOPPED_UNPLANNED',
            currentState: 'RUNNING',
            comment: 'Operator confirmed feeder cassette cleared and safety guard latched'
          }
        })
      });
      await fetchWorkCenters();
    } catch (err: any) {
      alert(`Failed to resume: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-[#7A8A9E] font-mono text-sm tracking-widest uppercase animate-pulse">
        CALIBRATING FUJI SMT FEEDER BUS...
      </div>
    );
  }

  const isLineRunning = activeWc?.current_state === 'RUNNING';

  return (
    <div className="space-y-6">
      {/* 1. SMT Line Sequential Machine Flow Ribbon */}
      <div className="milled-panel rounded-xl p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E] flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-[#00E699]" />
            <span>IN-LINE CONVEYOR PROGRESSION • SMT LINE 01</span>
          </div>
          <div className="text-xs font-mono text-white/70">
            Fuji Program: <strong className="text-[#00E699]">PROG-SM-METER-TOP-REV4</strong>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {workCenters.map((wc, i) => {
            const isSelected = wc.id === selectedWcId;
            const isRun = wc.current_state === 'RUNNING';

            return (
              <button
                key={wc.id}
                onClick={() => setSelectedWcId(wc.id)}
                className={`p-3 rounded-lg text-left transition-all relative border ${
                  isSelected 
                    ? 'bg-[#1A2330] border-[#00E699] shadow-lg ring-1 ring-[#00E699]/30' 
                    : 'bg-[#121820] border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-mono text-[#7A8A9E] tracking-wider">
                    STAGE 0{i + 1}
                  </span>
                  <span className={`w-2 h-2 rounded-full ${
                    isRun ? 'bg-[#00E699] andon-green' : 'bg-[#FF334B] andon-red animate-pulse'
                  }`} />
                </div>
                <div className="text-xs font-bold text-white truncate font-sans">{wc.name}</div>
                <div className="text-[10px] font-mono text-[#7A8A9E] mt-1 flex justify-between">
                  <span>{wc.code}</span>
                  <span className={isRun ? 'text-[#00E699]' : 'text-[#FF334B]'}>{wc.current_state}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Main Work Area: 2-Column Split (Feeder Bay Rack vs Splicing Reticle Dock) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Physical Feeder Rack Table */}
        <div className="lg:col-span-7 space-y-4">
          <div className="milled-panel rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap justify-between items-center border-b border-white/10 pb-3 gap-2">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-[#00E699]" />
                  Fuji NXT III Feeder Table (Module 1)
                </h2>
                <p className="text-xs text-[#7A8A9E]">
                  Select any cassette to inspect component stock, MSL timer, or prepare a splice.
                </p>
              </div>

              {/* Station State & Emergency Action */}
              <div className="flex items-center gap-2">
                {isLineRunning ? (
                  <button
                    onClick={() => setShowStoppageDrawer(true)}
                    className="bg-[#FF334B]/15 hover:bg-[#FF334B]/25 text-[#FF334B] border border-[#FF334B]/40 px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all active:scale-95"
                  >
                    <AlertOctagon className="w-4 h-4" />
                    <span>HALT / LOG STOPPAGE</span>
                  </button>
                ) : (
                  <button
                    onClick={handleResumeLine}
                    className="bg-[#00E699] hover:bg-[#00E699]/90 text-[#0B0F14] px-4 py-1.5 rounded-lg text-xs font-mono font-black flex items-center gap-1.5 shadow-lg transition-all active:scale-95"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>RESUME RUN</span>
                  </button>
                )}
              </div>
            </div>

            {/* Feeder Slot Rail Layout */}
            <div className="space-y-2.5 pt-1">
              {feeders.length > 0 ? (
                feeders.map((slot) => {
                  const isSelected = slot.slot_no === activeSlotNo;
                  const isLowParts = (slot.reel_remaining_quantity || 0) < 4000;
                  const isMslSensitive = (slot.msl_level || 1) > 1;

                  return (
                    <div
                      key={slot.id}
                      onClick={() => handleSelectSlot(slot)}
                      className={`milled-slot p-3.5 rounded-xl cursor-pointer transition-all flex flex-wrap items-center justify-between gap-4 border ${
                        isSelected 
                          ? 'border-[#00E699] bg-[#1B2533] shadow-md ring-1 ring-[#00E699]/40' 
                          : 'border-white/5 hover:border-white/20'
                      }`}
                    >
                    {/* Cassette Slot & Andon Light */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#0F151E] border border-white/10 flex flex-col items-center justify-center font-mono">
                        <span className="text-[9px] text-[#7A8A9E] leading-none">SLOT</span>
                        <span className="text-sm font-black text-white leading-none mt-0.5">
                          {slot.slot_no < 10 ? `0${slot.slot_no}` : slot.slot_no}
                        </span>
                      </div>

                      <div className={`w-3 h-3 rounded-full ${
                        isLowParts 
                          ? 'bg-[#FFB800] andon-amber animate-pulse' 
                          : 'bg-[#00E699] andon-green'
                      }`} />

                      <div>
                        <div className="text-xs font-bold font-mono text-white flex items-center gap-2">
                          <span>{slot.assigned_part_number}</span>
                          <span className="text-[10px] font-normal text-[#7A8A9E] px-1.5 py-0.2 bg-[#0B0F14] rounded border border-white/5">
                            {slot.feeder_type.split(' ')[0]}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#7A8A9E] font-sans truncate max-w-[220px]">
                          {slot.part_name}
                        </div>
                      </div>
                    </div>

                    {/* Stock, Reel Barcode, MSL Badge */}
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <div className="text-right">
                        <div className="text-white font-bold">
                          {(slot.reel_remaining_quantity || 0).toLocaleString()} <span className="text-[10px] text-[#7A8A9E]">PCS</span>
                        </div>
                        <div className="text-[10px] text-[#7A8A9E] truncate max-w-[120px]">
                          {slot.current_reel_id || 'NO REEL'}
                        </div>
                      </div>

                      {isMslSensitive ? (
                        <div className="px-2 py-1 rounded bg-[#FFB800]/10 border border-[#FFB800]/30 text-[#FFB800] text-[10px] font-bold">
                          MSL {slot.msl_level} ({Math.round((slot.msl_remaining_minutes || 0) / 60)}h)
                        </div>
                      ) : (
                        <div className="px-2 py-1 rounded bg-white/5 text-[#7A8A9E] text-[10px]">
                          MSL 1
                        </div>
                      )}

                      <button
                        onClick={(e) => { e.stopPropagation(); handleSelectSlot(slot); }}
                        className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-white text-[11px] font-mono rounded border border-white/10"
                      >
                        Splice &rarr;
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center bg-[#0C1117] rounded-xl border border-white/10 space-y-3">
                <div className="text-sm font-bold text-white">
                  {activeWc?.name || 'Selected Station'} does not host mechanical component feeder cassettes.
                </div>
                <p className="text-xs text-[#7A8A9E] max-w-md mx-auto">
                  Component reels, tape cassettes, and optical splicing interlocks are located on the pick-and-place stage (Fuji NXT III M6).
                </p>
                <button
                  onClick={() => {
                    const nxt = workCenters.find(w => w.type === 'PICK_AND_PLACE' || w.id === 'wc-nxt-01');
                    if (nxt) setSelectedWcId(nxt.id);
                  }}
                  className="px-4 py-2 bg-[#00E699] text-[#0B0F14] font-mono font-bold text-xs rounded-lg shadow-lg hover:bg-[#00E699]/90 transition-all inline-flex items-center gap-2"
                >
                  <span>SWITCH TO FUJI NXT III FEEDER BAY (STAGE 02)</span>
                  <span>&rarr;</span>
                </button>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Laser Splicing Reticle Dock */}
        <div className="lg:col-span-5 space-y-4">
          <div className="milled-panel rounded-xl p-5 space-y-5 border-t-2 border-t-[#00E699]">
            {feeders.length === 0 ? (
              <div className="p-8 text-center bg-[#0A0E13] rounded-xl border border-white/10 space-y-3 font-mono">
                <span className="text-xs text-[#7A8A9E] block">
                  Reel verification and optical interlocks are mounted on Stage 02 (Fuji NXT III).
                </span>
                <button
                  onClick={() => {
                    const nxt = workCenters.find(w => w.type === 'PICK_AND_PLACE' || w.id === 'wc-nxt-01');
                    if (nxt) setSelectedWcId(nxt.id);
                  }}
                  className="px-3 py-1.5 bg-[#00E699]/15 border border-[#00E699]/40 hover:bg-[#00E699]/25 text-[#00E699] font-bold text-xs rounded-lg transition-all"
                >
                  Select Fuji NXT III &rarr;
                </button>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#00E699] flex items-center gap-1.5">
                      <Disc className="w-3.5 h-3.5 animate-spin" />
                      OPTICAL SPLICING DOCK
                    </span>
                    <h3 className="text-lg font-bold text-white font-sans mt-0.5">
                      Slot 0{activeSlot?.slot_no} Interlock Verification
                    </h3>
                  </div>
                  <span className="text-xs font-mono text-[#7A8A9E] bg-[#0A0E13] px-2 py-1 rounded border border-white/10">
                    {activeSlot?.feeder_id}
                  </span>
                </div>

            {/* Split Comparison Terminal */}
            <div className="space-y-3 font-mono text-xs">
              {/* Channel A: Recipe Expected Specification */}
              <div className="bg-[#0C1118] p-3.5 rounded-lg border border-white/10 space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-[#7A8A9E] flex justify-between">
                  <span>CHANNEL A // EXPECTED BOM PART</span>
                  <span className="text-[#00E699]">LOCKED</span>
                </div>
                <div className="text-sm font-black text-white">
                  {activeSlot?.assigned_part_number}
                </div>
                <div className="text-[11px] text-[#7A8A9E]">
                  Cassette: {activeSlot?.feeder_type} • Reel: {activeSlot?.current_reel_id}
                </div>
              </div>

              {/* Channel B: Optical Scanner Feed (Laser Reticle) */}
              <div className={`p-3.5 rounded-lg border space-y-2 relative ${
                isScanning ? 'laser-reticle bg-[#131D2A] border-[#00E699]' : 'bg-[#0C1118] border-white/10'
              }`}>
                <div className="text-[10px] uppercase tracking-widest text-[#7A8A9E] flex justify-between">
                  <span>CHANNEL B // SCANNED COMPONENT REEL</span>
                  <span className="text-[#7A8A9E]">OPTICAL INPUT</span>
                </div>

                <div>
                  <label className="text-[10px] text-[#7A8A9E] block mb-1">Scanned Manufacturer Part (MPN):</label>
                  <input
                    type="text"
                    value={scannedPartNumber}
                    onChange={(e) => setScannedPartNumber(e.target.value)}
                    className="w-full bg-[#070A0E] border border-white/20 text-white font-mono rounded px-3 py-2 text-xs font-bold focus:border-[#00E699] focus:outline-none"
                    placeholder="e.g. C0402-100NF-16V"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-[#7A8A9E] block mb-1">Scanned Reel Barcode UID:</label>
                  <input
                    type="text"
                    value={scannedReelId}
                    onChange={(e) => setScannedReelId(e.target.value)}
                    className="w-full bg-[#070A0E] border border-white/20 text-white font-mono rounded px-3 py-2 text-xs font-bold focus:border-[#00E699] focus:outline-none"
                    placeholder="e.g. REEL-MUR-98125-SPLICE"
                  />
                </div>

                {/* Quick Simulation Toggles for the Demo */}
                <div className="flex items-center gap-2 text-[10px] text-[#7A8A9E] pt-1">
                  <span>Test Scenarios:</span>
                  <button
                    onClick={() => {
                      if (activeSlot) {
                        setScannedPartNumber(activeSlot.assigned_part_number);
                        setScannedReelId(`REEL-MATCH-${Math.floor(1000 + Math.random() * 9000)}`);
                      }
                    }}
                    className="text-[#00E699] hover:underline font-bold"
                  >
                    [MATCH]
                  </button>
                  <span>•</span>
                  <button
                    onClick={() => {
                      setScannedPartNumber('R0402-10K-WRONG');
                      setScannedReelId(`REEL-MISMATCH-${Math.floor(1000 + Math.random() * 9000)}`);
                    }}
                    className="text-[#FF334B] hover:underline font-bold"
                  >
                    [MISMATCH MISFIRE]
                  </button>
                </div>
              </div>
            </div>

            {/* Interlock Result Banner */}
            <div className={`p-4 rounded-xl text-xs font-mono space-y-1 border ${
              spliceResult.status === 'VERIFIED'
                ? 'bg-[#00E699]/10 border-[#00E699]/50 text-[#00E699]'
                : spliceResult.status === 'TRIPPED'
                ? 'bg-[#FF334B]/15 border-[#FF334B]/60 text-[#FF334B] animate-pulse'
                : 'bg-[#10161F] border-white/10 text-[#7A8A9E]'
            }`}>
              <div className="font-bold flex items-center gap-2">
                {spliceResult.status === 'VERIFIED' && <ShieldCheck className="w-4 h-4" />}
                {spliceResult.status === 'TRIPPED' && <ShieldAlert className="w-4 h-4" />}
                <span>
                  {spliceResult.status === 'VERIFIED' ? 'RELAY ENGAGED // OK TO SPLICE' :
                   spliceResult.status === 'TRIPPED' ? 'INTERLOCK TRIPPED // FEEDER INHIBITED' :
                   'INTERLOCK READY'}
                </span>
              </div>
              <div className="text-[11px] leading-relaxed">{spliceResult.message}</div>
            </div>

            {/* Verification Execute Button */}
            <button
              onClick={executeSplicingInterlock}
              disabled={isScanning}
              className="w-full bg-[#00E699] hover:bg-[#00E699]/90 active:bg-[#00E699]/80 text-[#0B0F14] font-black font-mono py-4 rounded-xl text-xs tracking-wider shadow-xl transition-transform active:scale-98 flex items-center justify-center gap-2"
            >
              <QrCode className="w-4 h-4" />
              <span>{isScanning ? 'SCANNING REEL BARCODE...' : 'RUN LASER SCAN & VERIFY SPLICE'}</span>
            </button>
            </>
          )}
          </div>
        </div>
      </div>

      {/* 3. Stoppage Drawer (Tactile Operator Matrix) */}
      {showStoppageDrawer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="milled-panel rounded-xl max-w-xl w-full p-6 shadow-2xl space-y-5 border border-[#FF334B]/40 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <div className="flex items-center gap-3">
                <AlertOctagon className="w-6 h-6 text-[#FF334B]" />
                <div>
                  <h3 className="text-base font-bold text-white">Log Line 01 Stoppage</h3>
                  <p className="text-xs text-[#7A8A9E] font-mono">Immediate attribution for OEE Pareto</p>
                </div>
              </div>
              <button 
                onClick={() => setShowStoppageDrawer(false)}
                className="text-xs font-mono text-[#7A8A9E] hover:text-white px-3 py-1 bg-white/5 rounded"
              >
                ESC
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E] block">
                Select Shopfloor Stoppage Cause:
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {STANDARD_DOWNTIME_REASONS.slice(0, 6).map((r) => (
                  <button
                    key={r.code}
                    onClick={() => handleQuickStoppage(r.code, r.label)}
                    className="p-3.5 rounded-lg bg-[#0F151E] border border-white/10 hover:border-[#FF334B] text-left transition-all group"
                  >
                    <div className="text-xs font-bold text-white group-hover:text-[#FF334B]">{r.label}</div>
                    <div className="text-[10px] font-mono text-[#7A8A9E] mt-1">{r.category}</div>
                  </button>
                ))}
              </div>

              <div>
                <input
                  type="text"
                  placeholder="Optional operator comment (e.g. Cleared tape peel jam at Slot 02)..."
                  value={stoppageComment}
                  onChange={(e) => setStoppageComment(e.target.value)}
                  className="w-full bg-[#070A0E] border border-white/15 rounded-lg p-3 text-xs text-white font-mono focus:border-[#FF334B] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
