// Fetch the most recent weekly memo for a project.

import fs from 'node:fs';
import path from 'node:path';

async function getMemos(baseUrl, apiKey, projectIdOrSlug, { fetchImpl = fetch }) {
  const url = baseUrl.replace(/\/+$/, '') + '/api/code-sessions/memos?project=' + encodeURIComponent(projectIdOrSlug);
  const res = await fetchImpl(url, {
    headers: { 'x-api-key': apiKey },
  });
  let body = null;
  try { body = await res.json(); } catch { /* keep null */ }
  return { status: res.status, ok: res.ok, body };
}

/**
 * @param {Object} args
 * @param {string} args.baseUrl
 * @param {string} args.apiKey
 * @param {string} args.project    Project slug or id.
 * @param {boolean} [args.save]    When true, writes the memo to ./memos/<weekTag>-<slug>.md.
 * @param {Function} [args.fetchImpl]
 * @param {Object}   [args.logger]
 */
export async function runMemo({ baseUrl, apiKey, project, save = false, fetchImpl = fetch, logger = console }) {
  if (!baseUrl) throw new Error('runMemo: baseUrl is required');
  if (!apiKey) throw new Error('runMemo: apiKey is required');
  if (!project) throw new Error('runMemo: project (slug or id) is required');

  const { status, ok, body } = await getMemos(baseUrl, apiKey, project, { fetchImpl });
  if (!ok) {
    throw new Error('HTTP ' + status + (body?.error ? ' — ' + body.error : ''));
  }
  const memos = Array.isArray(body?.memos) ? body.memos : [];
  if (!memos.length) {
    logger.info('No memos yet for project ' + project + '.');
    return { saved: false, memo: null };
  }
  // Most recent first (the API already sorts by iso_week_tag DESC, but be
  // defensive in case that contract slips).
  memos.sort((a, b) => String(b.iso_week_tag).localeCompare(String(a.iso_week_tag)));
  const memo = memos[0];

  logger.info('--- ' + memo.iso_week_tag + ' ' + project + ' ---');
  if (memo.body_md) logger.info(memo.body_md);

  if (save) {
    const dir = path.join(process.cwd(), 'memos');
    fs.mkdirSync(dir, { recursive: true });
    const safeSlug = String(project).replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80);
    const filePath = path.join(dir, memo.iso_week_tag + '-' + safeSlug + '.md');
    fs.writeFileSync(filePath, memo.body_md || '', 'utf8');
    logger.info('Saved to ' + filePath);
    return { saved: true, memo, filePath };
  }
  return { saved: false, memo };
}
