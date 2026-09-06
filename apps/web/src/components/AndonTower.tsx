import React, { useState } from 'react';
import { Volume2, VolumeX, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react';
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
    <div className="bg-[#0D1219] border border-white/10 rounded-xl p-3 flex items-center justify-between gap-4 font-mono select-none">
      {/* 3-Tier Physical Light Stack */}
      <div className="flex items-center gap-2">
        <div className="text-[10px] text-white/40 uppercase tracking-widest mr-1">ANDON:</div>
        <div className="flex items-center gap-1.5 bg-[#070A0E] p-1.5 rounded-lg border border-white/5">
          {/* RED LENS */}
          <div
            className={`w-5 h-5 rounded-full transition-all duration-200 border ${
              isRed
                ? 'bg-[#FF334B] border-[#FF334B] shadow-[0_0_12px_#FF334B] animate-pulse'
                : 'bg-[#3A141A] border-[#5A1C24] opacity-40'
            }`}
            title="CRITICAL INTERLOCK"
          />

          {/* AMBER LENS */}
          <div
            className={`w-5 h-5 rounded-full transition-all duration-200 border ${
              isAmber
                ? 'bg-[#FFB800] border-[#FFB800] shadow-[0_0_12px_#FFB800] animate-pulse'
                : 'bg-[#3A2D0D] border-[#5A4514] opacity-40'
            }`}
            title="WARNING / MSL EXPIRING"
          />

          {/* GREEN LENS */}
          <div
            className={`w-5 h-5 rounded-full transition-all duration-200 border ${
              isGreen
                ? 'bg-[#00E699] border-[#00E699] shadow-[0_0_10px_#00E699]'
                : 'bg-[#0E3524] border-[#164D35] opacity-40'
            }`}
            title="LINE NORMAL"
          />
        </div>

        {/* State Label */}
        <div className="hidden sm:flex flex-col ml-1">
          <span
            className={`text-xs font-bold tracking-wider ${
              isRed ? 'text-[#FF334B]' : isAmber ? 'text-[#FFB800]' : 'text-[#00E699]'
            }`}
          >
            {isRed ? 'INTERLOCK TRIPPED' : isAmber ? 'CAUTION // REEL LOW' : 'RUNNING // NORMAL'}
          </span>
          <span className="text-[10px] text-white/50 truncate max-w-[200px]">{activeReason}</span>
        </div>
      </div>

      {/* Tactile Audio & Siren Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={testHorn}
          className="min-h-[38px] px-3 bg-[#17212D] hover:bg-[#202E3F] text-white text-xs rounded-lg border border-white/10 flex items-center gap-1.5 transition-colors"
          title="Test Cleanroom Klaxon Tone"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-[#00E699]" />
          <span className="hidden md:inline">TEST KLAXON</span>
        </button>

        <button
          onClick={toggleMute}
          className={`min-h-[38px] w-9 flex items-center justify-center rounded-lg border transition-colors ${
            isMuted
              ? 'bg-[#2A171A] border-[#FF334B]/40 text-[#FF334B]'
              : 'bg-[#17212D] border-white/10 text-white/70 hover:text-white'
          }`}
          title={isMuted ? 'Acoustic siren muted' : 'Acoustic siren armed'}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-[#00E699]" />}
        </button>
      </div>
    </div>
  );
};
