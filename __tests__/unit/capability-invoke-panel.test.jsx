import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
}));
vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));
vi.mock('@/capabilities/[capabilityId]/components/CapabilityGeneratedTestForm.jsx', () => ({
  default: () => <div data-testid="generated-form" />,
}));

const { default: CapabilityInvokePanel } = await import(
  '@/capabilities/[capabilityId]/components/CapabilityInvokePanel.jsx'
);

const noop = () => {};

describe('CapabilityInvokePanel outcome rendering', () => {
  it('renders a successful invocation with result, audit link, timing, and DLP summary', () => {
    render(
      <CapabilityInvokePanel
        fields={[]}
        isSubmitting={false}
        onSubmit={noop}
        result={{ success: true, action_id: 'act_123', result: { ok: 1 }, elapsed_ms: 42, governed: true, security: { clean: true } }}
      />
    );
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('Governed')).toBeTruthy();
    expect(screen.getByText('42 ms')).toBeTruthy();
    expect(screen.getByText('act_123').getAttribute('href')).toBe('/decisions/act_123');
    expect(screen.getByText(/no sensitive data/i)).toBeTruthy();
    expect(screen.getByText(/"ok": 1/)).toBeTruthy();
  });

  it('renders a policy block with the guard reasons', () => {
    render(
      <CapabilityInvokePanel
        fields={[]}
        isSubmitting={false}
        onSubmit={noop}
        result={{ success: false, error: 'blocked_by_policy', guard_decision: { reasons: ['risk too high'], matched_policies: [{ name: 'High risk' }] } }}
      />
    );
    expect(screen.getByText('Blocked by policy')).toBeTruthy();
    expect(screen.getByText('risk too high')).toBeTruthy();
    expect(screen.getByText(/High risk/)).toBeTruthy();
  });

  it('renders an access-denied outcome with the reason and agent', () => {
    render(
      <CapabilityInvokePanel
        fields={[]}
        isSubmitting={false}
        onSubmit={noop}
        result={{ success: false, error: 'access_denied', reason: 'not allowed', agent_id: 'agt_x' }}
      />
    );
    expect(screen.getByText('Access denied')).toBeTruthy();
    expect(screen.getByText('not allowed')).toBeTruthy();
    expect(screen.getByText('agt_x')).toBeTruthy();
  });

  it('renders a pending-approval outcome', () => {
    render(
      <CapabilityInvokePanel
        fields={[]}
        isSubmitting={false}
        onSubmit={noop}
        result={{ success: false, error: 'pending_approval', action_id: 'act_9', message: 'needs human approval' }}
      />
    );
    expect(screen.getByText('Requires approval')).toBeTruthy();
    expect(screen.getByText('needs human approval')).toBeTruthy();
  });

  it('renders an execution failure with the error code and message', () => {
    render(
      <CapabilityInvokePanel
        fields={[]}
        isSubmitting={false}
        onSubmit={noop}
        result={{ success: false, action_id: 'act_5', error: 'capability_timeout', message: 'upstream timed out', elapsed_ms: 5000, governed: true }}
      />
    );
    expect(screen.getByText('capability timeout')).toBeTruthy();
    expect(screen.getByText('upstream timed out')).toBeTruthy();
    expect(screen.getByText('act_5').getAttribute('href')).toBe('/decisions/act_5');
  });
});
