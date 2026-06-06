'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyableCodeBlockProps {
  title?: React.ReactNode;
  children?: React.ReactNode;
  copyText?: string;
}

export default function CopyableCodeBlock({ title, children, copyText }: CopyableCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = copyText ?? (typeof children === 'string' ? children : '');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative group rounded-xl bg-surface-tertiary border border-border overflow-x-auto">
      {title && (
        <div className="px-5 py-2.5 border-b border-border text-xs text-tertiary font-mono">{title}</div>
      )}
      <pre className="p-5 font-mono text-sm leading-relaxed text-secondary whitespace-pre-wrap">{children}</pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-surface-tertiary hover:bg-surface-elevated opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy"
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} className="text-secondary" />}
      </button>
    </div>
  );
}
