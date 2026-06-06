'use client';

import { useState } from 'react';

interface DocsCodeTabsProps {
  nodeSnippet?: React.ReactNode;
  pythonSnippet?: React.ReactNode;
  nodeTitle?: React.ReactNode;
  pythonTitle?: React.ReactNode;
}

export default function DocsCodeTabs({
  nodeSnippet,
  pythonSnippet,
  nodeTitle = 'Node.js',
  pythonTitle = 'Python',
}: DocsCodeTabsProps) {
  const [activeTab, setActiveTab] = useState('node');

  return (
    <div className="rounded-xl bg-surface-secondary border border-border overflow-hidden">
      <div className="flex border-b border-border bg-surface-primary">
        <button
          onClick={() => setActiveTab('node')}
          className={`px-4 py-2 text-xs font-mono transition-colors ${
            activeTab === 'node'
              ? 'text-brand border-b border-brand bg-brand-subtle'
              : 'text-text-tertiary hover:text-text-primary'
          }`}
        >
          {nodeTitle}
        </button>
        <button
          onClick={() => setActiveTab('python')}
          className={`px-4 py-2 text-xs font-mono transition-colors ${
            activeTab === 'python'
              ? 'text-brand border-b border-brand bg-brand-subtle'
              : 'text-text-tertiary hover:text-text-primary'
          }`}
        >
          {pythonTitle}
        </button>
      </div>
      <div className="p-5 overflow-x-auto">
        <pre className="font-mono text-sm leading-relaxed text-text-secondary">
          {activeTab === 'node' ? nodeSnippet : pythonSnippet}
        </pre>
      </div>
    </div>
  );
}
