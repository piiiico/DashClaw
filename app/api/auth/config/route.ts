import { NextResponse } from 'next/server';
import { getAuthConfig, getMissingAuthMessage } from '../../../lib/authConfig.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const isProd = process.env.NODE_ENV === 'production';
  const authConfig = getAuthConfig();
  const providers = [...authConfig.oauthProviders];

  if (!isProd) {
    if (!authConfig.hasGitHub) providers.push({ id: 'github', name: 'GitHub (Mock)' });
    if (!authConfig.hasGoogle) providers.push({ id: 'google', name: 'Google (Mock)' });
  }

  return NextResponse.json({
    isProd,
    providers,
    localAuthEnabled: authConfig.hasLocalPassword,
    message: authConfig.hasAnySignInMethod ? null : getMissingAuthMessage(),
  });
}
