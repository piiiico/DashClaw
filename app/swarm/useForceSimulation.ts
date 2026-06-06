'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as d3 from 'd3-force';

interface UseForceSimulationArgs {
  nodes: any[];
  links: any[];
  width?: number;
  height?: number;
}

/**
 * NEURAL FORCE SIMULATION (v7 - Locked & Stable)
 *
 * - Stable selection: Clicking no longer triggers repulsion kicks.
 * - Bound constraints: Agents are physically incapable of leaving the viewport.
 * - Focused physics: Lower energy, higher stability.
 */
export function useForceSimulation({ nodes: initialNodes, links: initialLinks, width = 800, height = 600 }: UseForceSimulationArgs) {
  const simulation = useRef<any>(null);
  const nodesRef = useRef<any[]>([]);
  const linksRef = useRef<any[]>([]);
  const nodesMapRef = useRef<Map<any, any>>(new Map());

  useEffect(() => {
    if (!initialNodes.length) return;

    const nodeMap = new Map(nodesRef.current.map(n => [n.id, n]));

    const nodes = initialNodes.map(node => {
      const prev = nodeMap.get(node.id);
      return {
        ...node,
        x: prev ? prev.x : width / 2 + (Math.random() - 0.5) * 50,
        y: prev ? prev.y : height / 2 + (Math.random() - 0.5) * 50,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0,
      };
    });

    const links = initialLinks.map(link => ({
      ...link,
      source: typeof link.source === 'object' ? link.source.id : link.source,
      target: typeof link.target === 'object' ? link.target.id : link.target,
    })).filter(l => nodes.find(n => n.id === l.source) && nodes.find(n => n.id === l.target));

    nodesRef.current = nodes;
    linksRef.current = links;

    // Update fast lookup map
    const newMap = new Map();
    nodes.forEach(n => newMap.set(n.id, n));
    nodesMapRef.current = newMap;

    if (!simulation.current) {
      simulation.current = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(80).strength(0.1))
        .force('charge', d3.forceManyBody().strength(0))
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
        .force('collision', d3.forceCollide().radius(20).strength(0.5))
        .on('tick', () => {
          const margin = 40;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n.x < margin) n.x = margin;
            if (n.x > width - margin) n.x = width - margin;
            if (n.y < margin) n.y = margin;
            if (n.y > height - margin) n.y = height - margin;
          }
        });

      simulation.current.alphaDecay(0.1);
    } else {
      simulation.current.nodes(nodes);
      simulation.current.force('link').links(links);
      simulation.current.alpha(0.05).restart();
    }

    return () => {
      if (simulation.current) simulation.current.stop();
    };
  }, [initialNodes, initialLinks, width, height]);

  const wake = useCallback(() => {
    if (simulation.current) simulation.current.alpha(0.1).restart();
  }, []);

  const expand = useCallback(() => {
    if (simulation.current) {
      // 1. Boost forces to spread them out quickly
      simulation.current.force('link').distance(250);
      simulation.current.force('collision').radius(60);
      simulation.current.alpha(1).restart();

      // 2. Settle back into a more readable 'dispersed' state
      setTimeout(() => {
        if (simulation.current) {
          simulation.current.force('link').distance(140);
          simulation.current.force('collision').radius(30);
          simulation.current.alpha(0.3).restart();
        }
      }, 800);
    }
  }, []);

  const setNodeFixed = useCallback((id: any, x: any, y: any) => {
    const node = nodesMapRef.current.get(id);
    if (node) {
      if (x === null) {
        delete node.fx;
        delete node.fy;
        if (simulation.current) simulation.current.alpha(0.1).restart();
      } else {
        node.fx = x;
        node.fy = y;
        if (simulation.current && simulation.current.alpha() < 0.2) {
          simulation.current.alpha(0.2).restart();
        }
      }
    }
  }, []);

  return { nodesRef, linksRef, nodesMapRef, setNodeFixed, wake, expand };
}
