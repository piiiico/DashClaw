import { describe, expect, it } from 'vitest';

import { getConnectGuideContent } from '@/lib/connectGuide.js';

describe('connect guide content', () => {
  it('builds a node golden path with env vars, starter code, validator, and optional pairing', () => {
    const content = getConnectGuideContent({ host: 'dashclaw.example.com' });

    expect(content.baseUrl).toBe('https://dashclaw.example.com');
    expect(content.languages.node.envBlock).toContain('DASHCLAW_BASE_URL=https://dashclaw.example.com');
    expect(content.languages.node.envBlock).toContain('DASHCLAW_API_KEY=oc_live_...');
    expect(content.languages.node.starterSnippet).toContain('await claw.guard');
    expect(content.languages.node.validatorCommand).toContain('node ./dashclaw-platform-intelligence/scripts/validate-integration.mjs');
    expect(content.languages.node.validatorCommand).toContain('--capture-setup-proof');
    expect(content.languages.node.optionalPairingSnippet).toContain('createPairingFromPrivateJwk');
  });

  it('uses a safe placeholder instead of the marketing host for base URL examples', () => {
    const content = getConnectGuideContent({ host: 'dashclaw.io' });

    expect(content.baseUrl).toBe('https://your-dashclaw-instance.example.com');
    expect(content.languages.node.envBlock).toContain('DASHCLAW_BASE_URL=https://your-dashclaw-instance.example.com');
    expect(content.baseUrlGuidance[0]).toContain('not https://dashclaw.io');
    expect(content.envNote).toContain('Do not use the marketing site URL');
    expect(content.commonMistakes[0]).toContain('Do not use https://dashclaw.io');
  });

  it('builds a python golden path with explicit no-database note and pairing guidance', () => {
    const content = getConnectGuideContent({ host: 'localhost:3000' });

    expect(content.baseUrl).toBe('http://localhost:3000');
    expect(content.agentRequirementsNote).toContain('never needs DATABASE_URL');
    expect(content.languages.python.envBlock).toContain('DASHCLAW_BASE_URL=http://localhost:3000');
    expect(content.languages.python.starterSnippet).toContain('claw.create_action');
    expect(content.languages.python.validatorCommand).toContain('/api/setup/live-proof');
    expect(content.languages.python.optionalPairingSnippet).toContain('create_pairing_from_private_jwk');
  });
});
