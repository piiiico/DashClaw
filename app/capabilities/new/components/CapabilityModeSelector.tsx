interface CapabilityModeSelectorProps {
  mode: string;
  onChange: (mode: string) => void;
}

export default function CapabilityModeSelector({ mode, onChange }: CapabilityModeSelectorProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-secondary">
        Capability Mode
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={`rounded-xl border p-4 ${mode === 'registry_only' ? 'border-brand bg-brand/10' : 'border-white/10 bg-surface-tertiary'}`}>
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="capability_mode"
              value="registry_only"
              checked={mode === 'registry_only'}
              onChange={() => onChange('registry_only')}
              className="mt-1"
            />
            <div className="space-y-1">
              <div className="text-sm font-medium text-white">Registry entry only</div>
              <p className="text-sm text-secondary">
                Track a tool in the registry without making it runnable in DashClaw runtime yet.
              </p>
            </div>
          </div>
        </label>

        <label className={`rounded-xl border p-4 ${mode === 'runnable_http' ? 'border-brand bg-brand/10' : 'border-white/10 bg-surface-tertiary'}`}>
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="capability_mode"
              value="runnable_http"
              checked={mode === 'runnable_http'}
              onChange={() => onChange('runnable_http')}
              className="mt-1"
            />
            <div className="space-y-1">
              <div className="text-sm font-medium text-white">Runnable HTTP capability</div>
              <p className="text-sm text-secondary">
                Configure an external HTTP tool DashClaw can test and invoke through governance.
              </p>
            </div>
          </div>
        </label>
      </div>
      <p className="text-sm text-tertiary">
        Only HTTP capabilities are runnable in this version.
      </p>
    </div>
  );
}
