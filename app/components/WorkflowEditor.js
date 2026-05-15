'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ─────────────────────────────────────────────────────────────────────────────
// Custom node types
// ─────────────────────────────────────────────────────────────────────────────

const NODE_COLORS = {
  action: { bg: 'rgba(14,165,233,0.15)', border: 'rgba(14,165,233,0.6)', label: 'Action' },
  guard: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.6)', label: 'Guard' },
  approval: { bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.6)', label: 'Approval' },
  condition: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.6)', label: 'Condition' },
  default: { bg: 'rgba(113,113,122,0.15)', border: 'rgba(113,113,122,0.6)', label: 'Step' },
};

function StepNode({ data, id }) {
  const colors = NODE_COLORS[data.stepType] || NODE_COLORS.default;
  return (
    <div
      style={{
        background: colors.bg,
        border: `1.5px solid ${colors.border}`,
        borderRadius: 8,
        padding: '10px 16px',
        minWidth: 180,
        maxWidth: 260,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: colors.border }} />
      <div style={{ fontSize: 10, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {colors.label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', wordBreak: 'break-word' }}>
        {data.label || id}
      </div>
      {data.description && (
        <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 4, lineHeight: 1.3 }}>
          {data.description}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: colors.border }} />
    </div>
  );
}

const nodeTypes = { step: StepNode };

// ─────────────────────────────────────────────────────────────────────────────
// Convert between steps_json formats and React Flow state
// ─────────────────────────────────────────────────────────────────────────────

const STEP_TYPES = ['action', 'guard', 'approval', 'condition'];

/**
 * Normalize any steps_json value into React Flow nodes + edges.
 *
 * Supports:
 *   - New format: { nodes: [...], edges: [...] }
 *   - Legacy array: [{id, label, ...}, ...] → auto-sequential layout
 *   - Empty/null: starter node
 */
function stepsToFlow(steps) {
  if (!steps) {
    return {
      nodes: [
        {
          id: 'step_1',
          type: 'step',
          position: { x: 100, y: 150 },
          data: { label: 'First step', stepType: 'action', description: '' },
        },
      ],
      edges: [],
    };
  }

  // New format
  if (steps.nodes && Array.isArray(steps.nodes)) {
    return {
      nodes: steps.nodes.map((n) => ({
        id: n.id,
        type: 'step',
        position: n.position || { x: 0, y: 0 },
        data: {
          label: n.label || n.id,
          stepType: n.stepType || n.type || 'action',
          description: n.description || '',
          ...n.data,
        },
      })),
      edges: (steps.edges || []).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(255,255,255,0.3)' },
        style: { stroke: 'rgba(255,255,255,0.2)' },
      })),
    };
  }

  // Legacy array format → sequential auto-layout
  if (Array.isArray(steps)) {
    const nodes = steps.map((s, i) => ({
      id: s.id || `step_${i + 1}`,
      type: 'step',
      position: { x: 100 + i * 280, y: 150 },
      data: {
        label: s.label || s.name || s.id || `Step ${i + 1}`,
        stepType: s.stepType || s.type || 'action',
        description: s.description || '',
      },
    }));
    const edges = nodes.slice(1).map((n, i) => ({
      id: `edge_${i}`,
      source: nodes[i].id,
      target: n.id,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(255,255,255,0.3)' },
      style: { stroke: 'rgba(255,255,255,0.2)' },
    }));
    return { nodes, edges };
  }

  return stepsToFlow(null);
}

/**
 * Convert React Flow state back to the persistent steps_json format.
 */
function flowToSteps(nodes, edges) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data?.stepType || 'action',
      label: n.data?.label || n.id,
      description: n.data?.description || '',
      position: n.position,
      data: n.data || {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Visual workflow step editor built on React Flow.
 *
 * @param {object} props
 * @param {any} props.steps - Current steps_json value (array or {nodes, edges})
 * @param {function} props.onChange - Called with new steps value when graph changes
 * @param {boolean} [props.readOnly=false]
 */
export default function WorkflowEditor({ steps, onChange, readOnly = false }) {
  // Per-instance node-id counter. Previously a module-level `let nextNodeId`
  // was shared across every mounted editor + StrictMode double-invocations,
  // producing non-deterministic IDs that could collide and corrupt the
  // saved steps_json. useRef scopes the counter to this component instance.
  const nextNodeIdRef = useRef(100);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally compute once on mount
  const initial = useMemo(() => stepsToFlow(steps), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedNode, setSelectedNode] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editType, setEditType] = useState('action');
  const [editDesc, setEditDesc] = useState('');

  const onConnect = useCallback(
    (connection) => {
      if (readOnly) return;
      setEdges((eds) => addEdge({
        ...connection,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(255,255,255,0.3)' },
        style: { stroke: 'rgba(255,255,255,0.2)' },
      }, eds));
    },
    [readOnly, setEdges]
  );

  // Emit changes on any graph mutation
  const emitChange = useCallback(
    (ns, es) => {
      if (onChange) onChange(flowToSteps(ns, es));
    },
    [onChange]
  );

  const handleNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      // Read both nodes AND edges via functional setters so we emit against
      // the latest committed state of each dimension. Previously `edges`
      // was captured in this callback's closure and went stale whenever
      // the user interleaved a drag with an edge change — the saved
      // steps_json then diverged from the canvas.
      queueMicrotask(() => {
        setNodes((currentNodes) => {
          setEdges((currentEdges) => {
            emitChange(currentNodes, currentEdges);
            return currentEdges;
          });
          return currentNodes;
        });
      });
    },
    [onNodesChange, setNodes, setEdges, emitChange]
  );

  const handleEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);
      queueMicrotask(() => {
        setEdges((currentEdges) => {
          setNodes((currentNodes) => {
            emitChange(currentNodes, currentEdges);
            return currentNodes;
          });
          return currentEdges;
        });
      });
    },
    [onEdgesChange, setEdges, setNodes, emitChange]
  );

  const addNode = useCallback(() => {
    nextNodeIdRef.current += 1;
    const id = `step_${nextNodeIdRef.current}`;
    const newNode = {
      id,
      type: 'step',
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: { label: 'New step', stepType: 'action', description: '' },
    };
    // Read current edges via the functional updater to avoid emitting with a
    // stale snapshot — `edges` captured in the closure can lag any edge
    // edit that happened since this callback was last memoized.
    setEdges((currentEdges) => {
      setNodes((ns) => {
        const updated = [...ns, newNode];
        emitChange(updated, currentEdges);
        return updated;
      });
      return currentEdges;
    });
  }, [setNodes, setEdges, emitChange]);

  const onNodeClick = useCallback((_event, node) => {
    setSelectedNode(node);
    setEditLabel(node.data?.label || '');
    setEditType(node.data?.stepType || 'action');
    setEditDesc(node.data?.description || '');
  }, []);

  const saveNodeEdit = useCallback(() => {
    if (!selectedNode) return;
    // Same stale-edges rationale as addNode — read current edges via setEdges
    // identity callback so emitChange always sees the latest snapshot.
    setEdges((currentEdges) => {
      setNodes((ns) => {
        const updated = ns.map((n) =>
          n.id === selectedNode.id
            ? { ...n, data: { ...n.data, label: editLabel, stepType: editType, description: editDesc } }
            : n
        );
        emitChange(updated, currentEdges);
        return updated;
      });
      return currentEdges;
    });
    setSelectedNode(null);
  }, [selectedNode, editLabel, editType, editDesc, setNodes, setEdges, emitChange]);

  const deleteSelected = useCallback(() => {
    if (!selectedNode) return;
    setNodes((ns) => {
      const updated = ns.filter((n) => n.id !== selectedNode.id);
      setEdges((es) => {
        const updatedEdges = es.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id);
        emitChange(updated, updatedEdges);
        return updatedEdges;
      });
      return updated;
    });
    setSelectedNode(null);
  }, [selectedNode, setNodes, setEdges, emitChange]);

  return (
    <div className="rounded-lg border border-white/10 overflow-hidden" style={{ height: 500 }}>
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-black/40">
          <button
            onClick={addNode}
            className="px-3 py-1 text-xs text-white bg-brand hover:bg-brand/90 rounded transition-colors"
          >
            + Add Step
          </button>
          {selectedNode && (
            <>
              <span className="text-[10px] text-tertiary ml-2">
                Selected: <span className="text-secondary">{selectedNode.data?.label}</span>
              </span>
              <button
                onClick={deleteSelected}
                className="px-2 py-1 text-xs text-error hover:text-error bg-error-subtle hover:bg-error-subtle rounded transition-colors"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={readOnly ? undefined : handleNodesChange}
        onEdgesChange={readOnly ? undefined : handleEdgesChange}
        onConnect={readOnly ? undefined : onConnect}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        style={{ background: '#0a0a0a' }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
      >
        <Background color="rgba(255,255,255,0.03)" gap={24} />
        <Controls
          showInteractive={false}
          style={{ background: 'rgba(0,0,0,0.6)', borderColor: 'rgba(255,255,255,0.1)' }}
        />
        <MiniMap
          nodeColor={() => 'rgba(249,115,22,0.5)'}
          maskColor="rgba(0,0,0,0.7)"
          style={{ background: '#111' }}
        />
      </ReactFlow>

      {/* Node edit panel */}
      {!readOnly && selectedNode && (
        <div className="absolute bottom-4 right-4 w-72 bg-[#111] border border-white/10 rounded-lg p-4 z-10 shadow-2xl">
          <div className="text-xs text-tertiary uppercase tracking-wider mb-3">Edit Step</div>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-secondary uppercase mb-1">Label</label>
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="w-full px-2 py-1.5 bg-black/40 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="block text-[10px] text-secondary uppercase mb-1">Type</label>
              <select
                value={editType}
                onChange={(e) => setEditType(e.target.value)}
                className="w-full px-2 py-1.5 bg-black/40 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-brand"
              >
                {STEP_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-secondary uppercase mb-1">Description</label>
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
                className="w-full px-2 py-1.5 bg-black/40 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-brand"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveNodeEdit}
                className="flex-1 px-2 py-1.5 text-xs text-white bg-brand hover:bg-brand/90 rounded transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setSelectedNode(null)}
                className="px-2 py-1.5 text-xs text-secondary hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
