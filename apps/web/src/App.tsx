import React, { useState, useEffect } from 'react';
import { 
  Tablet, Activity, GitFork, Terminal, Shield, 
  Cpu, Radio, AlertCircle, Layers, Sliders,
  Key, Lock, LogOut, UserCheck
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
import { Crosshair, Truck, Split, Flame } from 'lucide-react';

type NavTab = 'FLEET' | 'AGV_LOGISTICS' | 'PREDICTIVE' | 'REFLOW' | 'SPI' | 'SOLDER_PASTE' | 'OPERATOR' | 'SUPERVISOR' | 'GENEALOGY' | 'AUDIT_TRAIL' | 'COMPLIANCE' | 'REWORK';

const TAB_ROLE_PERMISSIONS: Record<NavTab, OperatorRole[]> = {
  SPI: ['OPERATOR', 'QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
  SOLDER_PASTE: ['OPERATOR', 'QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
  OPERATOR: ['OPERATOR', 'MAINTENANCE', 'LINE_LEAD', 'SYSTEM_ADMIN'],
  SUPERVISOR: ['LINE_LEAD', 'SYSTEM_ADMIN', 'QUALITY_LEAD'],
  GENEALOGY: ['OPERATOR', 'MAINTENANCE', 'QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
  AUDIT_TRAIL: ['QUALITY_LEAD', 'SYSTEM_ADMIN'],
  COMPLIANCE: ['QUALITY_LEAD', 'SYSTEM_ADMIN'],
  REWORK: ['OPERATOR', 'QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
  FLEET: ['LINE_LEAD', 'SYSTEM_ADMIN', 'QUALITY_LEAD'],
  AGV_LOGISTICS: ['OPERATOR', 'LINE_LEAD', 'MAINTENANCE', 'SYSTEM_ADMIN'],
  PREDICTIVE: ['QUALITY_LEAD', 'LINE_LEAD', 'SYSTEM_ADMIN'],
  REFLOW: ['OPERATOR', 'MAINTENANCE', 'LINE_LEAD', 'SYSTEM_ADMIN']
};

const ROLE_BADGE_STYLES: Record<OperatorRole, { bg: string; text: string; border: string }> = {
  OPERATOR: { bg: 'bg-emerald-500/10', text: 'text-[#00E699]', border: 'border-[#00E699]/30' },
  MAINTENANCE: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  QUALITY_LEAD: { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30' },
  LINE_LEAD: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30' },
  SYSTEM_ADMIN: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30' }
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('REFLOW');
  const [operator, setOperator] = useState<OperatorProfile | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = authService.subscribe((state) => {
      setOperator(state.operator);
    });
    return unsubscribe;
  }, []);

  const requiredRoles = TAB_ROLE_PERMISSIONS[activeTab];
  // If not logged in, allow read-only access to general monitoring tabs, but gate privileged compliance and audit tabs
  const isAllowedTab = !operator 
    ? !['AUDIT_TRAIL', 'COMPLIANCE', 'SUPERVISOR'].includes(activeTab)
    : authService.hasRole(...requiredRoles);

  return (
    <div className="min-h-screen bg-[#0B0F14] bg-pcb-grid text-[#F0F4F8] flex flex-col font-sans">
      {/* Industrial Cockpit Header */}
      <header className="bg-[#10161F] border-b border-white/10 px-4 sm:px-6 py-3 sticky top-0 z-40 shadow-2xl">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Facility & Machine Metadata */}
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-[#18222F] border border-white/15 flex items-center justify-center text-[#00E699] shadow-inner">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A8A9E]">
                  APEX ELECTRONICS • NOIDA CLUSTER P4
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#00E699] animate-pulse" />
                <span className="text-[10px] font-mono text-[#00E699] font-bold">
                  LINE 01 ONLINE
                </span>
              </div>
              <h1 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
                Fuji NXT III M6 <span className="text-white/40 text-xs font-normal">| High-Speed SMT Placement System</span>
              </h1>
            </div>
          </div>

          {/* Machine Connection Telemetry & Operator Auth Tag */}
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-4 text-xs font-mono bg-[#0C1117] px-3.5 py-1.5 rounded-lg border border-white/10">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#00E699]" />
                <span className="text-[#7A8A9E]">TCP:</span>
                <span className="text-white font-bold">30040</span>
              </div>
              <div className="h-3 w-px bg-white/15" />
              <div>
                <span className="text-[#7A8A9E]">PROGRAM:</span>{' '}
                <span className="text-[#00E699] font-bold">PROG-SM-METER-TOP-REV4</span>
              </div>
              <div className="h-3 w-px bg-white/15" />
              <div className="flex items-center gap-1 text-[#00E699]">
                <Shield className="w-3.5 h-3.5" />
                <span>INTERLOCK ARMED</span>
              </div>
            </div>

            {/* Operator Session Tag */}
            {operator ? (
              <div className="flex items-center gap-3 bg-[#0C1117] px-3 py-1.5 rounded-lg border border-white/10 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-3.5 h-3.5 text-[#00E699]" />
                  <span className="text-white font-bold">{operator.code}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${ROLE_BADGE_STYLES[operator.role].bg} ${ROLE_BADGE_STYLES[operator.role].text} ${ROLE_BADGE_STYLES[operator.role].border}`}>
                    {operator.role}
                  </span>
                </div>
                <div className="h-3 w-px bg-white/15" />
                <button
                  onClick={() => authService.logout()}
                  className="text-[#7A8A9E] hover:text-white flex items-center gap-1 hover:bg-white/5 px-1.5 py-0.5 rounded transition-all"
                  title="Lock Station / Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">LOCK</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsLoginModalOpen(true)}
                className="flex items-center gap-2 bg-[#18222F] hover:bg-[#202C3D] active:bg-[#00E699]/20 text-white hover:text-[#00E699] px-3.5 py-1.5 rounded-lg border border-white/15 hover:border-[#00E699]/40 text-xs font-mono font-bold transition-all shadow-sm"
              >
                <Key className="w-3.5 h-3.5 text-[#00E699]" />
                <span>OPERATOR SIGN-IN</span>
              </button>
            )}
          </div>

          {/* Tactile Navigation Switches */}
          <nav className="flex items-center gap-1 bg-[#0A0E13] p-1 rounded-xl border border-white/10 text-xs font-mono">
            <button
              onClick={() => setActiveTab('SPI')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'SPI' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>00 // 3D SPI</span>
            </button>

            <button
              onClick={() => setActiveTab('SOLDER_PASTE')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'SOLDER_PASTE' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>01 // SOLDER PASTE</span>
            </button>

            <button
              onClick={() => setActiveTab('OPERATOR')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'OPERATOR' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
              <span>01 // FEEDER BAY</span>
            </button>

            <button
              onClick={() => setActiveTab('SUPERVISOR')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'SUPERVISOR' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>02 // CPH & LINE OEE</span>
            </button>

            <button
              onClick={() => setActiveTab('GENEALOGY')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'GENEALOGY' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <GitFork className="w-3.5 h-3.5" />
              <span>03 // GENEALOGY</span>
            </button>

            <button
              onClick={() => setActiveTab('AUDIT_TRAIL')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'AUDIT_TRAIL' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>04 // RAW TCP</span>
            </button>

            <button
              onClick={() => setActiveTab('COMPLIANCE')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'COMPLIANCE' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>05 // eDHR & AUDIT</span>
            </button>

            <button
              onClick={() => setActiveTab('REWORK')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'REWORK' 
                  ? 'bg-[#1D2735] text-red-400 font-bold border border-red-500/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>06 // REWORK KIOSK</span>
            </button>

            <button
              onClick={() => setActiveTab('FLEET')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'FLEET' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              <span>07 // FLEET OEE</span>
            </button>

            <button
              onClick={() => setActiveTab('AGV_LOGISTICS')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'AGV_LOGISTICS' 
                  ? 'bg-[#1D2735] text-[#00E699] font-bold border border-[#00E699]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>08 // AGV FLEET</span>
            </button>

            <button
              onClick={() => setActiveTab('PREDICTIVE')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'PREDICTIVE' 
                  ? 'bg-[#1D2735] text-[#38BDF8] font-bold border border-[#38BDF8]/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>09 // PREDICTIVE SPC</span>
            </button>

            <button
              onClick={() => setActiveTab('REFLOW')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                activeTab === 'REFLOW' 
                  ? 'bg-[#1D2735] text-orange-400 font-bold border border-orange-500/40 shadow-sm' 
                  : 'text-[#7A8A9E] hover:text-white'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>10 // REFLOW PROFILE</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Cleanroom Ergonomics Bar: Physical Andon Stack & Acoustic Horn */}
      <div className="bg-[#0B0F15] border-b border-white/10 px-4 sm:px-6 py-2">
        <div className="max-w-7xl mx-auto">
          <AndonTower state="NORMAL" activeReason="Line 01 Fuji NXT III M6 • Interlocks Armed • 21 CFR Part 11 Active" />
        </div>
      </div>

      {/* Main Instrument Display Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {!isAllowedTab ? (
          <div className="bg-[#10161F] border border-red-500/30 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-4 max-w-lg mx-auto mt-12 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-red-950/40 border border-red-500/40 flex items-center justify-center text-red-400">
              <Lock className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono uppercase tracking-wider">
                Access Restricted: Privileged Station
              </h2>
              <p className="text-xs text-[#7A8A9E] mt-1 font-mono">
                Station <span className="text-white font-bold">{activeTab}</span> requires authorized credentials.
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
        }} 
      />

      {/* Micro-Telemetry Bottom HUD */}
      <footer className="bg-[#0D1219] border-t border-white/10 px-6 py-2.5 text-xs font-mono text-[#7A8A9E]">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <span>JOB: <strong className="text-white">JOB-SM-260901</strong></span>
            <span>•</span>
            <span>CYCLE: <strong className="text-[#00E699]">18.24s</strong></span>
            <span>•</span>
            <span>SPEED: <strong className="text-[#00E699]">44,820 CPH</strong></span>
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
