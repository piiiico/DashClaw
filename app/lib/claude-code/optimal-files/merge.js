/**
 * Section-aware markdown merge.
 *
 * Contract: never silently rewrite the user's existing content. Two-stage:
 *   1. previewMerge(existing, generated) → returns a structured plan:
 *        appendSections:    full sections from generated that have no heading
 *                           match in existing — safe to auto-add.
 *        sharedSections:    sections whose heading appears in both files —
 *                           we DO NOT auto-edit these. We return the
 *                           candidate bullets the generated version has that
 *                           the existing version doesn't, and let the caller
 *                           ask the user which to accept.
 *   2. applyMerge(existing, generated, plan) → returns the merged content
 *        string for a given user selection.
 *
 * Headings are compared by normalized text (lower-case, stripped of
 * punctuation). Bullets are compared by their normalized leading text — we
 * only treat a generated bullet as "new" if its first 8 normalized words
 * don't appear anywhere in the existing section.
 *
 * Ported from AgentLens (`src/optimal-files/merge.js`). Pure.
 */

export function parseMarkdownSections(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  // Capture preamble as a synthetic section with level=0.
  let cur = { level: 0, heading: '__preamble__', headingRaw: '', body: [] };
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      sections.push(cur);
      cur = { level: m[1].length, heading: normalizeHeading(m[2]), headingRaw: m[2], body: [] };
    } else {
      cur.body.push(line);
    }
  }
  sections.push(cur);
  return sections;
}

export function normalizeHeading(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBullets(bodyLines) {
  const bullets = [];
  const other = [];
  for (const line of bodyLines) {
    if (/^\s*[-*]\s+/.test(line)) bullets.push({ raw: line, normalized: normalizeBullet(line) });
    else other.push(line);
  }
  return { bullets, other };
}

function normalizeBullet(line) {
  return String(line || '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^a-z0-9\s]+/gi, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join(' ');
}

export function bulletAlreadyPresent(generatedNorm, existingBullets) {
  if (!generatedNorm) return true;
  for (const b of existingBullets) {
    if (!b.normalized) continue;
    if (b.normalized.startsWith(generatedNorm)) return true;
    if (generatedNorm.startsWith(b.normalized) && b.normalized.length >= 4) return true;
    const aWords = generatedNorm.split(' ');
    const bWords = b.normalized.split(' ');
    let shared = 0;
    for (let i = 0; i < Math.min(aWords.length, bWords.length); i++) {
      if (aWords[i] === bWords[i]) shared++; else break;
    }
    if (shared >= 5) return true;
  }
  return false;
}

export function previewMerge(existing, generated) {
  const ex = parseMarkdownSections(existing);
  const gn = parseMarkdownSections(generated);
  const exByHeading = new Map();
  for (const s of ex) {
    if (s.heading === '__preamble__') continue;
    if (!exByHeading.has(s.heading)) exByHeading.set(s.heading, s);
  }

  const appendSections = [];
  const sharedSections = [];

  // Only consider top-level (##/H2) sections by default. Deeper headings get
  // carried along with their parent section.
  for (let i = 0; i < gn.length; i++) {
    const s = gn[i];
    if (s.heading === '__preamble__') continue;
    if (isFooterSection(s)) continue;
    if (s.level !== 2) continue;
    const exSection = exByHeading.get(s.heading);
    if (!exSection) {
      appendSections.push({
        heading: s.heading,
        headingRaw: s.headingRaw,
        bodyText: renderSection(s),
      });
    } else {
      const exBullets = parseBullets(exSection.body).bullets;
      const genBullets = parseBullets(s.body).bullets;
      const candidates = [];
      for (const gb of genBullets) {
        if (gb.normalized && !bulletAlreadyPresent(gb.normalized, exBullets)) {
          candidates.push({ text: gb.raw.replace(/^\s*[-*]\s+/, '- ') });
        }
      }
      if (candidates.length) {
        sharedSections.push({
          heading: s.heading,
          headingRaw: s.headingRaw,
          existingBulletCount: exBullets.length,
          candidateBullets: candidates,
        });
      }
    }
  }

  return {
    appendSections,
    sharedSections,
    newSectionCount: appendSections.length,
    sharedSectionCount: sharedSections.length,
    candidateBulletCount: sharedSections.reduce((acc, s) => acc + s.candidateBullets.length, 0),
  };
}

function isFooterSection(section) {
  if (!section || !Array.isArray(section.body)) return false;
  const joined = section.body.join('\n').toLowerCase();
  return (joined.includes('generated by agentlens') || joined.includes('generated by dashclaw')) && joined.includes('review before committing');
}

function renderSection(section) {
  return `## ${section.headingRaw}\n${section.body.join('\n')}`.replace(/\n+$/, '\n');
}

export function applyMerge(existing, generated, selection) {
  const preview = previewMerge(existing, generated);
  selection = selection || {};
  const acceptedHeadings = new Set((selection.acceptedHeadings || []).map(h => normalizeHeading(h)));
  const acceptedBulletsByHeading = new Map();
  for (const b of (selection.acceptedBullets || [])) {
    const k = normalizeHeading(b.heading);
    if (!acceptedBulletsByHeading.has(k)) acceptedBulletsByHeading.set(k, []);
    acceptedBulletsByHeading.get(k).push(b.text);
  }

  let merged = String(existing == null ? '' : existing);
  if (merged && !merged.endsWith('\n')) merged += '\n';

  if (acceptedBulletsByHeading.size) {
    const sections = parseMarkdownSections(merged);
    const rebuilt = [];
    for (const s of sections) {
      if (s.heading === '__preamble__') {
        rebuilt.push(s.body.join('\n'));
        continue;
      }
      const headingLine = `${'#'.repeat(s.level)} ${s.headingRaw}`;
      const accepted = acceptedBulletsByHeading.get(s.heading) || [];
      if (accepted.length) {
        const trimmedBody = trimTrailingBlanks(s.body);
        rebuilt.push(headingLine);
        rebuilt.push(trimmedBody.join('\n'));
        rebuilt.push('');
        rebuilt.push('<!-- dashclaw:merged-bullets -->');
        for (const t of accepted) {
          rebuilt.push(t.startsWith('- ') ? t : `- ${t}`);
        }
        rebuilt.push('<!-- /dashclaw:merged-bullets -->');
        rebuilt.push('');
      } else {
        rebuilt.push(headingLine);
        rebuilt.push(s.body.join('\n'));
      }
    }
    merged = rebuilt.join('\n');
    // Collapse a run of trailing newlines to exactly one. Done with a linear
    // scan rather than /\n+$/, whose unanchored quantifier backtracks
    // quadratically on attacker-influenced content (js/polynomial-redos).
    let mEnd = merged.length;
    while (mEnd > 0 && merged.charCodeAt(mEnd - 1) === 10) mEnd--;
    if (mEnd < merged.length) merged = merged.slice(0, mEnd) + '\n';
  }

  const wholeAdditions = preview.appendSections.filter(s => acceptedHeadings.has(s.heading));
  if (wholeAdditions.length) {
    if (!merged.endsWith('\n')) merged += '\n';
    merged += '\n<!-- dashclaw:merged-sections -->\n\n';
    for (const s of wholeAdditions) {
      merged += s.bodyText.endsWith('\n') ? s.bodyText : s.bodyText + '\n';
      merged += '\n';
    }
    merged += '<!-- /dashclaw:merged-sections -->\n';
  }

  return {
    merged,
    additions: {
      sections: wholeAdditions.map(s => s.headingRaw),
      bulletCount: [...acceptedBulletsByHeading.values()].reduce((acc, l) => acc + l.length, 0),
    },
  };
}

function trimTrailingBlanks(lines) {
  const out = lines.slice();
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}
