'use client';

import { useState } from 'react';
import { FileSearch, ShieldCheck, ShieldAlert, Plus, X } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';

// Operator surface for the static skill safety scanner:
//   POST /api/skills/scan  — { skill_name, files: { name: content } }
//     → { findings, passed, cached } where a finding is
//       { severity, rule_id, file, line, match }. A 'high' finding fails.
// Only a content hash + findings are stored (skill_scan_results), never the
// skill body itself.

const SEVERITY_VARIANT = { high: 'error', medium: 'warning', low: 'info' };

export default function SkillScanner() {
  const [skillName, setSkillName] = useState('');
  const [files, setFiles] = useState([{ filename: '', content: '' }]);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const updateFile = (i, key, value) => {
    setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  };
  const addFile = () => setFiles((prev) => [...prev, { filename: '', content: '' }]);
  const removeFile = (i) => setFiles((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const handleScan = async (event) => {
    event.preventDefault();
    const fileMap = {};
    for (const f of files) {
      const name = f.filename.trim();
      if (name) fileMap[name] = f.content;
    }
    if (!skillName.trim() || Object.keys(fileMap).length === 0) {
      setError('A skill name and at least one named file are required.');
      return;
    }
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/skills/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_name: skillName.trim(), files: fileMap }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Scan failed');
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const highCount = result?.findings?.filter((f) => f.severity === 'high').length || 0;

  return (
    <Card className="mb-6" hover={false}>
      <CardHeader
        title={<span className="flex items-center gap-2"><FileSearch size={14} className="text-brand" aria-hidden="true" />Scan a skill</span>}
      />
      <CardContent className="space-y-4">
        <form onSubmit={handleScan} className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Skill name</span>
            <input
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="e.g. deploy-helper"
              aria-label="Skill name"
              className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>

          <div className="space-y-3">
            {files.map((f, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface-tertiary p-3">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    value={f.filename}
                    onChange={(e) => updateFile(i, 'filename', e.target.value)}
                    placeholder="filename (e.g. SKILL.md, run.py)"
                    aria-label={`File ${i + 1} name`}
                    className="flex-1 rounded-md border border-border bg-surface-secondary px-2.5 py-1.5 font-mono text-xs text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                  {files.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove file ${i + 1}`}
                      className="rounded-md border border-border bg-surface-secondary p-1.5 text-tertiary transition-colors hover:border-error/30 hover:text-error"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <textarea
                  value={f.content}
                  onChange={(e) => updateFile(i, 'content', e.target.value)}
                  rows={4}
                  placeholder="Paste file contents…"
                  aria-label={`File ${i + 1} contents`}
                  className="w-full rounded-md border border-border bg-surface-secondary px-2.5 py-2 font-mono text-xs text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addFile}
              className="flex items-center gap-1.5 text-xs text-tertiary transition-colors hover:text-secondary"
            >
              <Plus size={12} aria-hidden="true" /> Add file
            </button>
            <button
              type="submit"
              disabled={scanning}
              aria-busy={scanning}
              className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
            >
              {scanning ? 'Scanning…' : 'Scan skill'}
            </button>
          </div>
          <p className="text-[11px] text-tertiary">Only a content hash and findings are stored — never the skill body.</p>
        </form>

        {error && (
          <div role="alert" className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-sm text-error">{error}</div>
        )}

        {result && (
          <div className="space-y-3 rounded-lg border border-border bg-surface-tertiary px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {result.passed
                ? <Badge variant="success" size="xs"><span className="flex items-center gap-1"><ShieldCheck size={11} aria-hidden="true" />Passed</span></Badge>
                : <Badge variant="error" size="xs"><span className="flex items-center gap-1"><ShieldAlert size={11} aria-hidden="true" />Failed — {highCount} high</span></Badge>}
              <Badge variant="default" size="xs">{result.findings?.length || 0} finding{result.findings?.length === 1 ? '' : 's'}</Badge>
              {result.cached && <Badge variant="info" size="xs">cached</Badge>}
            </div>
            {result.findings?.length > 0 ? (
              <ul className="space-y-1.5 text-xs text-secondary">
                {result.findings.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Badge variant={SEVERITY_VARIANT[f.severity] || 'info'} size="xs">{f.severity}</Badge>
                    <span className="font-mono text-tertiary">{f.file}:{f.line}</span>
                    <span className="text-secondary">{f.rule_id}</span>
                    {f.match && <code className="truncate rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-[11px] text-tertiary">{f.match}</code>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-success">No risky patterns detected.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
