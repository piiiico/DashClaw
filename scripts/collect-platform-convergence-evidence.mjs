#!/usr/bin/env node

import fs from 'node:fs/promises';

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const OUT_PATH = process.argv[3] || '';
const API_KEY = process.env.DASHCLAW_API_KEY || '';
const IS_LOCAL_BASE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE_URL);
const VERBOSE = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.CONVERGENCE_VERBOSE || '').toLowerCase()
);

function log(message) {
  if (VERBOSE) {
    console.log(`[convergence-evidence] ${message}`);
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const BENCH_ITERATIONS = parsePositiveInt(
  process.env.CONVERGENCE_BENCH_ITERATIONS,
  IS_LOCAL_BASE ? 12 : 120
);
const BENCH_CONCURRENCY = parsePositiveInt(
  process.env.CONVERGENCE_BENCH_CONCURRENCY,
  IS_LOCAL_BASE ? 3 : 6
);
const SSE_SEND_COUNT = parsePositiveInt(
  process.env.CONVERGENCE_SSE_SEND_COUNT,
  IS_LOCAL_BASE ? 12 : 40
);
const RETRY_429_MAX = parsePositiveInt(
  process.env.CONVERGENCE_RETRY_429_MAX,
  IS_LOCAL_BASE ? 1 : 0
);
const RETRY_429_WAIT_MS = parsePositiveInt(
  process.env.CONVERGENCE_RETRY_429_WAIT_MS,
  IS_LOCAL_BASE ? 65000 : 1000
);
const REPLAY_CONNECT_TIMEOUT_MS = parsePositiveInt(
  process.env.CONVERGENCE_REPLAY_CONNECT_TIMEOUT_MS,
  IS_LOCAL_BASE ? 5000 : 10000
);

const headers = {
  'Content-Type': 'application/json',
};
if (API_KEY) headers['x-api-key'] = API_KEY;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeLatencies(latencies) {
  return {
    count: latencies.length,
    p50_ms: Number(percentile(latencies, 50).toFixed(2)),
    p95_ms: Number(percentile(latencies, 95).toFixed(2)),
    p99_ms: Number(percentile(latencies, 99).toFixed(2)),
    max_ms: Number(Math.max(...latencies, 0).toFixed(2)),
  };
}

async function request(method, path, body, extraHeaders = {}) {
  let attempts = 0;
  while (true) {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { ...headers, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    const elapsed = performance.now() - start;
    let data = null;
    try {
      data = await res.json();
    } catch {}

    if (res.status !== 429 || attempts >= RETRY_429_MAX) {
      return { status: res.status, data, elapsed_ms: elapsed, attempts };
    }

    attempts += 1;
    await new Promise((r) => setTimeout(r, RETRY_429_WAIT_MS));
  }
}

function extractActionId(data) {
  if (!data || typeof data !== 'object') return null;
  return data.action_id || data.action?.action_id || data.action?.id || null;
}

async function benchmarkEndpoint({
  name,
  method = 'GET',
  path,
  body = null,
  iterations = BENCH_ITERATIONS,
  concurrency = BENCH_CONCURRENCY,
}) {
  const latencies = [];
  let success = 0;
  let failures = 0;
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= iterations) return;
      const res = await request(method, path, body);
      latencies.push(res.elapsed_ms);
      if (res.status >= 200 && res.status < 300) success += 1;
      else failures += 1;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    name,
    method,
    path,
    success,
    failures,
    success_rate: Number(((success / iterations) * 100).toFixed(2)),
    ...summarizeLatencies(latencies),
  };
}

function parseSseBlock(raw) {
  const lines = raw.replace(/\r/g, '').split('\n').filter(Boolean);
  let id = null;
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  let parsed = null;
  try {
    parsed = data ? JSON.parse(data) : null;
  } catch {}
  return { id, event, data: parsed };
}

async function openSseStream({ lastEventId = null } = {}) {
  const extraHeaders = {};
  if (lastEventId) extraHeaders['last-event-id'] = lastEventId;
  const res = await fetch(`${BASE_URL}/api/stream`, {
    method: 'GET',
    headers: { ...headers, ...extraHeaders },
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE connect failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const state = {
    all: [],
    actionCreated: [],
    connected: false,
    errors: [],
  };

  let buffer = '';
  let closed = false;

  const done = (async () => {
    try {
      while (!closed) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let splitIdx = buffer.indexOf('\n\n');
        while (splitIdx >= 0) {
          const block = buffer.slice(0, splitIdx);
          buffer = buffer.slice(splitIdx + 2);
          const parsed = parseSseBlock(block);
          state.all.push(parsed);
          if (parsed.event === 'connected') state.connected = true;
          if (parsed.event === 'action.created') state.actionCreated.push(parsed);
          splitIdx = buffer.indexOf('\n\n');
        }
      }
    } catch (err) {
      state.errors.push(err?.message || String(err));
    }
  })();

  return {
    state,
    close: async () => {
      closed = true;
      const cancelPromise = reader.cancel().catch(() => {});
      await Promise.race([
        cancelPromise,
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
      await Promise.race([
        done,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    },
  };
}

function countUniqueActions(actionEvents, expectedIds) {
  const seen = new Set();
  for (const evt of actionEvents) {
    const id = evt?.data?.action_id || evt?.data?.id || null;
    if (!id) continue;
    if (expectedIds && !expectedIds.has(id)) continue;
    seen.add(id);
  }
  return seen.size;
}

async function waitFor(predicate, timeoutMs = 30000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function runRealtimeEvidence() {
  log('opening SSE streams');
  const streamA = await openSseStream();
  const streamB = await openSseStream();

  const expectedActionIds = new Set();
  const postStatusCounts = {};
  const sendCount = SSE_SEND_COUNT;
  for (let i = 0; i < sendCount; i += 1) {
    const post = await request('POST', '/api/actions', {
      agent_id: 'convergence-load-agent',
      action_type: 'monitor',
      declared_goal: `SSE evidence event ${i + 1}`,
      risk_score: 5,
    });
    postStatusCounts[post.status] = (postStatusCounts[post.status] || 0) + 1;
    const actionId = extractActionId(post.data);
    if (post.status >= 200 && post.status < 300 && actionId) {
      expectedActionIds.add(actionId);
    }
  }
  log(`posted primary SSE events; accepted=${expectedActionIds.size}/${sendCount}`);

  await waitFor(
    () => countUniqueActions(streamA.state.actionCreated, expectedActionIds) >= expectedActionIds.size
      && countUniqueActions(streamB.state.actionCreated, expectedActionIds) >= expectedActionIds.size,
    45000,
    150
  );

  const receivedAUnique = countUniqueActions(streamA.state.actionCreated, expectedActionIds);
  const receivedBUnique = countUniqueActions(streamB.state.actionCreated, expectedActionIds);
  const totalA = streamA.state.actionCreated.filter((e) => expectedActionIds.has(e?.data?.action_id)).length;
  const totalB = streamB.state.actionCreated.filter((e) => expectedActionIds.has(e?.data?.action_id)).length;

  const lastEventId = streamA.state.actionCreated.at(-1)?.id || null;
  log(`primary receive counts: A=${receivedAUnique}, B=${receivedBUnique}, lastEventId=${lastEventId || 'none'}`);
  await streamA.close();

  const replayExpected = new Set();
  const replayPostStatusCounts = {};
  for (let i = 0; i < 5; i += 1) {
    const post = await request('POST', '/api/actions', {
      agent_id: 'convergence-load-agent',
      action_type: 'monitor',
      declared_goal: `SSE replay event ${i + 1}`,
      risk_score: 5,
    });
    replayPostStatusCounts[post.status] = (replayPostStatusCounts[post.status] || 0) + 1;
    const actionId = extractActionId(post.data);
    if (post.status >= 200 && post.status < 300 && actionId) {
      replayExpected.add(actionId);
    }
  }
  log(`posted replay events; accepted=${replayExpected.size}/5`);

  let replayStream = null;
  let replayRecovered = 0;
  let replayError = null;
  try {
    replayStream = await Promise.race([
      openSseStream({ lastEventId }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('replay stream connect timeout')), REPLAY_CONNECT_TIMEOUT_MS)),
    ]);
    await waitFor(() => countUniqueActions(replayStream.state.actionCreated, replayExpected) >= replayExpected.size, 20000, 150);
    replayRecovered = countUniqueActions(replayStream.state.actionCreated, replayExpected);
  } catch (err) {
    replayError = err?.message || String(err);
  }
  log(`replay recovered=${replayRecovered}/${replayExpected.size}`);

  if (replayStream) {
    await replayStream.close();
  }
  await streamB.close();

  const expectedCount = expectedActionIds.size;
  const deliveryRateA = expectedCount ? (receivedAUnique / expectedCount) * 100 : 0;
  const deliveryRateB = expectedCount ? (receivedBUnique / expectedCount) * 100 : 0;
  const duplicateRateA = totalA ? ((totalA - receivedAUnique) / totalA) * 100 : 0;
  const duplicateRateB = totalB ? ((totalB - receivedBUnique) / totalB) * 100 : 0;

  return {
    expected_events: expectedCount,
    action_post_status_counts: postStatusCounts,
    replay_post_status_counts: replayPostStatusCounts,
    subscriber_a: {
      unique_received: receivedAUnique,
      total_received: totalA,
      delivery_success_rate_pct: Number(deliveryRateA.toFixed(3)),
      duplicate_rate_pct: Number(duplicateRateA.toFixed(3)),
    },
    subscriber_b: {
      unique_received: receivedBUnique,
      total_received: totalB,
      delivery_success_rate_pct: Number(deliveryRateB.toFixed(3)),
      duplicate_rate_pct: Number(duplicateRateB.toFixed(3)),
    },
    replay: {
      last_event_id_used: lastEventId,
      expected_replay_events: replayExpected.size,
      recovered_unique_events: replayRecovered,
      recovered_within_60s: replayRecovered >= replayExpected.size,
      error: replayError,
    },
  };
}

async function main() {
  log(`starting run against ${BASE_URL}`);
  const health = await request('GET', '/api/health');
  if (health.status < 200 || health.status >= 300) {
    throw new Error(`Server health check failed (${health.status}) at ${BASE_URL}`);
  }

  const seed = await request('POST', '/api/actions', {
    agent_id: 'convergence-bench-agent',
    action_type: 'monitor',
    declared_goal: 'Seed benchmark action',
    risk_score: 5,
  });
  let seededActionId = extractActionId(seed.data);
  if (!seededActionId) {
    const listFallback = await request('GET', '/api/actions?limit=1');
    seededActionId = listFallback.data?.actions?.[0]?.action_id || null;
  }
  log(`seeded action id: ${seededActionId || 'none'}`);

  const ws1Benchmarks = [];
  ws1Benchmarks.push(await benchmarkEndpoint({
    name: 'actions.list',
    path: '/api/actions?limit=25',
  }));
  if (seededActionId) {
    ws1Benchmarks.push(await benchmarkEndpoint({
      name: 'actions.detail',
      path: `/api/actions/${seededActionId}`,
    }));
  } else {
    ws1Benchmarks.push({
      name: 'actions.detail',
      method: 'GET',
      path: '/api/actions/{actionId}',
      skipped: true,
      reason: 'No action_id available from seed or list fallback',
      success: 0,
      failures: 0,
      success_rate: 0,
      count: 0,
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
      max_ms: 0,
    });
  }
  ws1Benchmarks.push(await benchmarkEndpoint({
    name: 'messages.inbox',
    path: '/api/messages?agent_id=convergence-bench-agent&direction=inbox&limit=25',
  }));
  ws1Benchmarks.push(await benchmarkEndpoint({
    name: 'handoffs.list',
    path: '/api/handoffs?agent_id=convergence-bench-agent&limit=25',
  }));

  const realtime = await runRealtimeEvidence();
  log('realtime evidence complete');

  const maxP95 = Math.max(...ws1Benchmarks.map((b) => b.p95_ms));

  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    run_profile: {
      local_safe_defaults: IS_LOCAL_BASE,
      bench_iterations: BENCH_ITERATIONS,
      bench_concurrency: BENCH_CONCURRENCY,
      sse_send_count: SSE_SEND_COUNT,
      retry_429_max: RETRY_429_MAX,
      retry_429_wait_ms: RETRY_429_WAIT_MS,
      replay_connect_timeout_ms: REPLAY_CONNECT_TIMEOUT_MS,
    },
    ws1_latency: {
      endpoint_benchmarks: ws1Benchmarks,
      max_endpoint_p95_ms: Number(maxP95.toFixed(2)),
      regression_guard_threshold_pct: 10,
      notes: 'Endpoint p95 values captured post-migration for critical repository-backed routes.',
    },
    ws3_realtime: realtime,
    ws3_slo_checks: {
      delivery_success_rate_target_pct: 99.9,
      duplicate_tolerance_target_pct: 0.1,
      replay_window_target_seconds: 60,
      met: {
        delivery_success_rate: realtime.subscriber_a.delivery_success_rate_pct >= 99.9 && realtime.subscriber_b.delivery_success_rate_pct >= 99.9,
        duplicate_tolerance: realtime.subscriber_a.duplicate_rate_pct <= 0.1 && realtime.subscriber_b.duplicate_rate_pct <= 0.1,
        replay_window: realtime.replay.recovered_within_60s,
      },
    },
  };

  const serialized = JSON.stringify(report, null, 2);
  if (OUT_PATH) {
    await fs.writeFile(OUT_PATH, `${serialized}\n`, 'utf8');
    log(`wrote report to ${OUT_PATH}`);
    console.log(`Wrote platform convergence evidence: ${OUT_PATH}`);
  } else {
    console.log(serialized);
  }
}

main().catch((err) => {
  console.error(`Evidence collection failed: ${err.message}`);
  process.exit(1);
});
