'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap, ArrowRight,
  RefreshCw, Activity, Search, MousePointer2, Info,
  History, Target, X, AlertCircle, CheckCircle2,
  Clock, Terminal, FileText, ChevronRight, Maximize2, ZoomIn, ZoomOut
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { isDemoMode } from '../lib/isDemoMode';
import { useRealtime } from '../hooks/useRealtime';
import { useForceSimulation } from './useForceSimulation';

export default function SwarmTopologyPage() {
  const router = useRouter();
  const demo = isDemoMode();

  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI State
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [hoveredAgentId, setHoveredAgentId] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null); // { source: nodeId, target: nodeId }
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFocused, setIsFocused] = useState(false);

  // Performance Refs
  const packetsRef = useRef([]);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef({ isDragging: false, node: null, hasMoved: false });
  const hoveredLinkRef = useRef(null);
  const selectedLinkRef = useRef(null);
  // Design-token color strings for the canvas, read once from CSS custom
  // properties on mount so we never scatter raw hex through the draw loop.
  const colorsRef = useRef({
    brand: '#f97316',
    success: '#22c55e',
    warning: '#eab308',
    error: '#ef4444',
    nodeBody: '#111111',
    label: '#fafafa',
    labelMuted: '#808088',
  });
  const renderStateRef = useRef({
    selectedId: null,
    hoveredId: null,
    selectedLink: null,
    zoom: 0.8,
    pan: { x: 0, y: 0 }
  });

  // Action Inspection State
  const [inspectedAction, setInspectedAction] = useState(null);

  const { nodesRef, linksRef, nodesMapRef, setNodeFixed, wake, expand } = useForceSimulation({
    nodes: graphData.nodes,
    links: graphData.links,
    width: 800,
    height: 600
  });

  // Read design tokens into literal color strings once for the canvas.
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (name, fallback) => {
      const v = cs.getPropertyValue(name).trim();
      return v || fallback;
    };
    colorsRef.current = {
      brand: read('--color-brand', '#f97316'),
      success: read('--color-success', '#22c55e'),
      warning: read('--color-warning', '#eab308'),
      error: read('--color-error', '#ef4444'),
      nodeBody: read('--color-bg-secondary', '#111111'),
      label: read('--color-text-primary', '#fafafa'),
      labelMuted: read('--color-text-tertiary', '#808088'),
    };
  }, []);

  // Sync React state to render ref for high-performance canvas access
  useEffect(() => {
    selectedLinkRef.current = selectedLink;
    renderStateRef.current = {
      selectedId: selectedAgentId,
      hoveredId: hoveredAgentId,
      selectedLink,
      zoom,
      pan
    };
  }, [selectedAgentId, hoveredAgentId, selectedLink, zoom, pan]);

  const [agentContext, setAgentContext] = useState({
    loading: false,
    actions: [],
    messages: [],
  });

  const [linkContext, setLinkContext] = useState({
    loading: false,
    shared_actions: [],
    messages: [],
  });

  // --- RENDERING LOOP (CANVAS) ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let frame;

    const render = () => {
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const nodesMap = nodesMapRef.current;
      const packets = packetsRef.current;
      const colors = colorsRef.current;
      const { selectedId, hoveredId, zoom: z, pan: p } = renderStateRef.current;

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);
      ctx.save();

      // Apply View Transform (Zoom/Pan)
      ctx.translate(width / 2 + p.x, height / 2 + p.y);
      ctx.scale(z, z);
      ctx.translate(-400, -300);

      // 1. Draw Links
      const sLink = renderStateRef.current.selectedLink;

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const s = typeof link.source === 'object' ? link.source : nodesMap.get(link.source);
        const t = typeof link.target === 'object' ? link.target : nodesMap.get(link.target);
        if (!s || !t) continue;

        const isSelectedLink = sLink && (
          (s.id === sLink.source && t.id === sLink.target) ||
          (s.id === sLink.target && t.id === sLink.source)
        );
        const isHoveredLink = hoveredLinkRef.current && (
          (s.id === hoveredLinkRef.current.source && t.id === hoveredLinkRef.current.target) ||
          (s.id === hoveredLinkRef.current.target && t.id === hoveredLinkRef.current.source)
        );

        ctx.beginPath();
        if (isSelectedLink) {
          ctx.lineWidth = 4;
          ctx.strokeStyle = withAlpha(colors.brand, 0.6);
        } else if (isHoveredLink) {
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        } else {
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        }

        // Additional highlight for selected agent's links
        if (!isSelectedLink && !isHoveredLink && selectedId && (s.id === selectedId || t.id === selectedId)) {
          ctx.strokeStyle = withAlpha(colors.brand, 0.4);
          ctx.lineWidth = 2;
        }

        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }

      // 2. Draw Packets (NO SHADOWS - Performance Killer)
      const now = Date.now();
      const activePackets = [];

      ctx.fillStyle = colors.brand;
      for (let i = 0; i < packets.length; i++) {
        const p = packets[i];
        const progress = (now - p.startTime) / 800;
        if (progress > 1) continue; // Will be cleaned up

        activePackets.push(p);
        const s = nodesMap.get(p.from);
        const t = nodesMap.get(p.to === 'broadcast' ? nodes[0]?.id : p.to);
        if (!s || !t) continue;

        const px = s.x + (t.x - s.x) * progress;
        const py = s.y + (t.y - s.y) * progress;

        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      packetsRef.current = activePackets;

      // 3. Draw Nodes
      const showLabels = nodes.length < 15;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isSel = selectedId === node.id;
        const isHov = hoveredId === node.id;

        // Focus ring (only for the actively selected / hovered node)
        if (isSel || isHov) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 35, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 35);
          grad.addColorStop(0, withAlpha(colors.brand, 0.22));
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Body
        const rCol = node.risk > 70 ? colors.error : node.risk > 40 ? colors.warning : colors.success;
        ctx.beginPath();
        ctx.arc(node.x, node.y, isSel ? 18 : 12, 0, Math.PI * 2);
        ctx.fillStyle = colors.nodeBody;
        ctx.strokeStyle = isSel ? colors.brand : rCol;
        ctx.lineWidth = isSel ? 4 : 3;
        ctx.fill();
        ctx.stroke();

        // Label
        if (isSel || isHov || showLabels) {
          ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
          ctx.fillStyle = isSel ? colors.label : colors.labelMuted;
          ctx.textAlign = 'center';
          ctx.fillText(node.name, node.x, node.y + 35);
        }
      }

      ctx.restore();
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [linksRef, nodesMapRef, nodesRef]); // Use refs as dependencies to satisfy linter

  // --- INTERACTION LOGIC ---

  const screenToWorld = useCallback((sx, sy) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (sx - rect.left) * (canvas.width / rect.width);
    const y = (sy - rect.top) * (canvas.height / rect.height);
    const { zoom: z, pan: p } = renderStateRef.current;
    const wx = (x - canvas.width / 2 - p.x) / z + 400;
    const wy = (y - canvas.height / 2 - p.y) / z + 300;
    return { x: wx, y: wy };
  }, []);

  const pointToLineDistance = (px, py, x1, y1, x2, y2) => {
    const l2 = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
    if (l2 === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (x1 + t * (x2 - x1));
    const dy = py - (y1 + t * (y2 - y1));
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleMouseDown = (e) => {
    setIsFocused(true);
    const { x, y } = screenToWorld(e.clientX, e.clientY);

    const clickedNode = nodesRef.current.find(n => {
      const dx = n.x - x;
      const dy = n.y - y;
      const { zoom: z } = renderStateRef.current;
      return Math.sqrt(dx * dx + dy * dy) < 30 / z;
    });

    if (clickedNode) {
      dragRef.current = { isDragging: true, node: clickedNode, hasMoved: false };
      setSelectedAgentId(clickedNode.id);
      setSelectedLink(null);
    } else if (hoveredLinkRef.current) {
      dragRef.current = { isDragging: true, node: null, hasMoved: false };
      setSelectedLink(hoveredLinkRef.current);
      setSelectedAgentId(null);
    } else {
      dragRef.current = { isDragging: true, node: null, hasMoved: false };
      setSelectedAgentId(null);
      setSelectedLink(null);
    }
  };

  const handleMouseMove = (e) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (dragRef.current.isDragging) {
      dragRef.current.hasMoved = true;
      if (dragRef.current.node) {
        setNodeFixed(dragRef.current.node.id, x, y);
        setHoveredAgentId(null);
      } else {
        setPan(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
      }
    } else {
      const hovNode = nodesRef.current.find(n => {
        const dx = n.x - x;
        const dy = n.y - y;
        const { zoom: z } = renderStateRef.current;
        return Math.sqrt(dx * dx + dy * dy) < 30 / z;
      });
      setHoveredAgentId(hovNode?.id || null);

      if (!hovNode) {
        // Check links
        let bestLink = null;
        let minDist = 6; // 6 world-space pixels
        const links = linksRef.current;
        const nodesMap = nodesMapRef.current;

        for (const link of links) {
          const s = typeof link.source === 'object' ? link.source : nodesMap.get(link.source);
          const t = typeof link.target === 'object' ? link.target : nodesMap.get(link.target);
          if (!s || !t) continue;

          const dist = pointToLineDistance(x, y, s.x, s.y, t.x, t.y);
          if (dist < minDist) {
            minDist = dist;
            bestLink = { source: s.id, target: t.id };
          }
        }
        hoveredLinkRef.current = bestLink;
      } else {
        hoveredLinkRef.current = null;
      }
    }
  };

  const handleMouseUp = () => {
    if (dragRef.current.node && dragRef.current.hasMoved) {
      setNodeFixed(dragRef.current.node.id, null, null);
    }
    dragRef.current = { isDragging: false, node: null, hasMoved: false };
  };

  const handleWheel = useCallback((e) => {
    if (!isFocused) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const { zoom: z, pan: p } = renderStateRef.current;
    const newZoom = Math.max(0.1, Math.min(10, z * delta));

    if (newZoom !== z) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dx = (mx - canvas.width / 2 - p.x) * (delta - 1);
      const dy = (my - canvas.height / 2 - p.y) * (delta - 1);

      setPan(prev => ({ x: prev.x - dx, y: prev.y - dy }));
      setZoom(newZoom);
    }
  }, [isFocused]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el?.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // --- DATA FETCHING ---

  const triggerPacket = useCallback((fromId, toId) => {
    const packetId = Math.random().toString(36).substring(7);
    packetsRef.current.push({ id: packetId, from: fromId, to: toId, startTime: Date.now() });
    // No more state update here! The render loop will pick it up from the ref.
  }, []);

  useRealtime((event, payload) => {
    if (event === 'message.created') {
      triggerPacket(payload.from_agent_id, payload.to_agent_id || 'broadcast');
    }
  });

  const fetchGraph = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/swarm/graph');
      if (!res.ok) throw new Error('Failed to load swarm data');
      const json = await res.json();
      setGraphData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
    const interval = setInterval(fetchGraph, 60000);
    return () => clearInterval(interval);
  }, [fetchGraph]);

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentContext({ loading: false, actions: [], messages: [] });
      return;
    }
    const ctrl = new AbortController();
    const load = async () => {
      setAgentContext(prev => ({ ...prev, loading: true }));
      try {
        const qs = (path) => `/api/${path}?agent_id=${encodeURIComponent(selectedAgentId)}&limit=15`;
        const [actionsRes, msgsRes] = await Promise.all([
          fetch(qs('actions'), { signal: ctrl.signal }),
          fetch(qs('messages'), { signal: ctrl.signal }),
        ]);
        const [actionsJson, msgsJson] = await Promise.all([
          actionsRes.json().catch(() => ({ actions: [] })),
          msgsRes.json().catch(() => ({ messages: [] })),
        ]);
        setAgentContext({ loading: false, actions: actionsJson.actions || [], messages: msgsJson.messages || [] });
      } catch (e) {
        if (e.name !== 'AbortError') setAgentContext(prev => ({ ...prev, loading: false }));
      }
    };
    load();
    return () => ctrl.abort();
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedLink) {
      setLinkContext({ loading: false, shared_actions: [], messages: [] });
      return;
    }
    const ctrl = new AbortController();
    const load = async () => {
      setLinkContext(prev => ({ ...prev, loading: true }));
      try {
        const url = `/api/swarm/link?source=${encodeURIComponent(selectedLink.source)}&target=${encodeURIComponent(selectedLink.target)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const json = await res.json();
        setLinkContext({
          loading: false,
          shared_actions: json.shared_actions || [],
          messages: json.messages || []
        });
      } catch (e) {
        if (e.name !== 'AbortError') setLinkContext(prev => ({ ...prev, loading: false }));
      }
    };
    load();
    return () => ctrl.abort();
  }, [selectedLink]);

  const selectedAgent = useMemo(() =>
    nodesRef.current.find(n => n.id === selectedAgentId),
  [selectedAgentId, nodesRef]);

  const selectedPartners = useMemo(() => {
    if (!selectedAgentId) return [];
    return linksRef.current
      .filter(l => l.source === selectedAgentId || l.target === selectedAgentId || l.source?.id === selectedAgentId || l.target?.id === selectedAgentId)
      .map(link => {
        const s = typeof link.source === 'object' ? link.source.id : link.source;
        const t = typeof link.target === 'object' ? link.target.id : link.target;
        const pId = s === selectedAgentId ? t : s;
        const pNode = nodesRef.current.find(n => n.id === pId);
        return { id: pId, name: pNode?.name || pId };
      });
  }, [selectedAgentId, linksRef, nodesRef]);

  const LinkInspectorPanel = ({ link, context, onClose }) => {
    const [activeTab, setActiveTab] = useState('activity');
    const sourceNode = nodesMapRef.current.get(link.source);
    const targetNode = nodesMapRef.current.get(link.target);

    if (!sourceNode || !targetNode) return null;

    return (
      <div className="flex flex-1 flex-col min-h-0 space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-tertiary border border-border text-[10px] font-semibold text-white">
                {sourceNode.name[0]}
              </div>
              <span className="mt-1 max-w-[60px] truncate text-[9px] text-tertiary">{sourceNode.name}</span>
            </div>
            <ArrowRight size={14} className="text-tertiary" />
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-tertiary border border-border text-[10px] font-semibold text-white">
                {targetNode.name[0]}
              </div>
              <span className="mt-1 max-w-[60px] truncate text-[9px] text-tertiary">{targetNode.name}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-tertiary transition-colors hover:bg-surface-tertiary hover:text-white" aria-label="Close inspector">
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('activity')}
            className={`border-b-2 px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${activeTab === 'activity' ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary'}`}
          >
            Shared activity
          </button>
          <button
            onClick={() => setActiveTab('messages')}
            className={`border-b-2 px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${activeTab === 'messages' ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary'}`}
          >
            Messages
          </button>
        </div>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {context.loading ? (
            <div className="py-12 text-center text-[11px] text-tertiary">Loading shared activity…</div>
          ) : activeTab === 'activity' ? (
            <div className="flex flex-1 flex-col min-h-0 gap-2">
              <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Shared actions ({context.shared_actions.length})
              </div>
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                {context.shared_actions.length > 0 ? (
                  <>
                    {context.shared_actions.slice(0, 3).map((act, i) => {
                      const statusColor = act.status === 'completed' ? 'bg-status-success' : act.status === 'failed' ? 'bg-status-error' : 'bg-status-warning';
                      const riskColor = act.risk_score >= 70 ? 'text-error' : 'text-warning';
                      return (
                        <a
                          key={i}
                          href={`/decisions/${act.action_id}`}
                          className="block rounded-lg bg-surface-tertiary p-2.5 text-xs transition-colors hover:bg-surface-elevated"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
                            <span className="truncate text-secondary">{act.declared_goal || act.action_type}</span>
                            {act.risk_score >= 40 && (
                              <span className={`${riskColor} ml-auto shrink-0 font-mono text-[10px] tabular-nums`}>risk {act.risk_score}</span>
                            )}
                          </div>
                        </a>
                      );
                    })}
                    {context.shared_actions.length > 3 && (
                      <a
                        href={`/decisions?agents=${encodeURIComponent(link.source)},${encodeURIComponent(link.target)}`}
                        className="flex items-center justify-center gap-1 py-1 text-center text-[10px] text-secondary transition-colors hover:text-primary"
                      >
                        View all {context.shared_actions.length} actions <ArrowRight size={11} />
                      </a>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={Activity}
                    title="No shared actions"
                    description="No governed actions recorded between these agents within the current window."
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col min-h-0 gap-2">
              <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Messages ({context.messages.length})
              </div>
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                {context.messages.length > 0 ? (
                  <>
                    {context.messages.slice(0, 5).map((msg, i) => {
                      const time = formatTimestamp(msg.created_at);
                      return (
                        <div key={i} className="rounded-lg bg-surface-tertiary p-2.5 text-xs">
                          <div className="mb-0.5 flex items-center gap-1 text-tertiary">
                            <span className="text-secondary">{msg.sender_agent_id}</span>
                            <ArrowRight size={10} />
                            <span>{msg.recipient_agent_id || 'broadcast'}</span>
                            <span className="ml-auto tabular-nums">{time}</span>
                          </div>
                          <div className="line-clamp-2 text-secondary">{msg.content}</div>
                        </div>
                      );
                    })}
                    {context.messages.length > 5 && (
                      <a
                        href={`/messages?agents=${encodeURIComponent(link.source)},${encodeURIComponent(link.target)}`}
                        className="flex items-center justify-center gap-1 py-1 text-center text-[10px] text-secondary transition-colors hover:text-primary"
                      >
                        View all {context.messages.length} messages <ArrowRight size={11} />
                      </a>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={Info}
                    title="No messages"
                    description="No direct messages recorded between these agents."
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const ActionDetailOverlay = ({ action, onClose }) => {
    if (!action) return null;
    return (
      <div className="absolute inset-0 z-[100] flex flex-col rounded-xl bg-surface-primary p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`rounded-xl p-3 ${
              action.status === 'completed' ? 'bg-success-subtle text-success' :
              action.status === 'failed' ? 'bg-error-subtle text-error' : 'bg-warning-subtle text-warning'
            }`}>
              {action.status === 'completed' ? <CheckCircle2 size={26} /> : action.status === 'failed' ? <AlertCircle size={26} /> : <Clock size={26} />}
            </div>
            <div>
              <h2 className="mb-2 text-xl font-semibold leading-none text-white">{action.action_type}</h2>
              <div className="flex items-center gap-2">
                <Badge
                  variant={action.status === 'completed' ? 'success' : action.status === 'failed' ? 'error' : 'default'}
                  size="xs"
                  className="uppercase"
                >
                  {action.status}
                </Badge>
                <span className="font-mono text-[10px] tracking-tight text-tertiary">{action.action_id}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-tertiary transition-colors hover:bg-surface-tertiary hover:text-white" aria-label="Close detail"><X size={20} /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                <Target size={14} className="text-tertiary" /> Risk score
              </div>
              <div className={`font-mono text-3xl tabular-nums tracking-tight ${action.risk_score > 70 ? 'text-error' : action.risk_score > 40 ? 'text-warning' : 'text-success'}`}>
                {action.risk_score || 0}%
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                <Clock size={14} className="text-tertiary" /> Execution time
              </div>
              <div className="font-mono text-xl tabular-nums tracking-tight text-secondary">
                {formatTimestamp(action.timestamp_start)}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              <Info size={14} className="text-tertiary" /> Decision rationale
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5 text-sm leading-relaxed text-secondary">
              {action.reasoning || 'Autonomous decision based on current fleet goals and policy constraints.'}
            </div>
          </div>

          {(() => {
            const meta = typeof action.metadata === 'string'
              ? (() => { try { return JSON.parse(action.metadata); } catch { return null; } })()
              : action.metadata;
            if (!meta || typeof meta !== 'object' || Array.isArray(meta) || Object.keys(meta).length === 0) {
              // Non-object metadata (string/array/number) has no key/value shape — show the raw value.
              if (meta === null || meta === undefined || (typeof meta === 'object' && Object.keys(meta).length === 0)) return null;
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                    <Terminal size={14} className="text-tertiary" /> Contextual metadata
                  </div>
                  <pre className="overflow-x-auto rounded-xl border border-border bg-surface-tertiary p-5 font-mono text-[11px] leading-relaxed text-secondary">
                    {JSON.stringify(meta, null, 2)}
                  </pre>
                </div>
              );
            }
            // Humanize governance-meaningful keys into a labeled key/value list. Scalar
            // values render as labeled fields; nested objects/arrays collapse into a
            // small code block so the human-readable fields stay scannable.
            const LABELS = {
              model: 'Model',
              provider: 'Provider',
              capability: 'Capability',
              cost: 'Cost',
              cost_estimate: 'Cost estimate',
              tokens: 'Tokens',
              input_tokens: 'Input tokens',
              output_tokens: 'Output tokens',
              risk_score: 'Risk score',
              policy: 'Policy',
              decision: 'Decision',
              tool: 'Tool',
              agent_id: 'Agent',
              duration_ms: 'Duration (ms)',
            };
            const humanize = (key) =>
              LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            const entries = Object.entries(meta);
            const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
            const scalarEntries = entries.filter(([, v]) => isScalar(v));
            const complexEntries = entries.filter(([, v]) => !isScalar(v));
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                  <Terminal size={14} className="text-tertiary" /> Contextual metadata
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-surface-secondary p-5">
                  {scalarEntries.map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
                        {humanize(key)}
                      </dt>
                      <dd className="break-words font-mono text-xs text-secondary">
                        {value === null ? '—' : String(value)}
                      </dd>
                    </div>
                  ))}
                  {complexEntries.map(([key, value]) => (
                    <details key={key} className="group col-span-2 min-w-0">
                      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary [&::-webkit-details-marker]:hidden">
                        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                        {humanize(key)}
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-tertiary p-3 font-mono text-[11px] leading-relaxed text-secondary">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    </details>
                  ))}
                </dl>
              </div>
            );
          })()}
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <button
            onClick={() => router.push(`/decisions/${action.action_id}`)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            View decision record <FileText size={16} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <PageLayout
      title="Fleet topology"
      subtitle="Agent network: relationships, message flow, and per-agent risk"
      breadcrumbs={['Operations', 'Topology']}
      actions={<button onClick={fetchGraph} className="p-2 text-secondary transition-colors hover:text-white" aria-label="Refresh topology"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>}
    >
      <div className="space-y-6">
        {/* ROW 1: TOPOLOGY CANVAS + INSPECTOR (FULL VIEWPORT HEIGHT) */}
        <div className="flex h-[calc(100vh-140px)] min-h-[600px] flex-col gap-6 lg:flex-row">

          {/* Topology canvas */}
          <Card hover={false} className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-primary">
            <CardHeader>
              <div className="flex min-w-0 items-center gap-2">
                <Activity size={14} className="shrink-0 text-tertiary" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Agent network</span>
              </div>
              <Badge variant="default" size="xs" className="tabular-nums">{graphData.nodes.length} agents</Badge>
            </CardHeader>

            <CardContent className="relative flex-1 overflow-hidden p-0">
              <div
                ref={containerRef}
                className="relative h-full w-full cursor-grab active:cursor-grabbing"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <canvas ref={canvasRef} width={800} height={600} className="h-full w-full select-none" />
                {!isFocused && (
                  <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-surface-primary/40">
                    <div className="flex flex-col items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border">
                        <MousePointer2 className="text-secondary" size={22} />
                      </div>
                      <div className="rounded-lg border border-border bg-surface-secondary px-4 py-2 text-[11px] font-medium text-secondary">
                        Click to interact with the network
                      </div>
                    </div>
                  </div>
                )}
                <div className="absolute right-4 top-4 z-20 flex flex-col gap-2">
                  <button onClick={() => { setZoom(z => Math.min(10, z * 1.5)); }} title="Zoom in" aria-label="Zoom in" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary text-secondary transition-colors hover:border-border-hover hover:text-white"><ZoomIn size={14} /></button>
                  <button onClick={() => { setZoom(z => Math.max(0.1, z * 0.7)); }} title="Zoom out" aria-label="Zoom out" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary text-secondary transition-colors hover:border-border-hover hover:text-white"><ZoomOut size={14} /></button>
                  <button onClick={() => { setZoom(0.8); setPan({ x: 0, y: 0 }); }} title="Reset view" aria-label="Reset view" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary text-secondary transition-colors hover:border-border-hover hover:text-white"><RefreshCw size={14} /></button>
                  <button onClick={expand} title="Distribute network" aria-label="Distribute network" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary text-secondary transition-colors hover:border-border-hover hover:text-white"><Maximize2 size={14} /></button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Inspector */}
          <div className="h-full w-full shrink-0 lg:w-[400px]">
            <Card hover={false} className="flex h-full flex-col overflow-hidden">
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <Search size={14} className="shrink-0 text-tertiary" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Inspector</span>
                </div>
              </CardHeader>
              <CardContent className="relative flex flex-1 flex-col min-h-0">
                {inspectedAction && <ActionDetailOverlay action={inspectedAction} onClose={() => setInspectedAction(null)} />}

                {selectedLink ? (
                  <LinkInspectorPanel
                    link={selectedLink}
                    context={linkContext}
                    onClose={() => setSelectedLink(null)}
                  />
                ) : selectedAgent ? (
                  <div className="flex flex-1 flex-col min-h-0 space-y-5">
                    <div className="shrink-0">
                      <h3 className="mb-0.5 text-lg font-semibold text-white">{selectedAgent.name}</h3>
                      <code className="font-mono text-[10px] text-tertiary">{selectedAgent.id.substring(0, 12)}…</code>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant={(selectedAgent.risk || 0) > 40 ? 'warning' : 'success'} size="xs" className="tabular-nums">
                          Risk {(selectedAgent.risk || 0).toFixed(0)}%
                        </Badge>
                      </div>
                    </div>

                    <div className="shrink-0 space-y-3">
                      <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary"><Zap size={12} className="text-tertiary" /> Performance</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-border bg-surface-tertiary p-3">
                          <StatCompact label="Actions" value={selectedAgent.actions || 0} />
                        </div>
                        <div className="rounded-xl border border-border bg-surface-tertiary p-3">
                          <StatCompact label="Cost" value={`$${(selectedAgent.cost || 0).toFixed(2)}`} color="text-info" />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col min-h-0 space-y-3 overflow-hidden">
                      <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary"><History size={12} className="text-tertiary" /> Latest decisions</h4>
                      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                        {agentContext.loading ? (
                          <div className="py-8 text-center text-[11px] text-tertiary">Loading decisions…</div>
                        ) : agentContext.actions.length > 0 ? (
                          agentContext.actions.map((action, i) => (
                            <button
                              key={i}
                              onClick={() => setInspectedAction(action)}
                              className="group/action flex w-full flex-col gap-2 rounded-xl border border-border bg-surface-tertiary p-3 text-left transition-colors hover:border-border-hover hover:bg-surface-elevated"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="max-w-[150px] truncate text-[12px] font-semibold text-white">{action.action_type}</span>
                                <Badge
                                  variant={action.status === 'completed' ? 'success' : action.status === 'failed' ? 'error' : 'warning'}
                                  size="xs"
                                  className="uppercase"
                                >
                                  {action.status}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-tertiary">
                                <span className="flex items-center gap-1.5"><Target size={10} /> {action.risk_score || 0}% risk</span>
                                <span className="flex items-center gap-1.5">{formatTimestamp(action.timestamp_start)} <ChevronRight size={10} className="transition-transform group-hover/action:translate-x-0.5" /></span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <EmptyState
                            icon={History}
                            title="No recent decisions"
                            description="This agent has no governed decisions recorded yet."
                          />
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 border-t border-border pt-5">
                      <button onClick={() => router.push(`/decisions?agent_id=${selectedAgent.id}`)} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[11px] font-semibold text-white transition-colors hover:bg-brand-hover">View agent decisions <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center">
                    <EmptyState
                      icon={Search}
                      title="No agent selected"
                      description="Select a node or connection in the network to inspect its governed activity and decision history."
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ROW 2: STATS ROW */}
        <div className="grid grid-cols-1 gap-4 pb-12 md:grid-cols-3">
          <Card hover={false}><CardContent className="flex items-center justify-center py-4"><StatCompact label="Connections" value={graphData.links.length} /></CardContent></Card>
          <Card hover={false}><CardContent className="flex items-center justify-center py-4"><StatCompact label="Total actions" value={graphData.nodes.reduce((s, n) => s + (Number(n.actions) || 0), 0)} /></CardContent></Card>
          <Card hover={false}><CardContent className="flex items-center justify-center py-4"><StatCompact label="Total cost" value={`$${graphData.nodes.reduce((s, n) => s + (Number(n.cost) || 0), 0).toFixed(2)}`} color="text-info" /></CardContent></Card>
        </div>
      </div>
    </PageLayout>
  );
}

// Convert a `#rrggbb` token value into an rgba string at the given alpha so the
// canvas can dim brand/status colors without hardcoding new hex literals.
function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
