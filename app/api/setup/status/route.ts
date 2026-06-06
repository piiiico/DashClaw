import { NextResponse } from 'next/server';
import { getSetupStatus } from '../../../lib/setupStatus.mjs';

export const dynamic = 'force-dynamic';

// Check if the dashboard is properly configured
export async function GET() {
  try {
    return NextResponse.json(await getSetupStatus());
  } catch (error) {
    console.error('Setup status error:', error);
    return NextResponse.json({
      configured: false,
      reason: 'connection_error',
      message: 'Unable to connect to database'
    });
  }
}
