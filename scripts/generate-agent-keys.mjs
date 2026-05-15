// CLAUDE.md: every entry point must surface async rejections.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

import { webcrypto } from 'node:crypto';

async function generateIdentity() {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error('Usage: node scripts/generate-agent-keys.mjs <agent-id>');
    process.exit(1);
  }

  console.log(`Generating RSA-PSS 2048-bit keypair for agent: ${agentId}...`);

  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  // Export keys as JWK (easy format for Node/Web interop)
  const privateJwk = await webcrypto.subtle.exportKey('jwk', privateKey);

  // Export public key as PEM for database storage/display
  const publicSpki = await webcrypto.subtle.exportKey('spki', publicKey);
  const publicBase64 = Buffer.from(publicSpki).toString('base64');
  const publicBase64Lines = publicBase64.match(/.{1,64}/g) ?? [];
  const publicPem = `-----BEGIN PUBLIC KEY-----\n${publicBase64Lines.join('\n')}\n-----END PUBLIC KEY-----`;

  console.log('\nKeys generated successfully!');

  console.log('\n--- 1. REGISTER THIS IDENTITY (Admin Only) ---');
  console.log('Run this curl command to register the public key with DashClaw:');
  console.log(`\ncurl -X POST http://localhost:3000/api/identities \n  -H "x-api-key: YOUR_ADMIN_KEY" \n  -H "Content-Type: application/json" \n  -d '{\n    "agent_id": "${agentId}",\n    "public_key": ${JSON.stringify(publicPem)},\n    "algorithm": "RSASSA-PKCS1-v1_5"\n  }'\n`);

  console.log('\n--- 2. CONFIGURE YOUR AGENT ---');
  console.log('Pass this Private Key to your DashClaw SDK constructor:');
  console.log('\n// Option A: Env Var (Recommended)');
  console.log(`AGENT_PRIVATE_KEY='${JSON.stringify(privateJwk)}'`);

  console.log('\n// Option B: Code (For testing)');
  console.log(`const privateKeyJwk = ${JSON.stringify(privateJwk, null, 2)};`);

  console.log(`\n// Usage in Agent Code:\nimport { DashClaw } from 'dashclaw';\nimport { webcrypto } from 'node:crypto';\n\n// Import the key\nconst keyData = JSON.parse(process.env.AGENT_PRIVATE_KEY);\nconst privateKey = await webcrypto.subtle.importKey(\n  "jwk",\n  keyData,\n  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },\n  false,\n  ["sign"]\n);\n\nconst claw = new DashClaw({\n  ...,\n  agentId: '${agentId}',\n  privateKey\n});\n`);
}

generateIdentity();
