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
      // If clipboard API is blocked, textarea is selected for manual copy
      if (textareaRef.current) {
        textareaRef.current.select();
      }
      setCopied(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="briefing-modal-title"
    >
      <div className="bg-[#10161F] border border-white/20 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4 text-white font-sans animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#00E699]/10 border border-[#00E699]/30 flex items-center justify-center text-[#00E699]">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 id="briefing-modal-title" className="text-sm font-bold tracking-tight">
                SMT Shift Handover Briefing
              </h3>
              <p className="text-xs text-[#7A8A9E] font-mono">
                Standardized production markdown report
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#7A8A9E] hover:text-white rounded-lg hover:bg-white/5 transition-all"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {copyError && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300 flex items-center gap-2 font-mono">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Automatic clipboard write restricted by browser. Please select text below to copy.</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="briefing-content" className="text-[11px] font-mono text-[#7A8A9E] uppercase tracking-wider">
            Report Content (Markdown)
          </label>
          <textarea
            id="briefing-content"
            ref={textareaRef}
            readOnly
            value={briefingText}
            className="w-full h-64 bg-[#0B0F14] border border-white/15 rounded-xl p-3 text-xs font-mono text-white/90 focus:outline-none focus:border-[#00E699]/50 select-all resize-none leading-relaxed"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <span className="text-[11px] font-mono text-[#7A8A9E]">
            Ctrl+A / Cmd+A inside box to select all
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white rounded-xl text-xs font-mono font-medium transition-all"
            >
              Close
            </button>
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-[#00E699] hover:bg-[#00c784] text-[#0B0F14] rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-[#00E699]/20"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied to Clipboard!</span>
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
