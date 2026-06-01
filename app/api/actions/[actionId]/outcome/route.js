export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { apiErrorResponse } from '../../../../lib/apiErrors.js';
import { EVENTS, publishOrgEvent } from '../../../../lib/events.js';
import { scanSensitiveData } from '../../../../lib/security.js';
import {
  getActionOutcome,
  setActionOutcome,
} from '../../../../lib/repositories/actions.repository.js';

// Terminal states an agent is allowed to report. `lost_confirmation` is
// reserved for the system sweep (Phase 2) and rejected from this endpoint.
const AGENT_TERMINAL_STATES = new Set(['completed', 'partial', 'failed']);

const MAX_SUMMARY_LEN = 4000;
const MAX_ERROR_LEN = 4000;
const MAX_PROGRESS_BYTES = 8 * 1024;

function redactString(value, findings) {
  if (typeof value !== 'string') return value;
  const scan = scanSensitiveData(value);
  if (!scan.clean) findings.push(...scan.findings);
  return scan.redacted ?? value;
}

function redactProgress(progress, findings) {
  if (!progress || typeof progress !== 'object') return progress;
  if (Array.isArray(progress)) {
    return progress.map((v) => (typeof v === 'string' ? redactString(v, findings) : v));
  }
  const out = {};
  for (const [k, v] of Object.entries(progress)) {
    out[k] = typeof v === 'string' ? redactString(v, findings) : v;
  }
  return out;
}

export async function GET(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;

    const outcome = await getActionOutcome(sql, orgId, actionId);
    if (!outcome) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json(outcome);
  } catch (error) {
    return apiErrorResponse(error, 'ACTION_OUTCOME_GET');
  }
}

export async function POST(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;
    const body = await request.json();

    const status = body?.status;
    if (!AGENT_TERMINAL_STATES.has(status)) {
      return NextResponse.json(
        {
          error: 'Invalid status',
          details: `status must be one of: ${[...AGENT_TERMINAL_STATES].join(', ')}`,
        },
        { status: 400 },
      );
    }

    let summary = body?.summary ?? null;
    let errorMessage = body?.error_message ?? null;
    let progress = body?.progress ?? null;

    if (status === 'failed' && !errorMessage) {
      return NextResponse.json(
        { error: 'error_message is required when status is "failed"' },
        { status: 400 },
      );
    }
    if (status === 'partial' && (progress == null || typeof progress !== 'object')) {
      return NextResponse.json(
        { error: 'progress (object) is required when status is "partial"' },
        { status: 400 },
      );
    }

    if (typeof summary === 'string' && summary.length > MAX_SUMMARY_LEN) {
      summary = summary.slice(0, MAX_SUMMARY_LEN);
    }
    if (typeof errorMessage === 'string' && errorMessage.length > MAX_ERROR_LEN) {
      errorMessage = errorMessage.slice(0, MAX_ERROR_LEN);
    }
    if (progress != null) {
      const size = Buffer.byteLength(JSON.stringify(progress), 'utf8');
      if (size > MAX_PROGRESS_BYTES) {
        return NextResponse.json(
          { error: `progress payload too large (${size} bytes; max ${MAX_PROGRESS_BYTES})` },
          { status: 400 },
        );
      }
    }

    const dlpFindings = [];
    summary = redactString(summary, dlpFindings);
    errorMessage = redactString(errorMessage, dlpFindings);
    progress = redactProgress(progress, dlpFindings);

    const result = await setActionOutcome(sql, orgId, actionId, {
      status,
      summary,
      error_message: errorMessage,
      progress,
    });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ error: 'Action not found' }, { status: 404 });
      }
      if (result.reason === 'conflict') {
        return NextResponse.json(
          { error: 'outcome already set', current_status: result.current_status },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Emit the same { orgId, action } envelope the PATCH route uses so the SSE
    // serializer (which reads payload.action) sends a populated frame. Without
    // the action key the frame serialized to `data: null` and every terminal
    // outcome update was dropped by live consumers.
    void publishOrgEvent(EVENTS.ACTION_UPDATED, {
      orgId,
      action: { action_id: actionId, ...result.outcome },
    });

    return NextResponse.json({
      outcome: result.outcome,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter((f) => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map((f) => f.category))],
      },
    });
  } catch (error) {
    return apiErrorResponse(error, 'ACTION_OUTCOME_POST');
  }
}
