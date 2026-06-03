import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

const { ProofPanel } = await import('@/settings/components/ProofPanel.jsx');

const VIEW = {
  proofArtifact: {
    verification: { overall: 'pass', label: 'Ready', summary: 'All systems go' },
    categories: [
      {
        id: 'core', title: 'Core runtime', status: 'pass', summary: 'All good',
        checks: [
          { id: 'c1', label: 'DB reachable', status: 'pass', detail: 'connected' },
          { id: 'c2', label: 'Schema current', status: 'pass', detail: null },
        ],
      },
      {
        id: 'sdk', title: 'SDK validation', status: 'warn', summary: 'Pending live proof',
        checks: [
          { id: 'c3', label: 'Live proof', status: 'warn', detail: 'not captured', next_action: 'run test' },
        ],
      },
    ],
  },
};

describe('ProofPanel — inline proof breakdown', () => {
  it('renders an aggregate pass/fail/warn summary from the categories', () => {
    render(<ProofPanel view={VIEW} proofDownloadHref="/api/setup/proof?download=1" />);
    expect(screen.getByText('2 passed')).toBeTruthy();
    expect(screen.getByText('0 failed')).toBeTruthy();
    expect(screen.getByText('1 warning')).toBeTruthy();
  });

  it('renders each category and its checks inline', () => {
    render(<ProofPanel view={VIEW} proofDownloadHref="/x" />);
    expect(screen.getByText('Core runtime')).toBeTruthy();
    expect(screen.getByText('SDK validation')).toBeTruthy();
    expect(screen.getByText('DB reachable')).toBeTruthy();
    expect(screen.getByText('Live proof')).toBeTruthy();
    expect(screen.getByText('not captured')).toBeTruthy();
  });

  it('keeps the download link', () => {
    render(<ProofPanel view={VIEW} proofDownloadHref="/api/setup/proof?download=1" />);
    expect(screen.getByText('Download JSON').getAttribute('href')).toBe('/api/setup/proof?download=1');
  });
});
