function normalizeValue(type: string, rawValue: any): any {
  if (type === 'number') {
    return rawValue === '' ? undefined : Number(rawValue);
  }

  if (type === 'boolean') {
    return Boolean(rawValue);
  }

  return rawValue;
}

interface GeneratedField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  helpText?: string;
  [key: string]: any;
}

interface CapabilityGeneratedTestFormProps {
  fields: GeneratedField[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
}

export default function CapabilityGeneratedTestForm({
  fields,
  values,
  onChange,
}: CapabilityGeneratedTestFormProps) {
  if (!fields.length) return null;

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const inputId = `generated-field-${field.key}`;

        if (field.type === 'boolean') {
          return (
            <label key={field.key} htmlFor={inputId} className="flex items-center gap-2 text-sm text-secondary">
              <input
                id={inputId}
                aria-label={field.label}
                type="checkbox"
                checked={Boolean(values[field.key])}
                onChange={(event) => onChange(field.key, normalizeValue(field.type, event.target.checked))}
              />
              <span>{field.label}</span>
            </label>
          );
        }

        return (
          <label key={field.key} htmlFor={inputId} className="flex flex-col gap-1 text-sm text-secondary">
            <span>
              {field.label}
              {field.required ? <span className="text-error"> *</span> : null}
            </span>
            <input
              id={inputId}
              aria-label={field.label}
              type={field.type === 'number' ? 'number' : 'text'}
              value={values[field.key] ?? ''}
              onChange={(event) => onChange(field.key, normalizeValue(field.type, event.target.value))}
              className="rounded-lg border border-white/10 bg-surface-tertiary px-3 py-2 text-sm text-white"
            />
            {field.helpText ? (
              <span className="text-xs text-tertiary">{field.helpText}</span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
