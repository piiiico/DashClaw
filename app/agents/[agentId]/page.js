'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, RotateCw, ShieldAlert } from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import AgentVitalsStrip from './components/AgentVitalsStrip';
import AgentTrustPosture from './components/AgentTrustPosture';
import AgentSignals from './components/AgentSignals';
import AgentDecisionTable from './components/AgentDecisionTable';
import AgentAssumptions from './components/AgentAssumptions';
import AgentPoliciesSection from './components/AgentPoliciesSection';
import AgentConnectionsSection from './components/AgentConnectionsSection';

export default function AgentProfilePage() {
  const { agentId } = useParams();
  const decodedAgentId = decodeURIComponent(agentId);

  const [profile, setProfile] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [profileRes, agentPoliciesRes] = await Promise.all([
        fetch(`/api/agents/${encodeURIComponent(decodedAgentId)}/profile`),
        fetch(`/api/policies?agent_id=${encodeURIComponent(decodedAgentId)}`),
      ]);

      if (!profileRes.ok) {
        if (profileRes.status === 404) throw new Error('Agent not found');
        throw new Error('Failed to load profile');
      }

      const profileData = await profileRes.json();
      setProfile(profileData);

      if (agentPoliciesRes.ok) {
        const pData = await agentPoliciesRes.json();
        setPolicies(pData.policies || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [decodedAgentId]);

  useEffect(() => {
    if (decodedAgentId) fetchProfile();
  }, [decodedAgentId, fetchProfile]);

  if (loading) {
    return (
      <PageLayout title="Agent profile" breadcrumbs={['Observe', 'Fleet', 'Profile']}>
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </PageLayout>
    );
  }

  if (error || !profile) {
    return (
      <PageLayout title="Agent not found" breadcrumbs={['Observe', 'Fleet', decodedAgentId]}>
        <div className="mx-auto mt-12 max-w-md text-center">
          <Card hover={false}>
            <CardContent className="pt-8">
              <ShieldAlert size={32} className="mx-auto mb-3 text-tertiary" aria-hidden="true" />
              <div className="mb-2 text-lg font-semibold text-white">{error || 'Agent not found'}</div>
              <Link
                href="/agents"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand transition-colors hover:text-brand-hover"
              >
                <ArrowLeft size={12} aria-hidden="true" /> Back to fleet
              </Link>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={profile.agent.agent_name}
      breadcrumbs={['Observe', 'Fleet', profile.agent.agent_name]}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/agents"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
          >
            <ArrowLeft size={14} aria-hidden="true" /> Fleet
          </Link>
          <button
            onClick={fetchProfile}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
            aria-label="Refresh"
          >
            <RotateCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
      }
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <AgentVitalsStrip
          agent={profile.agent}
          identityVerified={profile.trust.identity_verified}
        />

        <AgentTrustPosture trust={profile.trust} />

        <AgentSignals signals={profile.signals} />

        <AgentDecisionTable agentId={decodedAgentId} />

        <AgentAssumptions
          agentId={decodedAgentId}
          summary={profile.assumptions_summary}
        />

        <AgentConnectionsSection agentId={decodedAgentId} />

        <AgentPoliciesSection
          agentId={decodedAgentId}
          policies={policies}
          onRefresh={fetchProfile}
        />
      </div>
    </PageLayout>
  );
}
