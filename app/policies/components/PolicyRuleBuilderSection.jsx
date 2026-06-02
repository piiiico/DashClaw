const inputClass = 'w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand';
const selectClass = 'w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand';

const DECISION_ACTIONS = [
  { value: 'block', label: 'Block' },
  { value: 'warn', label: 'Warn' },
  { value: 'require_approval', label: 'Require Approval' },
];

// Test-status ladder enforced by the green_contract guard (app/lib/guard.js).
const GREEN_LEVELS = [
  { value: 'targeted', label: 'Targeted' },
  { value: 'package', label: 'Package' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'merge_ready', label: 'Merge-ready' },
];

// Branch states the branch_freshness guard can trigger on.
const FRESHNESS_OPTIONS = ['stale', 'diverged'];

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

  const toggleFreshness = (state) => {
    const current = Array.isArray(form.freshness) ? form.freshness : [];
    onChange(
      'freshness',
      current.includes(state)
        ? current.filter((value) => value !== state)
        : [...current, state]
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

      {form.type === 'behavioral_anomaly' && (
        <div className="space-y-4">
          <p className="text-[11px] text-tertiary">
            Compares each action against the agent&apos;s recent history using embedding similarity.
            Requires embeddings — set <code className="text-secondary">OPENAI_API_KEY</code>. The policy
            stays dormant until the agent has at least the baseline number of recorded actions.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-secondary mb-1">Similarity threshold (0&ndash;1)</label>
              <input
                aria-label="Similarity threshold"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={form.similarityThreshold}
                onChange={(event) => {
                  const value = event.target.value === ''
                    ? ''
                    : Math.max(0, Math.min(1, parseFloat(event.target.value) || 0));
                  onChange('similarityThreshold', value);
                }}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Baseline samples</label>
              <input
                aria-label="Baseline samples"
                type="number"
                min="1"
                value={form.minHistory}
                onChange={(event) => onChange('minHistory', parseInt(event.target.value, 10) || 1)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">On anomaly</label>
              <select
                aria-label="Behavioral anomaly action"
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
        </div>
      )}

      {form.type === 'permission_escalation' && (
        <div className="space-y-4">
          <p className="text-[11px] text-tertiary">
            Compares the permission a tool requires against the agent&apos;s approved pairing level.
            The policy is inert until enforcement is turned on.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                aria-label="Enforce permission escalation"
                type="checkbox"
                checked={!!form.enforce}
                onChange={(event) => onChange('enforce', event.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              Enforce this policy
            </label>
            <div>
              <label className="block text-xs text-secondary mb-1">On escalation</label>
              <select
                aria-label="Permission escalation action"
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
        </div>
      )}

      {form.type === 'green_contract' && (
        <div className="space-y-4">
          <p className="text-[11px] text-tertiary">
            Gates the selected actions until the agent reports a test status at or above the required
            level. A missing test status fails the contract.
          </p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-secondary mb-1">Required green level</label>
              <select
                aria-label="Required green level"
                value={form.requiredLevel}
                onChange={(event) => onChange('requiredLevel', event.target.value)}
                className={selectClass}
              >
                {GREEN_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>{level.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">On violation</label>
              <select
                aria-label="Green contract action"
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
        </div>
      )}

      {form.type === 'branch_freshness' && (
        <div className="space-y-4">
          <p className="text-[11px] text-tertiary">
            Blocks the selected actions when the agent&apos;s working branch is in one of the chosen
            states and is too many commits behind its base.
          </p>
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
          <div>
            <label className="block text-xs text-secondary mb-2">Trigger when branch is</label>
            <div className="flex flex-wrap gap-2">
              {FRESHNESS_OPTIONS.map((state) => (
                <button
                  key={state}
                  type="button"
                  aria-pressed={(form.freshness || []).includes(state)}
                  onClick={() => toggleFreshness(state)}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                    (form.freshness || []).includes(state)
                      ? 'bg-brand text-white'
                      : 'bg-[#1a1a1a] text-secondary border border-[rgba(255,255,255,0.06)] hover:text-white'
                  }`}
                >
                  {state}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-secondary mb-1">Max commits behind</label>
              <input
                aria-label="Max commits behind"
                type="number"
                min="0"
                value={form.maxCommitsBehind}
                onChange={(event) => onChange('maxCommitsBehind', parseInt(event.target.value, 10) || 0)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">On violation</label>
              <select
                aria-label="Branch freshness action"
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
        </div>
      )}
    </>
  );
}
