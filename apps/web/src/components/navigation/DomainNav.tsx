import React from 'react';
import { BarChart3, Cpu, Shield, Terminal } from 'lucide-react';
import { DomainId, DOMAINS, getStationsForDomain } from '../../config/navigation';

interface DomainNavProps {
  activeDomain: DomainId;
  onSelectDomain: (domainId: DomainId) => void;
}

const DOMAIN_ICONS: Record<DomainId, React.ComponentType<{ className?: string }>> = {
  EXECUTIVE: BarChart3,
  OPERATIONS: Cpu,
  QUALITY: Shield,
  DIAGNOSTICS: Terminal
};

export const DomainNav: React.FC<DomainNavProps> = ({
  activeDomain,
  onSelectDomain
}) => {
  return (
    <nav 
      className="flex items-center gap-1.5 p-1 bg-[#0A0E13] rounded-xl border border-white/10 font-sans"
      role="tablist"
      aria-label="Operational Domains"
    >
      {DOMAINS.map(domain => {
        const Icon = DOMAIN_ICONS[domain.id] || Cpu;
        const isActive = activeDomain === domain.id;
        const stationCount = getStationsForDomain(domain.id).length;

        return (
          <button
            key={domain.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`domain-panel-${domain.id}`}
            id={`domain-tab-${domain.id}`}
            onClick={() => onSelectDomain(domain.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono transition-all ${
              isActive
                ? 'bg-[#1D2735] text-white font-bold border border-[#00E699]/40 shadow-sm'
                : 'text-[#7A8A9E] hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#00E699]' : 'text-[#7A8A9E]'}`} />
            <span className="hidden sm:inline">{domain.label}</span>
            <span className="sm:hidden">{domain.shortLabel}</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
              isActive 
                ? 'bg-[#00E699]/20 text-[#00E699] font-bold' 
                : 'bg-white/5 text-[#7A8A9E]'
            }`}>
              {stationCount}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
