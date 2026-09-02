import React, { useState } from 'react';
import { 
  Tablet, Activity, GitFork, Terminal, Shield, 
  Cpu, Radio, AlertCircle
} from 'lucide-react';
import { OperatorStation } from './components/OperatorStation';
import { SupervisorDashboard } from './components/SupervisorDashboard';
import { GenealogyExplorer } from './components/GenealogyExplorer';
import { AuditTrailViewer } from './components/AuditTrailViewer';

type NavTab = 'OPERATOR' | 'SUPERVISOR' | 'GENEALOGY' | 'AUDIT_TRAIL';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('OPERATOR');

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
                  DIXON TECH • NOIDA CLUSTER P4
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

          {/* Machine Connection Telemetry Tag */}
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

          {/* Tactile Navigation Switches */}
          <nav className="flex items-center gap-1 bg-[#0A0E13] p-1 rounded-xl border border-white/10 text-xs font-mono">
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
          </nav>
        </div>
      </header>

      {/* Main Instrument Display Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'OPERATOR' && <OperatorStation />}
        {activeTab === 'SUPERVISOR' && <SupervisorDashboard />}
        {activeTab === 'GENEALOGY' && <GenealogyExplorer />}
        {activeTab === 'AUDIT_TRAIL' && <AuditTrailViewer />}
      </main>

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
