export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import {
  listAlerts,
  countUnreadAlerts,
} from '../../../lib/repositories/code-sessions.repository.js';

export async function GET(request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const url = new URL(request.url);
  const onlyUnread = url.searchParams.get('onlyUnread') === '1';
  const limit = url.searchParams.get('limit') || '50';
  const alerts = await listAlerts(sql, orgId, { onlyUnread, limit });
  const unread = await countUnreadAlerts(sql, orgId);
  return NextResponse.json({ alerts, unread_count: unread });
}
