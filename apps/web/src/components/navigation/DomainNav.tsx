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
      className="inline-flex items-center gap-0.5 p-0.5 bg-[#12151B] rounded-lg border border-white/[0.08] font-sans"
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
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
              isActive
                ? 'bg-[#1C212B] text-white font-medium border border-white/[0.12] shadow-sm'
                : 'text-[#8E95A2] hover:text-[#D1D5DB] hover:bg-white/[0.04] border border-transparent'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#6B7280]'}`} />
            <span className="hidden sm:inline tracking-tight">{domain.label}</span>
            <span className="sm:hidden tracking-tight">{domain.shortLabel}</span>
            <span className={`text-[10px] font-mono px-1 py-0.2 rounded ${
              isActive 
                ? 'bg-white/10 text-white' 
                : 'text-[#525866]'
            }`}>
              {stationCount}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
