'use client';

import { useState, useEffect, useCallback } from 'react';
import { Target } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { ProgressBar } from './ui/ProgressBar';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips.js';

export default function GoalsChart() {
  const [goals, setGoals] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals${agentId ? `?agent_id=${agentId}` : ''}`);
      const result = await res.json();
      setGoals(result.goals || []);
      setStats(result.stats || {});
    } catch (error) {
      console.error('Failed to fetch goals:', error);
      setGoals([]);
      setStats({});
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  useRealtime(useCallback((event) => {
    if (event === 'goal.created' || event === 'goal.updated') {
      fetchGoals();
    }
  }, [fetchGoals]));

  if (loading) {
    return <CardSkeleton />;
  }

  const totalGoals = stats.totalGoals || goals.length;

  if (totalGoals === 0) {
    return (
      <Card className="h-full">
        <CardHeader title={<span className="flex items-center">Goal Progress<HelpIcon sectionKey="goals" tip={HELP_TIPS['goals']} /></span>} icon={Target} />
        <CardContent>
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="Create goals via the SDK's createGoal() or POST /api/goals"
          />
        </CardContent>
      </Card>
    );
  }

  const topGoals = goals.slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader title={<span className="flex items-center">Goal Progress<HelpIcon sectionKey="goals" tip={HELP_TIPS['goals']} /></span>} icon={Target} count={totalGoals} />

      <CardContent>
        {/* Stats row */}
        <div className="bg-surface-tertiary rounded-lg px-3 py-2.5 mb-4">
          <div className="grid grid-cols-4 gap-2">
            <StatCompact label="Total" value={totalGoals} />
            <StatCompact label="Active" value={stats.active || 0} color="text-info" />
            <StatCompact label="Done" value={stats.completed || 0} color="text-success" />
            <StatCompact label="Avg %" value={`${stats.avgProgress || 0}%`} color="text-brand" />
          </div>
        </div>

        {/* Top 5 goals */}
        <div className="space-y-2.5">
          {topGoals.map((goal) => (
            <div key={goal.id || goal.title} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-secondary truncate mr-2">
                  {goal.title || 'Goal'}
                </span>
                <span className="text-xs text-tertiary tabular-nums flex-shrink-0">
                  {goal.progress || 0}%
                </span>
              </div>
              <ProgressBar
                value={goal.progress || 0}
                color={goal.progress >= 100 ? 'success' : goal.progress > 0 ? 'brand' : 'info'}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
