import React, { useState, useEffect, useCallback } from 'react';
import { 
  Cpu, Radio, AlertCircle, Shield, 
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
  OPERATOR: { bg: 'bg-emerald-500/10', text: 'text-[#00E699]', border: 'border-[#00E699]/30' },
  MAINTENANCE: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  QUALITY_LEAD: { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30' },
  LINE_LEAD: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30' },
  SYSTEM_ADMIN: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30' }
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
      // Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsStationSwitcherOpen(prev => !prev);
        return;
      }

      // '/' search hotkey (when not inside inputs)
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
    // If current tab does not belong to the selected domain, switch to first station in that domain
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
      setToastMessage('Shift handover briefing copied to clipboard!');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      // Fallback to modal dialog with selectable text
      setBriefingCopyError(err?.message || 'Clipboard access denied');
      setIsBriefingModalOpen(true);
    }
  }, [kpis]);

  const currentStation = STATIONS[activeTab];
  const requiredRoles = currentStation?.requiredRoles ?? [];
  const isAllowed = isTabAllowed(activeTab, operator);

  return (
    <div className="min-h-screen bg-[#0B0F14] bg-pcb-grid text-[#F0F4F8] flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1D2735] border border-[#00E699]/40 text-[#00E699] px-4 py-2.5 rounded-xl shadow-2xl text-xs font-mono flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Industrial Cockpit Header */}
      <header className="bg-[#10161F] border-b border-white/10 px-4 sm:px-6 py-2.5 sticky top-0 z-40 shadow-2xl">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left: Facility Context & Line Selector */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#18222F] border border-white/15 flex items-center justify-center text-[#00E699] shadow-inner shrink-0">
              <Cpu className="w-5 h-5" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#7A8A9E]">
                  APEX ELECTRONICS • NOIDA CLUSTER P4
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#00E699] animate-pulse" />
                <span className="text-[10px] font-mono text-[#00E699] font-bold">
                  {selectedLine === 'LINE_01' ? 'LINE 01 ONLINE' : 'LINE 02 ONLINE'}
                </span>
              </div>

              {/* Line Selector Dropdown */}
              <div className="relative mt-0.5">
                <button
                  onClick={() => setIsLineMenuOpen(!isLineMenuOpen)}
                  className="text-xs sm:text-sm font-bold text-white tracking-tight flex items-center gap-1.5 hover:text-[#00E699] transition-all"
                  aria-haspopup="true"
                  aria-expanded={isLineMenuOpen}
                >
                  <span>
                    {selectedLine === 'LINE_01' 
                      ? 'Fuji NXT III M6 (Line 01)' 
                      : 'Fuji AIMEX IIIc (Line 02)'}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-[#7A8A9E]" />
                </button>

                {isLineMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-[#10161F] border border-white/15 rounded-xl shadow-2xl py-1 z-50 w-64 text-xs font-mono">
                    <button
                      onClick={() => {
                        setSelectedLine('LINE_01');
                        setIsLineMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-white/5 ${
                        selectedLine === 'LINE_01' ? 'text-[#00E699] font-bold bg-[#00E699]/5' : 'text-white'
                      }`}
                    >
                      <div>
                        <div className="font-bold">Line 01: Fuji NXT III M6</div>
                        <div className="text-[10px] text-[#7A8A9E]">High-Speed Smart Meter SMT</div>
                      </div>
                      {selectedLine === 'LINE_01' && <Check className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      onClick={() => {
                        setSelectedLine('LINE_02');
                        setIsLineMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-white/5 ${
                        selectedLine === 'LINE_02' ? 'text-[#00E699] font-bold bg-[#00E699]/5' : 'text-white'
                      }`}
                    >
                      <div>
                        <div className="font-bold">Line 02: Fuji AIMEX IIIc</div>
                        <div className="text-[10px] text-[#7A8A9E]">Flexible Mixed-Model SMT</div>
                      </div>
                      {selectedLine === 'LINE_02' && <Check className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Quick Search Button, Telemetry Status & Operator Sign-In */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick Station Switcher Button (Cmd+K) */}
            <button
              onClick={() => setIsStationSwitcherOpen(true)}
              className="flex items-center gap-2 bg-[#0C1117] hover:bg-[#18222F] text-[#7A8A9E] hover:text-white px-2.5 sm:px-3 py-1.5 rounded-lg border border-white/10 text-xs font-mono transition-all"
              title="Search and jump to any station (⌘K or /)"
              aria-label="Open station search palette"
            >
              <Search className="w-3.5 h-3.5 text-[#00E699]" />
              <span className="hidden md:inline">Jump to Station...</span>
              <kbd className="hidden sm:inline text-[10px] bg-white/5 border border-white/10 px-1.5 py-0.5 rounded text-[#7A8A9E]">
                ⌘K
              </kbd>
            </button>

            {/* Live Gateway Telemetry Tag */}
            <div className="hidden xl:flex items-center gap-3 text-xs font-mono bg-[#0C1117] px-3 py-1.5 rounded-lg border border-white/10">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#00E699]" />
                <span className="text-[#7A8A9E]">TCP:</span>
                <span className="text-white font-bold">30040</span>
              </div>
              <div className="h-3 w-px bg-white/15" />
              <div className="flex items-center gap-1 text-[#00E699]">
                <Shield className="w-3.5 h-3.5" />
                <span>INTERLOCK ARMED</span>
              </div>
            </div>

            {/* Operator Session Tag */}
            {operator ? (
              <div className="flex items-center gap-2 bg-[#0C1117] px-2.5 py-1.5 rounded-lg border border-white/10 text-xs font-mono">
                <UserCheck className="w-3.5 h-3.5 text-[#00E699]" />
                <span className="text-white font-bold">{operator.code}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded border font-semibold ${ROLE_BADGE_STYLES[operator.role]?.bg || 'bg-white/5'} ${ROLE_BADGE_STYLES[operator.role]?.text || 'text-white'} ${ROLE_BADGE_STYLES[operator.role]?.border || 'border-white/10'}`}>
                  {operator.role}
                </span>
                <div className="h-3 w-px bg-white/15" />
                <button
                  onClick={() => authService.logout()}
                  className="text-[#7A8A9E] hover:text-white flex items-center gap-1 hover:bg-white/5 px-1 py-0.5 rounded transition-all"
                  title="Lock Station / Sign Out"
                  aria-label="Sign out operator"
                >
                  <LogOut className="w-3 h-3" />
                  <span className="hidden sm:inline">LOCK</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsLoginModalOpen(true)}
                className="flex items-center gap-1.5 bg-[#18222F] hover:bg-[#202C3D] text-white hover:text-[#00E699] px-3 py-1.5 rounded-lg border border-white/15 hover:border-[#00E699]/40 text-xs font-mono font-bold transition-all shadow-sm"
                aria-label="Sign in operator"
              >
                <Key className="w-3.5 h-3.5 text-[#00E699]" />
                <span>SIGN-IN</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Two-Tier Categorized Navigation */}
      <div className="bg-[#0C1117] border-b border-white/10 px-4 sm:px-6 py-2 sticky top-[57px] z-30 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col gap-2">
          {/* Tier 1: Operational Domains */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <DomainNav 
              activeDomain={activeDomain} 
              onSelectDomain={handleSelectDomain} 
            />

            {/* Current Active Station Descriptor */}
            <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-[#7A8A9E]">
              <span>ACTIVE INSTRUMENT:</span>
              <span className="text-[#00E699] font-bold">{currentStation?.code}</span>
              <span className="text-white font-medium">— {currentStation?.label}</span>
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

      {/* Executive KPI Telemetry Ribbon (Collapsible on cleanroom tablets) */}
      <ManagerKpiRibbon 
        kpis={kpis} 
        onOpenShiftBriefing={handleExportBriefing} 
      />

      {/* Cleanroom Ergonomics Bar: Physical Andon Stack & Acoustic Status */}
      <div className="bg-[#0B0F15] border-b border-white/10 px-4 sm:px-6 py-1.5">
        <div className="max-w-7xl mx-auto">
          <AndonTower 
            state={kpis.activeQualityHolds.value && kpis.activeQualityHolds.value > 0 ? "CRITICAL" : "NORMAL"} 
            activeReason={`${selectedLine === 'LINE_01' ? 'Line 01 Fuji NXT III M6' : 'Line 02 Fuji AIMEX IIIc'} • Interlocks Armed • 21 CFR Part 11 Active`} 
          />
        </div>
      </div>

      {/* Main Instrument Display Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {!isAllowed ? (
          <div className="bg-[#10161F] border border-red-500/30 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-4 max-w-lg mx-auto mt-12 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-red-950/40 border border-red-500/40 flex items-center justify-center text-red-400">
              <Lock className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono uppercase tracking-wider">
                Access Restricted: Privileged Station
              </h2>
              <p className="text-xs text-[#7A8A9E] mt-1 font-mono">
                Station <span className="text-white font-bold">{currentStation?.label || activeTab}</span> requires authorized credentials.
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                {requiredRoles.map((r) => (
                  <span key={r} className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/70">
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => setIsLoginModalOpen(true)}
              className="mt-2 px-6 py-2.5 bg-[#00E699] hover:bg-[#00c784] text-[#0B0F14] font-mono text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-[#00E699]/20"
            >
              <Key className="w-4 h-4" />
              <span>{operator ? 'SWITCH OPERATOR / OVERRIDE' : 'OPERATOR SIGN-IN'}</span>
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
          // Deterministically adjust tab if logged-in operator cannot access current tab
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
      <footer className="bg-[#0D1219] border-t border-white/10 px-6 py-2.5 text-xs font-mono text-[#7A8A9E]">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <span>JOB: <strong className="text-white">JOB-SM-260901</strong></span>
            <span>•</span>
            <span>CYCLE: <strong className="text-[#00E699]">{kpis.placementSpeedCph.value?.cycleTimeSeconds ? `${kpis.placementSpeedCph.value.cycleTimeSeconds}s` : '18.24s'}</strong></span>
            <span>•</span>
            <span>SPEED: <strong className="text-[#00E699]">{kpis.placementSpeedCph.value?.actualCph ? `${kpis.placementSpeedCph.value.actualCph.toLocaleString()} CPH` : '—'}</strong></span>
            <span>•</span>
            <span>PRODUCT: <strong className="text-white">Smart Meter 4G (Rev 4)</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[#FFB800]">
              <AlertCircle className="w-3 h-3" />
              1 REEL LOW STOCK (SLOT 02)
            </span>
            <span>•</span>
            <span>ANTIGRAVITY FUJI GATEWAY v2.8</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
