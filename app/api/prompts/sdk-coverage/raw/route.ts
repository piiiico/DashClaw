import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const filePath = resolve(process.cwd(), 'docs', 'prompts', 'dashclaw-sdk-coverage.md');
    const content = readFileSync(filePath, 'utf8');

    return new Response(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error reading SDK coverage prompt:', error);
    return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
  }
}
