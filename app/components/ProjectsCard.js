'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { FolderKanban } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { StatCompact } from './ui/Stat';
import { ProgressBar } from './ui/ProgressBar';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { useTileSize, fitItems } from '../hooks/useTileSize';

function getStatusVariant(status) {
  switch (status) {
    case 'active': return 'success';
    case 'building': return 'warning';
    case 'maintaining': return 'info';
    case 'paused': return 'default';
    default: return 'default';
  }
}

function getProgressColor(status) {
  switch (status) {
    case 'active': return 'brand';
    case 'building': return 'warning';
    case 'maintaining': return 'info';
    case 'paused': return 'brand';
    default: return 'brand';
  }
}

export default function ProjectsCard() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch(`/api/actions?limit=200${agentId ? `&agent_id=${agentId}` : ''}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      const systemMap = {};
      for (const action of (data.actions || [])) {
        let systems = [];
        try {
          systems = typeof action.systems_touched === 'string'
            ? JSON.parse(action.systems_touched || '[]')
            : (action.systems_touched || []);
        } catch { systems = []; }

        if (systems.length === 0) systems = ['General'];

        for (const sys of systems) {
          if (!systemMap[sys]) {
            systemMap[sys] = { total: 0, completed: 0, failed: 0, running: 0, lastUpdate: null };
          }
          systemMap[sys].total++;
          if (action.status === 'completed') systemMap[sys].completed++;
          else if (action.status === 'failed') systemMap[sys].failed++;
          else if (action.status === 'running') systemMap[sys].running++;

          const ts = action.timestamp_start || action.created_at;
          if (ts && (!systemMap[sys].lastUpdate || ts > systemMap[sys].lastUpdate)) {
            systemMap[sys].lastUpdate = ts;
          }
        }
      }

      const items = Object.entries(systemMap)
        .map(([name, stats]) => {
          const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
          let status = 'active';
          if (stats.running > 0) status = 'building';
          else if (stats.failed > stats.completed) status = 'paused';
          else if (progress === 100) status = 'maintaining';

          return { name, status, progress, total: stats.total, lastUpdate: stats.lastUpdate };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, 9);

      setProjects(items);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useRealtime(useCallback((event) => {
    if (event === 'action.created' || event === 'action.updated') {
      fetchProjects();
    }
  }, [fetchProjects]));

  const { activeCount, buildingCount, maintainingCount } = useMemo(() => {
    let active = 0, building = 0, maintaining = 0;
    for (const p of projects) {
      if (p.status === 'active') active++;
      else if (p.status === 'building') building++;
      else if (p.status === 'maintaining') maintaining++;
    }
    return { activeCount: active, buildingCount: building, maintainingCount: maintaining };
  }, [projects]);

  const formatDate = (ts) => {
    if (!ts) return '--';
    try {
      return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return '--'; }
  };

  if (loading) {
    return <CardSkeleton />;
  }

  if (projects.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader title="Active Projects" icon={FolderKanban} />
        <CardContent>
          <EmptyState
            icon={FolderKanban}
            title="No project activity yet"
            description="Projects auto-populate from action systems_touched. Use the SDK's createAction() to start tracking."
          />
        </CardContent>
      </Card>
    );
  }

  const ITEM_H = 40;
  const FOOTER_H = 80;
  const maxVisible = tileHeight > 0 ? fitItems(tileHeight, ITEM_H, FOOTER_H) : 5;
  const visibleProjects = projects.slice(0, maxVisible);

  return (
    <Card className="h-full">
      <CardHeader title="Active Projects" icon={FolderKanban} count={projects.length} />

      <CardContent>
        <div ref={sizeRef} className="flex flex-col h-full min-h-0">
        <div className="flex-1 min-h-0 space-y-1">
          {visibleProjects.map((project, index) => (
            <div
              key={index}
              className="flex items-center gap-3 px-2 py-2 rounded-lg transition-colors duration-150 hover:bg-white/[0.03]"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-secondary truncate">{project.name}</div>
              </div>

              <span className="text-xs text-tertiary tabular-nums flex-shrink-0 w-10 text-right">
                {project.total}
              </span>

              <div className="w-20 flex-shrink-0">
                <ProgressBar value={project.progress} color={getProgressColor(project.status)} />
              </div>

              <Badge variant={getStatusVariant(project.status)} size="xs" className="flex-shrink-0 w-[72px] justify-center">
                {project.status}
              </Badge>

              <span className="font-mono text-[10px] text-disabled flex-shrink-0 w-14 text-right">
                {formatDate(project.lastUpdate)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-auto pt-3 border-t border-border flex-shrink-0 relative z-10 bg-surface-secondary">
          <div className="grid grid-cols-3 gap-2">
            <StatCompact label="Active" value={activeCount} color="text-success" />
            <StatCompact label="Building" value={buildingCount} color="text-warning" />
            <StatCompact label="Maintaining" value={maintainingCount} color="text-info" />
          </div>
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
