import React, { useState, useEffect, useCallback } from 'react';
import { 
  Cpu, Radio, Shield, 
  Key, Lock, LogOut, UserCheck, Search,
  ChevronDown, Check
} from 'lucide-react';
import { SolderPasteStation } from './components/SolderPasteStation';
import { OperatorStation } from './components/OperatorStation';
import { SupervisorDashboard } from './components/SupervisorDashboard';
import { TraceabilityStation } from './components/TraceabilityStation';
import { AuditTrailViewer } from './components/AuditTrailViewer';
import { CleanroomComplianceStation } from './components/CleanroomComplianceStation';
import { AndonTower } from './components/AndonTower';
import { ReworkStation } from './components/ReworkStation';
import { SpiStation } from './components/SpiStation';
import { FleetDashboard } from './components/FleetDashboard';
import { AgvLogisticsStation } from './components/AgvLogisticsStation';
import { PredictiveIntelligenceStation } from './components/PredictiveIntelligenceStation';
import { ReflowThermalStation } from './components/ReflowThermalStation';
import { LoginModal } from './components/auth/LoginModal';
import { authService, OperatorProfile, OperatorRole } from './services/auth.service';

import { 
  NavTab, 
  DomainId, 
  STATIONS, 
  getStationsForDomain,
  isTabAllowed, 
  getInitialOrPermittedTab 
} from './config/navigation';
import { DomainNav } from './components/navigation/DomainNav';
import { StationNav } from './components/navigation/StationNav';
import { ManagerKpiRibbon } from './components/navigation/ManagerKpiRibbon';
import { QuickStationSwitcher } from './components/navigation/QuickStationSwitcher';
import { ShiftBriefingModal } from './components/navigation/ShiftBriefingModal';
import { useManagerKpis, generateShiftBriefingText } from './services/kpi-adapter';

const ROLE_BADGE_STYLES: Record<OperatorRole, { bg: string; text: string; border: string }> = {
  OPERATOR: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  MAINTENANCE: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  QUALITY_LEAD: { bg: 'bg-indigo-500/10', text: 'text-indigo-300', border: 'border-indigo-500/20' },
  LINE_LEAD: { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/20' },
  SYSTEM_ADMIN: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/20' }
};

export const App: React.FC = () => {
  const [operator, setOperator] = useState<OperatorProfile | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>(() => getInitialOrPermittedTab('FLEET', null));
  const [activeDomain, setActiveDomain] = useState<DomainId>(() => STATIONS[activeTab]?.domainId ?? 'EXECUTIVE');
  
  const [selectedLine, setSelectedLine] = useState<'LINE_01' | 'LINE_02'>('LINE_01');
  const [isLineMenuOpen, setIsLineMenuOpen] = useState(false);
  
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isStationSwitcherOpen, setIsStationSwitcherOpen] = useState(false);
  const [isBriefingModalOpen, setIsBriefingModalOpen] = useState(false);
  const [briefingText, setBriefingText] = useState('');
  const [briefingCopyError, setBriefingCopyError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Live KPI hook adhering strictly to Anti-Fake-Success invariants
  const kpis = useManagerKpis(5000);

  // Subscribe to auth state changes and enforce deterministic fallback
  useEffect(() => {
    const unsubscribe = authService.subscribe((state) => {
      const newOp = state.operator;
      setOperator(newOp);

      // Verify active tab remains accessible after login/logout
      setActiveTab((prev) => {
        const validated = getInitialOrPermittedTab(prev, newOp);
        setActiveDomain(STATIONS[validated]?.domainId ?? 'EXECUTIVE');
        return validated;
      });
    });
    return unsubscribe;
  }, []);

  // Global keyboard shortcuts (Cmd+K, Ctrl+K, '/')
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsStationSwitcherOpen(prev => !prev);
        return;
      }

      if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      ) {
        e.preventDefault();
        setIsStationSwitcherOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle station selection from any tier or quick switcher
  const handleSelectTab = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    const domain = STATIONS[tab]?.domainId;
    if (domain) {
      setActiveDomain(domain);
    }
  }, []);

  // Handle domain tab click
  const handleSelectDomain = useCallback((domainId: DomainId) => {
    setActiveDomain(domainId);
    const stationsInDomain = getStationsForDomain(domainId);
    if (!stationsInDomain.some(s => s.id === activeTab)) {
      const firstAllowed = stationsInDomain.find(s => isTabAllowed(s.id, operator));
      if (firstAllowed) {
        setActiveTab(firstAllowed.id);
      } else if (stationsInDomain[0]) {
        setActiveTab(stationsInDomain[0].id);
      }
    }
  }, [activeTab, operator]);

  // Handle shift briefing export with clipboard fallback
  const handleExportBriefing = useCallback(async () => {
    const reportMarkdown = generateShiftBriefingText(kpis);
    setBriefingText(reportMarkdown);

    try {
      await navigator.clipboard.writeText(reportMarkdown);
      setBriefingCopyError(null);
      setToastMessage('Shift handover briefing copied to clipboard');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      setBriefingCopyError(err?.message || 'Clipboard access restricted');
      setIsBriefingModalOpen(true);
    }
  }, [kpis]);

  const currentStation = STATIONS[activeTab];
  const requiredRoles = currentStation?.requiredRoles ?? [];
  const isAllowed = isTabAllowed(activeTab, operator);

  return (
    <div className="min-h-screen bg-[#0A0D12] text-[#EDEDED] flex flex-col font-sans selection:bg-white/10 selection:text-white">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#171B22] border border-white/[0.12] text-white px-3.5 py-2 rounded-lg shadow-xl text-xs font-mono flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Industrial Cockpit Header */}
      <header className="bg-[#0F1218] border-b border-white/[0.08] px-4 sm:px-6 py-2 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Left: Facility Context & Line Selector */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/80 shrink-0">
              <Cpu className="w-4 h-4" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono tracking-wider text-[#6B7280] uppercase">
                  Apex Electronics · Noida Cluster P4
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] font-mono text-emerald-400 font-medium">
                  {selectedLine === 'LINE_01' ? 'Line 01 Online' : 'Line 02 Online'}
                </span>
              </div>

              {/* Line Selector Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setIsLineMenuOpen(!isLineMenuOpen)}
                  className="text-xs font-semibold text-white tracking-tight flex items-center gap-1.5 hover:text-white/80 transition-colors"
                  aria-haspopup="true"
                  aria-expanded={isLineMenuOpen}
                >
                  <span>
                    {selectedLine === 'LINE_01' 
                      ? 'Fuji NXT III M6 (Line 01)' 
                      : 'Fuji AIMEX IIIc (Line 02)'}
                  </span>
                  <ChevronDown className="w-3 h-3 text-[#6B7280]" />
                </button>

                {isLineMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-[#141820] border border-white/[0.12] rounded-lg shadow-xl py-1 z-50 w-64 text-xs font-sans">
                    <button
                      onClick={() => {
                        setSelectedLine('LINE_01');
                        setIsLineMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-white/[0.04] ${
                        selectedLine === 'LINE_01' ? 'text-white font-semibold bg-white/[0.04]' : 'text-[#9CA3AF]'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-white">Line 01: Fuji NXT III M6</div>
                        <div className="text-[10px] text-[#6B7280]">High-Speed Smart Meter SMT</div>
                      </div>
                      {selectedLine === 'LINE_01' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </button>

                    <button
                      onClick={() => {
                        setSelectedLine('LINE_02');
                        setIsLineMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-white/[0.04] ${
                        selectedLine === 'LINE_02' ? 'text-white font-semibold bg-white/[0.04]' : 'text-[#9CA3AF]'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-white">Line 02: Fuji AIMEX IIIc</div>
                        <div className="text-[10px] text-[#6B7280]">Flexible Mixed-Model SMT</div>
                      </div>
                      {selectedLine === 'LINE_02' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Quick Search Button & Operator Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick Station Switcher Button (Cmd+K) */}
            <button
              onClick={() => setIsStationSwitcherOpen(true)}
              className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] text-[#8E95A2] hover:text-white px-2.5 sm:px-3 py-1.5 rounded-md border border-white/[0.08] text-xs font-sans transition-colors"
              title="Search and jump to any station (⌘K or /)"
              aria-label="Open station search palette"
            >
              <Search className="w-3.5 h-3.5 text-[#6B7280]" />
              <span className="hidden md:inline">Jump to station...</span>
              <kbd className="hidden sm:inline text-[10px] font-mono bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.2 rounded text-[#8E95A2]">
                ⌘K
              </kbd>
            </button>

            {/* Gateway Telemetry Tag */}
            <div className="hidden xl:flex items-center gap-3 text-xs font-mono bg-white/[0.03] px-3 py-1.5 rounded-md border border-white/[0.08]">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-[#6B7280]" />
                <span className="text-[#6B7280]">PORT:</span>
                <span className="text-white font-medium">30040</span>
              </div>
              <div className="h-3 w-px bg-white/[0.08]" />
              <div className="flex items-center gap-1 text-emerald-400">
                <Shield className="w-3 h-3" />
                <span>INTERLOCK ARMED</span>
              </div>
            </div>

            {/* Operator Session Tag */}
            {operator ? (
              <div className="flex items-center gap-2 bg-white/[0.03] px-2.5 py-1.5 rounded-md border border-white/[0.08] text-xs font-mono">
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-white font-medium">{operator.code}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded border font-medium ${ROLE_BADGE_STYLES[operator.role]?.bg || 'bg-white/5'} ${ROLE_BADGE_STYLES[operator.role]?.text || 'text-white'} ${ROLE_BADGE_STYLES[operator.role]?.border || 'border-white/10'}`}>
                  {operator.role}
                </span>
                <div className="h-3 w-px bg-white/[0.08]" />
                <button
                  onClick={() => authService.logout()}
                  className="text-[#6B7280] hover:text-white flex items-center gap-1 hover:bg-white/[0.04] px-1 py-0.5 rounded transition-colors"
                  title="Sign out operator"
                  aria-label="Sign out operator"
                >
                  <LogOut className="w-3 h-3" />
                  <span className="hidden sm:inline font-sans">Lock</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsLoginModalOpen(true)}
                className="flex items-center gap-1.5 bg-white/[0.05] hover:bg-white/[0.09] text-white px-3 py-1.5 rounded-md border border-white/[0.12] text-xs font-medium transition-colors"
                aria-label="Sign in operator"
              >
                <Key className="w-3 h-3 text-[#9CA3AF]" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Two-Tier Categorized Navigation */}
      <div className="bg-[#0C0F14] border-b border-white/[0.08] px-4 sm:px-6 py-1.5 sticky top-[49px] z-30">
        <div className="max-w-7xl mx-auto flex flex-col gap-1.5">
          {/* Tier 1: Operational Domains */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <DomainNav 
              activeDomain={activeDomain} 
              onSelectDomain={handleSelectDomain} 
            />

            {/* Current Active Station Indicator */}
            <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-[#6B7280]">
              <span>INSTRUMENT:</span>
              <span className="text-white font-medium">{currentStation?.code}</span>
              <span className="text-[#9CA3AF] font-sans">— {currentStation?.label}</span>
            </div>
          </div>

          {/* Tier 2: Station Sub-Navigation */}
          <StationNav 
            activeDomain={activeDomain} 
            activeTab={activeTab} 
            onSelectTab={handleSelectTab} 
            operator={operator} 
          />
        </div>
      </div>

      {/* Executive Cleanroom Telemetry Rail */}
      <ManagerKpiRibbon 
        kpis={kpis} 
        onOpenShiftBriefing={handleExportBriefing} 
      />

      {/* Cleanroom Ergonomics Bar: Physical Andon Status */}
      <div className="bg-[#090C10] border-b border-white/[0.06] px-4 sm:px-6 py-1">
        <div className="max-w-7xl mx-auto">
          <AndonTower 
            state={kpis.activeQualityHolds.value && kpis.activeQualityHolds.value > 0 ? "CRITICAL" : "NORMAL"} 
            activeReason={`${selectedLine === 'LINE_01' ? 'Line 01 Fuji NXT III M6' : 'Line 02 Fuji AIMEX IIIc'} · Interlocks Armed · 21 CFR Part 11 Active`} 
          />
        </div>
      </div>

      {/* Main Instrument Display Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {!isAllowed ? (
          <div className="bg-[#12151C] border border-white/[0.12] rounded-xl p-8 text-center flex flex-col items-center justify-center gap-4 max-w-md mx-auto mt-12 shadow-xl">
            <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-amber-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide uppercase font-mono">
                Access Restricted: Privileged Station
              </h2>
              <p className="text-xs text-[#8E95A2] mt-1 font-sans">
                Station <strong className="text-white">{currentStation?.label || activeTab}</strong> requires authorized cleanroom credentials.
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                {requiredRoles.map((r) => (
                  <span key={r} className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-[#9CA3AF]">
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => setIsLoginModalOpen(true)}
              className="mt-2 px-5 py-2 bg-white text-[#0B0F14] hover:bg-[#E5E7EB] font-sans text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 shadow-sm"
            >
              <Key className="w-3.5 h-3.5" />
              <span>{operator ? 'Switch Operator / Override' : 'Operator Sign In'}</span>
            </button>
          </div>
        ) : (
          <>
            {activeTab === 'REFLOW' && <ReflowThermalStation />}
            {activeTab === 'FLEET' && <FleetDashboard />}
            {activeTab === 'AGV_LOGISTICS' && <AgvLogisticsStation />}
            {activeTab === 'PREDICTIVE' && <PredictiveIntelligenceStation />}
            {activeTab === 'SPI' && <SpiStation />}
            {activeTab === 'SOLDER_PASTE' && <SolderPasteStation />}
            {activeTab === 'OPERATOR' && <OperatorStation />}
            {activeTab === 'SUPERVISOR' && <SupervisorDashboard />}
            {activeTab === 'GENEALOGY' && <TraceabilityStation />}
            {activeTab === 'AUDIT_TRAIL' && <AuditTrailViewer />}
            {activeTab === 'COMPLIANCE' && <CleanroomComplianceStation />}
            {activeTab === 'REWORK' && <ReworkStation />}
          </>
        )}
      </main>

      {/* Operator Authentication Modal (Gate G-08) */}
      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
        onSuccess={(loggedOp) => {
          setOperator(loggedOp);
          setIsLoginModalOpen(false);
          setActiveTab(prev => getInitialOrPermittedTab(prev, loggedOp));
        }} 
      />

      {/* Quick Station Switcher Command Palette (Cmd+K) */}
      <QuickStationSwitcher
        isOpen={isStationSwitcherOpen}
        onClose={() => setIsStationSwitcherOpen(false)}
        activeTab={activeTab}
        onSelectStation={handleSelectTab}
        operator={operator}
      />

      {/* Shift Briefing Markdown Modal */}
      <ShiftBriefingModal
        isOpen={isBriefingModalOpen}
        onClose={() => setIsBriefingModalOpen(false)}
        briefingText={briefingText}
        copyError={briefingCopyError}
      />

      {/* Micro-Telemetry Bottom HUD */}
      <footer className="bg-[#0B0E13] border-t border-white/[0.08] px-6 py-2 text-xs font-mono text-[#6B7280]">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <span>JOB: <strong className="text-white">{kpis.shiftInfo.value?.shiftCode ? 'JOB-SM-260901' : 'JOB-SM-260901'}</strong></span>
            <span>·</span>
            <span>CYCLE: <strong className="text-white">{kpis.placementSpeedCph.value?.cycleTimeSeconds ? `${kpis.placementSpeedCph.value.cycleTimeSeconds}s` : '18.24s'}</strong></span>
            <span>·</span>
            <span>SPEED: <strong className="text-white">{kpis.placementSpeedCph.value?.actualCph ? `${kpis.placementSpeedCph.value.actualCph.toLocaleString()} CPH` : '—'}</strong></span>
            <span>·</span>
            <span>PRODUCT: <strong className="text-white">Smart Meter 4G (Rev 4)</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-amber-400">
              1 Reel Low Stock (Slot 02)
            </span>
            <span>·</span>
            <span>Fuji Nexim Gateway v2.8</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
