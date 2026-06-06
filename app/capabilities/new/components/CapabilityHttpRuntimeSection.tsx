interface LabelProps {
  htmlFor?: string;
  children?: React.ReactNode;
}

function Label({ htmlFor, children }: LabelProps) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">
      {children}
    </label>
  );
}

const FIELD_TYPES = ['string', 'number', 'boolean'];

interface RuntimeInputField {
  label: string;
  key: string;
  type: string;
  required: boolean;
  helpText?: string;
  [key: string]: any;
}

interface CapabilityRuntime {
  endpoint: string;
  method: string;
  timeout_ms: number;
  auth: { type: string; token_setting: string; [key: string]: any };
  retry_policy?: {
    max_retries?: number;
    backoff?: string;
    base_delay_ms?: number;
    max_delay_ms?: number;
    [key: string]: any;
  };
  circuit_breaker?: {
    enabled?: boolean;
    consecutive_failures?: number;
    [key: string]: any;
  };
  inputFields: RuntimeInputField[];
  [key: string]: any;
}

interface CapabilityHttpRuntimeSectionProps {
  runtime: CapabilityRuntime;
  onRuntimeChange: (key: string, value: any) => void;
  onAddInputField: () => void;
  onUpdateInputField: (index: number, key: string, value: any) => void;
  onRemoveInputField: (index: number) => void;
}

export default function CapabilityHttpRuntimeSection({
  runtime,
  onRuntimeChange,
  onAddInputField,
  onUpdateInputField,
  onRemoveInputField,
}: CapabilityHttpRuntimeSectionProps) {
  return (
    <div className="space-y-5 rounded-xl border border-white/10 bg-surface-tertiary/40 p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="capability-endpoint-url">Endpoint URL</Label>
          <input
            id="capability-endpoint-url"
            aria-label="Endpoint URL"
            type="url"
            value={runtime.endpoint}
            onChange={(event) => onRuntimeChange('endpoint', event.target.value)}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
            placeholder="https://api.example.com/messages"
          />
        </div>

        <div>
          <Label htmlFor="capability-http-method">HTTP method</Label>
          <select
            id="capability-http-method"
            aria-label="HTTP method"
            value={runtime.method}
            onChange={(event) => onRuntimeChange('method', event.target.value)}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="capability-timeout-ms">Timeout (ms)</Label>
          <input
            id="capability-timeout-ms"
            aria-label="Timeout (ms)"
            type="number"
            min="1000"
            max="300000"
            step="1000"
            value={runtime.timeout_ms}
            onChange={(event) => onRuntimeChange('timeout_ms', Number(event.target.value))}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="capability-auth-mode">Auth mode</Label>
          <select
            id="capability-auth-mode"
            aria-label="Auth mode"
            value={runtime.auth.type}
            onChange={(event) => onRuntimeChange('auth.type', event.target.value)}
            className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
          >
            <option value="none">none</option>
            <option value="bearer">bearer</option>
            <option value="api_key">api_key</option>
          </select>
        </div>

        {runtime.auth.type !== 'none' ? (
          <div>
            <Label htmlFor="capability-token-setting-key">Token setting key</Label>
            <input
              id="capability-token-setting-key"
              aria-label="Token setting key"
              type="text"
              value={runtime.auth.token_setting}
              onChange={(event) => onRuntimeChange('auth.token_setting', event.target.value)}
              className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
              placeholder="SLACK_BOT_TOKEN"
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-secondary">Retry policy</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="capability-max-retries">Max retries</Label>
            <input
              id="capability-max-retries"
              aria-label="Max retries"
              type="number"
              min="0"
              max="5"
              step="1"
              value={runtime.retry_policy?.max_retries ?? 0}
              onChange={(event) => onRuntimeChange('retry_policy.max_retries', Number(event.target.value))}
              className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>

          {(runtime.retry_policy?.max_retries || 0) > 0 ? (
            <>
              <div>
                <Label htmlFor="capability-backoff">Backoff strategy</Label>
                <select
                  id="capability-backoff"
                  aria-label="Backoff strategy"
                  value={runtime.retry_policy?.backoff || 'none'}
                  onChange={(event) => onRuntimeChange('retry_policy.backoff', event.target.value)}
                  className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                >
                  <option value="none">none (immediate)</option>
                  <option value="fixed">fixed delay</option>
                  <option value="exponential">exponential backoff</option>
                </select>
              </div>

              {runtime.retry_policy?.backoff && runtime.retry_policy.backoff !== 'none' ? (
                <div>
                  <Label htmlFor="capability-base-delay">Base delay (ms)</Label>
                  <input
                    id="capability-base-delay"
                    aria-label="Base delay (ms)"
                    type="number"
                    min="100"
                    max="30000"
                    step="100"
                    value={runtime.retry_policy?.base_delay_ms ?? 1000}
                    onChange={(event) => onRuntimeChange('retry_policy.base_delay_ms', Number(event.target.value))}
                    className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                  />
                </div>
              ) : null}

              {runtime.retry_policy?.backoff === 'exponential' ? (
                <div>
                  <Label htmlFor="capability-max-delay">Max delay (ms)</Label>
                  <input
                    id="capability-max-delay"
                    aria-label="Max delay (ms)"
                    type="number"
                    min="100"
                    max="60000"
                    step="1000"
                    value={runtime.retry_policy?.max_delay_ms ?? 30000}
                    onChange={(event) => onRuntimeChange('retry_policy.max_delay_ms', Number(event.target.value))}
                    className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-secondary">Circuit breaker</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input
                aria-label="Enable circuit breaker"
                type="checkbox"
                checked={runtime.circuit_breaker?.enabled || false}
                onChange={(event) => onRuntimeChange('circuit_breaker.enabled', event.target.checked)}
              />
              Enable circuit breaker
            </label>
          </div>

          {runtime.circuit_breaker?.enabled ? (
            <div>
              <Label htmlFor="capability-consecutive-failures">Consecutive failures threshold</Label>
              <input
                id="capability-consecutive-failures"
                aria-label="Consecutive failures threshold"
                type="number"
                min="1"
                max="50"
                step="1"
                value={runtime.circuit_breaker?.consecutive_failures ?? 5}
                onChange={(event) => onRuntimeChange('circuit_breaker.consecutive_failures', Number(event.target.value))}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-secondary">Input fields</p>
            <p className="text-sm text-tertiary">These fields drive the guided test form and runtime payload contract.</p>
          </div>
          <button
            type="button"
            onClick={onAddInputField}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/5"
          >
            Add input field
          </button>
        </div>

        {runtime.inputFields.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-sm text-tertiary">
            No input fields yet. Add one to generate a guided test form.
          </div>
        ) : runtime.inputFields.map((field, index) => (
          <div key={index} className="grid gap-3 rounded-lg border border-white/10 p-3 md:grid-cols-2">
            <div>
              <Label htmlFor={`capability-field-label-${index}`}>Field label</Label>
              <input
                id={`capability-field-label-${index}`}
                aria-label={index === 0 ? 'Field label' : `Field label ${index + 1}`}
                type="text"
                value={field.label}
                onChange={(event) => onUpdateInputField(index, 'label', event.target.value)}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                placeholder="Channel"
              />
            </div>

            <div>
              <Label htmlFor={`capability-field-key-${index}`}>Field key</Label>
              <input
                id={`capability-field-key-${index}`}
                aria-label={index === 0 ? 'Field key' : `Field key ${index + 1}`}
                type="text"
                value={field.key}
                onChange={(event) => onUpdateInputField(index, 'key', event.target.value)}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
                placeholder="channel"
              />
            </div>

            <div>
              <Label htmlFor={`capability-field-type-${index}`}>Field type</Label>
              <select
                id={`capability-field-type-${index}`}
                aria-label={index === 0 ? 'Field type' : `Field type ${index + 1}`}
                value={field.type}
                onChange={(event) => onUpdateInputField(index, 'type', event.target.value)}
                className="w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end justify-between gap-4">
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  aria-label={index === 0 ? 'Required field' : `Required field ${index + 1}`}
                  type="checkbox"
                  checked={field.required}
                  onChange={(event) => onUpdateInputField(index, 'required', event.target.checked)}
                />
                Required field
              </label>

              <button
                type="button"
                onClick={() => onRemoveInputField(index)}
                className="text-sm text-secondary hover:text-white"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
