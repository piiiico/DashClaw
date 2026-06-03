import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/ui/Badge.js', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));

const { default: PolicyAdvancedImportPanel } = await import('@/policies/components/PolicyAdvancedImportPanel.jsx');

const baseProps = {
  open: true, onClose: () => {}, importMode: 'pack', setImportMode: () => {},
  importPack: 'enterprise-strict', setImportPack: () => {}, importYaml: '', setImportYaml: () => {},
  importing: false, handleImport: () => {}, packPreviews: {}, templates: [],
};

describe('PolicyAdvancedImportPanel — import result', () => {
  it('shows the error count + messages (errors is an array of strings, not a number)', () => {
    render(<PolicyAdvancedImportPanel {...baseProps} importResult={{
      imported: 2, skipped: 1,
      errors: ['Failed to import "x": bad', 'Failed to import "y": worse'],
      policies: [],
    }} />);

    expect(screen.getByText('2 imported')).toBeTruthy();
    expect(screen.getByText('1 skipped')).toBeTruthy();
    expect(screen.getByText('2 errors')).toBeTruthy();
    expect(screen.getByText(/Failed to import "x": bad/)).toBeTruthy();
    expect(screen.getByText(/Failed to import "y": worse/)).toBeTruthy();
  });

  it('renders a failed-import error message', () => {
    render(<PolicyAdvancedImportPanel {...baseProps} importResult={{ error: 'Import failed' }} />);
    expect(screen.getByText('Import failed')).toBeTruthy();
  });

  it('omits the errors badge when there are none', () => {
    render(<PolicyAdvancedImportPanel {...baseProps} importResult={{ imported: 3, skipped: 0, errors: [], policies: [] }} />);
    expect(screen.getByText('3 imported')).toBeTruthy();
    expect(screen.queryByText(/errors/)).toBeNull();
  });
});
