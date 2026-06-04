import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import PolicyRuleBuilderSection from '@/policies/components/PolicyRuleBuilderSection.jsx';

// A representative slice of the preset quick-picks CustomTab passes in.
const ACTION_OPTIONS = ['build', 'deploy', 'post', 'apply', 'message', 'api'];

// Controlled harness mirroring how PolicyAuthoringPanel drives the builder:
// onChange(field, value) writes the field back into form state and re-renders.
function Harness({ type = 'require_approval', actionTypes = [] }) {
  const [form, setForm] = useState({ type, actionTypes, freshness: ['stale', 'diverged'] });
  const onChange = (field, value) => setForm((cur) => ({ ...cur, [field]: value }));
  return <PolicyRuleBuilderSection form={form} actionOptions={ACTION_OPTIONS} onChange={onChange} />;
}

describe('PolicyRuleBuilderSection — custom action type input', () => {
  it('adds an arbitrary custom action type as a removable chip on Enter', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Custom action type');

    fireEvent.change(input, { target: { value: 'marketplace_publish' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Chip is rendered with a remove control, and the input is cleared.
    expect(screen.getByText('marketplace_publish')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove marketplace_publish' })).toBeTruthy();
    expect(input.value).toBe('');
  });

  it('adds a custom action type on comma as well', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Custom action type');

    fireEvent.change(input, { target: { value: 'ps-finance:charge_customer' } });
    fireEvent.keyDown(input, { key: ',' });

    expect(screen.getByText('ps-finance:charge_customer')).toBeTruthy();
  });

  it('keeps the existing preset quick-pick toggle behavior working', () => {
    render(<Harness />);
    const deploy = screen.getByRole('button', { name: 'deploy' });

    expect(deploy.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(deploy);
    expect(deploy.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(deploy);
    expect(deploy.getAttribute('aria-pressed')).toBe('false');
  });

  it('removes a custom chip when its remove control is clicked', () => {
    render(<Harness actionTypes={['marketplace_publish']} />);
    expect(screen.getByText('marketplace_publish')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove marketplace_publish' }));

    expect(screen.queryByText('marketplace_publish')).toBeNull();
  });

  it('dedupes — adding the same custom type twice keeps a single chip', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Custom action type');

    fireEvent.change(input, { target: { value: 'marketplace_publish' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'marketplace_publish' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getAllByText('marketplace_publish')).toHaveLength(1);
  });

  it('ignores empty / whitespace-only custom input', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Custom action type');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // No chip created; the Add button stays disabled for blank input.
    expect(screen.getByRole('button', { name: 'Add' }).disabled).toBe(true);
  });

  it('renders the free-text input for green_contract too (not just require_approval)', () => {
    render(<Harness type="green_contract" />);
    expect(screen.getByLabelText('Custom action type')).toBeTruthy();
  });
});
