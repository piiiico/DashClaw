'use client';

import { useState } from 'react';
import { Terminal, Check } from 'lucide-react';
import { generateConnectPrompt, generateCoveragePrompt } from '../lib/connectPrompt';

interface ConnectAgentButtonProps {
  className?: string;
  label?: string;
  promptType?: string;
}

export default function ConnectAgentButton({
  className = '',
  label = 'Copy Agent Prompt',
  promptType = 'connect',
}: ConnectAgentButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      const baseUrl = window.location.origin;
      let orgName = 'My Workspace';
      try {
        const res = await fetch('/api/team');
        if (res.ok) {
          const data = await res.json();
          orgName = data.org?.name || data.name || orgName;
        }
      } catch {
        // Fall back to default name
      }
      const prompt = promptType === 'coverage'
        ? generateCoveragePrompt(baseUrl, orgName)
        : generateConnectPrompt(baseUrl, orgName);
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-3 py-2 bg-surface-tertiary border border-border rounded-lg text-sm text-secondary hover:text-white hover:border-border-hover transition-colors ${className}`}
    >
      {copied ? <Check size={14} className="text-success" /> : <Terminal size={14} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}
