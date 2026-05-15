/**
 * Tests for app/lib/url-safety.js — SSRF defense for server-side outbound
 * fetches whose target host can be influenced by untrusted input (JWT iss
 * claims, webhook URLs from settings, etc.).
 *
 * Uses an injected dnsLookup mock so we never hit real DNS.
 */
import { describe, expect, it, vi } from 'vitest';
import { isPrivateIP, assertSafeFetchUrl } from '@/lib/url-safety.js';

const PUBLIC_IP = '93.184.216.34'; // example.com per IANA reservation
const fakeDns = (addresses) => vi.fn(async () => addresses);

describe('isPrivateIP', () => {
  it('flags loopback (127.x)', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.42.1.1')).toBe(true);
  });

  it('flags RFC1918 ranges (10/8, 172.16/12, 192.168/16)', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
  });

  it('flags link-local (169.254/16) — covers AWS metadata 169.254.169.254', () => {
    expect(isPrivateIP('169.254.169.254')).toBe(true);
    expect(isPrivateIP('169.254.0.1')).toBe(true);
  });

  it('flags 0.x and localhost / IPv6 loopback aliases', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('localhost')).toBe(true);
    expect(isPrivateIP('::1')).toBe(true);
    expect(isPrivateIP('[::1]')).toBe(true);
  });

  it('does NOT flag public IPs / hostnames', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('93.184.216.34')).toBe(false);
    expect(isPrivateIP('example.com')).toBe(false);
    expect(isPrivateIP('agentlair.dev')).toBe(false);
  });
});

describe('assertSafeFetchUrl', () => {
  it('passes for a public HTTPS URL', async () => {
    await expect(
      assertSafeFetchUrl('https://idp.example.com/.well-known/jwks.json', {
        dnsLookup: fakeDns([{ address: PUBLIC_IP, family: 4 }]),
      })
    ).resolves.toBeUndefined();
  });

  it('rejects http:// (must be HTTPS)', async () => {
    await expect(
      assertSafeFetchUrl('http://idp.example.com/.well-known/jwks.json', {
        dnsLookup: fakeDns([{ address: PUBLIC_IP, family: 4 }]),
      })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL', message: expect.stringContaining('non_https_url') });
  });

  it('rejects file:// and other non-http schemes', async () => {
    await expect(
      assertSafeFetchUrl('file:///etc/passwd', { dnsLookup: fakeDns([]) })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL' });
  });

  it('rejects an unparseable URL', async () => {
    await expect(
      assertSafeFetchUrl('not-a-url', { dnsLookup: fakeDns([]) })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL', message: expect.stringContaining('invalid_url') });
  });

  it('rejects a literal AWS-metadata IP (169.254.169.254)', async () => {
    await expect(
      assertSafeFetchUrl('https://169.254.169.254/latest/meta-data/', {
        dnsLookup: fakeDns([{ address: '169.254.169.254', family: 4 }]),
      })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL', message: expect.stringContaining('private_hostname') });
  });

  it('rejects a literal loopback IP', async () => {
    await expect(
      assertSafeFetchUrl('https://127.0.0.1:5432/', {
        dnsLookup: fakeDns([{ address: '127.0.0.1', family: 4 }]),
      })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL', message: expect.stringContaining('private_hostname') });
  });

  it('rejects a public-looking hostname that DNS-resolves to a private IP (rebinding)', async () => {
    await expect(
      assertSafeFetchUrl('https://malicious-rebinding.example.com/', {
        dnsLookup: fakeDns([{ address: '127.0.0.1', family: 4 }]),
      })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL', message: expect.stringContaining('private_ip_after_dns') });
  });

  it('rejects a hostname whose DNS resolution fails (cannot prove public)', async () => {
    const dnsLookup = vi.fn(async () => {
      const e = new Error('NXDOMAIN');
      e.code = 'ENOTFOUND';
      throw e;
    });
    await expect(
      assertSafeFetchUrl('https://nonexistent.example.test/', { dnsLookup })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL', message: expect.stringContaining('dns_lookup_failed') });
  });

  it('rejects a multi-IP DNS response if ANY address is private (defense in depth)', async () => {
    await expect(
      assertSafeFetchUrl('https://mixed.example.com/', {
        dnsLookup: fakeDns([
          { address: PUBLIC_IP, family: 4 },
          { address: '10.0.0.1', family: 4 },
        ]),
      })
    ).rejects.toMatchObject({ code: 'UNSAFE_URL', message: expect.stringContaining('private_ip_after_dns') });
  });
});
