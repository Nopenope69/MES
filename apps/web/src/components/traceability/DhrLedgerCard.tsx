// apps/web/src/components/traceability/DhrLedgerCard.tsx
import React from 'react';
import { ShieldCheck, FileText, Hash, CheckCircle2, AlertTriangle, Key } from 'lucide-react';

interface DhrLedgerCardProps {
  dhr: {
    dhrNumber: string;
    status: string;
    sha256Checksum: string;
    qaReviewerId: string | null;
    qaReleasedAt: string | null;
  } | null;
  complianceLedger: {
    dhrSignatures: Array<{
      sequenceNumber: number;
      currentHash: string;
      actorId: string;
      actorRole: string;
      actionType: string;
      signedAt: string;
    }>;
  } | null;
}

export const DhrLedgerCard: React.FC<DhrLedgerCardProps> = ({ dhr, complianceLedger }) => {
  const signatures = complianceLedger?.dhrSignatures || [];

  return (
    <div className="milled-panel rounded-xl p-5 space-y-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#00E699]" />
          <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider">
            ELECTRONIC DEVICE HISTORY RECORD (eDHR) & AUDIT LEDGER
          </h3>
        </div>

        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00E699]/10 border border-[#00E699]/30 text-[#00E699] font-bold">
          AUDIT LEDGER LINKED
        </span>
      </div>

      {/* DHR Metadata Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">eDHR Identifier</span>
          <span className="text-xs font-bold text-white block truncate" title={dhr?.dhrNumber || 'UNISSUED'}>
            {dhr?.dhrNumber || 'UNISSUED'}
          </span>
        </div>

        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">DHR Release State</span>
          <span
            className={`text-xs font-bold block ${
              dhr?.status === 'RELEASED'
                ? 'text-emerald-400'
                : dhr?.status === 'PENDING_QA_REVIEW'
                ? 'text-amber-300'
                : 'text-white/60'
            }`}
          >
            {dhr?.status ? dhr.status.replace(/_/g, ' ') : 'NOT INGESTED'}
          </span>
        </div>

        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/10">
          <span className="text-[10px] text-[#7A8A9E] uppercase tracking-wider block">QA Officer Release</span>
          <span className="text-xs font-bold text-white block">
            {dhr?.qaReviewerId ? `${dhr.qaReviewerId}` : 'PENDING'}
          </span>
          {dhr?.qaReleasedAt && (
            <span className="text-[10px] text-[#7A8A9E]">
              {new Date(dhr.qaReleasedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Cryptographic Ledger SHA-256 Digest */}
      {dhr?.sha256Checksum && (
        <div className="bg-[#070A0E] p-3 rounded-lg border border-white/5 space-y-1 text-xs font-mono">
          <div className="flex items-center gap-1 text-[10px] text-[#7A8A9E] uppercase tracking-wider">
            <Hash className="w-3 h-3 text-[#00E699]" />
            <span>Cryptographic DHR Checksum (SHA-256 Digest)</span>
          </div>
          <div className="text-[11px] text-white/90 font-mono break-all select-all">
            {dhr.sha256Checksum}
          </div>
        </div>
      )}

      {/* Immutable Electronic Signature Ledger Chain */}
      {signatures.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-mono text-[#7A8A9E] uppercase tracking-wider block">
            Immutable Audit Ledger Signatures ({signatures.length} Records)
          </span>
          <div className="space-y-1.5">
            {signatures.map((sig, i) => (
              <div
                key={i}
                className="bg-[#090D13] p-2.5 rounded-lg border border-white/5 text-[11px] font-mono flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[#00E699] font-bold">#{sig.sequenceNumber}</span>
                  <span className="text-white font-bold">{sig.actionType}</span>
                  <span className="text-[#7A8A9E]">by {sig.actorId} ({sig.actorRole})</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[#7A8A9E]">
                  <span className="font-mono text-white/40 truncate max-w-[120px]" title={sig.currentHash}>
                    {sig.currentHash.substring(0, 12)}...
                  </span>
                  <span>{new Date(sig.signedAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
