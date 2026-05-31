export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import zlib from 'node:zlib';
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { parseSessionLines } from '../../../lib/claude-code/parser.js';
import { detectRepeatedRuns } from '../../../lib/claude-code/repeated-runs.js';
import { runOptimizer } from '../../../lib/claude-code/optimizer.js';
import { detectForSession } from '../../../lib/claude-code/alerts.js';
import {
  upsertProject,
  upsertSessionWithChildren,
  getProjectSessionsChronological,
  replaceSignalsForSession,
  insertAlerts,
  listProjects,
} from '../../../lib/repositories/code-sessions.repository.js';

const MAX_LINES = 200_000;
// Cap decompressed payload at 50 MB. Vercel's per-IP body limit is 4.5 MB on
// Hobby; clients gzip large JSONL to fit. A 50 MB decompressed ceiling bounds
// the zip-bomb risk while still covering every JSONL we've seen in the wild
// (largest observed: 19 MB raw → ~3.3 MB gzipped).
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

/**
 * Read the request body, transparently inflating a raw-gzip body.
 *
 * The wire transport for large JSONL is a gzip of the JSON envelope, flagged by
 * the custom `x-dashclaw-encoding: gzip` header. We deliberately do NOT use the
 * standard `Content-Encoding: gzip` — proxies/CDNs (incl. Vercel's edge) may try
 * to auto-decode or re-encode it, which is exactly the ambiguity we want to
 * avoid. A custom header is opaque to every intermediary, so the bytes Vercel
 * counts against its 4.5 MB request-body cap are the gzip bytes (≈3-4 MB for our
 * largest sessions) — base64's +33% inflation, which previously pushed those
 * same sessions over the cap, is gone.
 *
 * Back-compat: plain JSON (`jsonl_lines`) and base64 (`compressed_jsonl`) bodies
 * still work unchanged — older CLIs and the hook reporter keep functioning.
 */
async function readRequestBody(request) {
  const enc = (request.headers.get('x-dashclaw-encoding') || '').toLowerCase();
  if (enc !== 'gzip') {
    return request.json();
  }
  const compressed = Buffer.from(await request.arrayBuffer());
  let inflated;
  try {
    inflated = zlib.gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch (err) {
    // gunzipSync throws a RangeError once output would exceed maxOutputLength —
    // surface it as the same 413 contract as the base64 path's size guard.
    const wrapped = new Error('gzip body inflate failed: ' + err.message);
    if (err.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|too large/i.test(err.message)) {
      wrapped.code = 'GZIP_TOO_LARGE';
    } else {
      wrapped.code = 'GZIP_DECODE_FAILED';
    }
    throw wrapped;
  }
  return JSON.parse(inflated.toString('utf8'));
}

function deriveSlugFromCwd(cwd) {
  if (!cwd) return 'unknown';
  const segs = String(cwd).split(/[\\/]/).filter(Boolean);
  const last = segs[segs.length - 1] || 'unknown';
  return last.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 80) || 'unknown';
}

export async function POST(request) {
  let body;
  try {
    body = await readRequestBody(request);
  } catch (err) {
    if (err.code === 'GZIP_TOO_LARGE') {
      return NextResponse.json(
        { error: 'gzip_body_too_large_after_decode', max_bytes: MAX_DECOMPRESSED_BYTES },
        { status: 413 },
      );
    }
    if (err.code === 'GZIP_DECODE_FAILED') {
      return NextResponse.json({ error: 'gzip_body_decode_failed', reason: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const project = body?.project || {};
  const sourceHost = project.source_host || 'jsonl';
  if (sourceHost !== 'hook' && sourceHost !== 'jsonl') {
    return NextResponse.json({ error: 'invalid_source_host', reason: 'must be "hook" or "jsonl"' }, { status: 400 });
  }

  let lines = Array.isArray(body?.jsonl_lines) ? body.jsonl_lines : null;
  const compressed = typeof body?.compressed_jsonl === 'string' ? body.compressed_jsonl : null;

  if (!lines && !compressed) {
    return NextResponse.json({ error: 'missing_jsonl_lines' }, { status: 400 });
  }

  if (!lines && compressed) {
    let decompressed;
    try {
      decompressed = zlib.gunzipSync(Buffer.from(compressed, 'base64'));
    } catch (err) {
      return NextResponse.json(
        { error: 'compressed_jsonl_decode_failed', reason: err.message },
        { status: 400 },
      );
    }
    if (decompressed.length > MAX_DECOMPRESSED_BYTES) {
      return NextResponse.json(
        { error: 'compressed_jsonl_too_large_after_decode', max_bytes: MAX_DECOMPRESSED_BYTES },
        { status: 413 },
      );
    }
    lines = decompressed.toString('utf8').split('\n').filter(l => l.length > 0);
  }

  if (lines.length > MAX_LINES) {
    return NextResponse.json({ error: 'jsonl_lines_too_large', max: MAX_LINES }, { status: 413 });
  }

  const slug = (typeof project.slug === 'string' && project.slug.trim())
    ? project.slug.trim()
    : deriveSlugFromCwd(project.cwd);

  const parsed = parseSessionLines(lines, {
    mtime: body?.source_mtime || null,
    sourceFile: body?.source_file || null,
  });

  if (!parsed.sessionUuid) {
    return NextResponse.json({
      error: 'no_session_uuid_in_jsonl',
      reason: 'No assistant record with a sessionId was found in jsonl_lines',
      parsed_skipped_lines: parsed.skippedLines,
      jsonl_records: parsed.jsonlRecords,
    }, { status: 400 });
  }

  if (body?.session_uuid && body.session_uuid !== parsed.sessionUuid) {
    return NextResponse.json({
      error: 'mismatched_session_uuid',
      client_session_uuid: body.session_uuid,
      parser_session_uuid: parsed.sessionUuid,
    }, { status: 400 });
  }

  const sql = getSql();
  const orgId = getOrgId(request);

  const projectRow = await upsertProject(sql, orgId, {
    slug,
    cwd: project.cwd || null,
    source_host: sourceHost,
  });

  const upsert = await upsertSessionWithChildren(sql, orgId, parsed, {
    projectId: projectRow.id,
    toolUseActionMap: body?.tool_use_action_map && typeof body.tool_use_action_map === 'object'
      ? body.tool_use_action_map
      : {},
    source: sourceHost,
  });

  // Signals + alerts pass. Skipped re-ingests don't recompute — the stored
  // signals are still valid for unchanged input.
  let signalsInserted = 0;
  let alertsInserted = 0;
  if (!upsert.skipped && upsert.sessionId) {
    try {
      const projectSessions = await getProjectSessionsChronological(sql, orgId, projectRow.id);
      const priorSessions = projectSessions.filter(s => s.id !== upsert.sessionId);
      const toolEvents = (parsed.toolUses || []).map(t => ({
        name: t.name, requestId: t.requestId, target: t.target,
      }));
      const repeatedRuns = detectRepeatedRuns(toolEvents);
      const stuckLoops = repeatedRuns.filter(r => r.confidence === 'high');
      const sessionForRules = {
        ...projectSessions.find(s => s.id === upsert.sessionId),
        model_primary: parsed.modelPrimary,
        cost_usd: Number(parsed.cost_usd) || 0,
        input_tokens: parsed.totals?.input_tokens || 0,
        output_tokens: parsed.totals?.output_tokens || 0,
        cache_read_tokens: parsed.totals?.cache_read_tokens || 0,
        cache_creation_tokens: parsed.totals?.cache_creation_tokens || 0,
        message_count: parsed.messageCount || 0,
      };
      const findings = runOptimizer({
        session: sessionForRules,
        stuckLoops,
        repeatedRuns,
        toolCount: toolEvents.length,
        toolEvents,
        subagentInvocations: [],
        projectSessions,
      });
      const repeatedRunSignals = repeatedRuns.map(r => ({
        kind: 'repeated_run',
        confidence: r.confidence,
        savingsUsd: null,
        payload: { name: r.name, count: r.count, evidence: r.evidence, targets: r.targets },
      }));
      const allSignals = [...findings, ...repeatedRunSignals];
      await replaceSignalsForSession(sql, upsert.sessionId, allSignals);
      signalsInserted = allSignals.length;

      const allProjects = await listProjects(sql, orgId);
      const projectsWithRecentSessions = allProjects.filter(p => Number(p.session_count) > 0).length;
      const alerts = detectForSession({
        session: { session_uuid: parsed.sessionUuid, cost_usd: sessionForRules.cost_usd },
        priorSessions,
        stuckLoopCount: stuckLoops.length,
        projectSessionCount: projectsWithRecentSessions,
      });
      alertsInserted = await insertAlerts(sql, orgId, alerts, {
        project_id: projectRow.id,
        session_id: upsert.sessionId,
      });
    } catch (err) {
      console.warn('[code-sessions/ingest] signals/alerts step failed:', err.message);
    }
  }

  return NextResponse.json({
    project: { id: projectRow.id, slug: projectRow.slug },
    session: {
      id: upsert.sessionId,
      session_uuid: parsed.sessionUuid,
      source_mtime: parsed.sourceMtime,
      parser_version: parsed.parserVersion,
      skipped: upsert.skipped,
      reason: upsert.reason,
      inserted_messages: upsert.insertedMessages || 0,
      inserted_tool_uses: upsert.insertedToolUses || 0,
      signals_inserted: signalsInserted,
      alerts_inserted: alertsInserted,
    },
    parser: {
      jsonl_records: parsed.jsonlRecords,
      model_requests: parsed.modelRequests,
      duplicate_fragments_skipped: parsed.duplicateFragmentsSkipped,
      parser_skipped: parsed.skippedLines,
      model_primary: parsed.modelPrimary,
    },
  });
}
