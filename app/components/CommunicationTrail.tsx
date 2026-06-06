'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';

interface CommunicationTrailProps {
  actionId?: string;
  actingAgentId?: string;
}

function timeLabel(dateStr: any) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function CommunicationTrail({ actionId, actingAgentId }: CommunicationTrailProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [correlation, setCorrelation] = useState('none');
  const [threadName, setThreadName] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!actionId) return;

    async function fetchMessages() {
      try {
        const res = await fetch(`/api/actions/${actionId}/messages`);
        if (!res.ok) return;
        const data = await res.json();
        const msgs = data.messages || [];
        setMessages(msgs);
        setCorrelation(data.correlation || 'none');

        // Look up thread name if any message has a thread_id
        const firstThreadId = msgs.find((m: any) => m.thread_id)?.thread_id;
        if (firstThreadId) {
          try {
            const tRes = await fetch(`/api/messages/threads`);
            if (tRes.ok) {
              const tData = await tRes.json();
              const thread = (tData.threads || []).find((t: any) => t.id === firstThreadId);
              if (thread?.name) setThreadName(thread.name);
            }
          } catch {
            // ignore thread fetch failure
          }
        }
      } catch {
        // ignore fetch failure
      } finally {
        setLoading(false);
      }
    }

    fetchMessages();
  }, [actionId]);

  if (loading) return null;
  if (messages.length === 0) return null;

  return (
    <div className="my-6">
      {/* Header */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center gap-2 text-left group"
        aria-expanded={expanded}
      >
        <span className="text-tertiary group-hover:text-secondary transition-colors">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <MessageSquare size={14} className="text-tertiary group-hover:text-secondary transition-colors" />
        <span className="text-[11px] font-bold text-tertiary group-hover:text-secondary uppercase tracking-[0.18em] transition-colors">
          Communication Trail ({messages.length})
        </span>
        {correlation === 'time_window' && (
          <span className="ml-1 text-[9px] font-bold text-warning/80 uppercase tracking-widest border border-warning/20 bg-warning-subtle rounded px-1.5 py-0.5">
            inferred from timing
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-1">
          {threadName && (
            <div className="text-[10px] text-tertiary font-medium px-1 mb-2">
              Thread: <span className="text-secondary">{threadName}</span>
            </div>
          )}

          <div className="space-y-2">
            {messages.map((msg) => {
              const isActing = msg.from_agent_id === actingAgentId;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isActing ? 'items-end' : 'items-start'}`}
                >
                  {/* Sender label */}
                  <span className="text-[9px] font-mono text-disabled mb-0.5 px-1">
                    {msg.from_agent_id || 'unknown'}
                  </span>

                  {/* Bubble */}
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                      isActing
                        ? 'bg-brand/10 text-brand border border-brand/20'
                        : 'bg-white/5 text-foreground border border-white/[0.06]'
                    }`}
                  >
                    {msg.body || msg.subject || '(empty)'}
                  </div>

                  {/* Timestamp */}
                  <span className="text-[9px] font-mono text-zinc-700 mt-0.5 px-1">
                    {timeLabel(msg.created_at)}
                    {msg.match_type === 'time_window' && (
                      <span className="ml-1 text-amber-600">(inferred)</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
