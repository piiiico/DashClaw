import { z } from 'zod';

// Helper for loose string fields that might be null/undefined
const optionalString = z.string().nullish().transform(val => val || null);
const optionalNumber = z.number().nullish().transform(val => (val == null ? 0 : val));

export const syncSchema = z.object({
  agent_id: z.string().optional(),
  target_org_id: z.string().max(100).optional(),

  connections: z.array(z.object({
    provider: z.string().max(100),
    auth_type: z.string().max(50).default('api_key'),
    status: z.string().max(50).default('active'),
    metadata: z.record(z.string(), z.any()).nullish(),
  })).max(1000).optional(),

  memory: z.object({
    health: z.object({
      score: optionalNumber,
      total_files: optionalNumber,
      total_lines: optionalNumber,
      total_size_kb: optionalNumber,
      memory_md_lines: optionalNumber,
      oldest_daily: optionalString,
      newest_daily: optionalString,
      days_with_notes: optionalNumber,
      avg_lines_per_day: optionalNumber,
      duplicates: optionalNumber,
      stale_count: optionalNumber,
    }).optional(),
    entities: z.array(z.object({
      name: z.string().max(255),
      type: z.string().max(50).optional(),
      mentions: optionalNumber,
      mention_count: optionalNumber,
    })).max(100).optional(),
    topics: z.array(z.object({
      name: z.string().max(255),
      mentions: optionalNumber,
      mention_count: optionalNumber,
    })).max(100).optional(),
  }).optional(),

  goals: z.array(z.object({
    title: z.string().max(500),
    category: optionalString,
    description: optionalString,
    target_date: optionalString,
    progress: optionalNumber.pipe(z.number().min(0).max(100)),
    status: z.string().max(50).default('active'),
  })).max(2000).optional(),

  learning: z.array(z.object({
    decision: z.string().max(2000),
    context: optionalString,
    reasoning: optionalString,
    outcome: z.string().max(2000).default('pending'),
    confidence: optionalNumber.pipe(z.number().min(0).max(100)),
  })).max(2000).optional(),

  content: z.array(z.object({
    title: z.string().max(500),
    platform: optionalString,
    status: z.string().max(50).default('draft'),
    url: optionalString,
    body: optionalString,
  })).max(2000).optional(),

  inspiration: z.array(z.object({
    title: z.string().max(500),
    description: optionalString,
    category: optionalString,
    score: optionalNumber,
    status: z.string().max(50).default('pending'),
    source: optionalString,
  })).max(2000).optional(),

  context_points: z.array(z.object({
    content: z.string().max(2000),
    category: z.string().max(50).default('general'),
    // Zod v4 typing rejects a ZodDefault as a .pipe() target; the runtime
    // schema is unchanged (optionalNumber always yields a number, so .default(5)
    // is inert but preserved). Cast keeps the pipe's output type as number.
    importance: optionalNumber.pipe(z.number().min(1).max(10).default(5) as unknown as z.ZodNumber),
    session_date: optionalString,
  })).max(5000).optional(),

  context_threads: z.array(z.object({
    name: z.string().max(255),
    summary: optionalString,
  })).max(1000).optional(),

  handoffs: z.array(z.object({
    session_date: optionalString,
    summary: z.string().max(4000),
    key_decisions: z.any().optional(), // JSON
    open_tasks: z.any().optional(), // JSON
    mood_notes: optionalString,
    next_priorities: z.any().optional(), // JSON
  })).max(1000).optional(),

  snippets: z.array(z.object({
    name: z.string().max(255),
    description: optionalString,
    code: z.string().max(10000),
    language: optionalString,
    tags: z.any().optional(), // JSON
  })).max(1000).optional(),

  relationships: z.array(z.object({
    name: z.string().max(255),
    relationship_type: z.string().max(100).default('contact'),
    description: optionalString,
    source_file: optionalString,
  })).max(1000).optional(),

  capabilities: z.array(z.object({
    name: z.string().max(255),
    capability_type: z.string().max(50).default('skill'),
    description: optionalString,
    source_path: optionalString,
    file_count: optionalNumber,
    metadata: z.record(z.string(), z.any()).nullish(),
  })).max(1000).optional(),

  preferences: z.object({
    observations: z.array(z.object({
      observation: z.string().max(2000),
      category: optionalString,
      importance: optionalNumber,
    })).max(1000).optional(),
    preferences: z.array(z.object({
      preference: z.string().max(2000),
      category: optionalString,
      confidence: optionalNumber,
    })).max(1000).optional(),
    moods: z.array(z.object({
      mood: z.string().max(100),
      energy: optionalString,
      notes: optionalString,
    })).max(1000).optional(),
    approaches: z.array(z.object({
      approach: z.string().max(500),
      context: optionalString,
      success: z.boolean().optional(),
    })).max(1000).optional(),
  }).optional(),
});
