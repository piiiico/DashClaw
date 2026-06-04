import { useState, useEffect, useRef } from 'react';
import { MoreHorizontal, Eye, Archive, Reply, Copy, FileType } from 'lucide-react';
import { copyToClipboard, stripMarkdown } from './helpers';

export default function MessageActionMenu({ message, onMarkRead, onArchive, onReply }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClose(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    function handleEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClose);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClose);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  async function handleCopy(mode) {
    const text = mode === 'markdown' ? message.body : stripMarkdown(message.body);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(mode);
      setTimeout(() => { setCopied(null); setOpen(false); }, 1000);
    }
  }

  const items = [];
  if (!message.is_read && message.status === 'sent' && onMarkRead) {
    items.push({ icon: Eye, label: 'Mark Read', onClick: () => { onMarkRead(message.id); setOpen(false); } });
  }
  if (!message.is_read && message.status === 'sent' && onArchive) {
    items.push({ icon: Archive, label: 'Archive', onClick: () => { onArchive(message.id); setOpen(false); } });
  }
  if (onReply) {
    items.push({ icon: Reply, label: 'Reply', onClick: () => { onReply(message); setOpen(false); } });
  }
  items.push({ icon: Copy, label: copied === 'markdown' ? 'Copied!' : 'Copy Markdown', onClick: () => handleCopy('markdown') });
  items.push({ icon: FileType, label: copied === 'plain' ? 'Copied!' : 'Copy Plain Text', onClick: () => handleCopy('plain') });

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-tertiary hover:text-secondary hover:bg-white/[0.06]"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[160px] py-1 rounded-md bg-surface-secondary border border-white/[0.08] shadow-lg">
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); item.onClick(); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-secondary hover:bg-white/[0.06] transition-colors"
              >
                <Icon size={12} className="text-secondary" /> {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
