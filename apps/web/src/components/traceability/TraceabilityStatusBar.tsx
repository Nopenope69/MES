// apps/web/src/components/traceability/TraceabilityStatusBar.tsx
import React from 'react';
import { Activity, AlertTriangle, ShieldCheck, ShieldAlert, Lock, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import { TraceabilityDataSource, isFixtureModeEnabled, setFixtureModeEnabled } from '../../services/traceability.api';

interface TraceabilityStatusBarProps {
  source: TraceabilityDataSource;
  error?: string;
  fixtureId?: string;
  onRefresh?: () => void;
  onFixtureModeToggled?: () => void;
}

export const TraceabilityStatusBar: React.FC<TraceabilityStatusBarProps> = ({
  source,
  error,
  fixtureId,
  onRefresh,
  onFixtureModeToggled
}) => {
  const fixtureEnabled = isFixtureModeEnabled();

  const handleToggle = () => {
    setFixtureModeEnabled(!fixtureEnabled);
    if (onFixtureModeToggled) onFixtureModeToggled();
  };

  return (
    <div className="space-y-2">
      {/* Persistent Source State Banner */}
      {source === 'OFFLINE_FIXTURE' && (
        <div className="bg-amber-500/15 border border-amber-500/40 text-amber-300 px-4 py-2.5 rounded-lg text-xs font-mono flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <div>
              <span className="font-bold tracking-wider uppercase">⚠ OFFLINE / DEMO DATA — NOT LIVE</span>
              <span className="text-amber-300/70 ml-2">
                Live MES bus unavailable; displaying simulated test record: [{fixtureId || 'CANONICAL'}]
              </span>
            </div>
          </div>
          <span className="text-[10px] bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
            DEMO MODE
          </span>
        </div>
      )}

      {source === 'AUTH_ERROR' && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-300 px-4 py-2.5 rounded-lg text-xs font-mono flex items-center gap-2.5 shadow-lg">
          <Lock className="w-4 h-4 text-red-400 shrink-0" />
          <div>
            <span className="font-bold tracking-wider uppercase">🔒 AUTHENTICATION REQUIRED (HTTP 401/403)</span>
            <span className="text-red-300/70 ml-2">{error || 'Valid operator JWT or Permission.TRACEABILITY_READ required.'}</span>
          </div>
        </div>
      )}

      {source === 'OFFLINE_NO_DATA' && (
        <div className="bg-red-500/15 border border-red-500/40 text-red-300 px-4 py-2.5 rounded-lg text-xs font-mono flex items-center gap-2.5 shadow-lg">
          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
          <div>
            <span className="font-bold tracking-wider uppercase">⚠ LIVE MES API UNAVAILABLE</span>
            <span className="text-red-300/70 ml-2">Production endpoint unreachable and offline fixtures are disabled.</span>
          </div>
        </div>
      )}

      {source === 'NOT_FOUND' && (
        <div className="bg-gray-800/60 border border-white/10 text-[#7A8A9E] px-4 py-2 rounded-lg text-xs font-mono flex items-center gap-2">
          <span className="text-white font-bold">404 NOT FOUND:</span>
          <span>{error || 'No matching manufacturing records located for the requested identifier.'}</span>
        </div>
      )}

      {source === 'ERROR' && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg text-xs font-mono flex items-center gap-2">
          <span className="font-bold">SYSTEM ERROR:</span>
          <span>{error || 'Internal MES service communication failure.'}</span>
        </div>
      )}

      {/* Industrial Sub-Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono bg-[#0D131A] px-4 py-2 rounded-lg border border-white/10">
        {/* Source Status Indicator */}
        <div className="flex items-center gap-2">
          {source === 'LIVE' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-[#00E699] animate-pulse" />
              <span className="text-[#00E699] font-bold">● LIVE DATA</span>
              <span className="text-[#7A8A9E] text-[11px]">• Connected to MES API</span>
            </>
          ) : source === 'OFFLINE_FIXTURE' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-amber-400 font-bold">● OFFLINE / DEMO FIXTURE</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-red-400 font-bold">● DISCONNECTED</span>
            </>
          )}
        </div>

        {/* Factual Audit & Evidence Indicator (No false regulatory claim) */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[#7A8A9E]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#00E699]" />
            <span className="text-white/80">AUDIT LEDGER LINKED</span>
          </div>

          <div className="h-3 w-px bg-white/10" />

          {/* Fixture Mode Toggle Switch */}
          <button
            onClick={handleToggle}
            className="flex items-center gap-1 text-[#7A8A9E] hover:text-white transition-colors"
            title="Toggle offline demo fixture fallback"
          >
            <span>DEMO FIXTURES:</span>
            {fixtureEnabled ? (
              <span className="text-[#00E699] font-bold flex items-center gap-0.5">
                ON <ToggleRight className="w-4 h-4 text-[#00E699]" />
              </span>
            ) : (
              <span className="text-gray-400 font-bold flex items-center gap-0.5">
                OFF <ToggleLeft className="w-4 h-4 text-gray-500" />
              </span>
            )}
          </button>

          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1 text-[#7A8A9E] hover:text-[#00E699] transition-colors"
              title="Refresh dataset from API"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
