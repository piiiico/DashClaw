# Agent Identity — JWKS Verification (Phase 2)

DashClaw supports cryptographically verifiable agent identity via standard JWT
bearer tokens. Any OIDC-compatible issuer works — Keycloak, Auth0, a custom
JWKS server, or AgentLair.

## How it works

1. The agent attaches `Authorization: Bearer <JWT>` to DashClaw API calls.
2. DashClaw reads the `iss` claim from the JWT and fetches JWKS from
   `{iss}/.well-known/jwks.json` (cached for 1 hour).
3. The signature is verified using the matching key (`kid` → JWK lookup).
4. Expiry (`exp`), and optionally audience (`aud`), are validated.
5. If verification succeeds, the JWT `sub` claim becomes the canonical
   `agent_id` in the audit entry — cryptographic proof beats self-assertion.
6. The `verification_status` field in every guard response and audit record
   reflects the outcome.

## verification_status enum

| Value            | Meaning                                                   |
|------------------|-----------------------------------------------------------|
| `verified`       | Signature valid; `sub` used as `agent_id`                 |
| `unverified`     | No JWT, or issuer temporarily unavailable (fail-soft)     |
| `expired`        | Signature valid, but `exp` is in the past                 |
| `failed`         | Bad signature, malformed token, or `aud` mismatch         |
| `unknown_issuer` | `iss` not in `DASHCLAW_ALLOWED_ISSUER` (when configured)  |

## Resilience

DashClaw uses a fail-soft model: if the JWKS endpoint is unreachable or slow,
tokens resolve to `unverified` rather than `failed`. A downed identity provider
cannot block agent decisions. Phase 1 body-field attribution (`agent_id` /
`agent_name` in the request body) is always the fallback.

The JWKS fetcher includes:
- **1-hour cache** per issuer — eliminates per-request latency
- **Circuit breaker** — opens after 3 consecutive fetch failures; stays open
  for 30 s, then half-opens for retry
- **5-second fetch timeout** — prevents slow JWKS from adding audit latency

## Configuration

Set these environment variables. No YAML config file is needed.

```bash
# Optional: restrict which JWT issuers are trusted.
# Tokens from other issuers → verification_status = 'unknown_issuer'.
DASHCLAW_ALLOWED_ISSUER=https://idp.example.com

# Optional: require this value in the JWT 'aud' claim.
# Mismatch → verification_status = 'failed'.
DASHCLAW_JWT_AUDIENCE=dashclaw.production.example.com
```

Both env vars are optional. Without them DashClaw accepts tokens from any
issuer and does not validate the audience — useful during development.

## JWT token schema

```json
{
  "iss": "https://idp.example.com",
  "sub": "agt_7f3a2b",
  "agent_name": "review-worker-3",
  "aud": "dashclaw.example.com",
  "exp": 1744300800,
  "iat": 1744300500,
  "jti": "txn_a8f3..."
}
```

| Claim        | Required | Used by DashClaw                          |
|--------------|----------|-------------------------------------------|
| `iss`        | Yes      | JWKS discovery (`{iss}/.well-known/jwks.json`) |
| `sub`        | Yes      | Canonical `agent_id` when verified        |
| `agent_name` | No       | Human-readable label in audit entries     |
| `aud`        | No       | Validated when `DASHCLAW_JWT_AUDIENCE` set |
| `exp`        | No       | Checked before JWKS fetch (fast path)     |
| `jti`        | No       | Replay-protection (future Phase 2b)       |

## Supported algorithms

EdDSA (Ed25519), RS256/384/512, ES256/384/512.

## SDK usage

```javascript
import DashClaw from 'dashclaw';

const dashclaw = new DashClaw({
  baseUrl: 'https://dashclaw.example.com',
  apiKey: 'dc_key_...',
  // Phase 1 trust-on-assertion (still works):
  agentId: 'agt_7f3a2b',
  agentName: 'deploy-checker',
  // Phase 2 JWKS verification — pass your AAT as a bearer token:
  authToken: '<your-jwt-from-your-idp>',
});

const result = await dashclaw.guard({ action_type: 'deploy' });
console.log(result.verification_status); // 'verified' | 'unverified' | ...
```

## Example: AgentLair

AgentLair (agentlair.dev) issues Ed25519-signed JWTs (Agent Audit Tokens)
with a persistent `sub` (stable `agent_id`) and publishes JWKS at
`https://agentlair.dev/.well-known/jwks.json`.

To use AgentLair as your identity provider:

```bash
DASHCLAW_ALLOWED_ISSUER=https://agentlair.dev
DASHCLAW_JWT_AUDIENCE=dashclaw.example.com  # optional
```

No other changes are needed — the standard bearer token flow works as-is.

## Example: Keycloak

```bash
DASHCLAW_ALLOWED_ISSUER=https://keycloak.example.com/realms/agents
# JWT iss must match exactly. JWKS auto-discovered from:
# https://keycloak.example.com/realms/agents/.well-known/jwks.json
```

## Example: Auth0

```bash
DASHCLAW_ALLOWED_ISSUER=https://your-tenant.auth0.com/
# JWKS auto-discovered from:
# https://your-tenant.auth0.com/.well-known/jwks.json
```

## Backward compatibility

Phase 2 is fully additive. Existing integrations using Phase 1 body-field
attribution continue to work without any changes. The only difference is that
`verification_status` will be `unverified` instead of absent.
