export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

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

function deriveSlugFromCwd(cwd) {
  if (!cwd) return 'unknown';
  const segs = String(cwd).split(/[\\/]/).filter(Boolean);
  const last = segs[segs.length - 1] || 'unknown';
  return last.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 80) || 'unknown';
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const project = body?.project || {};
  const sourceHost = project.source_host || 'jsonl';
  if (sourceHost !== 'hook' && sourceHost !== 'jsonl') {
    return NextResponse.json({ error: 'invalid_source_host', reason: 'must be "hook" or "jsonl"' }, { status: 400 });
  }

  const lines = Array.isArray(body?.jsonl_lines) ? body.jsonl_lines : null;
  if (!lines) {
    return NextResponse.json({ error: 'missing_jsonl_lines' }, { status: 400 });
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
