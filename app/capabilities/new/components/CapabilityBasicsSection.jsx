const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const REGISTRY_SOURCE_TYPES = ['internal_sdk', 'webhook', 'human_approval', 'external_marketplace'];

function Label({ htmlFor, children }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">
      {children}
    </label>
  );
}

export default function CapabilityBasicsSection({ form, mode, onChange }) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="capability-name">Name <span className="text-error">*</span></Label>
        <input
          id="capability-name"
          aria-label="Name"
          type="text"
          value={form.name}
          onChange={(event) => onChange('name', event.target.value)}
          className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
          placeholder="Send Slack Message"
        />
      </div>

      <div>
        <Label htmlFor="capability-description">Description</Label>
        <textarea
          id="capability-description"
          aria-label="Description"
          value={form.description}
          onChange={(event) => onChange('description', event.target.value)}
          rows={2}
          className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
          placeholder="Posts a governed message to a Slack channel"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="capability-category">Category</Label>
          <input
            id="capability-category"
            aria-label="Category"
            type="text"
            value={form.category}
            onChange={(event) => onChange('category', event.target.value)}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
            placeholder="messaging"
          />
        </div>

        <div>
          <Label htmlFor="capability-risk-level">Risk level</Label>
          <select
            id="capability-risk-level"
            aria-label="Risk level"
            value={form.risk_level}
            onChange={(event) => onChange('risk_level', event.target.value)}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
          >
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="capability-source-type">Source type</Label>
          {mode === 'runnable_http' ? (
            <input
              id="capability-source-type"
              aria-label="Source type"
              type="text"
              value="http_api"
              disabled
              className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-secondary"
            />
          ) : (
            <select
              id="capability-source-type"
              aria-label="Source type"
              value={form.source_type}
              onChange={(event) => onChange('source_type', event.target.value)}
              className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
            >
              {REGISTRY_SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <Label htmlFor="capability-health-status">Health status</Label>
          <select
            id="capability-health-status"
            aria-label="Health status"
            value={form.health_status}
            onChange={(event) => onChange('health_status', event.target.value)}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
          >
            <option value="unknown">unknown</option>
            <option value="untested">untested</option>
            <option value="healthy">healthy</option>
            <option value="degraded">degraded</option>
            <option value="failing">failing</option>
            <option value="unhealthy">unhealthy</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="capability-tags">Tags</Label>
          <input
            id="capability-tags"
            aria-label="Tags"
            type="text"
            value={form.tags}
            onChange={(event) => onChange('tags', event.target.value)}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
            placeholder="notify, slack, messaging"
          />
        </div>

        <div>
          <Label htmlFor="capability-docs-url">Docs URL</Label>
          <input
            id="capability-docs-url"
            aria-label="Docs URL"
            type="url"
            value={form.docs_url}
            onChange={(event) => onChange('docs_url', event.target.value)}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
            placeholder="https://docs.example.com/slack"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
        <input
          aria-label="Requires approval"
          type="checkbox"
          checked={form.requires_approval}
          onChange={(event) => onChange('requires_approval', event.target.checked)}
          className="rounded border-white/20 bg-surface-tertiary"
        />
        Requires approval
      </label>
    </div>
  );
}

