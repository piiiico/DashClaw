// app/components/MessageTrail.js
'use client';

import { useState } from 'react';
import { MessageSquare, Link2, Link as LinkDashed, ChevronDown, ChevronRight } from 'lucide-react';

function MatchBadge({ type }: { type?: string }) {
  if (type === 'explicit') {
    return (
      <span title="Explicitly tagged by SDK" className="inline-flex items-center gap-1 text-[10px] text-success">
        <Link2 size={10} />
        linked
      </span>
    );
  }
  return (
    <span title="Inferred from timestamp proximity (±60s)" className="inline-flex items-center gap-1 text-[10px] text-tertiary">
      <LinkDashed size={10} />
      inferred
    </span>
  );
}

function MessageCard({ message, compact }: { message: any; compact?: boolean }) {
  const time = new Date(message.created_at).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border last:border-0">
      <MessageSquare size={14} className="text-info mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-secondary font-medium">{message.from_agent_id}</span>
          <span className="text-disabled">→</span>
          <span className="text-secondary">{message.to_agent_id || 'broadcast'}</span>
          <span className="text-disabled">·</span>
          <span className="text-tertiary">{time}</span>
          <MatchBadge type={message.match_type} />
        </div>
        <div className={`text-sm text-secondary mt-0.5 ${compact ? 'line-clamp-2' : ''}`}>
          {message.body}
        </div>
      </div>
    </div>
  );
}

interface MessageTrailProps {
  actionId?: string;
  summary?: any;
  compact?: boolean;
  defaultExpanded?: boolean;
}

/**
 * MessageTrail — displays messages correlated to an action.
 *
 * Props:
 *   actionId: string — the action_id to fetch messages for
 *   summary: { total, participants } — from the action detail response
 *   compact: boolean — if true, truncate message bodies to 2 lines (ledger mode)
 *   defaultExpanded: boolean — if true, start expanded (detail page mode)
 */
export default function MessageTrail({ actionId, summary, compact = true, defaultExpanded = false }: MessageTrailProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [messages, setMessages] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  if (!summary || summary.total === 0) return null;

  const handleToggle = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!messages) {
      setLoading(true);
      try {
        const res = await fetch(`/api/actions/${actionId}/messages`);
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
        }
      } catch (err) {
        console.error('Failed to fetch messages:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div>
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 text-xs text-tertiary uppercase tracking-wider hover:text-secondary transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Messages ({summary.total})
        {summary.participants?.length > 0 && (
          <span className="normal-case tracking-normal text-disabled">
            — {summary.participants.join(', ')}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-2 pl-1">
          {loading && <div className="text-xs text-tertiary">Loading messages...</div>}
          {messages && messages.map((msg: any) => (
            <MessageCard key={msg.id} message={msg} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * TimelineMessages — renders messages inline in a chronological timeline.
 * Used by the decision detail page.
 */
export function TimelineMessage({ message }: { message: any }) {
  const time = new Date(message.created_at).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  return (
    <div className="flex gap-3 py-3">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-info-subtle flex items-center justify-center flex-shrink-0">
          <MessageSquare size={14} className="text-info" />
        </div>
        <div className="w-px flex-1 bg-white/[0.06] mt-2" />
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex items-center gap-2 text-xs mb-1">
          <span className="text-tertiary">{time}</span>
          <span className="text-tertiary uppercase font-medium">Message</span>
          <span className="text-secondary">{message.from_agent_id}</span>
          <span className="text-disabled">→</span>
          <span className="text-secondary">{message.to_agent_id || 'broadcast'}</span>
          <MatchBadge type={message.match_type} />
        </div>
        <div className="text-sm text-secondary whitespace-pre-wrap">{message.body}</div>
      </div>
    </div>
  );
}
