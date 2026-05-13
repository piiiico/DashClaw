export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { parseSessionLines } from '../../../lib/claude-code/parser.js';
import {
  upsertProject,
  upsertSessionWithChildren,
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
