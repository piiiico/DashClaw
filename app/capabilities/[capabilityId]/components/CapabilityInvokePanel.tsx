import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import CapabilityGeneratedTestForm from './CapabilityGeneratedTestForm';

// Renders the structured response from POST /api/capabilities/{id}/invoke.
// The route returns the body for every outcome (success and each governed
// rejection), so we branch on result.error / result.success rather than HTTP
// status, which the page already discards when it parses the body.
function InvokeOutcome({ result }: { result?: any }) {
  if (!result) return null;

  // Client-side validation error (no governed call was made).
  if (result.error && !result.governed && result.success === undefined && result.action_id === undefined
    && !['blocked_by_policy', 'pending_approval', 'quota_exceeded', 'circuit_breaker_open', 'access_denied',
      'capability_not_found', 'not_invocable', 'auth_not_configured', 'endpoint_not_configured', 'capability_contract_invalid']
      .includes(result.error)) {
    return (
      <div role="alert" className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-sm text-error">
        {result.error}
      </div>
    );
  }

  const actionLink = result.action_id ? (
    <Link
      href={`/decisions/${result.action_id}`}
      className="font-mono text-xs text-brand transition-colors hover:text-brand-hover"
    >
      {result.action_id}
    </Link>
  ) : null;

  // Success
  if (result.success) {
    const sec = result.security || {};
    return (
      <div className="space-y-3 rounded-lg border border-success/20 bg-success-subtle px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success" size="xs">Completed</Badge>
          <Badge variant="info" size="xs">Governed</Badge>
          {typeof result.elapsed_ms === 'number' && (
            <span className="text-xs tabular-nums text-secondary">{result.elapsed_ms} ms</span>
          )}
          {result.retry_metadata?.retried && (
            <Badge variant="warning" size="xs">retried ×{result.retry_metadata.total_attempts}</Badge>
          )}
        </div>
        {actionLink && (
          <div className="text-xs text-secondary">Recorded as action {actionLink}</div>
        )}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Result</div>
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface-tertiary px-3 py-2 font-mono text-xs text-secondary">
            {JSON.stringify(result.result ?? null, null, 2)}
          </pre>
        </div>
        <div className="text-xs text-tertiary">
          {sec.clean
            ? 'DLP scan: no sensitive data detected in the input.'
            : `DLP scan: ${sec.findings_count ?? 0} finding(s)${sec.critical_count ? `, ${sec.critical_count} critical` : ''}${sec.categories?.length ? ` (${sec.categories.join(', ')})` : ''}.`}
          {result.quota_warning && ' · Approaching invocation quota.'}
        </div>
      </div>
    );
  }

  // Governed rejections and execution failures
  const code = result.error;
  if (code === 'blocked_by_policy') {
    const gd = result.guard_decision || {};
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-error/20 bg-error-subtle px-3 py-3 text-sm text-error">
        <div className="flex items-center gap-2"><Badge variant="error" size="xs">Blocked by policy</Badge></div>
        {gd.reasons?.length ? <ul className="list-disc pl-5 text-xs">{gd.reasons.map((r: any, i: number) => <li key={i}>{r}</li>)}</ul> : null}
        {gd.matched_policies?.length ? (
          <div className="text-xs text-secondary">Matched: {gd.matched_policies.map((p: any) => p.name || p.id || p).join(', ')}</div>
        ) : null}
      </div>
    );
  }
  if (code === 'pending_approval') {
    return (
      <div role="status" className="space-y-2 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-3 text-sm text-warning">
        <div className="flex items-center gap-2"><Badge variant="warning" size="xs">Requires approval</Badge></div>
        <p className="text-xs">{result.message || 'This invocation needs human approval before it runs.'}</p>
        {result.reason && <p className="text-xs text-secondary">Reason: {result.reason}</p>}
        {result.action_id && (
          <Link href={`/approvals`} className="inline-block text-xs text-brand hover:text-brand-hover">
            Review in Approvals →
          </Link>
        )}
      </div>
    );
  }
  if (code === 'quota_exceeded') {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-3 text-sm text-warning">
        <div className="flex items-center gap-2"><Badge variant="warning" size="xs">Quota exceeded</Badge></div>
        <p className="text-xs">{result.message || 'Monthly invocation limit reached.'}</p>
        {(result.usage != null && result.limit != null) && (
          <p className="text-xs tabular-nums text-secondary">{result.usage} / {result.limit} used</p>
        )}
        <Link href="/usage" className="inline-block text-xs text-brand hover:text-brand-hover">View usage →</Link>
      </div>
    );
  }
  if (code === 'circuit_breaker_open') {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-error/20 bg-error-subtle px-3 py-3 text-sm text-error">
        <div className="flex items-center gap-2"><Badge variant="error" size="xs">Circuit breaker open</Badge></div>
        <p className="text-xs">{result.message || 'The capability is temporarily disabled after repeated failures.'}</p>
        {result.consecutive_failures != null && (
          <p className="text-xs tabular-nums text-secondary">{result.consecutive_failures} consecutive failures</p>
        )}
      </div>
    );
  }
  if (code === 'access_denied') {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-error/20 bg-error-subtle px-3 py-3 text-sm text-error">
        <div className="flex items-center gap-2"><Badge variant="error" size="xs">Access denied</Badge></div>
        <p className="text-xs">{result.reason || 'This agent does not have access to the capability.'}</p>
        {result.agent_id && <p className="text-xs text-secondary">Agent: <span className="font-mono">{result.agent_id}</span></p>}
      </div>
    );
  }

  // Execution failure (timeout / invalid input / upstream) or prep error.
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-error/20 bg-error-subtle px-3 py-3 text-sm text-error">
      <div className="flex items-center gap-2">
        <Badge variant="error" size="xs">{(code || 'failed').replace(/_/g, ' ')}</Badge>
        {typeof result.elapsed_ms === 'number' && (
          <span className="text-xs tabular-nums text-secondary">{result.elapsed_ms} ms</span>
        )}
      </div>
      {result.message && <p className="text-xs">{result.message}</p>}
      {actionLink && <div className="text-xs text-secondary">Recorded as action {actionLink}</div>}
    </div>
  );
}

interface InvokeField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  [key: string]: any;
}

interface InvokeSubmitArgs {
  error?: string;
  payload?: Record<string, any>;
  declaredGoal?: string;
  agentId?: string;
}

interface CapabilityInvokePanelProps {
  fields?: InvokeField[];
  isSubmitting?: boolean;
  result?: any;
  onSubmit: (args: InvokeSubmitArgs) => void;
}

export default function CapabilityInvokePanel({ fields = [], isSubmitting, result, onSubmit }: CapabilityInvokePanelProps) {
  const [payloadText, setPayloadText] = useState('{}');
  const [declaredGoal, setDeclaredGoal] = useState('');
  const [agentId, setAgentId] = useState('');
  const [useAdvancedMode, setUseAdvancedMode] = useState(false);
  const [generatedValues, setGeneratedValues] = useState<Record<string, any>>({});

  const hasGeneratedFields = fields.length > 0;

  const validationError = useMemo(() => {
    if (hasGeneratedFields && !useAdvancedMode) {
      const missingField = fields.find((field) => field.required && (generatedValues[field.key] === undefined || generatedValues[field.key] === ''));
      return missingField ? `${missingField.label} is required` : null;
    }
    try {
      JSON.parse(payloadText || '{}');
      return null;
    } catch {
      return 'Payload must be valid JSON';
    }
  }, [fields, generatedValues, hasGeneratedFields, payloadText, useAdvancedMode]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedGoal = declaredGoal.trim();
    const trimmedAgent = agentId.trim();

    if (hasGeneratedFields && !useAdvancedMode) {
      onSubmit({
        payload: Object.fromEntries(
          Object.entries(generatedValues).filter(([, value]) => value !== undefined && value !== '')
        ),
        declaredGoal: trimmedGoal,
        agentId: trimmedAgent,
      });
      return;
    }

    let parsedPayload;
    try {
      parsedPayload = JSON.parse(payloadText.trim() || '{}');
    } catch {
      onSubmit({ error: 'Payload must be valid JSON' });
      return;
    }
    onSubmit({ payload: parsedPayload, declaredGoal: trimmedGoal, agentId: trimmedAgent });
  }

  return (
    <Card hover={false}>
      <CardHeader title="Invoke" />
      <CardContent className="space-y-4">
        <p className="text-xs text-tertiary">
          Runs a real governed invocation — guard policy, access rules, quota, and the circuit breaker are
          all enforced, the call is recorded as an action, and the input is DLP-scanned. Unlike a test, this
          executes the live endpoint.
        </p>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm text-secondary">
            <span>Agent ID <span className="text-tertiary">(optional — evaluated against access rules)</span></span>
            <input
              name="agent_id"
              type="text"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              placeholder="e.g. agent_prod_worker"
              className="rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-secondary">
            <span>Declared goal</span>
            <input
              name="declared_goal"
              type="text"
              value={declaredGoal}
              onChange={(event) => setDeclaredGoal(event.target.value)}
              placeholder="Optional goal for this invocation"
              className="rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white"
            />
          </label>

          {hasGeneratedFields && !useAdvancedMode ? (
            <CapabilityGeneratedTestForm
              fields={fields}
              values={generatedValues}
              onChange={(key, value) => setGeneratedValues((current) => ({ ...current, [key]: value }))}
            />
          ) : (
            <label className="flex flex-col gap-1 text-sm text-secondary">
              <span>Invocation payload</span>
              <textarea
                aria-label="Invocation payload"
                name="payload"
                rows={8}
                value={payloadText}
                onChange={(event) => setPayloadText(event.target.value)}
                className="rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 font-mono text-sm text-white"
              />
            </label>
          )}

          {hasGeneratedFields ? (
            <button
              type="button"
              onClick={() => setUseAdvancedMode((current) => !current)}
              className="text-sm text-secondary hover:text-white"
            >
              {useAdvancedMode ? 'Use guided fields' : 'Use advanced JSON'}
            </button>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || Boolean(validationError)}
            aria-busy={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Invoking…' : 'Invoke capability'}
          </button>
        </form>

        {validationError ? (
          <div role="alert" className="rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2 text-sm text-warning">
            {validationError}
          </div>
        ) : null}

        <InvokeOutcome result={result} />
      </CardContent>
    </Card>
  );
}
