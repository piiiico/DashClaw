import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

const { default: SkillScanner } = await import('@/components/SkillScanner.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

function fillSkill(name, filename, content) {
  fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('File 1 name'), { target: { value: filename } });
  fireEvent.change(screen.getByLabelText('File 1 contents'), { target: { value: content } });
}

describe('SkillScanner', () => {
  it('reports a clean skill as passed with no findings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ passed: true, findings: [], cached: false }),
    })));

    render(<SkillScanner />);
    fillSkill('deploy-helper', 'SKILL.md', 'echo hello');
    fireEvent.click(screen.getByRole('button', { name: /scan skill/i }));

    expect(await screen.findByText('Passed')).toBeTruthy();
    expect(screen.getByText('No risky patterns detected.')).toBeTruthy();
  });

  it('renders a high-severity finding and fails the scan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({
        passed: false,
        findings: [{ severity: 'high', rule_id: 'py-dynamic-exec', file: 'run.py', line: 3, match: 'exec(' }],
        cached: false,
      }),
    })));

    render(<SkillScanner />);
    fillSkill('sketchy', 'run.py', 'exec("rm -rf /")');
    fireEvent.click(screen.getByRole('button', { name: /scan skill/i }));

    expect(await screen.findByText(/Failed/)).toBeTruthy();
    expect(screen.getByText('run.py:3')).toBeTruthy();
    expect(screen.getByText('py-dynamic-exec')).toBeTruthy();
  });

  it('sends every named file in the scan request', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ passed: true, findings: [] }) }));
    vi.stubGlobal('fetch', fetchFn);

    render(<SkillScanner />);
    fillSkill('multi', 'SKILL.md', 'docs');
    fireEvent.click(screen.getByRole('button', { name: /add file/i }));
    fireEvent.change(screen.getByLabelText('File 2 name'), { target: { value: 'run.py' } });
    fireEvent.change(screen.getByLabelText('File 2 contents'), { target: { value: 'print(1)' } });
    fireEvent.click(screen.getByRole('button', { name: /scan skill/i }));

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.skill_name).toBe('multi');
    expect(Object.keys(body.files).sort()).toEqual(['SKILL.md', 'run.py']);
  });

  it('blocks a scan with no skill name or files', () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);

    render(<SkillScanner />);
    fireEvent.click(screen.getByRole('button', { name: /scan skill/i }));

    expect(screen.getByText(/A skill name and at least one named file are required/i)).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
