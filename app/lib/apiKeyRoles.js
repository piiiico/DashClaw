// Roles assignable to an API key. Constrained by the `api_keys_role_check`
// CHECK constraint in schema/schema.js (admin | member) — keep this list in
// sync with that constraint. Shared by the /api/keys route (validation) and
// the API-keys UI (selector + badge) so the two never drift.
export const API_KEY_ROLES = ['admin', 'member'];

export const API_KEY_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', desc: 'Full access, including managing keys, team, and settings' },
  { value: 'member', label: 'Member', desc: 'Read and write governance data; cannot perform admin actions' },
];

export function isValidApiKeyRole(role) {
  return API_KEY_ROLES.includes(role);
}
