// §9.1 Identity & tenancy contracts.
//
// The ONE identity contract that every governed-action-creating route converges
// on. `AgentIdentity` mirrors the return of app/lib/identity-resolution.js
// (resolveAgentIdentity): a verified JWT `sub` overrides the self-asserted body
// agent_id; an untrusted token never applies its claims and is marked NOT
// verified, so a reader can always distinguish verified from self-asserted.

import type { Brand, Nullable } from './brand';

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type AgentName = Brand<string, 'AgentName'>;

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';

/** JWKS verification outcome — mirrors guard_decisions.verification_status. */
export type VerificationStatus =
  | 'verified'
  | 'unverified'
  | 'expired'
  | 'failed'
  | 'unknown_issuer'
  | 'exp_too_far';

/** jti replay-protection outcome — mirrors guard_decisions.replay_status. */
export type ReplayStatus =
  | 'not_applicable'
  | 'unique'
  | 'replayed'
  | 'not_present'
  | 'unavailable'
  | 'exp_too_far'
  | 'disabled';

/** Action-binding outcome — mirrors guard_decisions.act_status. */
export type ActionBindingStatus =
  | 'not_applicable'
  | 'match'
  | 'mismatch'
  | 'not_present'
  | 'unsupported_typ'
  | 'ctx_incomplete';

export interface JwtClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  jti?: string;
  [claim: string]: unknown;
}

/**
 * Result of resolveAgentIdentity(). `verified` distinguishes a cryptographically
 * proven identity from a self-asserted one. `agent_id`/`agent_name` stay plain
 * nullable strings to match the resolver's runtime contract exactly.
 */
export interface AgentIdentity {
  agent_id: Nullable<string>;
  agent_name: Nullable<string>;
  verification_status: VerificationStatus;
  verified: boolean;
  jti: Nullable<string>;
  /** Full verifier result (jwks-verifier.js); narrow before use. */
  verification: unknown;
}

export interface ApiKeyContext {
  orgId: OrganizationId;
  keyId: string;
  role: OrganizationRole;
}

export interface OrganizationContext {
  orgId: OrganizationId;
  role?: OrganizationRole;
}

/** Authenticated, governance-ready agent context (identity ∪ org). */
export interface AuthenticatedAgentContext extends AgentIdentity {
  org: OrganizationContext;
}
