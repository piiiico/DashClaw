'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Brain,
  Shield,
  FileCheck2,
  Package,
  RefreshCw,
  ArrowRight,
  X,
  Gauge,
  Bot,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import {
  HIGHLIGHTS_VERSION,
  dismissHighlights,
  isHighlightsDismissed,
} from '../lib/capabilityHighlightsState';

const HIGHLIGHTS = [
  {
    icon: Brain,
    title: 'Adaptive Learning Loop',
    detail: 'Action scoring, recommendation synthesis, recommendation telemetry events, and recommendation ops controls.',
    href: '/learning',
  },
  {
    icon: Gauge,
    title: 'Recommendation Metrics',
    detail: 'Per-recommendation adoption, success lift, failure reduction, latency delta, and cost delta metrics.',
    href: '/learning',
  },
  {
    icon: Bot,
    title: 'Safe SDK Auto-Adapt',
    detail: 'Node and Python SDK modes: off, warn, enforce with confidence thresholds and override tracking.',
    href: '/docs',
  },
  {
    icon: Shield,
    title: 'Route SQL Guardrails',
    detail: 'Critical-path SQL drift checks and repository contract tests are enforced for safer data-layer changes.',
    href: '/docs',
  },
  {
    icon: FileCheck2,
    title: 'API Contract Governance',
    detail: 'OpenAPI drift detection and API inventory checks prevent silent contract regressions.',
    href: '/docs',
  },
  {
    icon: Package,
    title: 'Cross-SDK Contract Harness',
    detail: 'Node and Python parity is validated through shared critical-contract integration fixtures.',
    href: '/docs',
  },
  {
    icon: RefreshCw,
    title: 'Learning Automation',
    detail: 'Backfill and recommendation rebuild cron endpoints keep adaptive models fresh over time.',
    href: '/learning',
  },
];

export default function CapabilityHighlightsCard() {
  const [dismissed, setDismissed] = useState(() => isHighlightsDismissed());

  const handleDismiss = () => {
    setDismissed(true);
    dismissHighlights();
  };

  if (dismissed) return null;

  return (
    <Card hover={false}>
      <CardHeader
        title="Shipped Platform Capabilities"
        icon={FileCheck2}
        action={(
          <button
            onClick={handleDismiss}
            className="p-1 rounded text-tertiary hover:text-secondary hover:bg-white/5 transition-colors"
            title="Dismiss"
            aria-label="Dismiss shipped platform capabilities"
          >
            <X size={14} />
          </button>
        )}
      />
      <CardContent>
        <p className="text-xs text-tertiary mb-3">
          Major release highlights ({HIGHLIGHTS_VERSION})
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          {HIGHLIGHTS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.title}
                href={item.href}
                className="rounded-lg border border-border-hover bg-surface-tertiary p-3 hover:border-white/[0.16] transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className="text-brand" />
                  <span className="text-xs font-semibold text-secondary">{item.title}</span>
                </div>
                <p className="text-xs text-secondary leading-relaxed">{item.detail}</p>
                <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-brand">
                  View
                  <ArrowRight size={11} />
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
