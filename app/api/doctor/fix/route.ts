// app/api/doctor/fix/route.ts
import { NextResponse } from 'next/server';
import { applyFix, runDoctor } from '../../../lib/doctor/engine.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    if (!action) {
      return NextResponse.json(
        { error: 'Missing required field: action' },
        { status: 400 },
      );
    }

    // API endpoint never allows local-only fixes (env file writes)
    const result = await applyFix(action, params, { allowLocal: false });
    const recheck = await runDoctor({ includeFixes: true });

    return NextResponse.json({ ...result, recheck });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
