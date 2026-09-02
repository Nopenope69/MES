import React, { useState, useEffect } from 'react';
import { Terminal, RefreshCw, Filter, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';

interface ProductionEventRecord {
  id: string;
  event_id: string;
  event_type: string;
  event_time: string;
  received_time: string;
  source_type: string;
  source_id: string;
  work_center_id: string;
  batch_id?: string;
  operator_id?: string;
  payload: Record<string, any>;
}

export const AuditTrailViewer: React.FC = () => {
  const [events, setEvents] = useState<ProductionEventRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');

  const fetchEvents = async () => {
    setLoading(true);
    try {
      let url = '/api/v1/events?limit=50';
      if (eventTypeFilter) url += `&eventType=${eventTypeFilter}`;
      const res = await fetch(url);
      if (res.ok) {
        setEvents(await res.json());
      }
    } catch (err) {
      console.error('Failed to load event log', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [eventTypeFilter]);

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* Cockpit Bar */}
      <div className="milled-panel rounded-xl p-5 flex flex-wrap justify-between items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-[#7A8A9E]">
              TIER 2 CANONICAL EVENT LOG
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#00E699]" />
            <span className="text-[10px] text-[#00E699] font-bold">APPEND-ONLY SINGLE SOURCE OF TRUTH</span>
          </div>
          <h2 className="text-lg font-bold text-white font-sans mt-0.5">
            Cryptographic Production Audit Stream
          </h2>
          <p className="text-xs text-[#7A8A9E]">
            Preserves exact timestamps, sequence IDs, and payload parameters for every board checkout and reel splice.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#070A0E] px-3 py-2 rounded-lg border border-white/10 text-xs">
            <Filter className="w-3.5 h-3.5 text-[#7A8A9E]" />
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="bg-transparent text-white font-bold focus:outline-none"
            >
              <option value="" className="bg-[#0B0F14]">ALL EVENT TYPES</option>
              <option value="PANEL_CHECKOUT" className="bg-[#0B0F14]">PANEL_CHECKOUT</option>
              <option value="REEL_SPLICED" className="bg-[#0B0F14]">REEL_SPLICED</option>
              <option value="PICK_ERROR_RECORDED" className="bg-[#0B0F14]">PICK_ERROR_RECORDED</option>
              <option value="STATE_CHANGED" className="bg-[#0B0F14]">STATE_CHANGED</option>
              <option value="BATCH_STARTED" className="bg-[#0B0F14]">BATCH_STARTED</option>
              <option value="DOWNTIME_RECORDED" className="bg-[#0B0F14]">DOWNTIME_RECORDED</option>
            </select>
          </div>

          <button
            onClick={fetchEvents}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#17202A] hover:bg-[#1F2C3A] text-white font-bold rounded-lg border border-white/10"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>SYNC</span>
          </button>
        </div>
      </div>

      {/* Events Table */}
      <div className="milled-panel rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#070A0E] text-[#7A8A9E] uppercase tracking-widest text-[10px] border-b border-white/10">
              <tr>
                <th className="p-3 w-8"></th>
                <th className="p-3">Event Type</th>
                <th className="p-3">Event Time (UTC)</th>
                <th className="p-3">Source Channel</th>
                <th className="p-3">Work Center</th>
                <th className="p-3">Batch / Job</th>
                <th className="p-3">Disposition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-[#F0F4F8]">
              {events.length > 0 ? (
                events.map((ev) => {
                  const isExpanded = expandedRow === ev.id;
                  const isManual = ev.source_type === 'MANUAL_UI';

                  return (
                    <React.Fragment key={ev.id}>
                      <tr 
                        onClick={() => setExpandedRow(isExpanded ? null : ev.id)}
                        className="hover:bg-white/5 cursor-pointer transition-colors"
                      >
                        <td className="p-3 text-[#7A8A9E]">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </td>
                        <td className="p-3 font-bold text-[#00C2FF]">{ev.event_type}</td>
                        <td className="p-3 text-[#7A8A9E]">{new Date(ev.event_time).toISOString()}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isManual 
                              ? 'bg-[#182330] text-[#7A8A9E] border border-white/10' 
                              : 'bg-[#00E699]/15 text-[#00E699] border border-[#00E699]/30'
                          }`}>
                            {ev.source_type}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-white">{ev.work_center_id}</td>
                        <td className="p-3 text-[#7A8A9E]">{ev.batch_id || '-'}</td>
                        <td className="p-3 text-[#00E699] flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Committed</span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-[#070A0E] border-b border-white/10">
                          <td colSpan={7} className="p-4 space-y-2">
                            <div className="flex justify-between text-[11px] text-[#7A8A9E]">
                              <span>UUID: <strong className="text-white">{ev.event_id}</strong></span>
                              <span>Source: <strong className="text-white">{ev.source_id}</strong></span>
                              <span>Operator: <strong className="text-white">{ev.operator_id || 'FUJI_NEXIM_SOCKET'}</strong></span>
                            </div>
                            <pre className="bg-[#0A0E13] p-3 rounded border border-white/10 text-[11px] text-[#00E699] overflow-x-auto">
                              {JSON.stringify(typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-[#7A8A9E]">
                    {loading ? 'READING CANONICAL LOG...' : 'ZERO EVENTS MATCHING CURRENT FILTER'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
