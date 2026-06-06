import { NextResponse } from 'next/server';
import type { z } from 'zod';

function formatZodIssues(issues: z.ZodIssue[]): Array<{ path: string; code: string; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

export type ParseJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export async function parseJsonWithSchema<S extends z.ZodTypeAny>(
  request: Request,
  schema: S
): Promise<ParseJsonResult<z.infer<S>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Validation failed',
          details: formatZodIssues(parsed.error.issues),
        },
        { status: 400 }
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
