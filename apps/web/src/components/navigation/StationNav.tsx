import React from 'react';
import { 
  Split, Activity, Tablet, Sliders, Layers, 
  Flame, Truck, Shield, GitFork, Crosshair, 
  Terminal, Lock 
} from 'lucide-react';
import { 
  NavTab, 
  DomainId, 
  getStationsForDomain, 
  isTabAllowed 
} from '../../config/navigation';
import { OperatorProfile } from '../../services/auth.service';

interface StationNavProps {
  activeDomain: DomainId;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  operator: OperatorProfile | null;
}

const STATION_ICONS: Record<NavTab, React.ComponentType<{ className?: string }>> = {
  FLEET: Split,
  SUPERVISOR: Activity,
  OPERATOR: Tablet,
  SPI: Sliders,
  SOLDER_PASTE: Layers,
  REFLOW: Flame,
  AGV_LOGISTICS: Truck,
  COMPLIANCE: Shield,
  GENEALOGY: GitFork,
  REWORK: Crosshair,
  PREDICTIVE: Activity,
  AUDIT_TRAIL: Terminal
};

export const StationNav: React.FC<StationNavProps> = ({
  activeDomain,
  activeTab,
  onSelectTab,
  operator
}) => {
  const stations = getStationsForDomain(activeDomain);

  return (
    <div 
      className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none font-sans"
      role="tablist"
      aria-label="Cleanroom Stations Sub-Navigation"
    >
      {stations.map(station => {
        const Icon = STATION_ICONS[station.id] || Tablet;
        const isActive = activeTab === station.id;
        const allowed = isTabAllowed(station.id, operator);

        return (
          <button
            key={station.id}
            role="tab"
            aria-selected={isActive}
            aria-disabled={!allowed}
            onClick={() => onSelectTab(station.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono shrink-0 transition-all ${
              isActive
                ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm'
                : allowed
                  ? 'bg-[#10161F] text-[#7A8A9E] hover:text-white hover:bg-[#18222F] border border-white/5'
                  : 'bg-[#0D1219] text-white/30 border border-white/5 cursor-pointer hover:bg-white/5'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${
              isActive ? 'text-[#00E699]' : allowed ? 'text-[#7A8A9E]' : 'text-white/30'
            }`} />
            
            <span className="text-[10px] text-[#7A8A9E] font-normal">
              {station.code}
            </span>

            <span>{station.shortLabel}</span>

            {!allowed && (
              <span className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1 py-0.2 rounded flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" />
                <span>LOCK</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
