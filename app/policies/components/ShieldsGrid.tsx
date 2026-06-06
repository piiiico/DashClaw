'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '../../components/ui/Skeleton';
import { SHIELDS, matchShieldsToPolicies, buildShieldPayload } from '../lib/shields';
import ShieldCard from './ShieldCard';

export default function ShieldsGrid() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch('/api/policies');
      if (res.ok) {
        const data = await res.json();
        setPolicies(data.policies || []);
      }
    } catch (err) {
      console.error('Failed to fetch policies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  const shieldMap = matchShieldsToPolicies(policies);

  const handleToggle = async (shield: any, policy: any, activate: boolean) => {
    if (activate && !policy) {
      // Create new shield policy
      const payload = buildShieldPayload(shield);
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) await fetchPolicies();
    } else if (activate && policy) {
      // Re-activate existing policy
      await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, active: 1 }),
      });
      await fetchPolicies();
    } else if (!activate && policy) {
      // Deactivate
      await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: policy.id, active: 0 }),
      });
      await fetchPolicies();
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {SHIELDS.map(shield => (
        <ShieldCard
          key={shield.id}
          shield={shield}
          policy={shieldMap.get(shield.id)}
          onToggle={handleToggle}
          onSaved={fetchPolicies}
        />
      ))}
    </div>
  );
}
