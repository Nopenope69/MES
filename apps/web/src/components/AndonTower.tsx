import React, { useState } from 'react';
import { Volume2, VolumeX, ShieldAlert } from 'lucide-react';
import { audioAlerts } from '../utils/audio-alerts';

export type AndonState = 'NORMAL' | 'WARNING' | 'CRITICAL';

interface AndonTowerProps {
  state?: AndonState;
  activeReason?: string;
}

export const AndonTower: React.FC<AndonTowerProps> = ({
  state = 'NORMAL',
  activeReason = 'SMT Line 01 nominal operation'
}) => {
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    audioAlerts.setMuted(next);
  };

  const testHorn = () => {
    if (state === 'CRITICAL') {
      audioAlerts.playInterlockTrip();
    } else if (state === 'WARNING') {
      audioAlerts.playWarningBeep();
    } else {
      audioAlerts.playApprovalChime();
    }
  };

  const isRed = state === 'CRITICAL';
  const isAmber = state === 'WARNING';
  const isGreen = state === 'NORMAL';

  return (
    <div 
      className="bg-[#0E1117] border border-white/[0.08] rounded-lg px-3 py-1.5 flex items-center justify-between gap-4 font-sans select-none"
      role="status"
      aria-live="polite"
      aria-label={`Andon System Status: ${state === 'CRITICAL' ? 'Critical Interlock Tripped' : state === 'WARNING' ? 'Warning Condition Active' : 'Normal Operation'}`}
    >
      {/* Precision 3-Stage Hardware Optical Stack */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#6B7280]">
          SIGNAL TOWER
        </span>

        {/* Optical Lens Enclosure */}
        <div className="flex items-center gap-1.5 bg-[#080A0E] px-2 py-1 rounded-md border border-white/[0.06]">
          {/* RED LENS */}
          <div
            className={`w-3.5 h-3.5 rounded-full transition-colors border ${
              isRed
                ? 'bg-rose-500 border-rose-400'
                : 'bg-rose-950/40 border-rose-900/30'
            }`}
            title="CRITICAL INTERLOCK"
            aria-label="Red lens: Critical"
          />

          {/* AMBER LENS */}
          <div
            className={`w-3.5 h-3.5 rounded-full transition-colors border ${
              isAmber
                ? 'bg-amber-400 border-amber-300'
                : 'bg-amber-950/40 border-amber-900/30'
            }`}
            title="WARNING / MSL EXPIRING"
            aria-label="Amber lens: Warning"
          />

          {/* GREEN LENS */}
          <div
            className={`w-3.5 h-3.5 rounded-full transition-colors border ${
              isGreen
                ? 'bg-emerald-500 border-emerald-400'
                : 'bg-emerald-950/40 border-emerald-900/30'
            }`}
            title="LINE NORMAL"
            aria-label="Green lens: Normal"
          />
        </div>

        {/* Status Text & Telemetry Reason */}
        <div className="flex items-baseline gap-2">
          <span
            className={`text-xs font-semibold tracking-tight ${
              isRed ? 'text-rose-400' : isAmber ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {isRed ? 'Interlock Tripped' : isAmber ? 'Caution Active' : 'Nominal Production'}
          </span>
          <span className="text-[11px] text-[#6B7280] hidden md:inline truncate max-w-sm font-mono">
            — {activeReason}
          </span>
        </div>
      </div>

      {/* Tactile Hardware Klaxon & Audio Controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={testHorn}
          className="h-7 px-2.5 bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.12] text-[#D1D5DB] hover:text-white text-xs rounded border border-white/[0.08] flex items-center gap-1.5 transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
          title="Test Cleanroom Klaxon Tone"
          aria-label="Test Cleanroom Klaxon Horn"
        >
          <ShieldAlert className="w-3 h-3 text-[#9CA3AF]" />
          <span className="hidden sm:inline font-mono text-[11px]">TEST TONE</span>
        </button>

        <button
          onClick={toggleMute}
          className={`h-7 w-7 flex items-center justify-center rounded border transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${
            isMuted
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/15'
              : 'bg-white/[0.04] border-white/[0.08] text-[#9CA3AF] hover:text-white hover:bg-white/[0.08]'
          }`}
          title={isMuted ? 'Acoustic siren muted (click to unmute)' : 'Acoustic siren armed (click to mute)'}
          aria-label={isMuted ? 'Unmute siren' : 'Mute siren'}
          aria-pressed={isMuted}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
