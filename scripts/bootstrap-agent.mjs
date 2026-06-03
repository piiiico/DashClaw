#!/usr/bin/env node

/**
 * Bootstrap Agent Scanner
 * Reads an agent's workspace and pushes discovered state to DashClaw.
 *
 * Usage:
 *   node scripts/bootstrap-agent.mjs --dir /path/to/agent --agent-id my-agent [options]
 *
 * Options:
 *   --dir          Agent workspace directory (required)
 *   --agent-id     Agent identifier (required)
 *   --agent-name   Human-readable agent name
 *   --base-url     API base URL (default: http://localhost:3000)
 *   --api-key      API key (falls back to DASHCLAW_API_KEY / DASHCLAW_API_KEY env)
 *   --local        Shorthand for --base-url http://localhost:3000
 *   --org-id       Target org ID (overrides API key org resolution)
 *   --dry-run      Print discovered data without pushing
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { discoverFiles } from './lib/discovery.mjs';
import { classifyAll, groupByCategory, CATEGORIES } from './lib/classifiers.mjs';
import {
  extractIdentity,
  extractUserProfile,
  extractRelationships,
  extractCapabilities,
  extractOperationalConfig,
  extractProjects,
  extractCreativeWorks,
} from './lib/extractors.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const MAX_GOALS = 50;

function isValidGoal(title) {
  if (!title || title.length <= 5) return false;
  if (title.split(/\s+/).length < 2) return false; // single-word items
  const lower = title.toLowerCase();
  if (['done', 'todo', 'n/a', 'tbd', 'wip', 'yes', 'no'].includes(lower)) return false;
  return true;
}

// ─── Env / Args ─────────────────────────────────────────────

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf8').split('\n');
  for (const l of lines) {
    const idx = l.indexOf('=');
    if (idx > 0 && !l.startsWith('#')) {
      const key = l.slice(0, idx).trim();
      if (!process.env[key]) {
        process.env[key] = l.slice(idx + 1).trim();
      }
    }
  }
}

function loadEnv() {
  loadEnvFile(resolve(projectRoot, '.env.local'));
  loadEnvFile(resolve(projectRoot, '.env'));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--local') args.local = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i];
    }
  }
  return args;
}

// ─── File Helpers ───────────────────────────────────────────

function safeRead(filePath) {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
  } catch { return null; }
}

function safeStat(filePath) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function isWindowsPathLike(s) {
  if (!s || typeof s !== 'string') return false;
  return /^[a-zA-Z]:\\/.test(s) || s.includes('\\Users\\') || s.includes('\\AppData\\');
}

function isUnixPathLike(s) {
  if (!s || typeof s !== 'string') return false;
  return s.startsWith('/home/') || s.startsWith('/Users/') || s.startsWith('/var/') || s.startsWith('/etc/');
}

function isSecretLike(s) {
  if (!s || typeof s !== 'string') return false;
  const v = s.trim();
  if (v.length < 12) return false;
  if (v.includes('-----BEGIN') && v.includes('PRIVATE KEY')) return true;
  if (/^oc_(live|test)_[a-zA-Z0-9]{12,}/.test(v)) return true;
  if (/^sk_(live|test)_[a-zA-Z0-9]{12,}/.test(v)) return true;
  if (/^ghp_[a-zA-Z0-9]{20,}/.test(v)) return true;
  if (/^xox[baprs]-/.test(v)) return true;
  if (/^AIza[0-9A-Za-z-_]{30,}/.test(v)) return true;
  if (/^AKIA[0-9A-Z]{16}/.test(v)) return true;
  if (/^eyJ[a-zA-Z0-9_-]{20,}\\.[a-zA-Z0-9_-]{10,}\\.[a-zA-Z0-9_-]{10,}$/.test(v)) return true; // JWT-ish
  return false;
}

function isDailyMemoryLogPath(filePath) {
  const base = basename(filePath);
  // Matches: 2026-02-14.md, 2026-02-14-1937.md, etc.
  return /^\d{4}-\d{2}-\d{2}(?:-[\w]+)?\.md$/i.test(base) && dirname(filePath).toLowerCase().endsWith('memory');
}

function gatherWorkspaceMarkdownSources(dir) {
  // Prefer curated sources over "scan everything" to avoid noisy imports.
  const sources = [];

  // Root docs (common in OpenClaw-style workspaces)
  for (const f of ['MEMORY.md', 'projects.md', 'insights.md', 'SECURITY.md', 'USER.md', 'IDENTITY.md', 'SOUL.md', 'CLAUDE.md']) {
    const p = join(dir, f);
    if (existsSync(p)) sources.push(p);
  }

  // README and CONTRIBUTING at any level (up to 5 deep)
  sources.push(...findFiles(dir, /^(README|CONTRIBUTING)\.md$/i, 5));

  // docs/ folder markdown files (up to 5 deep within docs/)
  const docsDir = join(dir, 'docs');
  if (existsSync(docsDir)) {
    sources.push(...findFiles(docsDir, /\.md$/i, 5));
  }

  // ".claude" memory (Claude-style) if present
  const claudeDir = join(dir, '.claude');
  if (existsSync(claudeDir)) {
    sources.push(...findFiles(claudeDir, /\.md$/i, 5));
  }

  // Hierarchical memory folder (OpenClaw-style): memory/**/*.md
  const memDir = existsSync(join(dir, 'memory')) ? join(dir, 'memory') : (existsSync(join(dir, 'Memory')) ? join(dir, 'Memory') : null);
  if (memDir) {
    const all = findFiles(memDir, /\.md$/i, 6);
    const daily = [];
    const other = [];

    for (const f of all) (isDailyMemoryLogPath(f) ? daily : other).push(f);

    // Include all structured memory plus a slice of recent daily logs.
    daily.sort((a, b) => (safeStat(b)?.mtimeMs || 0) - (safeStat(a)?.mtimeMs || 0));
    sources.push(...other);
    sources.push(...daily.slice(0, 60));
  }

  return uniq(sources).filter((p) => extname(p).toLowerCase() === '.md');
}

function findFiles(dir, pattern, maxDepth = 5, depth = 0) {
  if (depth > maxDepth) return [];
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        results.push(...findFiles(full, pattern, maxDepth, depth + 1));
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(full);
      }
    }
  } catch { /* permission denied etc */ }
  return results;
}

// ─── Provider Detection ─────────────────────────────────────

const PROVIDER_MAP = {
  'GITHUB_': { provider: 'github', auth_type: 'oauth' },
  'GOOGLE_': { provider: 'google', auth_type: 'oauth' },
  'STRIPE_': { provider: 'stripe', auth_type: 'api_key' },
  'OPENAI_': { provider: 'openai', auth_type: 'api_key' },
  'ANTHROPIC_': { provider: 'anthropic', auth_type: 'api_key' },
  'RESEND_': { provider: 'resend', auth_type: 'api_key' },
  'AWS_': { provider: 'aws', auth_type: 'api_key' },
  'VERCEL_': { provider: 'vercel', auth_type: 'api_key' },
  'SLACK_': { provider: 'slack', auth_type: 'api_key' },
  'DISCORD_': { provider: 'discord', auth_type: 'api_key' },
  'TWILIO_': { provider: 'twilio', auth_type: 'api_key' },
  'SENDGRID_': { provider: 'sendgrid', auth_type: 'api_key' },
  'SUPABASE_': { provider: 'supabase', auth_type: 'api_key' },
  'FIREBASE_': { provider: 'firebase', auth_type: 'api_key' },
  'REDIS_': { provider: 'redis', auth_type: 'api_key' },
  'MONGODB_': { provider: 'mongodb', auth_type: 'api_key' },
  'POSTGRES': { provider: 'postgresql', auth_type: 'api_key' },
  'SENTRY_': { provider: 'sentry', auth_type: 'api_key' },
  'DATADOG_': { provider: 'datadog', auth_type: 'api_key' },
  'CLOUDFLARE_': { provider: 'cloudflare', auth_type: 'api_key' },
  'LINEAR_': { provider: 'linear', auth_type: 'api_key' },
  'NOTION_': { provider: 'notion', auth_type: 'api_key' },
};

const PKG_PROVIDER_MAP = {
  'stripe': { provider: 'stripe', auth_type: 'subscription' },
  '@anthropic-ai/sdk': { provider: 'anthropic', auth_type: 'api_key' },
  'openai': { provider: 'openai', auth_type: 'api_key' },
  '@neondatabase/serverless': { provider: 'neon', auth_type: 'api_key' },
  'resend': { provider: 'resend', auth_type: 'api_key' },
  '@supabase/supabase-js': { provider: 'supabase', auth_type: 'api_key' },
  'firebase': { provider: 'firebase', auth_type: 'api_key' },
  'firebase-admin': { provider: 'firebase', auth_type: 'api_key' },
  '@aws-sdk/client-s3': { provider: 'aws', auth_type: 'api_key' },
  'aws-sdk': { provider: 'aws', auth_type: 'api_key' },
  'redis': { provider: 'redis', auth_type: 'api_key' },
  'ioredis': { provider: 'redis', auth_type: 'api_key' },
  'mongoose': { provider: 'mongodb', auth_type: 'api_key' },
  'mongodb': { provider: 'mongodb', auth_type: 'api_key' },
  '@slack/web-api': { provider: 'slack', auth_type: 'api_key' },
  'discord.js': { provider: 'discord', auth_type: 'api_key' },
  '@sendgrid/mail': { provider: 'sendgrid', auth_type: 'api_key' },
  'next-auth': { provider: 'next-auth', auth_type: 'pre_configured' },
  '@sentry/nextjs': { provider: 'sentry', auth_type: 'api_key' },
  'dashclaw': { provider: 'dashclaw', auth_type: 'api_key' },
};

// ─── Scanner Functions ──────────────────────────────────────

function scanConnections(dir) {
  const seen = new Map(); // provider -> connection

  // Scan .env files for key NAMES only (never values)
  for (const envFile of ['.env', '.env.local', '.env.example', '.env.production']) {
    const content = safeRead(join(dir, envFile));
    if (!content) continue;
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('#') || !line.includes('=')) continue;
      const key = line.split('=')[0].trim();

      // Check for DATABASE_URL with neon
      if (key === 'DATABASE_URL') {
        // Check .env.example for hint (no real value)
        const example = safeRead(join(dir, '.env.example'));
        if (example && example.includes('neon')) {
          seen.set('neon', { provider: 'neon', auth_type: 'api_key', status: 'active' });
        } else {
          seen.set('postgresql', { provider: 'postgresql', auth_type: 'api_key', status: 'active' });
        }
        continue;
      }

      for (const [prefix, info] of Object.entries(PROVIDER_MAP)) {
        if (key.startsWith(prefix) || key === prefix.replace(/_$/, '')) {
          seen.set(info.provider, { ...info, status: 'active' });
        }
      }
    }
  }

  // Scan package.json deps
  const pkgContent = safeRead(join(dir, 'package.json'));
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, info] of Object.entries(PKG_PROVIDER_MAP)) {
        if (allDeps[dep]) {
          if (!seen.has(info.provider)) {
            seen.set(info.provider, { ...info, status: 'active' });
          }
        }
      }
    } catch { /* invalid json */ }
  }

  return [...seen.values()];
}

function scanMemory(dir) {
  const mdFiles = gatherWorkspaceMarkdownSources(dir);
  if (!mdFiles.length) return null;

  let totalLines = 0;
  let totalSize = 0;
  const entities = new Map();
  const topics = new Map();

  // Daily memory stats (based on discovered daily logs).
  const dailyStats = { oldest: null, newest: null, days: 0, avgLines: 0 };
  const dailyFiles = mdFiles.filter(isDailyMemoryLogPath);
  if (dailyFiles.length) {
    const names = dailyFiles.map((p) => basename(p)).sort();
    dailyStats.oldest = names[0].replace(/\.md$/i, '');
    dailyStats.newest = names[names.length - 1].replace(/\.md$/i, '');
    dailyStats.days = names.length;
  }

  for (const f of mdFiles) {
    try {
      const stat = safeStat(f);
      if (!stat || !stat.isFile()) continue;
      totalSize += stat.size;
      const content = readFileSync(f, 'utf8');
      const lines = content.split('\n');
      totalLines += lines.length;

      // Extract topics from headings
      for (const line of lines) {
        const headingMatch = line.match(/^#{1,3}\s+(.+)/);
        if (headingMatch) {
          const name = headingMatch[1].trim();
          if (
            name.length > 2 &&
            name.length < 100 &&
            !isWindowsPathLike(name) &&
            !isUnixPathLike(name) &&
            !isSecretLike(name)
          ) {
            topics.set(name, (topics.get(name) || 0) + 1);
          }
        }
      }

      // Extract entities: **bold** terms, `backtick` terms
      const boldMatches = content.matchAll(/\*\*([^*]+)\*\*/g);
      for (const m of boldMatches) {
        const name = m[1].trim();
        if (
          name.length > 1 &&
          name.length < 60 &&
          !isWindowsPathLike(name) &&
          !isUnixPathLike(name) &&
          !isSecretLike(name)
        ) {
          entities.set(name, { name, type: 'concept', count: (entities.get(name)?.count || 0) + 1 });
        }
      }
      const codeMatches = content.matchAll(/`([^`]+)`/g);
      for (const m of codeMatches) {
        const name = m[1].trim();
        if (
          name.length > 1 &&
          name.length < 60 &&
          !name.includes(' ') &&
          !isWindowsPathLike(name) &&
          !isUnixPathLike(name) &&
          !isSecretLike(name)
        ) {
          entities.set(name, { name, type: 'code', count: (entities.get(name)?.count || 0) + 1 });
        }
      }
    } catch { /* read error */ }
  }

  // Health score
  let score = 50;
  const memoryIndex = safeRead(join(dir, 'MEMORY.md')) || safeRead(join(dir, '.claude', 'MEMORY.md'));
  if (memoryIndex) score += 15;
  if (totalLines > 100) score += 10;
  if (mdFiles.length > 5) score += 10;
  if (existsSync(join(dir, 'memory')) || existsSync(join(dir, 'Memory'))) score += 10;
  if (topics.size > 5) score += 5;
  score = Math.min(100, score);

  if (dailyStats.days > 0) {
    // Only compute avg if we actually included daily files in the scan set.
    dailyStats.avgLines = Math.round(totalLines / Math.max(1, dailyStats.days));
  }

  return {
    health: {
      score,
      total_files: mdFiles.length,
      total_lines: totalLines,
      total_size_kb: Math.round(totalSize / 1024),
      memory_md_lines: memoryIndex ? memoryIndex.split('\n').length : 0,
      oldest_daily: dailyStats.oldest,
      newest_daily: dailyStats.newest,
      days_with_notes: dailyStats.days,
      avg_lines_per_day: dailyStats.avgLines || 0,
    },
    entities: [...entities.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 100)
      .map(e => ({ name: e.name, type: e.type, mentions: e.count })),
    topics: [...topics.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([name, count]) => ({ name, mentions: count })),
  };
}

function scanGoals(dir) {
  const goals = [];

  // Read tasks/todo.md
  const todoContent = safeRead(join(dir, 'tasks', 'todo.md'));
  if (todoContent) {
    for (const line of todoContent.split('\n')) {
      const unchecked = line.match(/^[-*]\s+\[\s\]\s+(.+)/);
      if (unchecked) {
        const title = unchecked[1].trim();
        if (isValidGoal(title) && !goals.some(g => g.title.toLowerCase().trim() === title.toLowerCase().trim())) {
          goals.push({ title, status: 'active' });
        }
        continue;
      }
      const checked = line.match(/^[-*]\s+\[x\]\s+(.+)/i);
      if (checked) {
        const title = checked[1].trim();
        if (isValidGoal(title) && !goals.some(g => g.title.toLowerCase().trim() === title.toLowerCase().trim())) {
          goals.push({ title, status: 'completed', progress: 100 });
        }
      }
    }
  }

  // OpenClaw-style: projects.md (+ checkboxes)
  const projectsMd = safeRead(join(dir, 'projects.md'));
  if (projectsMd) {
    const sections = extractSections(projectsMd);
    for (const [heading, body] of sections) {
      if (!heading || heading.toLowerCase() === 'projects') continue;

      const statusLine = (body.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1] || '').trim();
      const goalLine = (body.match(/^\*\*Goal:\*\*\s*(.+)$/m)?.[1] || '').trim();

      const statusNorm = statusLine.toLowerCase();
      const projectStatus =
        statusNorm.includes('complete') ? 'completed' :
        statusNorm.includes('paused') ? 'paused' :
        'active';

      if (goalLine && isValidGoal(goalLine) && !goals.some(g => g.title.toLowerCase().trim() === goalLine.toLowerCase().trim())) {
        goals.push({
          title: goalLine,
          status: projectStatus,
          category: 'project',
          description: `Project: ${heading}${statusLine ? ` | Status: ${statusLine}` : ''}`,
        });
      }

      const tasks = [];
      for (const line of body.split('\n')) {
        const unchecked = line.match(/^[-*]\s+\[\s\]\s+(.+)/);
        if (unchecked) tasks.push({ title: unchecked[1].trim(), status: 'active' });
        const checked = line.match(/^[-*]\s+\[x\]\s+(.+)/i);
        if (checked) tasks.push({ title: checked[1].trim(), status: 'completed', progress: 100 });
      }

      const total = tasks.filter(t => t.title).length;
      const done = tasks.filter(t => t.status === 'completed').length;
      const pct = total ? Math.round((done / total) * 100) : null;

      if (total >= 3) {
        // Group project-level checkboxes under a progress summary instead of individual goals
        if (!goals.some(g => g.title.toLowerCase().trim() === `${heading} (progress)`.toLowerCase().trim())) {
          goals.push({
            title: `${heading} (progress)`,
            status: projectStatus,
            category: 'project_progress',
            description: `Checkbox progress extracted from projects.md for ${heading}.`,
            progress: pct ?? 0,
          });
        }
        // Skip individual task goals — the progress summary captures them
      } else {
        // Fewer than 3 tasks — add them individually
        for (const t of tasks) {
          if (!t.title) continue;
          if (!isValidGoal(t.title)) continue;
          if (goals.some(g => g.title.toLowerCase().trim() === t.title.toLowerCase().trim())) continue;
          goals.push({
            title: t.title,
            status: t.status,
            progress: t.progress ?? 0,
            category: 'task',
            description: `From projects.md (${heading})`,
          });
        }
      }
    }
  }

  // OpenClaw-style: memory/pending-tasks.md (Task blocks)
  const pendingTasks = safeRead(join(dir, 'memory', 'pending-tasks.md')) || safeRead(join(dir, 'Memory', 'pending-tasks.md'));
  if (pendingTasks) {
    const taskMatches = pendingTasks.matchAll(/^\*\*Task:\*\*\s*(.+)$/gim);
    for (const m of taskMatches) {
      const title = (m[1] || '').trim();
      if (isValidGoal(title) && !goals.some(g => g.title.toLowerCase().trim() === title.toLowerCase().trim())) {
        goals.push({ title, status: 'active', category: 'pending_task', description: 'From memory/pending-tasks.md' });
      }
    }
  }

  // Check CLAUDE.md for goals/TODO sections
  const claudeMd = safeRead(join(dir, 'CLAUDE.md'));
  if (claudeMd) {
    const sections = extractSections(claudeMd);
    for (const [heading, body] of sections) {
      const lower = heading.toLowerCase();
      if (lower.includes('goal') || lower.includes('todo') || lower.includes('next step')) {
        for (const line of body.split('\n')) {
          const bullet = line.match(/^[-*]\s+(.+)/);
          if (bullet) {
            const text = bullet[1].trim();
            if (isValidGoal(text) && !goals.some(g => g.title.toLowerCase().trim() === text.toLowerCase().trim())) {
              goals.push({ title: text, status: 'active' });
            }
          }
        }
      }
    }
  }

  // Cap goals to prevent overwhelming the dashboard
  if (goals.length > MAX_GOALS) {
    const completed = goals.filter(g => g.status === 'completed');
    const active = goals.filter(g => g.status !== 'completed');
    // Keep all completed (they're bounded), trim active
    const budget = MAX_GOALS - Math.min(completed.length, Math.floor(MAX_GOALS / 4));
    const keptCompleted = completed.slice(0, Math.floor(MAX_GOALS / 4));
    const keptActive = active.slice(0, budget);
    return [...keptActive, ...keptCompleted];
  }

  return goals;
}

function scanLearning(dir) {
  const decisions = [];

  // Read tasks/lessons.md
  const lessonsContent = safeRead(join(dir, 'tasks', 'lessons.md'));
  if (lessonsContent) {
    for (const line of lessonsContent.split('\n')) {
      const bullet = line.match(/^[-*]\s+(.+)/);
      if (bullet) {
        const text = bullet[1].trim();
        if (text.length > 5) {
          decisions.push({ decision: text, outcome: 'success', confidence: 70 });
        }
      }
    }
  }

  // Check CLAUDE.md for lessons/patterns sections
  const claudeMd = safeRead(join(dir, 'CLAUDE.md'));
  if (claudeMd) {
    const sections = extractSections(claudeMd);
    for (const [heading, body] of sections) {
      const lower = heading.toLowerCase();
      if (lower.includes('lesson') || lower.includes('key pattern') || lower.includes('convention')) {
        for (const line of body.split('\n')) {
          const bullet = line.match(/^[-*]\s+(.+)/);
          if (bullet) {
            const text = bullet[1].trim();
            if (text.length > 5 && !decisions.some(d => d.decision === text)) {
              decisions.push({ decision: text, context: heading, outcome: 'success', confidence: 70 });
            }
          }
        }
      }
    }
  }

  // OpenClaw-style: memory/decisions/*.md tables (Decision | Why | Outcome)
  const memDecisionsDir = existsSync(join(dir, 'memory', 'decisions')) ? join(dir, 'memory', 'decisions') : (existsSync(join(dir, 'Memory', 'decisions')) ? join(dir, 'Memory', 'decisions') : null);
  if (memDecisionsDir) {
    const files = findFiles(memDecisionsDir, /\.md$/i, 2);
    for (const filePath of files) {
      const content = safeRead(filePath);
      if (!content) continue;

      let currentDate = null;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const h = lines[i].match(/^##\s+(\d{4}-\d{2}-\d{2})/);
        if (h) {
          currentDate = h[1];
          continue;
        }

        // Look for table header then parse following rows.
        if (lines[i].includes('| Decision') && lines[i + 1]?.includes('|---')) {
          i += 2;
          while (i < lines.length && lines[i].trim().startsWith('|')) {
            const row = lines[i].trim();
            const cols = row.split('|').map(c => c.trim()).filter(Boolean);
            const [decisionText, whyText, outcomeText] = cols;
            if (decisionText && decisionText.length > 3) {
              const o = (outcomeText || '').toLowerCase();
              const outcome =
                o.includes('success') || o.includes('complete') || o.includes('working') ? 'success' :
                o.includes('fail') ? 'failure' :
                'pending';

              const entry = {
                decision: decisionText,
                reasoning: whyText || null,
                context: currentDate ? `Decisions ${currentDate}` : `Decisions (${basename(filePath)})`,
                outcome,
                confidence: outcome === 'success' ? 75 : 60,
              };

              if (!decisions.some(d => d.decision === entry.decision && d.context === entry.context)) {
                decisions.push(entry);
              }
            }
            i++;
          }
        }
      }
    }
  }

  // OpenClaw-style: memory/pending-tasks.md "Security Lessons Learned"
  const pendingTasks = safeRead(join(dir, 'memory', 'pending-tasks.md')) || safeRead(join(dir, 'Memory', 'pending-tasks.md'));
  if (pendingTasks) {
    const lines = pendingTasks.split('\n');
    let inLessons = false;
    for (const line of lines) {
      if (/^##\s+Security Lessons Learned/i.test(line)) {
        inLessons = true;
        continue;
      }
      if (inLessons && /^##\s+/.test(line)) break;
      if (!inLessons) continue;

      const item = line.match(/^\s*\d+\.\s+(.+)/);
      if (item) {
        const text = item[1].replace(/^[\s\u2713\u2705]+/g, '').trim();
        if (text.length > 5 && !decisions.some(d => d.decision === text)) {
          decisions.push({ decision: text, context: 'Security Lessons Learned', outcome: 'success', confidence: 80 });
        }
      }
    }
  }

  return decisions;
}

function scanHandoffs(dir) {
  const handoffs = [];

  // Source: daily log files (YYYY-MM-DD*.md) in memory/ directories
  const mdFiles = gatherWorkspaceMarkdownSources(dir);
  const dailyFiles = mdFiles.filter(isDailyMemoryLogPath);

  // Sort by filename descending (most recent first)
  dailyFiles.sort((a, b) => basename(b).localeCompare(basename(a)));

  for (const filePath of dailyFiles.slice(0, 100)) {
    const content = safeRead(filePath);
    if (!content || content.trim().length < 20) continue;

    const base = basename(filePath, '.md');
    const dateMatch = base.match(/^(\d{4}-\d{2}-\d{2})/);
    const sessionDate = dateMatch ? dateMatch[1] : null;

    const lines = content.split('\n');

    // Summary: first non-heading, non-empty paragraph (up to 500 chars)
    let summary = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^[-*]\s/.test(trimmed)) continue;
      summary = trimmed.slice(0, 500);
      break;
    }
    if (!summary) summary = lines.filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 500);

    // Parse sections for structured data
    const sections = extractSections(content);
    const keyDecisions = [];
    const openTasks = [];
    let moodNotes = null;
    const nextPriorities = [];

    for (const [heading, body] of sections) {
      const lower = heading.toLowerCase();
      const bullets = body.split('\n')
        .map(l => l.match(/^[-*]\s+(.+)/))
        .filter(Boolean)
        .map(m => m[1].trim())
        .filter(t => t.length > 3);

      if (/decision|decided|chose/i.test(lower)) {
        keyDecisions.push(...bullets.slice(0, 20));
      } else if (/todo|next step|open|pending/i.test(lower)) {
        openTasks.push(...bullets.slice(0, 20));
      } else if (/mood|energy|feeling|reflection/i.test(lower)) {
        moodNotes = body.trim().slice(0, 500) || null;
      } else if (/priorit|tomorrow|next session/i.test(lower)) {
        nextPriorities.push(...bullets.slice(0, 10));
      }
    }

    handoffs.push({
      session_date: sessionDate,
      summary,
      key_decisions: keyDecisions.length ? keyDecisions : undefined,
      open_tasks: openTasks.length ? openTasks : undefined,
      mood_notes: moodNotes,
      next_priorities: nextPriorities.length ? nextPriorities : undefined,
    });
  }

  return handoffs;
}

function scanInspiration(dir) {
  const items = [];

  // Look for inspiration/idea/bookmark files at root or in memory/
  const candidates = [
    'inspiration.md', 'ideas.md', 'bookmarks.md', 'reading-list.md', 'references.md',
  ];
  const files = [];
  for (const name of candidates) {
    const rootPath = join(dir, name);
    if (existsSync(rootPath)) files.push(rootPath);
    const memPath = join(dir, 'memory', name);
    if (existsSync(memPath)) files.push(memPath);
    const memCapPath = join(dir, 'Memory', name);
    if (existsSync(memCapPath)) files.push(memCapPath);
  }

  const urlRegex = /https?:\/\/[^\s)>\]]+/;

  for (const filePath of uniq(files)) {
    const content = safeRead(filePath);
    if (!content) continue;

    let currentCategory = null;
    for (const line of content.split('\n')) {
      // Track parent headings for category
      const headingMatch = line.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) {
        currentCategory = headingMatch[1].trim();
        // If the heading itself is an item (non-generic), add it
        if (currentCategory.length > 3 && !/^(inspiration|ideas|bookmarks|reading list|references)$/i.test(currentCategory)) {
          // Heading-as-item: look ahead for body
          // Skip — we'll pick it up as section body bullets instead
        }
        continue;
      }

      // Bullet items
      const bulletMatch = line.match(/^[-*]\s+(.+)/);
      if (!bulletMatch) continue;

      const text = bulletMatch[1].trim();
      if (text.length < 3) continue;

      const sourceMatch = text.match(urlRegex);
      const isCompleted = /^\[x\]/i.test(text);
      const cleanText = text.replace(/^\[[ x]\]\s*/i, '').trim();

      items.push({
        title: cleanText.replace(urlRegex, '').replace(/[[\]()]/g, '').trim().slice(0, 500) || cleanText.slice(0, 500),
        description: cleanText.length > 60 ? cleanText.slice(60, 560) : undefined,
        category: currentCategory?.slice(0, 50) || null,
        source: sourceMatch ? sourceMatch[0].slice(0, 500) : null,
        status: isCompleted ? 'completed' : 'pending',
      });

      if (items.length >= 200) break;
    }
    if (items.length >= 200) break;
  }

  return items;
}

function scanPreferences(dir) {
  const prefs = [];
  const observations = [];
  const moods = [];
  const approaches = [];

  // OpenClaw-style: MEMORY.md "Active Preferences" list
  const memIndex = safeRead(join(dir, 'MEMORY.md'));
  if (memIndex) {
    const lines = memIndex.split('\n');
    let inPrefs = false;
    for (const line of lines) {
      if (/^##\s+.*Active Preferences/i.test(line)) {
        inPrefs = true;
        continue;
      }
      if (inPrefs && /^##\s+/.test(line)) break;
      if (!inPrefs) continue;

      const bullet = line.match(/^-\s+(.+)/);
      if (!bullet) continue;
      const text = bullet[1].trim();
      if (text.length < 5) continue;
      if (isWindowsPathLike(text) || isUnixPathLike(text) || isSecretLike(text)) continue;
      prefs.push({ preference: text, category: 'agent', confidence: 80 });
    }
  }

  // ─── Observations: bullets under observation/noticed/pattern headings ───
  const observationSources = [
    join(dir, 'MEMORY.md'),
    join(dir, 'CLAUDE.md'),
    join(dir, 'tasks', 'lessons.md'),
  ].filter(p => existsSync(p));

  for (const filePath of observationSources) {
    const content = safeRead(filePath);
    if (!content) continue;
    const sections = extractSections(content);
    for (const [heading, body] of sections) {
      const lower = heading.toLowerCase();
      if (!/observation|noticed|pattern/i.test(lower)) continue;
      for (const line of body.split('\n')) {
        const bullet = line.match(/^[-*]\s+(.+)/);
        if (!bullet) continue;
        const text = bullet[1].trim();
        if (text.length < 5 || isWindowsPathLike(text) || isSecretLike(text)) continue;
        if (!observations.some(o => o.observation === text)) {
          observations.push({ observation: text, category: basename(filePath, '.md').toLowerCase() });
        }
      }
    }
  }

  // ─── Approaches: bullets under approach/strategy/technique/method/workflow headings ───
  for (const filePath of observationSources) {
    const content = safeRead(filePath);
    if (!content) continue;
    const sections = extractSections(content);
    for (const [heading, body] of sections) {
      const lower = heading.toLowerCase();
      if (!/approach|strateg|technique|method|workflow/i.test(lower)) continue;
      for (const line of body.split('\n')) {
        const bullet = line.match(/^[-*]\s+(.+)/);
        if (!bullet) continue;
        const text = bullet[1].trim();
        if (text.length < 5 || isWindowsPathLike(text) || isSecretLike(text)) continue;
        if (!approaches.some(a => a.approach === text)) {
          approaches.push({ approach: text.slice(0, 500), context: heading });
        }
      }
    }
  }

  // ─── Moods: from daily logs, text under mood/energy/feeling headings ───
  const mdFiles = gatherWorkspaceMarkdownSources(dir);
  const dailyFiles = mdFiles.filter(isDailyMemoryLogPath);
  dailyFiles.sort((a, b) => basename(b).localeCompare(basename(a)));

  for (const filePath of dailyFiles.slice(0, 30)) {
    const content = safeRead(filePath);
    if (!content) continue;
    const sections = extractSections(content);
    for (const [heading, body] of sections) {
      if (!/mood|energy|feeling/i.test(heading.toLowerCase())) continue;
      const trimmed = body.trim();
      if (trimmed.length < 3) continue;

      // Try to extract structured mood/energy
      const moodLine = trimmed.split('\n')[0].trim().slice(0, 100);
      const energyMatch = trimmed.match(/energy[:\s]+(\w+)/i);

      if (!moods.some(m => m.mood === moodLine)) {
        moods.push({
          mood: moodLine,
          energy: energyMatch ? energyMatch[1].slice(0, 50) : null,
          notes: trimmed.length > 100 ? trimmed.slice(0, 500) : null,
        });
      }
    }
  }

  const result = {};
  if (prefs.length) result.preferences = prefs;
  if (observations.length) result.observations = observations;
  if (moods.length) result.moods = moods;
  if (approaches.length) result.approaches = approaches;

  if (!Object.keys(result).length) return null;
  return result;
}

function scanContextPoints(dir) {
  const points = [];
  const claudeMd = safeRead(join(dir, 'CLAUDE.md'));
  if (claudeMd) {
    const sections = extractSections(claudeMd);
    for (const [heading, body] of sections) {
      const lower = heading.toLowerCase();
      let category = 'general';
      let importance = 5;

      if (lower.includes('architecture') || lower.includes('tech stack')) {
        category = 'insight';
        importance = 8;
      } else if (lower.includes('pattern') || lower.includes('convention')) {
        category = 'insight';
        importance = 7;
      } else if (lower.includes('command') || lower.includes('deploy')) {
        category = 'general';
        importance = 6;
      } else if (lower.includes('decision') || lower.includes('choice')) {
        category = 'decision';
        importance = 7;
      }

      const trimmed = body.trim();
      if (trimmed.length > 20 && trimmed.length < 5000) {
        points.push({
          content: `[${heading}] ${trimmed.slice(0, 2000)}`,
          category,
          importance,
        });
      }
    }
  }

  // OpenClaw-style: MEMORY.md index as lightweight context points (capped).
  const memIndex = safeRead(join(dir, 'MEMORY.md'));
  if (memIndex) {
    const sections = extractSections(memIndex);
    for (const [heading, body] of sections.slice(0, 25)) {
      const trimmed = body.trim();
      if (trimmed.length < 40) continue;
      points.push({
        content: `[MEMORY.md:${heading}] ${trimmed.slice(0, 1500)}`,
        category: heading.toLowerCase().includes('decision') ? 'decision' : 'insight',
        importance: 7,
      });
    }
  }

  return points;
}

function scanContextThreads(dir) {
  const threads = [];
  const claudeMd = safeRead(join(dir, 'CLAUDE.md'));
  if (!claudeMd) return threads;

  const sections = extractSections(claudeMd);
  for (const [heading, body] of sections) {
    const lines = body.trim().split('\n').filter(l => l.trim());
    if (lines.length >= 3) {
      threads.push({
        name: heading,
        summary: lines.slice(0, 3).join(' ').slice(0, 500),
      });
    }
  }

  return threads;
}

function scanSnippets(dir) {
  const snippets = [];
  const files = uniq([
    join(dir, 'CLAUDE.md'),
    join(dir, 'TOOLS.md'),
    join(dir, 'TOOLS.crypto.md'),
    join(dir, 'TOOLS.local.md'),
    join(dir, 'TOOLS.references.md'),
    join(dir, 'projects.md'),
    join(dir, 'MEMORY.md'),
    join(dir, 'memory', 'pending-tasks.md'),
    join(dir, 'memory', 'security-policy.md'),
    join(dir, 'memory', 'projects', 'dashclaw.md'),
    ...findFiles(join(dir, '.claude'), /\.md$/i, 2),
    ...findFiles(join(dir, 'memory', 'decisions'), /\.md$/i, 2),
  ]).filter((p) => existsSync(p) && extname(p).toLowerCase() === '.md');

  for (const filePath of files) {
    const content = safeRead(filePath);
    if (!content) continue;

    let currentHeading = basename(filePath, '.md');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      // Track headings for naming
      const headingMatch = lines[i].match(/^#{1,3}\s+(.+)/);
      if (headingMatch) {
        currentHeading = headingMatch[1].trim();
        continue;
      }

      // Find fenced code blocks
      const fenceMatch = lines[i].match(/^```(\w*)/);
      if (!fenceMatch) continue;

      const language = fenceMatch[1] || null;
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }

      // Skip tiny blocks
      if (codeLines.length < 2) continue;

      const code = codeLines.join('\n');
      const name = `${currentHeading.replace(/[^a-zA-Z0-9\s-]/g, '').trim().slice(0, 50).replace(/\s+/g, '-').toLowerCase()}`;

      if (name && code.length > 10 && !snippets.some(s => s.name === name)) {
        snippets.push({
          name,
          description: `From ${basename(filePath)}: ${currentHeading}`,
          code,
          language,
        });
      }

      if (snippets.length >= 200) return snippets; // hard cap to avoid noisy imports
    }
  }

  return snippets;
}

// ─── Helpers ────────────────────────────────────────────────

function extractSections(markdown) {
  const sections = [];
  const lines = markdown.split('\n');
  let currentHeading = null;
  let currentBody = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)/);
    if (match) {
      if (currentHeading) {
        sections.push([currentHeading, currentBody.join('\n')]);
      }
      currentHeading = match[1].trim();
      currentBody = [];
    } else if (currentHeading) {
      currentBody.push(line);
    }
  }
  if (currentHeading) {
    sections.push([currentHeading, currentBody.join('\n')]);
  }

  return sections;
}

function formatTable(data) {
  const maxKey = Math.max(...Object.keys(data).map(k => k.length), 10);
  const maxVal = Math.max(...Object.values(data).map(v => String(v).length), 5);
  const sep = `+${'-'.repeat(maxKey + 2)}+${'-'.repeat(maxVal + 2)}+`;

  const rows = [
    sep,
    `| ${'Category'.padEnd(maxKey)} | ${'Count'.padEnd(maxVal)} |`,
    sep,
    ...Object.entries(data).map(([k, v]) =>
      `| ${k.padEnd(maxKey)} | ${String(v).padEnd(maxVal)} |`
    ),
    sep,
  ];
  return rows.join('\n');
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);

  // Validate required args
  if (!args.dir) {
    console.error('Error: --dir is required (path to agent workspace)');
    process.exit(1);
  }
  if (!args.agentId) {
    console.error('Error: --agent-id is required');
    process.exit(1);
  }

  const dir = resolve(args.dir);
  if (!existsSync(dir)) {
    console.error(`Error: Directory not found: ${dir}`);
    process.exit(1);
  }

  console.log(`\nBootstrap Agent Scanner`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Directory: ${dir}`);
  console.log(`Agent ID:  ${args.agentId}`);
  if (args.orgId) console.log(`Org ID:    ${args.orgId}`);
  console.log(`Mode:      ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log();

  // Phase 1: Adaptive discovery + classification
  console.log('Phase 1: Discovering files...');
  const discovered = discoverFiles(dir);
  console.log(`  Found ${discovered.length} files\n`);

  console.log('Phase 2: Classifying...');
  const classified = classifyAll(discovered);
  const grouped = groupByCategory(classified);
  const classificationSummary = {};
  for (const [cat, files] of Object.entries(grouped)) {
    classificationSummary[cat] = files.length;
  }
  console.log(`  Categories: ${Object.keys(grouped).length}`);
  for (const [cat, count] of Object.entries(classificationSummary).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count} files`);
  }
  console.log();

  // Phase 3: Run existing scanners + new adaptive extractors
  console.log('Phase 3: Extracting data...\n');
  const payload = {};
  const summary = {};

  // Connections
  try {
    const connections = scanConnections(dir);
    if (connections.length) {
      payload.connections = connections;
      summary.connections = connections.length;
      console.log(`  Connections: ${connections.length} providers detected`);
      for (const c of connections) {
        console.log(`    - ${c.provider} (${c.auth_type})`);
      }
    } else {
      console.log('  Connections: none detected');
    }
  } catch (e) {
    console.error(`  Connections: ERROR - ${e.message}`);
  }

  // Memory
  try {
    const memory = scanMemory(dir);
    if (memory) {
      payload.memory = memory;
      summary.memory = 1;
      summary['  entities'] = memory.entities.length;
      summary['  topics'] = memory.topics.length;
      console.log(`  Memory: score=${memory.health.score}, ${memory.entities.length} entities, ${memory.topics.length} topics`);
    } else {
      console.log('  Memory: no workspace markdown sources found');
    }
  } catch (e) {
    console.error(`  Memory: ERROR - ${e.message}`);
  }

  // Goals
  try {
    const goals = scanGoals(dir);
    if (goals.length) {
      payload.goals = goals;
      summary.goals = goals.length;
      console.log(`  Goals: ${goals.length} (${goals.filter(g => g.status === 'completed').length} completed)`);
    } else {
      console.log('  Goals: none found');
    }
  } catch (e) {
    console.error(`  Goals: ERROR - ${e.message}`);
  }

  // Learning
  try {
    const learning = scanLearning(dir);
    if (learning.length) {
      payload.learning = learning;
      summary.learning = learning.length;
      console.log(`  Learning: ${learning.length} decisions/lessons`);
    } else {
      console.log('  Learning: none found');
    }
  } catch (e) {
    console.error(`  Learning: ERROR - ${e.message}`);
  }

  // Context Points
  try {
    const points = scanContextPoints(dir);
    if (points.length) {
      payload.context_points = points;
      summary.context_points = points.length;
      console.log(`  Context Points: ${points.length} sections`);
    } else {
      console.log('  Context Points: none extracted');
    }
  } catch (e) {
    console.error(`  Context Points: ERROR - ${e.message}`);
  }

  // Context Threads
  try {
    const threads = scanContextThreads(dir);
    if (threads.length) {
      payload.context_threads = threads;
      summary.context_threads = threads.length;
      console.log(`  Context Threads: ${threads.length} threads`);
    } else {
      console.log('  Context Threads: none created');
    }
  } catch (e) {
    console.error(`  Context Threads: ERROR - ${e.message}`);
  }

  // Snippets
  try {
    const snippets = scanSnippets(dir);
    if (snippets.length) {
      payload.snippets = snippets;
      summary.snippets = snippets.length;
      console.log(`  Snippets: ${snippets.length} code blocks`);
    } else {
      console.log('  Snippets: none found');
    }
  } catch (e) {
    console.error(`  Snippets: ERROR - ${e.message}`);
  }

  // Preferences (includes observations, moods, approaches)
  try {
    const preferences = scanPreferences(dir);
    if (preferences) {
      payload.preferences = preferences;
      summary.preferences = preferences.preferences?.length || 0;
      console.log(`  Preferences: ${preferences.preferences?.length || 0} detected`);
      if (preferences.observations?.length) {
        summary['  observations'] = preferences.observations.length;
        console.log(`  Observations: ${preferences.observations.length} detected`);
      }
      if (preferences.moods?.length) {
        summary['  moods'] = preferences.moods.length;
        console.log(`  Moods: ${preferences.moods.length} detected`);
      }
      if (preferences.approaches?.length) {
        summary['  approaches'] = preferences.approaches.length;
        console.log(`  Approaches: ${preferences.approaches.length} detected`);
      }
    } else {
      console.log('  Preferences: none found');
    }
  } catch (e) {
    console.error(`  Preferences: ERROR - ${e.message}`);
  }

  // Handoffs (from daily logs)
  try {
    const handoffs = scanHandoffs(dir);
    if (handoffs.length) {
      payload.handoffs = handoffs;
      summary.handoffs = handoffs.length;
      console.log(`  Handoffs: ${handoffs.length} sessions`);
    } else {
      console.log('  Handoffs: no daily logs found');
    }
  } catch (e) {
    console.error(`  Handoffs: ERROR - ${e.message}`);
  }

  // Inspiration
  try {
    const inspiration = scanInspiration(dir);
    if (inspiration.length) {
      payload.inspiration = inspiration;
      summary.inspiration = inspiration.length;
      console.log(`  Inspiration: ${inspiration.length} items`);
    } else {
      console.log('  Inspiration: no inspiration files found');
    }
  } catch (e) {
    console.error(`  Inspiration: ERROR - ${e.message}`);
  }

  // ─── Adaptive Extractors (from discovery) ──────────────────

  // Identity
  try {
    const identityFiles = grouped[CATEGORIES.IDENTITY] || [];
    if (identityFiles.length) {
      const identity = extractIdentity(identityFiles);
      if (identity.context_points.length) {
        payload.context_points = [...(payload.context_points || []), ...identity.context_points];
        summary['  identity_context'] = identity.context_points.length;
        console.log(`  Identity Context: ${identity.context_points.length} points`);
      }
      if (identity.preferences.length) {
        if (!payload.preferences) payload.preferences = {};
        payload.preferences.preferences = [...(payload.preferences?.preferences || []), ...identity.preferences];
        summary['  identity_prefs'] = identity.preferences.length;
        console.log(`  Identity Preferences: ${identity.preferences.length}`);
      }
    }
  } catch (e) {
    console.error(`  Identity: ERROR - ${e.message}`);
  }

  // User profile
  try {
    const userFiles = grouped[CATEGORIES.USER_PROFILE] || [];
    if (userFiles.length) {
      const user = extractUserProfile(userFiles);
      if (user.context_points.length) {
        payload.context_points = [...(payload.context_points || []), ...user.context_points];
        summary['  user_context'] = user.context_points.length;
        console.log(`  User Profile: ${user.context_points.length} context points`);
      }
    }
  } catch (e) {
    console.error(`  User Profile: ERROR - ${e.message}`);
  }

  // Relationships
  try {
    const relFiles = grouped[CATEGORIES.RELATIONSHIPS] || [];
    if (relFiles.length) {
      const rels = extractRelationships(relFiles);
      if (rels.relationships.length) {
        payload.relationships = rels.relationships;
        summary.relationships = rels.relationships.length;
        console.log(`  Relationships: ${rels.relationships.length} contacts/entities`);
      }
    }
  } catch (e) {
    console.error(`  Relationships: ERROR - ${e.message}`);
  }

  // Capabilities (skills + tools)
  try {
    const skillFiles = grouped[CATEGORIES.CAPABILITY_SKILL] || [];
    const toolFiles = grouped[CATEGORIES.CAPABILITY_TOOL] || [];
    if (skillFiles.length || toolFiles.length) {
      const caps = extractCapabilities(skillFiles, toolFiles);
      if (caps.capabilities.length) {
        payload.capabilities = caps.capabilities;
        summary.capabilities = caps.capabilities.length;
        const skills = caps.capabilities.filter(c => c.capability_type === 'skill').length;
        const tools = caps.capabilities.filter(c => c.capability_type === 'tool').length;
        console.log(`  Capabilities: ${caps.capabilities.length} (${skills} skills, ${tools} tools)`);
      }
    }
  } catch (e) {
    console.error(`  Capabilities: ERROR - ${e.message}`);
  }

  // Operational config
  try {
    const opFiles = grouped[CATEGORIES.OPERATIONAL_CONFIG] || [];
    if (opFiles.length) {
      const ops = extractOperationalConfig(opFiles);
      if (ops.context_points.length) {
        payload.context_points = [...(payload.context_points || []), ...ops.context_points];
        summary['  ops_context'] = ops.context_points.length;
        console.log(`  Operational Config: ${ops.context_points.length} context points`);
      }
      if (ops.preferences.length) {
        if (!payload.preferences) payload.preferences = {};
        payload.preferences.preferences = [...(payload.preferences?.preferences || []), ...ops.preferences];
        summary['  ops_prefs'] = ops.preferences.length;
        console.log(`  Operational Preferences: ${ops.preferences.length}`);
      }
    }
  } catch (e) {
    console.error(`  Operational Config: ERROR - ${e.message}`);
  }

  // Projects (from discovery — supplements existing scanGoals)
  try {
    const projectFiles = grouped[CATEGORIES.PROJECT] || [];
    if (projectFiles.length) {
      const projects = extractProjects(projectFiles);
      if (projects.goals.length) {
        // Merge with existing goals, dedup by title
        const existingTitles = new Set((payload.goals || []).map(g => g.title.toLowerCase()));
        const newGoals = projects.goals.filter(g => !existingTitles.has(g.title.toLowerCase()));
        if (newGoals.length) {
          payload.goals = [...(payload.goals || []), ...newGoals];
          summary['  project_goals'] = newGoals.length;
          console.log(`  Project Goals: ${newGoals.length} new (${projects.goals.length - newGoals.length} deduped)`);
        }
      }
    }
  } catch (e) {
    console.error(`  Projects: ERROR - ${e.message}`);
  }

  // Creative works
  try {
    const creativeFiles = grouped[CATEGORIES.CREATIVE] || [];
    if (creativeFiles.length) {
      const creative = extractCreativeWorks(creativeFiles);
      if (creative.content.length) {
        payload.content = [...(payload.content || []), ...creative.content];
        summary.content = creative.content.length;
        console.log(`  Creative Works: ${creative.content.length} pieces`);
      }
    }
  } catch (e) {
    console.error(`  Creative Works: ERROR - ${e.message}`);
  }

  // Update summary counts for merged categories
  if (payload.context_points) summary.context_points = payload.context_points.length;
  if (payload.preferences?.preferences) summary.preferences = payload.preferences.preferences.length;
  if (payload.preferences?.observations) summary['  observations'] = payload.preferences.observations.length;
  if (payload.preferences?.moods) summary['  moods'] = payload.preferences.moods.length;
  if (payload.preferences?.approaches) summary['  approaches'] = payload.preferences.approaches.length;
  if (payload.goals) summary.goals = payload.goals.length;

  console.log();

  // Dry run — print and exit
  if (args.dryRun) {
    console.log('DRY RUN — Discovery Manifest:');
    console.log(formatTable({ 'Total Files Discovered': discovered.length, ...classificationSummary }));
    console.log('\nSync Summary:');
    console.log(formatTable(summary));
    console.log('\nPayload preview (JSON):');
    // Print with truncated code blocks for readability
    const preview = JSON.parse(JSON.stringify(payload));
    if (preview.snippets) {
      for (const s of preview.snippets) {
        if (s.code?.length > 80) s.code = s.code.slice(0, 80) + '...';
      }
    }
    if (preview.context_points) {
      for (const p of preview.context_points) {
        if (p.content?.length > 120) p.content = p.content.slice(0, 120) + '...';
      }
    }
    if (preview.relationships) {
      for (const r of preview.relationships) {
        if (r.description?.length > 80) r.description = r.description.slice(0, 80) + '...';
      }
    }
    if (preview.capabilities) {
      for (const c of preview.capabilities) {
        if (c.description?.length > 80) c.description = c.description.slice(0, 80) + '...';
      }
    }
    if (preview.content) {
      for (const c of preview.content) {
        if (c.body?.length > 80) c.body = c.body.slice(0, 80) + '...';
      }
    }
    if (preview.handoffs) {
      for (const h of preview.handoffs) {
        if (h.summary?.length > 120) h.summary = h.summary.slice(0, 120) + '...';
        if (h.mood_notes?.length > 80) h.mood_notes = h.mood_notes.slice(0, 80) + '...';
      }
    }
    if (preview.inspiration) {
      for (const i of preview.inspiration) {
        if (i.description?.length > 80) i.description = i.description.slice(0, 80) + '...';
      }
    }
    console.log(JSON.stringify(preview, null, 2));
    console.log('\nRe-run without --dry-run to push data.');
    return;
  }

}

main();
