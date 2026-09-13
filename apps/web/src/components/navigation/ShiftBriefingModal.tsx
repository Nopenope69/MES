import React, { useRef, useState } from 'react';
import { Copy, Check, X, FileText, AlertCircle } from 'lucide-react';

interface ShiftBriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
  briefingText: string;
  copyError?: string | null;
}

export const ShiftBriefingModal: React.FC<ShiftBriefingModalProps> = ({
  isOpen,
  onClose,
  briefingText,
  copyError
}) => {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      if (textareaRef.current) {
        textareaRef.current.select();
      }
      await navigator.clipboard.writeText(briefingText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      if (textareaRef.current) {
        textareaRef.current.select();
      }
      setCopied(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="briefing-modal-title"
    >
      <div className="bg-[#12151C] border border-white/[0.12] rounded-xl max-w-2xl w-full p-5 shadow-2xl flex flex-col gap-3.5 text-white font-sans animate-in fade-in zoom-in-95 duration-100">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-[#D1D5DB]">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 id="briefing-modal-title" className="text-sm font-semibold tracking-tight">
                SMT Shift Handover Briefing
              </h3>
              <p className="text-[11px] text-[#6B7280]">
                Cleanroom operational markdown summary
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#6B7280] hover:text-white rounded hover:bg-white/[0.04] transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {copyError && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 text-xs text-amber-300/90 flex items-center gap-2 font-mono">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Automatic clipboard write restricted. Please copy the text below manually.</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="briefing-content" className="text-[10px] font-mono text-[#6B7280] uppercase tracking-wider">
            Markdown Telemetry Payload
          </label>
          <textarea
            id="briefing-content"
            ref={textareaRef}
            readOnly
            value={briefingText}
            className="w-full h-60 bg-[#0E1015] border border-white/[0.08] rounded-lg p-3 text-xs font-mono text-[#D1D5DB] focus:outline-none focus:border-white/20 select-all resize-none leading-relaxed"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
          <span className="text-[10px] font-mono text-[#6B7280]">
            Press Cmd+A / Ctrl+A to select all
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-[#9CA3AF] hover:text-white rounded-md text-xs font-medium transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-white text-[#0B0F14] hover:bg-[#E5E7EB] rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Report</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
