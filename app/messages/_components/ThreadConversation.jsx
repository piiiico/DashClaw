import { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Send, MessageSquare, AlertCircle, Copy, Paperclip, X } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { getAgentColor } from '../../lib/colors';
import { isDemoMode } from '../../lib/isDemoMode';
import { timeAgo, TYPE_VARIANTS, copyToClipboard, formatDateGroup } from './helpers';
import MarkdownBody from './MarkdownBody';
import AttachmentChips from './AttachmentChips';

export default function ThreadConversation({ thread, filterAgentId, onNewMessage, fullWidth }) {
  const isDemo = isDemoMode();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [replyAttachments, setReplyAttachments] = useState([]);
  const replyFileRef = useRef(null);
  const bottomRef = useRef(null);
  const containerRef = useRef(null);

  const participants = (() => {
    try {
      const p = JSON.parse(thread.participants || '[]');
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  })();

  const fetchThreadMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        thread_id: thread.id,
        direction: 'all',
        limit: '100',
      });
      if (filterAgentId) params.set('agent_id', filterAgentId);
      const res = await fetch(`/api/messages?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      // Show chronological (oldest first)
      const sorted = (data.messages || []).slice().sort(
        (a, b) => (a.created_at || '').localeCompare(b.created_at || '')
      );
      setMessages(sorted);
    } catch {
      // Silently fail, will retry on poll
    } finally {
      setLoading(false);
    }
  }, [thread.id, filterAgentId]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    fetchThreadMessages();
  }, [fetchThreadMessages]);

  // Polling fallback
  useEffect(() => {
    const interval = setInterval(fetchThreadMessages, 15000);
    return () => clearInterval(interval);
  }, [fetchThreadMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Handle incoming SSE messages
  const addMessage = useCallback((msg) => {
    if (msg.thread_id !== thread.id) return;
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, [thread.id]);

  // Expose addMessage for parent to call on SSE events
  useEffect(() => {
    if (onNewMessage) {
      onNewMessage.current = addMessage;
    }
  }, [addMessage, onNewMessage]);

  async function addReplyFiles(files) {
    const ALLOWED = ['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain','text/markdown','text/csv','application/json'];
    const MAX_SIZE = 5 * 1024 * 1024;
    const remaining = 3 - replyAttachments.length;
    const toAdd = Array.from(files).slice(0, remaining);
    for (const file of toAdd) {
      if (!ALLOWED.includes(file.type) || file.size > MAX_SIZE) continue;
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      setReplyAttachments(prev => [...prev, { filename: file.name, mime_type: file.type, data, size: file.size }]);
    }
  }

  async function handleSendReply() {
    if (!replyBody.trim() || isDemo) return;
    setSending(true);
    try {
      const payload = {
        from_agent_id: filterAgentId || 'dashboard',
        body: replyBody,
        message_type: 'info',
        thread_id: thread.id,
      };
      if (replyAttachments.length > 0) {
        payload.attachments = replyAttachments.map(a => ({
          filename: a.filename, mime_type: a.mime_type, data: a.data,
        }));
      }

      // Optimistic update
      const optimistic = {
        id: `temp_${Date.now()}`,
        ...payload,
        created_at: new Date().toISOString(),
        status: 'sent',
        _optimistic: true,
      };
      delete optimistic.attachments;
      setMessages(prev => [...prev, optimistic]);
      setReplyBody('');
      setReplyAttachments([]);

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setMessages(prev => prev.filter(m => m.id !== optimistic.id));
        return;
      }

      fetchThreadMessages();
    } catch {
      setMessages(prev => prev.filter(m => !m._optimistic));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="border-b border-[rgba(255,255,255,0.06)] pb-3 mb-3">
        <div className="flex items-center gap-2 mb-1">
          <Hash size={14} className="text-secondary" />
          <span className="text-sm font-semibold text-white">{thread.name}</span>
          <Badge variant={thread.status === 'open' ? 'success' : 'default'} size="xs">
            {thread.status}
          </Badge>
          <span className="text-xs text-tertiary">{thread.message_count || messages.length} messages</span>
        </div>
        {participants.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {participants.map(p => (
              <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-secondary">
                {p}
              </span>
            ))}
          </div>
        )}
        {thread.summary && (
          <div className="text-xs text-tertiary mt-1">{thread.summary}</div>
        )}
      </div>

      {/* Messages timeline */}
      <div ref={containerRef} className={`flex-1 overflow-y-auto space-y-3 min-h-0 pr-1 ${fullWidth ? 'max-h-[calc(100vh-340px)]' : 'max-h-[500px]'}`}>
        {loading ? (
          <div className="text-center text-tertiary py-8 text-sm">Loading conversation...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-tertiary py-8 text-sm">No messages in this thread yet.</div>
        ) : (
          messages.map((msg, idx) => {
            const fromAgentId = msg.from_agent_id || msg.sender_id || 'unknown';
            const messageType = msg.message_type || msg.type || 'info';
            const body = msg.body ?? msg.content ?? '';
            const agentColor = getAgentColor(fromAgentId);
            const isDashboard = fromAgentId === 'dashboard' || fromAgentId === (filterAgentId || 'dashboard');
            const prevDate = idx > 0 ? formatDateGroup(messages[idx - 1].created_at) : null;
            const curDate = formatDateGroup(msg.created_at);
            const showDateSep = curDate && curDate !== prevDate;
            return (
              <div key={msg.id}>
                {showDateSep && (
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex-1 h-px bg-[rgba(255,255,255,0.06)]" />
                    <span className="text-xs text-tertiary font-medium">{curDate}</span>
                    <div className="flex-1 h-px bg-[rgba(255,255,255,0.06)]" />
                  </div>
                )}
                <div className={`group flex gap-2 ${isDashboard ? 'flex-row-reverse' : ''}`}>
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 border ${agentColor}`}
                  >
                    <MessageSquare size={12} />
                  </div>
                  <div className={`flex-1 min-w-0 ${fullWidth ? 'max-w-[75%]' : 'max-w-[85%]'} ${isDashboard ? 'text-right' : ''}`}>
                    <div className={`flex items-center gap-1.5 mb-0.5 ${isDashboard ? 'justify-end' : ''}`}>
                      <span className="text-xs font-medium text-secondary">{fromAgentId}</span>
                      <Badge variant={TYPE_VARIANTS[messageType] || 'default'} size="xs">
                        {messageType}
                      </Badge>
                      {msg.urgent && <AlertCircle size={10} className="text-error" />}
                      <span className="text-xs text-disabled">{timeAgo(msg.created_at)}</span>
                    </div>
                    <div className={`relative rounded-lg p-2.5 ${
                      isDashboard
                        ? 'bg-brand/10 border border-brand/20'
                        : 'bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)]'
                    } ${msg._optimistic ? 'opacity-60' : ''}`}>
                      <MarkdownBody content={body} />
                      <AttachmentChips attachments={msg.attachments} compact />
                      {!msg._optimistic && (
                        <button
                          onClick={async () => {
                            const ok = await copyToClipboard(body);
                            if (ok) { setCopiedId(msg.id); setTimeout(() => setCopiedId(null), 2000); }
                          }}
                          className={`absolute top-1.5 ${isDashboard ? 'left-1.5' : 'right-1.5'} opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-[rgba(0,0,0,0.3)] text-secondary hover:text-secondary`}
                          title="Copy message"
                        >
                          <Copy size={10} />
                        </button>
                      )}
                      {copiedId === msg.id && (
                        <span className={`absolute top-1.5 ${isDashboard ? 'left-8' : 'right-8'} text-xs text-success`}>
                          Copied!
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {thread.status === 'resolved' && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-success-subtle border border-success/20 text-success text-xs">
            Thread resolved
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply bar */}
      <div className="border-t border-[rgba(255,255,255,0.06)] pt-3 mt-3">
        {isDemo ? (
          <div className="text-xs text-tertiary text-center py-2">Reply is disabled in demo mode</div>
        ) : (
          <div>
            <div className="flex gap-2">
              <textarea
                value={replyBody}
                onChange={e => setReplyBody(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
                placeholder="Reply to thread..."
                maxLength={2000}
                rows={2}
                className="flex-1 px-3 py-2 text-sm bg-surface-primary border border-[rgba(255,255,255,0.06)] rounded-md text-secondary placeholder:text-disabled resize-none"
              />
              <div className="flex flex-col gap-1 self-end">
                <button
                  onClick={() => replyFileRef.current?.click()}
                  disabled={replyAttachments.length >= 3}
                  className="px-2 py-2 rounded-md bg-[rgba(255,255,255,0.06)] text-secondary hover:text-secondary disabled:opacity-40 transition-colors"
                  title="Attach file"
                >
                  <Paperclip size={14} />
                </button>
                <input
                  ref={replyFileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => { if (e.target.files.length) addReplyFiles(e.target.files); e.target.value = ''; }}
                />
                <button
                  onClick={handleSendReply}
                  disabled={!replyBody.trim() || sending}
                  className="px-2 py-2 rounded-md bg-brand text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
            {replyAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {replyAttachments.map((att, idx) => (
                  <span key={idx} className="flex items-center gap-1 px-2 py-0.5 rounded bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] text-xs text-secondary">
                    <Paperclip size={9} className="text-secondary" />
                    <span className="truncate max-w-[80px]">{att.filename}</span>
                    <button onClick={() => setReplyAttachments(prev => prev.filter((_, i) => i !== idx))} className="text-tertiary hover:text-error">
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
