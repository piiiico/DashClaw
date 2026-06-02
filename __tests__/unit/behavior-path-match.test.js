import { describe, it, expect } from 'vitest';
import { matchesProtectedPath, classifyProtectedPath, globToRegExp, PROTECTED_PATH_GROUPS } from '@/lib/behavior/path-match.js';

describe('behavior/path-match', () => {
  it('globToRegExp: ** crosses path segments, * does not', () => {
    expect(globToRegExp('app/**/route.js').test('app/api/auth/route.js')).toBe(true);
    expect(globToRegExp('app/*/route.js').test('app/api/auth/route.js')).toBe(false);
    expect(globToRegExp('app/*/route.js').test('app/api/route.js')).toBe(true);
  });

  it('matches protected auth/middleware/billing/secrets paths', () => {
    const auth = PROTECTED_PATH_GROUPS.auth;
    expect(matchesProtectedPath('app/api/auth/login/route.js', auth)).toBe(true);
    expect(matchesProtectedPath('middleware.js', PROTECTED_PATH_GROUPS.middleware)).toBe(true);
    expect(matchesProtectedPath('app/something/middleware.js', PROTECTED_PATH_GROUPS.middleware)).toBe(true);
    expect(matchesProtectedPath('app/api/billing/route.js', PROTECTED_PATH_GROUPS.billing)).toBe(true);
    expect(matchesProtectedPath('app/secrets/store.js', PROTECTED_PATH_GROUPS.secrets)).toBe(true);
    expect(matchesProtectedPath('.env.local', PROTECTED_PATH_GROUPS.secrets)).toBe(true);
  });

  it('does not match unrelated paths', () => {
    expect(matchesProtectedPath('app/components/Button.jsx', PROTECTED_PATH_GROUPS.auth)).toBe(false);
    expect(matchesProtectedPath('README.md', PROTECTED_PATH_GROUPS.secrets)).toBe(false);
  });

  it('normalizes backslashes and drive prefixes', () => {
    expect(matchesProtectedPath('C:\\Projects\\DashClaw\\app\\api\\auth\\route.js', PROTECTED_PATH_GROUPS.auth)).toBe(true);
  });

  it('classifyProtectedPath returns the group label or null', () => {
    expect(classifyProtectedPath('livingcode/index.html')).toBe('livingcode');
    expect(classifyProtectedPath('organism.json')).toBe('organism');
    expect(classifyProtectedPath('app/page.js')).toBe(null);
  });

  it('is empty/garbage safe', () => {
    expect(matchesProtectedPath('', PROTECTED_PATH_GROUPS.auth)).toBe(false);
    expect(matchesProtectedPath('x', [])).toBe(false);
    expect(matchesProtectedPath(null, null)).toBe(false);
  });
});
