const selectClass = 'w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-border-hover text-sm text-white focus:outline-none focus:border-brand';
const inputClass = 'w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-border-hover text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand';

interface PolicyTypeOption {
  value: string;
  label: string;
  desc?: string;
}

interface PolicyBasicsSectionProps {
  form: any;
  policyTypes: PolicyTypeOption[];
  onChange: (field: string, value: any) => void;
  typeLocked?: boolean;
}

export default function PolicyBasicsSection({
  form,
  policyTypes,
  onChange,
  typeLocked = false,
}: PolicyBasicsSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className="block text-xs text-secondary mb-1">Policy Name</label>
        <input
          aria-label="Policy Name"
          type="text"
          value={form.name}
          onChange={(event) => onChange('name', event.target.value)}
          placeholder="e.g. Block high-risk deploys"
          required
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs text-secondary mb-1">Policy Type</label>
        {typeLocked ? (
          <div className="text-sm text-secondary py-2">
            <span className="inline-flex rounded-md bg-white/[0.05] px-2.5 py-1 text-xs text-secondary">
              {(form.type || '').replace(/_/g, ' ')}
            </span>
            <span className="ml-2 text-xs text-tertiary">(type cannot be changed after creation)</span>
          </div>
        ) : (
          <>
            <select
              aria-label="Policy Type"
              value={form.type}
              onChange={(event) => onChange('type', event.target.value)}
              className={selectClass}
            >
              {policyTypes.map((policyType) => (
                <option key={policyType.value} value={policyType.value}>
                  {policyType.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-tertiary mt-1">
              {policyTypes.find((policyType) => policyType.value === form.type)?.desc}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
