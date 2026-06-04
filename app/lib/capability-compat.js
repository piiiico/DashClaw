/**
 * Shared legacy-schema detection for capability routes.
 *
 * capability-health.js and capability-history.js both query action_records
 * using columns that were added in a schema migration (timestamp_start,
 * timestamp_end, duration_ms, output_summary, error_message, trigger).
 * When those columns are absent the DB raises a 42703/42883/42804 code or a
 * descriptive message; callers fall back to a simpler legacy query.
 *
 * This module exports the single, union pattern list so both callers stay in
 * sync when new columns are added in the future.
 */

export function isLegacyActionRecordsError(error) {
  const code = String(error?.code || '');
  const message = `${error?.message || ''} ${error?.detail || ''}`.toLowerCase();
  return ['42703', '42883', '42804'].includes(code)
    || /column .* does not exist/.test(message)
    || /operator does not exist/.test(message)
    || /timestamp_start/.test(message)
    || /timestamp_end/.test(message)
    || /duration_ms/.test(message)
    || /output_summary/.test(message)
    || /error_message/.test(message)
    || /trigger/.test(message);
}
