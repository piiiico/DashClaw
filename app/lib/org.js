/**
 * Multi-tenant org helpers.
 * Reads org context injected by middleware via request headers.
 */

import { NextResponse } from 'next/server';
import { getSql } from './db.js';
import { getOrgPlan } from './usage.js';

export function getOrgId(request) {
  return request.headers.get('x-org-id') || 'org_default';
}

export function getOrgRole(request) {
  return request.headers.get('x-org-role') || 'member';
}

export function getUserId(request) {
  return request.headers.get('x-user-id') || '';
}

/**
 * Tier rank ladder, retained as a no-op shim. DashClaw is open source and
 * free — there is no paid tier and no pricing surface. The ladder still
 * exists so call sites passing `minTier: 'pro'` keep type-compatible even
 * though every comparison now resolves equal (every org is rank 1).
 */
const TIER_RANK = { free: 1, pro: 1 };

/**
 * No-op tier gate. Preserved as an export because seven routes call
 * `await requireTier(request, 'pro')` (actions, capabilities/invoke, keys,
 * setup/migrate, team/invite, webhooks/stripe, workflows/templates/execute)
 * and removing the call sites was out of scope for the pricing-surface
 * retraction. With every TIER_RANK entry equal, this always returns null
 * and every caller proceeds.
 *
 * If a future build re-introduces tiers, restore TIER_RANK as
 * `{ free: 0, pro: 1 }` and the original 403 COMING_SOON branch below.
 *
 * @param {Request} request - middleware-injected org headers (see getOrgId)
 * @param {string} minTier - kept for API compatibility; no longer enforced
 * @returns {Promise<null>} always null
 */
// eslint-disable-next-line no-unused-vars
export async function requireTier(request, minTier) {
  return null;
}
