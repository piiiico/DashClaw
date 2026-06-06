'use client';

import { useState } from 'react';

interface WorkflowVariableOption {
  label: string;
  token: string;
}

interface WorkflowVariableGroup {
  label: string;
  options?: WorkflowVariableOption[];
}

interface WorkflowVariableInsertButtonProps {
  variableGroups?: WorkflowVariableGroup[];
  onInsert?: (token: string) => void;
}

export default function WorkflowVariableInsertButton({ variableGroups = [], onInsert }: WorkflowVariableInsertButtonProps) {
  const [open, setOpen] = useState(false);

  if (!Array.isArray(variableGroups) || variableGroups.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="px-2.5 py-1 rounded-lg bg-white/5 text-xs text-secondary hover:bg-white/10 transition-colors"
        aria-expanded={open ? 'true' : 'false'}
        aria-haspopup="menu"
      >
        Insert variable
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-white/10 bg-surface-secondary shadow-2xl p-3 space-y-3">
          {variableGroups.map((group) => (
            <div key={group.label} className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-tertiary">{group.label}</div>
              <div className="space-y-1">
                {(group.options || []).map((option) => (
                  <button
                    key={`${group.label}-${option.token}`}
                    type="button"
                    onClick={() => {
                      onInsert?.(option.token);
                      setOpen(false);
                    }}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10 transition-colors"
                  >
                    <div className="text-xs text-white">{option.label}</div>
                    <div className="mt-1 text-[11px] text-tertiary font-mono break-all">{option.token}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
