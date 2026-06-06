// Shared assumption display-status derivation.
//
// The /api/assumptions response returns each row with integer `validated` and
// `invalidated` columns (1/0) — it never returns a string `status` field. The
// UI must derive a human status from those integers; this helper is the single
// source of that mapping so list views, badges, and counters all agree.
//
// See app/lib/repositories/assumptions.repository.js (listAssumptions) for the
// server-side filter semantics these values mirror.

export type AssumptionStatus = 'validated' | 'invalidated' | 'pending';

export interface AssumptionStatusRow {
  validated?: number | boolean;
  invalidated?: number | boolean;
}

/**
 * Map an assumption row to its display status.
 */
export function deriveAssumptionStatus(row: AssumptionStatusRow | null | undefined): AssumptionStatus {
  if (!row) return 'pending';
  if (row.validated === 1 || row.validated === true) return 'validated';
  if (row.invalidated === 1 || row.invalidated === true) return 'invalidated';
  return 'pending';
}

// Filter tab values are the derived statuses above (plus `all`), so the UI can
// filter on the same field it renders without a separate server round-trip.
export const ASSUMPTION_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Awaiting validation' },
  { value: 'validated', label: 'Validated' },
  { value: 'invalidated', label: 'Invalidated' },
];
