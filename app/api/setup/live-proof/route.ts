export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createLiveVerificationProofToken } from '../../../lib/liveVerificationProof.mjs';

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const body = await request.json();
    const { token, proof } = await createLiveVerificationProofToken(body, {
      env: process.env,
      host: url.host,
    });

    const origin = `${url.protocol}//${url.host}`;
    const setupUrl = `${origin}/setup?proof=${encodeURIComponent(token)}`;

    return Response.json({
      ok: true,
      proof,
      proof_token: token,
      setup_url: setupUrl,
      proof_download_url: `${origin}/api/setup/proof?proof=${encodeURIComponent(token)}&download=1`,
    });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : 'Invalid live verification proof payload',
      },
      { status: 400 }
    );
  }
}
