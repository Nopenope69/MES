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
      className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none font-sans"
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
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-mono shrink-0 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
              isActive
                ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.14]'
                : allowed
                  ? 'text-[#8E95A2] hover:text-white hover:bg-white/[0.03] border border-transparent'
                  : 'text-white/30 border border-transparent hover:text-white/50 cursor-pointer'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${
              isActive ? 'text-white' : allowed ? 'text-[#6B7280]' : 'text-white/20'
            }`} />
            
            <span className="text-[10px] text-[#6B7280] font-normal">
              {station.code}
            </span>

            <span className="font-sans text-xs font-medium tracking-tight">
              {station.shortLabel}
            </span>

            {!allowed && (
              <span className="text-[9px] font-mono text-amber-300/80 bg-amber-500/10 border border-amber-500/20 px-1 py-0.2 rounded flex items-center gap-0.5">
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
