'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Zap, ShieldAlert, MessageSquare, ArrowRight,
  RefreshCw, Activity, Search, MousePointer2, Info,
  History, Target, Shield, Cpu, X, AlertCircle, CheckCircle2,
  Clock, Terminal, FileText, ChevronRight, Maximize2
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { isDemoMode } from '../lib/isDemoMode';
import { useRealtime } from '../hooks/useRealtime';
import { useForceSimulation } from './useForceSimulation';

export default function SwarmIntelligencePage() {
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
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.6)';
        } else if (isHoveredLink) {
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        } else {
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        }

        // Additional highlight for selected agent's links
        if (!isSelectedLink && !isHoveredLink && selectedId && (s.id === selectedId || t.id === selectedId)) {
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.4)';
          ctx.lineWidth = 2;
        }
        
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }

      // 2. Draw Packets (NO SHADOWS - Performance Killer)
      const now = Date.now();
      const activePackets = [];
      
      ctx.fillStyle = '#f97316';
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
        
        // Glow (Only for interactive nodes)
        if (isSel || isHov) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 35, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 35);
          grad.addColorStop(0, 'rgba(249, 115, 22, 0.3)');
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Body
        const rCol = node.risk > 70 ? '#ef4444' : node.risk > 40 ? '#eab308' : '#22c55e';
        ctx.beginPath();
        ctx.arc(node.x, node.y, isSel ? 18 : 12, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.strokeStyle = isSel ? '#f97316' : rCol;
        ctx.lineWidth = isSel ? 4 : 3;
        ctx.fill();
        ctx.stroke();

        // Label
        if (isSel || isHov || showLabels) {
          ctx.font = '10px JetBrains Mono, monospace';
          ctx.fillStyle = isSel ? '#fff' : '#71717a';
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
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 flex-1 flex flex-col min-h-0">
        <div className="flex justify-between items-start px-1">
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-tertiary border border-white/10 flex items-center justify-center text-[10px] font-bold text-white">
                {sourceNode.name[0]}
              </div>
              <span className="text-[9px] text-tertiary mt-1 truncate max-w-[60px]">{sourceNode.name}</span>
            </div>
            <ArrowRight size={14} className="text-brand" />
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-tertiary border border-white/10 flex items-center justify-center text-[10px] font-bold text-white">
                {targetNode.name[0]}
              </div>
              <span className="text-[9px] text-tertiary mt-1 truncate max-w-[60px]">{targetNode.name}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-tertiary hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-white/5 px-1">
          <button 
            onClick={() => setActiveTab('activity')}
            className={`pb-2 px-4 text-[10px] font-bold uppercase tracking-widest transition-colors border-b-2 ${activeTab === 'activity' ? 'border-brand text-brand' : 'border-transparent text-tertiary hover:text-secondary'}`}
          >
            Shared Activity
          </button>
          <button 
            onClick={() => setActiveTab('messages')}
            className={`pb-2 px-4 text-[10px] font-bold uppercase tracking-widest transition-colors border-b-2 ${activeTab === 'messages' ? 'border-brand text-brand' : 'border-transparent text-tertiary hover:text-secondary'}`}
          >
            Messages
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0 px-1">
          {context.loading ? (
            <div className="py-12 text-center text-[11px] text-disabled animate-pulse">Analyzing neural bridge...</div>
          ) : activeTab === 'activity' ? (
            <div className="flex flex-col flex-1 min-h-0 gap-2">
              <div className="text-[10px] text-tertiary font-bold uppercase tracking-widest shrink-0">
                Shared Actions ({context.shared_actions.length})
              </div>
              <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0">
                {context.shared_actions.length > 0 ? (
                  <>
                    {context.shared_actions.slice(0, 3).map((act, i) => {
                      const statusColor = act.status === 'completed' ? 'bg-green-400' : act.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400';
                      const riskColor = act.risk_score >= 70 ? 'text-error' : 'text-warning';
                      return (
                        <a
                          key={i}
                          href={`/decisions/${act.action_id}`}
                          className="block p-2 bg-surface-tertiary rounded text-xs hover:bg-surface-secondary transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                            <span className="text-secondary truncate">{act.declared_goal || act.action_type}</span>
                            {act.risk_score >= 40 && (
                              <span className={`${riskColor} ml-auto text-[10px] font-mono shrink-0`}>risk {act.risk_score}</span>
                            )}
                          </div>
                        </a>
                      );
                    })}
                    {context.shared_actions.length > 3 && (
                      <a
                        href={`/decisions?agents=${encodeURIComponent(link.source)},${encodeURIComponent(link.target)}`}
                        className="block text-center text-[10px] text-brand hover:text-brand/80 transition-colors py-1"
                      >
                        View all {context.shared_actions.length} actions →
                      </a>
                    )}
                  </>
                ) : (
                  <div className="py-12 text-center text-[11px] text-disabled italic">No shared neural activity within sync windows.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 gap-2">
              <div className="text-[10px] text-tertiary font-bold uppercase tracking-widest shrink-0">
                Messages ({context.messages.length})
              </div>
              <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0">
                {context.messages.length > 0 ? (
                  <>
                    {context.messages.slice(0, 5).map((msg, i) => {
                      const time = formatTimestamp(msg.created_at);
                      return (
                        <div key={i} className="p-2 bg-surface-tertiary rounded text-xs">
                          <div className="flex items-center gap-1 text-tertiary mb-0.5">
                            <span className="text-secondary">{msg.sender_agent_id}</span>
                            <span>→</span>
                            <span>{msg.recipient_agent_id || 'broadcast'}</span>
                            <span className="ml-auto">{time}</span>
                          </div>
                          <div className="text-secondary line-clamp-2">{msg.content}</div>
                        </div>
                      );
                    })}
                    {context.messages.length > 5 && (
                      <a
                        href={`/messages?agents=${encodeURIComponent(link.source)},${encodeURIComponent(link.target)}`}
                        className="block text-center text-[10px] text-brand hover:text-brand/80 transition-colors py-1"
                      >
                        View all {context.messages.length} messages →
                      </a>
                    )}
                  </>
                ) : (
                  <div className="py-12 text-center text-[11px] text-disabled italic">No direct messages recorded between these agents.</div>
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
      <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200 p-6 flex flex-col rounded-xl">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${
              action.status === 'completed' ? 'bg-status-success/10 text-success' :
              action.status === 'failed' ? 'bg-error-subtle text-error' : 'bg-status-warning/10 text-warning'
            }`}>
              {action.status === 'completed' ? <CheckCircle2 size={28} /> : action.status === 'failed' ? <AlertCircle size={28} /> : <Clock size={28} />}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white leading-none mb-2">{action.action_type}</h2>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`text-[10px] uppercase font-bold py-0.5 px-2 border-none ${
                  action.status === 'completed' ? 'bg-status-success/10 text-success' :
                  action.status === 'failed' ? 'bg-error-subtle text-error' : 'bg-tertiary text-secondary'
                }`}>{action.status}</Badge>
                <span className="text-[10px] text-tertiary font-mono tracking-tight">{action.action_id}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} className="text-tertiary hover:text-white" /></button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-[#0a0a0a] border border-white/5">
              <div className="text-[10px] text-tertiary uppercase tracking-[0.15em] font-bold mb-3 flex items-center gap-2">
                <Target size={14} className="text-disabled" /> Risk Score
              </div>
              <div className={`text-3xl font-mono tracking-tight ${action.risk_score > 70 ? 'text-error' : action.risk_score > 40 ? 'text-warning' : 'text-success'}`}>
                {action.risk_score || 0}%
              </div>
            </div>
            <div className="p-5 rounded-2xl bg-[#0a0a0a] border border-white/5">
              <div className="text-[10px] text-tertiary uppercase tracking-[0.15em] font-bold mb-3 flex items-center gap-2">
                <Clock size={14} className="text-disabled" /> Execution Time
              </div>
              <div className="text-xl font-mono text-secondary tracking-tight">
                {formatTimestamp(action.timestamp_start)}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-[10px] text-tertiary uppercase tracking-[0.15em] font-bold flex items-center gap-2">
              <Info size={14} className="text-disabled" /> Decision Rationale
            </div>
            <div className="p-6 rounded-2xl bg-[#0a0a0a] border border-white/5 text-[15px] text-secondary leading-relaxed italic font-medium">
              &quot;{action.reasoning || "Autonomous decision based on current swarm goals and policy constraints."}&quot;
            </div>
          </div>

          {(() => {
            const meta = typeof action.metadata === 'string'
              ? (() => { try { return JSON.parse(action.metadata); } catch { return null; } })()
              : action.metadata;
            if (!meta || (typeof meta === 'object' && Object.keys(meta).length === 0)) return null;
            return (
              <div className="space-y-3">
                <div className="text-[10px] text-tertiary uppercase tracking-[0.15em] font-bold flex items-center gap-2">
                  <Terminal size={14} className="text-disabled" /> Contextual Metadata
                </div>
                <pre className="p-5 rounded-2xl bg-black/60 border border-white/5 text-[11px] font-mono text-brand/80 overflow-x-auto leading-relaxed">
                  {JSON.stringify(meta, null, 2)}
                </pre>
              </div>
            );
          })()}
        </div>

        <div className="mt-8 pt-6 border-t border-white/10">
          <button 
            onClick={() => router.push(`/decisions/${action.action_id}`)} 
            className="w-full py-4 bg-brand rounded-xl text-sm font-bold text-white hover:bg-brand-hover shadow-lg shadow-brand/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
          >
            View Decision Record <FileText size={18} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <PageLayout
      title="Swarm Intelligence"
      subtitle="Neural fleet topology: Real-time agent synchronization & organic drift"
      breadcrumbs={['Operations', 'Swarm']}
      actions={<button onClick={fetchGraph} className="p-2 text-secondary hover:text-white transition-colors"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>}
    >
      <div className="space-y-6">
        {/* ROW 1: SWARM BOX + TELEMETRY SIDEBAR (FULL VIEWPORT HEIGHT) */}
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)] min-h-[600px]">
          
          {/* Swarm Box */}
          <Card className="relative overflow-hidden group border-brand/10 bg-[#050505] shadow-2xl flex-1 flex flex-col min-h-0">
            <CardHeader className="flex flex-row items-center justify-between border-b border-white/5 py-3 z-10 relative bg-[#050505]/80 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
                <span className="text-sm font-semibold tracking-tight">Active Neural Web</span>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="font-mono text-[10px] border-white/10">{graphData.nodes.length} AGENTS</Badge>
                <Badge variant="outline" className="font-mono text-[10px] text-brand border-brand/20 bg-brand/5">SYNCED</Badge>
              </div>
            </CardHeader>
            
            <CardContent className="p-0 flex-1 relative overflow-hidden bg-[#050505]">
              <div 
                ref={containerRef}
                className="w-full h-full relative cursor-grab active:cursor-grabbing"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <canvas ref={canvasRef} width={800} height={600} className="w-full h-full select-none" />
                {!isFocused && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none transition-all duration-700 z-20">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-16 h-16 rounded-full border border-brand/30 flex items-center justify-center animate-pulse"><MousePointer2 className="text-brand" size={24} /></div>
                      <div className="px-6 py-2.5 rounded-full bg-brand text-white text-[10px] font-bold uppercase tracking-[0.2em] shadow-2xl border border-white/20">Engage Swarm</div>
                    </div>
                  </div>
                )}
                <div className="absolute top-4 right-4 flex flex-col gap-2 z-20">
                  <button onClick={() => { setZoom(z => Math.min(10, z * 1.5)); }} title="Zoom In" className="w-8 h-8 rounded-lg bg-black/80 border border-white/10 text-white flex items-center justify-center hover:bg-brand/40 transition-colors">+</button>
                  <button onClick={() => { setZoom(z => Math.max(0.1, z * 0.7)); }} title="Zoom Out" className="w-8 h-8 rounded-lg bg-black/80 border border-white/10 text-white flex items-center justify-center hover:bg-brand/40 transition-colors">-</button>
                  <button onClick={() => { setZoom(0.8); setPan({ x: 0, y: 0 }); }} title="Reset View" className="w-8 h-8 rounded-lg bg-black/80 border border-white/10 text-white flex items-center justify-center hover:bg-brand/40 transition-colors"><RefreshCw size={14} /></button>
                  <button onClick={expand} title="Distribute/Expand Swarm" className="w-8 h-8 rounded-lg bg-black/80 border border-brand/30 text-brand flex items-center justify-center hover:bg-brand/40 transition-all shadow-lg shadow-brand/20 active:scale-90"><Maximize2 size={14} /></button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Telemetry Sidebar */}
          <div className="w-full lg:w-[400px] h-full shrink-0 relative overflow-hidden">
            <Card className="h-full border-brand/5 bg-surface-secondary/20 shadow-xl backdrop-blur-lg flex flex-col overflow-hidden">
              <CardHeader className="border-b border-white/5 py-4">
                <div className="flex items-center gap-2"><Activity size={16} className="text-brand" /><span className="text-xs font-bold uppercase tracking-widest text-secondary">Agent Telemetry</span></div>
              </CardHeader>
              <CardContent className="pt-6 flex-1 overflow-hidden relative flex flex-col min-h-0">
                {inspectedAction && <ActionDetailOverlay action={inspectedAction} onClose={() => setInspectedAction(null)} />}
                
                {selectedLink ? (
                  <LinkInspectorPanel 
                    link={selectedLink} 
                    context={linkContext} 
                    onClose={() => setSelectedLink(null)} 
                  />
                ) : selectedAgent ? (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 flex-1 flex flex-col min-h-0">
                    <div className="relative group shrink-0 px-1">
                      <div className="absolute -inset-2 bg-brand/5 rounded-xl blur-xl group-hover:bg-brand/10 transition-all" />
                      <div className="relative">
                        <h3 className="text-lg font-bold text-white mb-0.5">{selectedAgent.name}</h3>
                        <code className="text-[10px] text-tertiary font-mono">{selectedAgent.id.substring(0, 12)}...</code>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline" className={`text-[9px] border-none ${(selectedAgent.risk || 0) > 40 ? 'bg-status-warning/10 text-warning' : 'bg-status-success/10 text-success'}`}>RISK: {(selectedAgent.risk || 0).toFixed(0)}%</Badge>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 shrink-0 px-1">
                      <h4 className="text-[10px] font-bold text-tertiary uppercase tracking-widest flex items-center gap-2"><Zap size={10} className="text-brand" /> Live Performance</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 rounded-lg bg-black/40 border border-white/5"><div className="text-[9px] text-tertiary mb-1">Actions</div><div className="text-lg font-mono text-white">{selectedAgent.actions || 0}</div></div>
                        <div className="p-3 rounded-lg bg-black/40 border border-white/5"><div className="text-[9px] text-tertiary mb-1">Cost</div><div className="text-lg font-mono text-white">${(selectedAgent.cost || 0).toFixed(2)}</div></div>
                      </div>
                    </div>

                    <div className="space-y-3 flex-1 overflow-hidden flex flex-col min-h-0 px-1">
                      <h4 className="text-[10px] font-bold text-tertiary uppercase tracking-widest flex items-center gap-2"><History size={10} className="text-secondary" /> Latest Decisions</h4>
                      <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1 min-h-0">
                        {agentContext.loading ? (
                          <div className="py-8 text-center text-[11px] text-disabled animate-pulse">Syncing neural state...</div>
                        ) : agentContext.actions.length > 0 ? (
                          agentContext.actions.map((action, i) => (
                            <div 
                              key={i} 
                              onClick={() => setInspectedAction(action)}
                              className="p-3.5 rounded-xl bg-white/5 border border-white/5 flex flex-col gap-2 hover:bg-white/10 hover:border-brand/20 transition-all cursor-pointer group/action"
                            >
                              <div className="flex justify-between items-start">
                                <span className="text-[12px] font-bold text-white group-hover:text-brand transition-colors truncate max-w-[140px]">{action.action_type}</span>
                                <Badge variant="outline" className={`text-[9px] py-0 px-1.5 border-none font-bold ${
                                  action.status === 'completed' ? 'text-success bg-green-400/10' : 
                                  action.status === 'failed' ? 'text-error bg-red-400/10' : 'text-warning bg-yellow-400/10'
                                }`}>
                                  {action.status?.toUpperCase()}
                                </Badge>
                              </div>
                              <div className="flex justify-between items-center text-[10px] text-tertiary font-mono">
                                <div className="flex items-center gap-1.5"><Target size={10} /> {action.risk_score || 0}% RISK</div>
                                <div className="flex items-center gap-1.5">{formatTimestamp(action.timestamp_start)} <ChevronRight size={10} className="group-hover:translate-x-0.5 transition-transform" /></div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="py-8 text-center text-[11px] text-disabled italic">No recent neural activity detected.</div>
                        )}
                      </div>
                    </div>

                    <div className="pt-6 border-t border-white/5 shrink-0 px-1">
                      <button onClick={() => router.push(`/decisions?agent_id=${selectedAgent.id}`)} className="w-full flex items-center justify-center gap-2 py-3 bg-brand rounded-xl text-[11px] font-bold text-white hover:bg-brand-hover shadow-lg shadow-brand/20 transition-all active:scale-95 group">View Agent Decisions <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" /></button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-24 flex flex-col items-center gap-6">
                    <div className="relative"><div className="absolute inset-0 bg-brand/5 blur-2xl rounded-full" /><div className="relative w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center border border-white/5 group-hover:border-brand/20 transition-all"><Search className="text-zinc-700" size={24} /></div></div>
                    <div className="space-y-2"><p className="text-[11px] font-bold text-secondary uppercase tracking-widest">No Agent Selected</p><p className="text-[10px] text-disabled leading-relaxed max-w-[200px] mx-auto">Click any node in the neural web to capture its real-time telemetry and decision stream.</p></div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ROW 2: STATS ROW */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-12">
          <div className="p-4 rounded-xl bg-surface-secondary/30 border border-white/5 backdrop-blur-sm flex items-center justify-center"><StatCompact label="Neural Links" value={graphData.links.length} color="text-white" /></div>
          <div className="p-4 rounded-xl bg-surface-secondary/30 border border-white/5 backdrop-blur-sm flex items-center justify-center"><StatCompact label="Total Actions" value={graphData.nodes.reduce((s, n) => s + (Number(n.actions) || 0), 0)} color="text-brand" /></div>
          <div className="p-4 rounded-xl bg-surface-secondary/30 border border-white/5 backdrop-blur-sm flex items-center justify-center"><StatCompact label="Total Cost" value={`$${graphData.nodes.reduce((s, n) => s + (Number(n.cost) || 0), 0).toFixed(2)}`} color="text-info" /></div>
        </div>
      </div>
    </PageLayout>
  );
}

