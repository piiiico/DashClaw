export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { sampleStatus } from '../../../lib/behavior/sample-store.js';
import { DEFAULT_OPTIONS } from '../../../lib/behavior/analyzer.js';

/**
 * GET /api/behavior/samples — status of the LOCAL behavior-sample log that the
 * Policy Coach analyzes. Reports recorder enablement, directory, counts,
 * observed agents, and the captured window. Reads local files only; never
 * touches the database and never uploads samples. @beta
 */
export async function GET() {
  try {
    const status = await sampleStatus();
    const minSamples = DEFAULT_OPTIONS.minSamples;
    const ready = status.agents.some((a) => a.count >= minSamples);
    return NextResponse.json({ ...status, ready, min_samples: minSamples });
  } catch (err) {
    console.error('[behavior/samples] GET error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
