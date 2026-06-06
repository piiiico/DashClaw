import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '../../../components/ui/Card';
import CapabilityGeneratedTestForm from './CapabilityGeneratedTestForm';

interface TestField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  [key: string]: any;
}

interface TestSubmitArgs {
  error?: string;
  payload?: Record<string, any>;
  payloadText?: string;
  declaredGoal?: string;
}

interface CapabilityTestPanelProps {
  fields?: TestField[];
  isSubmitting?: boolean;
  result?: any;
  onSubmit: (args: TestSubmitArgs) => void;
}

export default function CapabilityTestPanel({
  fields = [],
  isSubmitting,
  result,
  onSubmit,
}: CapabilityTestPanelProps) {
  const [payloadText, setPayloadText] = useState('{}');
  const [declaredGoal, setDeclaredGoal] = useState('');
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedDeclaredGoal = declaredGoal.trim();

    if (hasGeneratedFields && !useAdvancedMode) {
      onSubmit({
        payload: Object.fromEntries(
          Object.entries(generatedValues).filter(([, value]) => value !== undefined && value !== '')
        ),
        declaredGoal: trimmedDeclaredGoal,
      });
      return;
    }

    const trimmedPayload = payloadText.trim();
    let parsedPayload;
    try {
      parsedPayload = JSON.parse(trimmedPayload || '{}');
    } catch {
      onSubmit({ error: 'Payload must be valid JSON' });
      return;
    }

    onSubmit({
      payload: parsedPayload,
      payloadText: trimmedPayload,
      declaredGoal: trimmedDeclaredGoal,
    });
  }

  return (
    <Card hover={false}>
      <CardHeader title="Test Panel" />
      <CardContent className="space-y-4">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm text-secondary">
            <span>Declared goal</span>
            <input
              name="declared_goal"
              type="text"
              value={declaredGoal}
              onChange={(event) => setDeclaredGoal(event.target.value)}
              placeholder="Optional goal for this validation run"
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
              <span>Test payload</span>
              <textarea
                aria-label="Test payload"
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
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Running...' : 'Submit Test'}
          </button>
        </form>

        {validationError ? (
          <div className="rounded-lg border border-yellow-500/20 bg-status-warning/10 px-3 py-2 text-sm text-yellow-200">
            {validationError}
          </div>
        ) : null}

        {result?.error ? (
          <div className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-sm text-error">
            {result.error}
          </div>
        ) : null}

        {result?.message ? (
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-secondary">
            {result.message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
