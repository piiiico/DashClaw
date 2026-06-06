'use client';

import { useState } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';

interface InlineCopyCommandProps {
  command?: string;
  className?: string;
  highlight?: boolean;
}

export default function InlineCopyCommand({ command = '', className = "", highlight = false }: InlineCopyCommandProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const baseStyles = "group/term relative flex max-w-full items-center gap-2.5 px-3 py-1.5 rounded-full transition-all active:scale-[0.98] border font-mono text-[11px] sm:text-[13px] whitespace-nowrap overflow-hidden text-ellipsis";
  const themeStyles = highlight
    ? "bg-brand/5 border-brand/30 text-brand shadow-[0_0_15px_rgba(249,115,22,0.1)] hover:bg-brand/10"
    : "bg-secondary/50 border-zinc-800 hover:border-zinc-700 text-secondary hover:text-secondary";

  return (
    <button
      onClick={handleCopy}
      className={`${baseStyles} ${themeStyles} ${className}`}
      title={`Click to copy: ${command}`}
    >
      <Terminal size={12} className={highlight ? "text-brand" : "text-disabled group-hover/term:text-secondary"} />
      <span>{command}</span>
      <div className="ml-1 pl-2 border-l border-white/5">
        {copied ? (
          <Check size={12} className="text-success" />
        ) : (
          <Copy size={12} className="opacity-0 group-hover/term:opacity-100 transition-opacity" />
        )}
      </div>
    </button>
  );
}
