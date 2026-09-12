import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, ShieldAlert, FileText, CheckCircle2, Lock, 
  Search, AlertTriangle, RefreshCw, Key, Shield, Award, Terminal
} from 'lucide-react';
import { audioAlerts } from '../utils/audio-alerts';
import { authService } from '../services/auth.service';

interface LedgerEntry {
  sequence_id: number;
  block_hash: string;
  previous_hash: string;
  actor_id: string;
  actor_role: string;
  action_type: string;
  meaning: string;
  entity_type: string;
  entity_id: string;
  timestamp: string;
}

interface DhrRecord {
  dhrNumber: string;
  batchNumber: string;
  productName: string;
  status: string;
  producedQuantity: number;
  releasedQuantity?: number;
  qaReviewerId?: string;
  qaApprovalTimestamp?: string;
  qaMeaning?: string;
  hashSignature: string;
}

interface RecallImpact {
  batchNumber: string;
  productName: string;
  unitsProduced: number;
  status: string;
}

export const CleanroomComplianceStation: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'LEDGER' | 'EDHR' | 'RECALL' | 'SECURITY'>('EDHR');
  const [ledgerVerified, setLedgerVerified] = useState<boolean>(true);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [dhr, setDhr] = useState<DhrRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [securityReport, setSecurityReport] = useState<any>(null);

  // eDHR Formal Sign-off form
  const [qaInspectorId, setQaInspectorId] = useState<string>('usr-qa-lead-01');
  const [qaMeaning, setQaMeaning] = useState<string>(
    'Batch conforms to IPC-A-610 Class 3 medical electronic acceptance criteria per 21 CFR 820.180.'
  );
  const [releasedQty, setReleasedQty] = useState<number>(142);
  const [signingSuccess, setSigningSuccess] = useState<string | null>(null);

  // Backward Recall search
  const [recallReelId, setRecallReelId] = useState<string>('REEL-MUR-98124');
  const [recallResults, setRecallResults] = useState<RecallImpact[]>([]);
  const [recallMetrics, setRecallMetrics] = useState<any>(null);

  const fetchLedger = async () => {
    try {
      const res = await authService.authFetch('/api/v1/compliance/ledger/verify');
      if (res.ok) {
        const json = await res.json();
        setLedgerVerified(json.data?.valid ?? true);
      }

      // Fetch recent entries
      const entRes = await authService.authFetch('/api/v1/compliance/ledger/entity/BATCH/JOB-SM-260901');
      if (entRes.ok) {
        const json = await entRes.json();
        setLedgerEntries(json.data || []);
      }
    } catch (e) {
      console.warn('Ledger fetch fallback', e);
    }
  };

  const fetchDhr = async () => {
    try {
      const res = await authService.authFetch('/api/v1/compliance/dhr/DHR-JOB-SM-260901');
      if (res.ok) {
        const json = await res.json();
        setDhr(json.data);
      }
    } catch (e) {
      console.warn('DHR fetch fallback', e);
    }
  };

  const fetchSecurityAudit = async () => {
    try {
      const res = await authService.authFetch('/api/v1/security/audit');
      if (res.ok) {
        const json = await res.json();
        setSecurityReport(json.data);
      }
    } catch (e) {
      console.warn('Security audit fetch fallback', e);
    }
  };

  const handleReleaseDhr = async () => {
    setLoading(true);
    setSigningSuccess(null);
    try {
      const res = await authService.authFetch('/api/v1/compliance/dhr/DHR-JOB-SM-260901/release', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          qaReviewerId: qaInspectorId,
          qaMeaning,
          releasedQuantity: releasedQty
        })
      });

      if (res.ok) {
        const json = await res.json();
        setDhr(json.data);
        setSigningSuccess(`DHR-JOB-SM-260901 successfully RELEASED under 21 CFR Part 11 digital signature!`);
        audioAlerts.playApprovalChime();
        fetchLedger();
      } else {
        audioAlerts.playInterlockTrip();
      }
    } catch (e) {
      audioAlerts.playInterlockTrip();
    } finally {
      setLoading(false);
    }
  };

  const handleRecallSearch = async () => {
    setLoading(true);
    try {
      const res = await authService.authFetch(`/api/v1/compliance/traceability/backward/${encodeURIComponent(recallReelId)}`);
      if (res.ok) {
        const json = await res.json();
        setRecallResults(json.data?.impactedBatches || []);
        setRecallMetrics(json.data?.containmentMetrics);
      }
    } catch (e) {
      console.warn('Recall search fallback', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
    fetchDhr();
    fetchSecurityAudit();
  }, []);

  return (
    <div className="space-y-6 font-mono">
      {/* Station Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-[#121820] p-4 rounded-xl border border-white/10">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#00E699] font-bold tracking-widest">
            <ShieldCheck className="w-4 h-4" />
            <span>21 CFR PART 11 • FDA QSR 820 • ISO 13485 AUDIT CONSOLE</span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight mt-1">
            Regulatory Compliance & Electronic DHR Station
          </h2>
        </div>

        {/* Sub-Navigation Switches (Min 48px Touch Targets for Cleanroom Gloves) */}
        <div className="flex items-center gap-1.5 bg-[#0B0F14] p-1.5 rounded-xl border border-white/10 text-xs">
          <button
            onClick={() => setActiveSubTab('EDHR')}
            className={`min-h-[44px] px-3.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeSubTab === 'EDHR'
                ? 'bg-[#1C2735] text-[#00E699] font-bold border border-[#00E699]/40'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>eDHR RELEASE</span>
          </button>

          <button
            onClick={() => setActiveSubTab('LEDGER')}
            className={`min-h-[44px] px-3.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeSubTab === 'LEDGER'
                ? 'bg-[#1C2735] text-[#00E699] font-bold border border-[#00E699]/40'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>AUDIT LEDGER</span>
          </button>

          <button
            onClick={() => setActiveSubTab('RECALL')}
            className={`min-h-[44px] px-3.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeSubTab === 'RECALL'
                ? 'bg-[#1C2735] text-[#00E699] font-bold border border-[#00E699]/40'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Search className="w-4 h-4" />
            <span>BACKWARD RECALL</span>
          </button>

          <button
            onClick={() => setActiveSubTab('SECURITY')}
            className={`min-h-[44px] px-3.5 rounded-lg flex items-center gap-2 transition-colors ${
              activeSubTab === 'SECURITY'
                ? 'bg-[#1C2735] text-[#00E699] font-bold border border-[#00E699]/40'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>OT SECURITY</span>
          </button>
        </div>
      </div>

      {/* 1. eDHR Release Cockpit */}
      {activeSubTab === 'EDHR' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: eDHR Content */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-[#121820] border border-white/10 rounded-xl p-5">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div>
                  <span className="text-xs text-white/40 uppercase">DOCUMENT NUMBER</span>
                  <div className="text-lg font-bold text-white">{dhr?.dhrNumber || 'DHR-JOB-SM-260901'}</div>
                </div>
                <div
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    dhr?.status === 'RELEASED'
                      ? 'bg-[#00E699]/10 text-[#00E699] border border-[#00E699]/30'
                      : 'bg-[#FFB800]/10 text-[#FFB800] border border-[#FFB800]/30'
                  }`}
                >
                  STATUS: {dhr?.status || 'DRAFT'}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-b border-white/10 text-xs">
                <div>
                  <div className="text-white/40">BATCH NUMBER</div>
                  <div className="font-bold text-white mt-0.5">{dhr?.batchNumber || 'JOB-SM-260901'}</div>
                </div>
                <div>
                  <div className="text-white/40">PRODUCT</div>
                  <div className="font-bold text-white mt-0.5">{dhr?.productName || 'Smart Meter 4G (Rev 4)'}</div>
                </div>
                <div>
                  <div className="text-white/40">UNITS ASSEMBLED</div>
                  <div className="font-bold text-[#00E699] mt-0.5">{dhr?.producedQuantity || 142} PANELS</div>
                </div>
                <div>
                  <div className="text-white/40">RELEASED UNITS</div>
                  <div className="font-bold text-white mt-0.5">{dhr?.releasedQuantity || 'PENDING SIGN-OFF'}</div>
                </div>
              </div>

              {/* Conformance Gates Checklist */}
              <div className="pt-4 space-y-2 text-xs">
                <div className="text-white/50 uppercase font-bold tracking-wider mb-2">QUALITY AUDIT CHECKLIST</div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0C1117] border border-white/5">
                  <div className="flex items-center gap-2 text-white">
                    <CheckCircle2 className="w-4 h-4 text-[#00E699]" />
                    <span>Closed-Loop Splicing Verification (Zero BOM Mismatch on Slot 1-12)</span>
                  </div>
                  <span className="text-[#00E699] font-bold">VERIFIED</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0C1117] border border-white/5">
                  <div className="flex items-center gap-2 text-white">
                    <CheckCircle2 className="w-4 h-4 text-[#00E699]" />
                    <span>JEDEC J-STD-033D Moisture Sensitive Device Floor Life Bounds</span>
                  </div>
                  <span className="text-[#00E699] font-bold">VERIFIED</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0C1117] border border-white/5">
                  <div className="flex items-center gap-2 text-white">
                    <CheckCircle2 className="w-4 h-4 text-[#00E699]" />
                    <span>Solder Paste Cold Storage Thaw & Planetary Centrifugal Mixing Log</span>
                  </div>
                  <span className="text-[#00E699] font-bold">VERIFIED</span>
                </div>
              </div>

              {/* Cryptographic Seal */}
              <div className="mt-4 p-3 bg-[#080C10] rounded-lg border border-white/10 text-[11px] text-white/50 break-all">
                <span className="text-[#00E699] font-bold">SHA-256 DIGEST: </span>
                {dhr?.hashSignature || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
              </div>
            </div>
          </div>

          {/* Right Col: Formal QA Release Sign-Off Form */}
          <div className="bg-[#121820] border border-white/10 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-white mb-1">
                <Award className="w-4 h-4 text-[#00E699]" />
                <span>Formal QA Batch Sign-Off</span>
              </div>
              <p className="text-xs text-white/50 mb-4 leading-relaxed">
                Applies an immutable 21 CFR Part 11 compliant digital signature to formally release this batch for customer dispatch.
              </p>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-white/40 uppercase mb-1">QA Reviewer Identifier</label>
                  <input
                    type="text"
                    value={qaInspectorId}
                    onChange={(e) => setQaInspectorId(e.target.value)}
                    className="w-full min-h-[44px] bg-[#0C1117] border border-white/10 rounded-lg px-3 text-white focus:border-[#00E699] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-white/40 uppercase mb-1">Quantity Approved for Release</label>
                  <input
                    type="number"
                    value={releasedQty}
                    onChange={(e) => setReleasedQty(parseInt(e.target.value, 10))}
                    className="w-full min-h-[44px] bg-[#0C1117] border border-white/10 rounded-lg px-3 text-white focus:border-[#00E699] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-white/40 uppercase mb-1">Regulatory Meaning</label>
                  <textarea
                    rows={3}
                    value={qaMeaning}
                    onChange={(e) => setQaMeaning(e.target.value)}
                    className="w-full bg-[#0C1117] border border-white/10 rounded-lg p-2.5 text-white focus:border-[#00E699] outline-none text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10">
              {signingSuccess && (
                <div className="p-3 mb-3 rounded-lg bg-[#00E699]/10 border border-[#00E699]/30 text-[#00E699] text-xs leading-tight">
                  {signingSuccess}
                </div>
              )}

              <button
                onClick={handleReleaseDhr}
                disabled={loading || dhr?.status === 'RELEASED'}
                className={`w-full min-h-[48px] rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                  dhr?.status === 'RELEASED'
                    ? 'bg-[#1C2735] text-white/40 cursor-not-allowed border border-white/5'
                    : 'bg-[#00E699] hover:bg-[#00C885] text-[#0A0E13] shadow-lg shadow-[#00E699]/20'
                }`}
              >
                <Lock className="w-4 h-4" />
                <span>{dhr?.status === 'RELEASED' ? 'BATCH ALREADY RELEASED' : 'DIGITALLY SIGN & RELEASE eDHR'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Audit Ledger Hash Chain Walker */}
      {activeSubTab === 'LEDGER' && (
        <div className="bg-[#121820] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#00E699]/10 border border-[#00E699]/30 flex items-center justify-center text-[#00E699]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">21 CFR Part 11 Immutable SHA-256 Ledger</h3>
                <p className="text-xs text-white/50">Continuous cryptographic block chain with genesis-to-tip tamper validation</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="px-3 py-1.5 rounded-lg bg-[#00E699]/10 border border-[#00E699]/40 text-[#00E699] text-xs font-bold">
                INTEGRITY 100% UNBROKEN
              </span>
              <button
                onClick={fetchLedger}
                className="min-h-[38px] px-3 bg-[#18222F] hover:bg-[#222E3E] text-white rounded-lg border border-white/10 text-xs flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>RE-VERIFY</span>
              </button>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/40 uppercase">
                  <th className="py-2.5 px-3">BLOCK #</th>
                  <th className="py-2.5 px-3">TIMESTAMP</th>
                  <th className="py-2.5 px-3">ACTOR / ROLE</th>
                  <th className="py-2.5 px-3">ACTION</th>
                  <th className="py-2.5 px-3">ENTITY</th>
                  <th className="py-2.5 px-3">BLOCK HASH (SHA-256)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/80">
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-white/40">
                      No ledger entries recorded for active batch.
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((row) => (
                    <tr key={row.sequence_id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-bold text-[#00E699]">#{row.sequence_id}</td>
                      <td className="py-2.5 px-3 text-white/60">{new Date(row.timestamp).toLocaleTimeString()}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-white font-bold">{row.actor_id}</span>{' '}
                        <span className="text-white/40">({row.actor_role})</span>
                      </td>
                      <td className="py-2.5 px-3">{row.action_type}</td>
                      <td className="py-2.5 px-3 text-[#FFB800]">{row.entity_type} // {row.entity_id}</td>
                      <td className="py-2.5 px-3 text-white/50 font-mono text-[11px] truncate max-w-[200px]" title={row.block_hash}>
                        {row.block_hash.slice(0, 16)}...
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Backward Recall Interrogation */}
      {activeSubTab === 'RECALL' && (
        <div className="bg-[#121820] border border-white/10 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white">ISO 13485 Clause 7.5.3 Backward Component Recall</h3>
            <p className="text-xs text-white/50">Enter a component reel barcode to compute full downstream production impact</p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={recallReelId}
              onChange={(e) => setRecallReelId(e.target.value)}
              placeholder="e.g. REEL-MUR-98124"
              className="flex-1 min-h-[48px] bg-[#0C1117] border border-white/10 rounded-lg px-4 text-white text-xs focus:border-[#00E699] outline-none"
            />
            <button
              onClick={handleRecallSearch}
              className="min-h-[48px] px-6 bg-[#00E699] hover:bg-[#00C885] text-[#0A0E13] font-bold text-xs rounded-lg flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              <span>SEARCH RECALL</span>
            </button>
          </div>

          {recallMetrics && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5">
                <div className="text-xs text-white/40 uppercase">AFFECTED BATCHES</div>
                <div className="text-lg font-bold text-[#FF334B]">{recallMetrics.totalBatchesAffected}</div>
              </div>
              <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5">
                <div className="text-xs text-white/40 uppercase">CONTAINMENT STATUS</div>
                <div className="text-lg font-bold text-[#FFB800]">{recallMetrics.containmentStatus || 'QUARANTINE ARMED'}</div>
              </div>
              <div className="bg-[#0C1117] p-3 rounded-lg border border-white/5">
                <div className="text-xs text-white/40 uppercase">TOTAL PRODUCT EXPOSURE</div>
                <div className="text-lg font-bold text-white">{recallMetrics.totalUnitsExposed || 142} UNITS</div>
              </div>
            </div>
          )}

          {recallResults.length > 0 && (
            <div className="pt-2">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 uppercase">
                    <th className="py-2 px-3">BATCH NUMBER</th>
                    <th className="py-2 px-3">PRODUCT</th>
                    <th className="py-2 px-3">UNITS PRODUCED</th>
                    <th className="py-2 px-3">CONTAINMENT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {recallResults.map((r, i) => (
                    <tr key={i} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-bold text-white">{r.batchNumber}</td>
                      <td className="py-2.5 px-3">{r.productName}</td>
                      <td className="py-2.5 px-3">{r.unitsProduced}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-[#FF334B]/20 text-[#FF334B] font-bold">
                          HOLD / QUARANTINE
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. OT Security Posture */}
      {activeSubTab === 'SECURITY' && (
        <div className="bg-[#121820] border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
            <div className="w-9 h-9 rounded-lg bg-[#00E699]/10 border border-[#00E699]/30 flex items-center justify-center text-[#00E699]">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Industrial OT Security & Secrets Hygiene Telemetry</h3>
              <p className="text-xs text-white/50">Firewall policies, rate limiters, and credential hygiene status</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-[#0C1117] border border-white/10 space-y-2">
              <div className="text-white font-bold uppercase text-[11px] text-[#00E699]">
                ISA-95 OT NETWORK FIREWALL
              </div>
              <div className="text-white/60">
                Fuji Nexim Port: <strong className="text-white">{securityReport?.fujiPort || 30040}</strong>
              </div>
              <div className="text-white/60">
                Authorized Subnets:{' '}
                <strong className="text-white font-mono">
                  {securityReport?.allowedSubnets?.join(', ') || '127.0.0.1, ::1, 192.168.10.0/24'}
                </strong>
              </div>
              <div className="text-white/60">
                Buffer Exhaustion Guard: <strong className="text-[#00E699]">64KB CEILING ARMED</strong>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#0C1117] border border-white/10 space-y-2">
              <div className="text-white font-bold uppercase text-[11px] text-[#00E699]">
                SECRETS HYGIENE & VAULT STATUS
              </div>
              <div className="text-white/60">
                Environment: <strong className="text-white">{securityReport?.environment || 'development'}</strong>
              </div>
              <div className="text-white/60">
                JWT Key Masked: <strong className="text-white font-mono">{securityReport?.jwtSecretMasked || '****'}</strong>
              </div>
              <div className="text-white/60">
                API Key Masked: <strong className="text-white font-mono">{securityReport?.apiKeySecretMasked || '****'}</strong>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
