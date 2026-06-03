'use client';

import { useEffect } from 'react';
import { AlertTriangle, Upload, X } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Card, CardContent } from '../../components/ui/Card';

const inputClass = 'w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand';
const selectClass = 'w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand';

export default function PolicyAdvancedImportPanel({
  open,
  onClose,
  importMode,
  setImportMode,
  importPack,
  setImportPack,
  importYaml,
  setImportYaml,
  importing,
  importResult,
  handleImport,
  packPreviews,
  templates,
}) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const hasCatalog = Array.isArray(templates) && templates.length > 0;
  const selectedTemplate = hasCatalog ? templates.find(t => t.id === importPack) : null;
  const preview = selectedTemplate || packPreviews?.[importPack];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <button
        type="button"
        aria-label="Close advanced import overlay"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <Card className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-[rgba(255,255,255,0.08)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-warning-subtle border border-warning/20 flex items-center justify-center">
              <Upload size={16} className="text-warning" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Advanced import</h2>
              <p className="text-xs text-tertiary">Expert tools for importing validated policy packs or raw YAML definitions.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-tertiary hover:text-white transition-colors" aria-label="Close advanced import">
            <X size={16} />
          </button>
        </div>

        <CardContent>
          <div className="space-y-5">
            <div className="rounded-xl bg-warning-subtle border border-warning/20 p-4 flex items-start gap-3">
              <AlertTriangle size={16} className="text-warning mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-100">Advanced import is intended for expert users.</p>
                <p className="text-xs text-amber-200/80">
                  Use this when you already have a validated YAML policy definition or you know exactly which policy pack you want to install.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setImportMode('pack')}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  importMode === 'pack'
                    ? 'border-brand bg-brand/10'
                    : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">Policy pack</span>
                  <Badge variant="success" size="xs">Recommended</Badge>
                </div>
                <p className="mt-2 text-xs text-secondary">
                  Start from a tested preset like Enterprise Strict or SMB Safe. Best when you want quick coverage without hand-authoring YAML.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setImportMode('yaml')}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  importMode === 'yaml'
                    ? 'border-brand bg-brand/10'
                    : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">Raw YAML</span>
                  <Badge variant="warning" size="xs">Expert</Badge>
                </div>
                <p className="mt-2 text-xs text-secondary">
                  Import a prewritten definition directly. Use this only when the YAML is already validated and ready to load.
                </p>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setImportMode('pack')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  importMode === 'pack'
                    ? 'bg-brand text-white'
                    : 'bg-elevated text-secondary hover:bg-zinc-600'
                }`}
              >
                Policy pack
              </button>
              <button
                type="button"
                onClick={() => setImportMode('yaml')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  importMode === 'yaml'
                    ? 'bg-brand text-white'
                    : 'bg-elevated text-secondary hover:bg-zinc-600'
                }`}
              >
                Raw YAML
              </button>
            </div>

            {importMode === 'pack' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-secondary mb-1">Policy pack</label>
                  <select
                    value={importPack}
                    onChange={(e) => setImportPack(e.target.value)}
                    className={selectClass}
                  >
                    {hasCatalog ? (
                      templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))
                    ) : (
                      <>
                        <option value="enterprise-strict">Enterprise Strict</option>
                        <option value="smb-safe">SMB Safe</option>
                        <option value="startup-growth">Startup Growth</option>
                        <option value="development">Development</option>
                      </>
                    )}
                  </select>
                </div>

                {preview && (
                  <div className="rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-white">{preview.name}</span>
                      {selectedTemplate && (
                        <Badge variant="info" size="xs">{`${selectedTemplate.policy_count} policies`}</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-tertiary mt-1">{preview.description}</p>
                    {preview.recommended_for && (
                      <p className="text-[10px] text-disabled mt-1">Recommended for: {preview.recommended_for}</p>
                    )}
                    {selectedTemplate?.policies?.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-[rgba(255,255,255,0.06)] pt-2">
                        {selectedTemplate.policies.map((p, i) => (
                          <li key={i} className="text-[10px] text-secondary">
                            <span className="text-white">{p.name}</span>
                            <span className="text-tertiary"> — {p.rules_summary}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs text-secondary mb-1">YAML policy definition</label>
                <textarea
                  value={importYaml}
                  onChange={(e) => setImportYaml(e.target.value)}
                  placeholder={'name: deploy-approval-gate\npolicy_type: require_approval\nrules:\n  action_types:\n    - deploy\n  action: require_approval'}
                  rows={8}
                  className={`${inputClass} font-mono`}
                />
                <p className="mt-2 text-[11px] text-tertiary">
                  DashClaw will send this directly to the import route. Use policy packs instead unless you already trust the YAML.
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleImport}
                disabled={importing || (importMode === 'yaml' && !importYaml.trim())}
                className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-elevated text-secondary text-sm font-medium hover:bg-zinc-600 transition-colors"
              >
                Back to policies
              </button>
            </div>

            {importResult && (
              <div className="p-3 rounded-lg bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="success">{importResult.imported ?? 0} imported</Badge>
                  {(importResult.skipped ?? 0) > 0 && (
                    <Badge variant="warning">{importResult.skipped} skipped</Badge>
                  )}
                  {(importResult.errors ?? 0) > 0 && (
                    <Badge variant="error">{importResult.errors} errors</Badge>
                  )}
                  {(importResult.skipped ?? 0) === 0 && (
                    <Badge variant="warning">0 skipped</Badge>
                  )}
                  {(importResult.errors ?? 0) === 0 && (
                    <Badge variant="error">0 errors</Badge>
                  )}
                </div>
                {importResult.details && (
                  <p className="text-xs text-secondary mt-1">{importResult.details}</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
