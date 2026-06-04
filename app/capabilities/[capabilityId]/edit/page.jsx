'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Wrench } from 'lucide-react';
import PageLayout from '../../../components/PageLayout';
import { Card, CardContent, CardHeader } from '../../../components/ui/Card';
import {
  compileCapabilityPayload,
  deriveCapabilityMode,
  deriveGeneratedInputFields,
} from '../../lib/capabilityFormModel.js';
import CapabilityModeSelector from '../../new/components/CapabilityModeSelector.jsx';
import CapabilityBasicsSection from '../../new/components/CapabilityBasicsSection.jsx';
import CapabilityHttpRuntimeSection from '../../new/components/CapabilityHttpRuntimeSection.jsx';
import CapabilitySummaryCard from '../../new/components/CapabilitySummaryCard.jsx';

function splitTags(tags) {
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function createEmptyInputField() {
  return {
    label: '',
    key: '',
    type: 'string',
    required: false,
    helpText: '',
  };
}

function buildInitialRuntime(capability) {
  const schema = capability?.invocation_schema || {};
  return {
    endpoint: schema.endpoint || '',
    method: schema.method || 'POST',
    timeout_ms: schema.timeout_ms ?? 60000,
    auth: schema.auth || { type: 'none', token_setting: '' },
    retry_policy: schema.retry_policy || {
      max_retries: 0,
      backoff: 'none',
      base_delay_ms: 1000,
      max_delay_ms: 30000,
    },
    circuit_breaker: schema.circuit_breaker || {
      enabled: false,
      consecutive_failures: 5,
    },
    inputFields: deriveGeneratedInputFields(capability),
  };
}

function buildInitialForm(capability) {
  return {
    name: capability?.name || '',
    description: capability?.description || '',
    category: capability?.category || '',
    source_type: capability?.source_type || 'internal_sdk',
    auth_type: capability?.auth_type || 'none',
    risk_level: capability?.risk_level || 'medium',
    requires_approval: Boolean(capability?.requires_approval),
    tags: Array.isArray(capability?.tags) ? capability.tags.join(', ') : '',
    docs_url: capability?.docs_url || '',
    health_status: capability?.health_status || 'unknown',
  };
}

export default function EditCapabilityPage() {
  const router = useRouter();
  const { capabilityId } = useParams();

  const [loadingCapability, setLoadingCapability] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [mode, setMode] = useState('registry_only');
  const [form, setForm] = useState({
    name: '',
    description: '',
    category: '',
    source_type: 'internal_sdk',
    auth_type: 'none',
    risk_level: 'medium',
    requires_approval: false,
    tags: '',
    docs_url: '',
    health_status: 'unknown',
  });
  const [runtime, setRuntime] = useState({
    endpoint: '',
    method: 'POST',
    timeout_ms: 60000,
    auth: { type: 'none', token_setting: '' },
    retry_policy: {
      max_retries: 0,
      backoff: 'none',
      base_delay_ms: 1000,
      max_delay_ms: 30000,
    },
    circuit_breaker: { enabled: false, consecutive_failures: 5 },
    inputFields: [],
  });

  useEffect(() => {
    if (!capabilityId) return;

    setLoadingCapability(true);
    setLoadError(null);

    fetch(`/api/capabilities/${capabilityId}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.detail || body.error || 'Failed to load capability');
        }
        return body;
      })
      .then(({ capability }) => {
        if (!capability) throw new Error('Capability not found');
        setMode(deriveCapabilityMode(capability));
        setForm(buildInitialForm(capability));
        setRuntime(buildInitialRuntime(capability));
      })
      .catch((err) => {
        setLoadError(err.message || 'Failed to load capability');
      })
      .finally(() => {
        setLoadingCapability(false);
      });
  }, [capabilityId]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateRuntime(key, value) {
    setRuntime((current) => {
      if (key.startsWith('auth.')) {
        const authKey = key.replace('auth.', '');
        return { ...current, auth: { ...current.auth, [authKey]: value } };
      }
      if (key.startsWith('retry_policy.')) {
        const retryKey = key.replace('retry_policy.', '');
        return { ...current, retry_policy: { ...current.retry_policy, [retryKey]: value } };
      }
      if (key.startsWith('circuit_breaker.')) {
        const cbKey = key.replace('circuit_breaker.', '');
        return { ...current, circuit_breaker: { ...current.circuit_breaker, [cbKey]: value } };
      }
      return { ...current, [key]: value };
    });
  }

  function updateInputField(index, key, value) {
    setRuntime((current) => ({
      ...current,
      inputFields: current.inputFields.map((field, fieldIndex) => (
        fieldIndex === index ? { ...field, [key]: value } : field
      )),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.name.trim()) {
      setSaveError('Name is required');
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const payload = compileCapabilityPayload({
        mode,
        metadata: {
          ...form,
          tags: splitTags(form.tags),
        },
        runtime,
      });

      const response = await fetch(`/api/capabilities/${capabilityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save capability');
      }

      router.push(`/capabilities/${capabilityId}`);
    } catch (err) {
      setSaveError(err.message || 'Failed to save capability');
      setSaving(false);
    }
  }

  const detailHref = `/capabilities/${capabilityId}`;

  if (loadingCapability) {
    return (
      <PageLayout
        title="Edit Capability"
        subtitle="Update capability configuration"
        breadcrumbs={['Studio', 'Capabilities', 'Edit']}
        maturity="stable"
      >
        <div className="py-12 text-center text-sm text-tertiary">Loading capability...</div>
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout
        title="Edit Capability"
        subtitle="Update capability configuration"
        breadcrumbs={['Studio', 'Capabilities', 'Edit']}
        maturity="stable"
      >
        <div className="rounded-lg bg-error-subtle border border-error/20 px-4 py-3 text-sm text-error">
          {loadError}
        </div>
        <div className="mt-4">
          <Link href="/capabilities" className="text-sm text-secondary hover:text-white transition-colors">
            Back to registry
          </Link>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Edit Capability"
      subtitle="Update capability configuration"
      breadcrumbs={['Studio', 'Capabilities', 'Edit']}
      maturity="stable"
      actions={(
        <Link
          href={detailHref}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </Link>
      )}
    >
      <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
        <Card>
          <CardHeader title="Capability Details" icon={Wrench} />
          <CardContent className="grid gap-6 p-5 pt-0 xl:grid-cols-[minmax(0,2fr)_320px]">
            <div className="space-y-6">
              <CapabilityModeSelector mode={mode} onChange={setMode} />
              <CapabilityBasicsSection form={form} mode={mode} onChange={updateForm} />

              {mode === 'runnable_http' ? (
                <CapabilityHttpRuntimeSection
                  runtime={runtime}
                  onRuntimeChange={updateRuntime}
                  onAddInputField={() => setRuntime((current) => ({
                    ...current,
                    inputFields: [...current.inputFields, createEmptyInputField()],
                  }))}
                  onUpdateInputField={updateInputField}
                  onRemoveInputField={(index) => setRuntime((current) => ({
                    ...current,
                    inputFields: current.inputFields.filter((_, fieldIndex) => fieldIndex !== index),
                  }))}
                />
              ) : null}
            </div>

            <div className="space-y-4">
              <CapabilitySummaryCard
                mode={mode}
                form={form}
                runtime={runtime}
                fieldCount={runtime.inputFields.filter((field) => field.key.trim()).length}
              />
            </div>
          </CardContent>
        </Card>

        {saveError ? (
          <div className="px-4 py-3 rounded-lg bg-error-subtle border border-error/20 text-sm text-error">
            {saveError}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-brand hover:bg-brand/90 rounded-lg transition-colors disabled:opacity-50"
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <Link href={detailHref} className="px-4 py-2 text-sm text-secondary hover:text-white transition-colors">
            Cancel
          </Link>
        </div>
      </form>
    </PageLayout>
  );
}
