interface DemoWebhook {
  id: string;
  url: string;
  events: string;
  active: number;
  failure_count: number;
  last_triggered_at: string;
  created_at: string;
}

interface DemoWebhookDelivery {
  id: string;
  event_type: string;
  status: string;
  response_status: number;
  attempted_at: string;
  duration_ms: number;
}

export const demoWebhooks: DemoWebhook[] = [
  {
    id: 'wh_01',
    url: 'https://hooks.slack.com/services/T04.../B06.../abc123xyz',
    events: JSON.stringify(['all']),
    active: 1,
    failure_count: 0,
    last_triggered_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15m ago
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), // 30d ago
  },
  {
    id: 'wh_02',
    url: 'https://discord.com/api/webhooks/123456789/qwert-yuiop',
    events: JSON.stringify(['autonomy_spike', 'repeated_failures']),
    active: 1,
    failure_count: 2,
    last_triggered_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2h ago
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(), // 7d ago
  },
  {
    id: 'wh_03',
    url: 'https://events.pagerduty.com/v2/enqueue',
    events: JSON.stringify(['high_impact_low_oversight']),
    active: 1,
    failure_count: 0,
    last_triggered_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1d ago
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(), // 14d ago
  }
];

export const demoWebhookDeliveries: Record<string, DemoWebhookDelivery[]> = {
  wh_01: [
    { id: 'del_01', event_type: 'autonomy_spike', status: 'success', response_status: 200, attempted_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(), duration_ms: 145 },
    { id: 'del_02', event_type: 'stale_loop', status: 'success', response_status: 200, attempted_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), duration_ms: 112 },
    { id: 'del_03', event_type: 'assumption_drift', status: 'success', response_status: 200, attempted_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), duration_ms: 168 },
  ],
  wh_02: [
    { id: 'del_04', event_type: 'repeated_failures', status: 'failed', response_status: 404, attempted_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), duration_ms: 85 },
    { id: 'del_05', event_type: 'repeated_failures', status: 'failed', response_status: 404, attempted_at: new Date(Date.now() - 1000 * 60 * 60 * 2.5).toISOString(), duration_ms: 92 },
    { id: 'del_06', event_type: 'autonomy_spike', status: 'success', response_status: 200, attempted_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), duration_ms: 134 },
  ],
  wh_03: [
    { id: 'del_07', event_type: 'high_impact_low_oversight', status: 'success', response_status: 202, attempted_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), duration_ms: 210 },
    { id: 'del_08', event_type: 'high_impact_low_oversight', status: 'success', response_status: 202, attempted_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), duration_ms: 195 },
  ]
};
