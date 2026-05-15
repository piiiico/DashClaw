#!/usr/bin/env node

// CLAUDE.md: every entry point must surface async rejections.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

import { rebuildLearningRecommendations } from '../app/lib/learningLoop.service.js';
import { createSqlFromEnv } from './_db.mjs';

function parseArgInt(name, fallback, min, max) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = parseInt(raw.slice(prefix.length), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(value, max));
}

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const lookbackDays = parseArgInt('lookback-days', 30, 1, 365);
  const minSamples = parseArgInt('min-samples', 5, 2, 100);
  const episodeLimit = parseArgInt('episode-limit', 5000, 100, 10000);

  const sql = createSqlFromEnv();
  const orgs = await sql`SELECT id FROM organizations ORDER BY id`;

  const summary = [];
  for (const org of orgs) {
    const rebuilt = await rebuildLearningRecommendations(sql, org.id, {
      lookbackDays,
      minSamples,
      episodeLimit,
    });
    summary.push({
      org_id: org.id,
      episodes_scanned: rebuilt.episodes_scanned,
      recommendations: rebuilt.recommendations.length,
    });
  }

  console.log(JSON.stringify({ summary, options: { lookbackDays, minSamples, episodeLimit } }, null, 2));
}

run().catch((error) => {
  console.error(`Recommendation rebuild failed: ${error.message}`);
  process.exit(1);
});
