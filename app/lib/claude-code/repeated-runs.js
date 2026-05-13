/**
 * Honest, evidence-based repeated-tool-run detector.
 *
 * Inputs: an array of tool events in session order, each: {name, requestId?, target?}.
 * Output: array of signals, each:
 *   {
 *     name,
 *     count,
 *     startIndex, endIndex,
 *     confidence: 'high' | 'medium' | 'low',
 *     evidence: string,
 *     requestSpread: number,    // distinct requestIds covered by the run
 *     targetSpread: number,     // distinct targets covered by the run
 *     allInOneRequest: boolean, // run sits inside a single model request (likely a batch)
 *   }
 *
 * Confidence rules:
 *   high   — same tool, same target (or unknown target), spans ≥ 3 distinct
 *            requests and no progress (no other tool interleaved)
 *   medium — same tool across ≥ 2 distinct requests but target signal weak
 *   low    — same tool repeated within a SINGLE request (batch — not a stuck
 *            loop), or no request_id evidence at all
 *
 * Important: callers should NOT compute "savings" from low-confidence runs.
 *
 * Ported from AgentLens (`src/repeated-runs.js`) — CommonJS → ESM. Pure.
 */

export const RUN_THRESHOLD = 3;

export function detectRepeatedRuns(events, threshold = RUN_THRESHOLD) {
  if (!Array.isArray(events) || events.length < threshold) return [];
  const signals = [];
  let runName = null;
  let runStart = -1;
  for (let i = 0; i <= events.length; i++) {
    const cur = i < events.length ? events[i] : null;
    if (cur && cur.name === runName) continue;
    if (runName !== null && (i - runStart) >= threshold) {
      const run = events.slice(runStart, i);
      signals.push(classifyRun(run, runStart, i - 1));
    }
    runName = cur ? cur.name : null;
    runStart = i;
  }
  return signals;
}

function classifyRun(run, startIndex, endIndex) {
  const name = run[0].name;
  const requestIds = new Set(run.map(e => e.requestId).filter(Boolean));
  const targets = new Set(run.map(e => e.target).filter(t => t !== null && t !== undefined && t !== ''));
  const requestSpread = requestIds.size;
  const targetSpread = targets.size;
  const allInOneRequest = requestSpread === 1 || (requestSpread === 0 && run.every(e => e.requestId === run[0].requestId));

  let confidence = 'low';
  let evidence;
  if (requestSpread >= 3 && targetSpread <= 1) {
    confidence = 'high';
    evidence = `${run.length} ${name} calls across ${requestSpread} model requests on the same target — strong signal of repeated work without progress.`;
  } else if (requestSpread >= 2) {
    confidence = 'medium';
    evidence = targetSpread > 1
      ? `${run.length} ${name} calls across ${requestSpread} requests, touching ${targetSpread} different targets — could be batch follow-ups rather than a loop.`
      : `${run.length} ${name} calls across ${requestSpread} requests — same tool but unknown target similarity.`;
  } else {
    confidence = 'low';
    evidence = allInOneRequest
      ? `${run.length} ${name} calls inside a single model request — almost certainly a batch, not a stuck loop.`
      : `${run.length} ${name} calls with no request_id evidence — cannot tell loop from batch.`;
  }

  return {
    name,
    count: run.length,
    startIndex,
    endIndex,
    confidence,
    evidence,
    requestSpread,
    targetSpread,
    allInOneRequest: !!allInOneRequest,
    targets: [...targets].slice(0, 8),
  };
}
