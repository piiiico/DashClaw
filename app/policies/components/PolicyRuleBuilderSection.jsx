const inputClass = 'w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand';
const selectClass = 'w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand';

const DECISION_ACTIONS = [
  { value: 'block', label: 'Block' },
  { value: 'warn', label: 'Warn' },
  { value: 'require_approval', label: 'Require Approval' },
];

export default function PolicyRuleBuilderSection({
  form,
  actionOptions,
  onChange,
}) {
  const toggleActionType = (type) => {
    const current = Array.isArray(form.actionTypes) ? form.actionTypes : [];
    onChange(
      'actionTypes',
      current.includes(type)
        ? current.filter((value) => value !== type)
        : [...current, type]
    );
  };

  return (
    <>
      {form.type === 'risk_threshold' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-secondary mb-1">Risk Threshold (0-100)</label>
            <input
              aria-label="Risk Threshold"
              type="number"
              min="0"
              max="100"
              value={form.threshold}
              onChange={(event) => {
                const value = event.target.value === ''
                  ? ''
                  : Math.max(0, Math.min(100, parseInt(event.target.value, 10) || 0));
                onChange('threshold', value);
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Action</label>
            <select
              aria-label="Action"
              value={form.action}
              onChange={(event) => onChange('action', event.target.value)}
              className={selectClass}
            >
              {DECISION_ACTIONS.map((action) => (
                <option key={action.value} value={action.value}>{action.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {(form.type === 'require_approval' || form.type === 'block_action_type') && (
        <div>
          <label className="block text-xs text-secondary mb-2">Action Types</label>
          <div className="flex flex-wrap gap-2">
            {actionOptions.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={form.actionTypes.includes(type)}
                onClick={() => toggleActionType(type)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  form.actionTypes.includes(type)
                    ? 'bg-brand text-white'
                    : 'bg-[#1a1a1a] text-secondary border border-[rgba(255,255,255,0.06)] hover:text-white'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      )}

      {form.type === 'rate_limit' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-secondary mb-1">Max Actions</label>
            <input
              aria-label="Max Actions"
              type="number"
              min="1"
              value={form.maxActions}
              onChange={(event) => onChange('maxActions', parseInt(event.target.value, 10) || 1)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Window (minutes)</label>
            <input
              aria-label="Window Minutes"
              type="number"
              min="1"
              value={form.windowMinutes}
              onChange={(event) => onChange('windowMinutes', parseInt(event.target.value, 10) || 1)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Action</label>
            <select
              aria-label="Rate Limit Action"
              value={form.action}
              onChange={(event) => onChange('action', event.target.value)}
              className={selectClass}
            >
              {DECISION_ACTIONS.map((action) => (
                <option key={action.value} value={action.value}>{action.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {form.type === 'webhook_check' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-3">
            <label className="block text-xs text-secondary mb-1">Webhook URL (HTTPS required)</label>
            <input
              aria-label="Webhook URL"
              type="url"
              value={form.webhookUrl}
              onChange={(event) => onChange('webhookUrl', event.target.value)}
              placeholder="https://your-api.example.com/guard"
              required
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Timeout (ms)</label>
            <input
              aria-label="Webhook Timeout"
              type="number"
              min="1000"
              max="10000"
              step="500"
              value={form.webhookTimeout}
              onChange={(event) => onChange('webhookTimeout', parseInt(event.target.value, 10) || 5000)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">On Timeout</label>
            <select
              aria-label="Webhook On Timeout"
              value={form.webhookOnTimeout}
              onChange={(event) => onChange('webhookOnTimeout', event.target.value)}
              className={selectClass}
            >
              <option value="allow">Allow (fail-open)</option>
              <option value="block">Block (fail-closed)</option>
            </select>
          </div>
        </div>
      )}

      {form.type === 'semantic_check' && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-secondary mb-1">Instruction (Natural Language)</label>
            <textarea
              aria-label="Instruction"
              value={form.instruction}
              onChange={(event) => onChange('instruction', event.target.value)}
              placeholder="e.g. Do not allow the agent to delete files in the /system directory."
              required
              rows={3}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Fallback Action (if LLM is unavailable)</label>
            <select
              aria-label="Fallback Action"
              value={form.fallback}
              onChange={(event) => onChange('fallback', event.target.value)}
              className={selectClass}
            >
              <option value="allow">Allow (Fail Open - Recommended)</option>
              <option value="block">Block (Fail Closed)</option>
            </select>
            <p className="text-[10px] text-tertiary mt-1">
              To enable this, set <code className="text-secondary">GUARD_LLM_KEY</code> (or OPENAI_API_KEY) in your environment variables.
            </p>
          </div>
        </div>
      )}

      {form.type === 'non_fabrication' && (
        <div className="space-y-4">
          <p className="text-[11px] text-tertiary">
            Verifies the action&apos;s outbound content against a source-of-truth: every amount, date,
            percentage, and registered ID must trace to an allowed fact, and no forbidden pattern may
            appear. Attach <code className="text-secondary">content</code> and{' '}
            <code className="text-secondary">source_of_truth</code> to the action (SDK:{' '}
            <code className="text-secondary">content</code> + <code className="text-secondary">sourceOfTruth</code>).
            Fail-closed: a missing or malformed source-of-truth blocks.
          </p>
          <div>
            <label className="block text-xs text-secondary mb-2">
              Action Types <span className="text-tertiary">(optional — leave empty to apply to all)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {actionOptions.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={form.actionTypes.includes(type)}
                  onClick={() => toggleActionType(type)}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                    form.actionTypes.includes(type)
                      ? 'bg-brand text-white'
                      : 'bg-[#1a1a1a] text-secondary border border-[rgba(255,255,255,0.06)] hover:text-white'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-secondary mb-1">On Violation</label>
              <select
                aria-label="On Violation"
                value={form.onViolation}
                onChange={(event) => onChange('onViolation', event.target.value)}
                className={selectClass}
              >
                <option value="block">Block (fail-closed)</option>
                <option value="require_approval">Require Approval</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Content field path</label>
              <input
                aria-label="Content field path"
                type="text"
                value={form.contentPath}
                onChange={(event) => onChange('contentPath', event.target.value)}
                placeholder="content"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Source-of-truth field path</label>
              <input
                aria-label="Source-of-truth field path"
                type="text"
                value={form.sourcePath}
                onChange={(event) => onChange('sourcePath', event.target.value)}
                placeholder="source_of_truth"
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
