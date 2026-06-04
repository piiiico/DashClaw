import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ href, children }) => <a href={href}>{children}</a> }));
vi.mock('@/messages/_components/MarkdownBody', () => ({ default: ({ content }) => <div>{content}</div> }));
vi.mock('@/components/PageLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: ({ title }) => <div>{title}</div> }));
vi.mock('@/components/ui/Skeleton', () => ({ ListSkeleton: () => null }));
vi.mock('@/components/VerifyReceiptPanel', () => ({ default: () => null }));

const { default: ComplianceExportsPage } = await import('@/compliance/exports/page.jsx');

const SCHEDULE = {
  id: 'sched_1',
  name: 'Weekly SOC2',
  frameworks: '["soc2"]',
  format: 'json',
  window_days: 30,
  cron_expression: '0 9 * * 1',
  enabled: true,
  include_evidence: true,
  include_remediation: false,
  include_trends: true,
};

function mockFetch(onPatch) {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (u.startsWith('/api/compliance/exports')) return { ok: true, json: async () => ({ exports: [] }) };
    if (u === '/api/compliance/schedules') return { ok: true, json: async () => ({ schedules: [SCHEDULE] }) };
    if (u.startsWith('/api/compliance/trends')) return { ok: true, json: async () => ({ trends: [] }) };
    if (u.startsWith('/api/compliance/schedules/') && method === 'PATCH') {
      const body = JSON.parse(options.body);
      if (onPatch) onPatch(u, body);
      return { ok: true, json: async () => ({ ...SCHEDULE, ...body }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('ComplianceExportsPage — schedule format/window/flags + rename', () => {
  it('surfaces the schedule format, window, and include flags', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<ComplianceExportsPage />);

    expect(await screen.findByText('Weekly SOC2')).toBeTruthy();
    expect(screen.getByText('json')).toBeTruthy();
    expect(screen.getByText('30d')).toBeTruthy();
    expect(screen.getByText('evidence')).toBeTruthy();
    expect(screen.getByText('trends')).toBeTruthy();
    expect(screen.queryByText('remediation')).toBeNull();
  });

  it('renames a schedule via PATCH {name}', async () => {
    const onPatch = vi.fn();
    vi.stubGlobal('fetch', mockFetch(onPatch));
    render(<ComplianceExportsPage />);
    await screen.findByText('Weekly SOC2');

    fireEvent.click(screen.getByRole('button', { name: /rename weekly soc2/i }));
    const input = screen.getByDisplayValue('Weekly SOC2');
    fireEvent.change(input, { target: { value: 'Monthly SOC2' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    const [url, body] = onPatch.mock.calls[0];
    expect(url).toBe('/api/compliance/schedules/sched_1');
    expect(body).toEqual({ name: 'Monthly SOC2' });
    expect(await screen.findByText('Monthly SOC2')).toBeTruthy();
  });
});
