/**
 * Local behavior-sample store. Reads the redacted JSONL the Python recorder
 * (or any source that follows the documented contract) writes under
 * `.dashclaw/behavior-samples/`. This is the ONLY place the analyzer's input
 * comes from — samples never leave the machine and are never persisted to the
 * database. Defensively re-redacts every sample on read.
 *
 * Server-only (uses node:fs). Import from route handlers / CLI, never from a
 * 'use client' component.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { redactSample } from './redaction.js';

// Behavior samples are parsed from JSONL on disk; their shape follows the
// recorder contract but is treated as untrusted external data here.
type Sample = Record<string, any>;
type Dismissal = Record<string, any>;

const MAX_SAMPLES = 20000; // hard ceiling so a runaway log can't OOM the analyzer
const DISMISSALS_FILE = '.dismissals.json';

/** Resolve the samples directory. Override with DASHCLAW_BEHAVIOR_SAMPLES_DIR. */
export function resolveSamplesDir(): string {
  const override = process.env.DASHCLAW_BEHAVIOR_SAMPLES_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.resolve(process.cwd(), '.dashclaw', 'behavior-samples');
}

/** Whether the recorder is switched on in this environment. */
export function recorderEnabled(): boolean {
  const v = (process.env.DASHCLAW_BEHAVIOR_SAMPLES_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function listSampleFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  // YYYY-MM-DD.jsonl files; newest filename last when sorted lexically.
  return entries
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function parseLines(text: string): Sample[] {
  const out: Sample[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.event_id && obj.agent_id) out.push(redactSample(obj));
    } catch {
      // Skip malformed lines — a partially-written tail line must not break
      // the whole read.
    }
  }
  return out;
}

/**
 * Read samples, newest-first across day files. Optionally limit by recency
 * (days) and count.
 */
export async function readSamples({
  days = null,
  limit = MAX_SAMPLES,
}: { days?: number | null; limit?: number } = {}): Promise<Sample[]> {
  const dir = resolveSamplesDir();
  const files = (await listSampleFiles(dir)).reverse(); // newest day first
  const cutoff = days ? Date.now() - days * 86400_000 : null;
  const cap = Math.min(Number(limit) || MAX_SAMPLES, MAX_SAMPLES);
  const all: Sample[] = [];
  for (const file of files) {
    if (all.length >= cap) break;
    let text;
    try {
      text = await fs.readFile(file, 'utf-8');
    } catch {
      continue;
    }
    for (const s of parseLines(text)) {
      if (cutoff && Date.parse(s.ts) && Date.parse(s.ts) < cutoff) continue;
      all.push(s);
    }
  }
  // Sort newest-first, then cap.
  all.sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
  return all.slice(0, cap);
}

/** Lightweight status for the Policy Coach "sample status" panel. */
export async function sampleStatus() {
  const dir = resolveSamplesDir();
  const samples = await readSamples({ limit: MAX_SAMPLES });
  const agents = new Map<string, number>();
  const byDay: Record<string, number> = {};
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const s of samples) {
    agents.set(s.agent_id, (agents.get(s.agent_id) || 0) + 1);
    const day = (s.ts || '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;
    if (!oldest || s.ts < oldest) oldest = s.ts;
    if (!newest || s.ts > newest) newest = s.ts;
  }
  return {
    recorder_enabled: recorderEnabled(),
    dir,
    sample_count: samples.length,
    agent_count: agents.size,
    agents: [...agents.entries()].map(([agent_id, count]) => ({ agent_id, count })).sort((a, b) => b.count - a.count),
    oldest_ts: oldest,
    newest_ts: newest,
    by_day: byDay,
  };
}

// ── Dismissals / accepted advisories (local, alongside the samples) ──────────

export async function readDismissals(): Promise<Dismissal[]> {
  const file = path.join(resolveSamplesDir(), DISMISSALS_FILE);
  try {
    const text = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Append (or replace by signature) a dismissal / accepted-advisory record.
 * `record` should carry { signature, agent_id, type, target, reason, status,
 * suppress_similar, ts }. Returns the full list. Best-effort; the directory is
 * created if missing.
 */
export async function writeDismissal(record: Dismissal): Promise<Dismissal[]> {
  const dir = resolveSamplesDir();
  const file = path.join(dir, DISMISSALS_FILE);
  const existing = await readDismissals();
  const next = existing.filter((d) => d.signature !== record.signature);
  next.push(record);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}
