export interface DemoAuditLog {
  id: string;
  action: string;
  actor_id: string;
  actor_name?: string;
  actor_image?: string;
  actor_type: string;
  resource_type: string;
  resource_id: string;
  details: string;
  created_at: string;
}

export const demoAuditLogs: DemoAuditLog[] = [
  {
    id: 'log_01',
    action: 'signal.detected',
    actor_id: 'system',
    actor_type: 'system',
    resource_type: 'agent',
    resource_id: 'agent_deployment_bot_01',
    details: JSON.stringify({ signal: 'Autonomy Spike', score: 92, threshold: 80 }),
    created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5m ago
  },
  {
    id: 'log_02',
    action: 'alert.email_sent',
    actor_id: 'system',
    actor_type: 'system',
    resource_type: 'alert',
    resource_id: 'alt_928374',
    details: JSON.stringify({ recipient: 'security-ops@company.com', trigger: 'Autonomy Spike' }),
    created_at: new Date(Date.now() - 1000 * 60 * 6).toISOString(), // 6m ago
  },
  {
    id: 'log_03',
    action: 'key.created',
    actor_id: 'user_01',
    actor_name: 'Alex Rivier',
    actor_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
    actor_type: 'user',
    resource_type: 'api_key',
    resource_id: 'dc_key_live_********************',
    details: JSON.stringify({ name: 'Production CI/CD', permissions: 'read_write' }),
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2h ago
  },
  {
    id: 'log_04',
    action: 'setting.updated',
    actor_id: 'user_02',
    actor_name: 'Jordan Smith',
    actor_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jordan',
    actor_type: 'user',
    resource_type: 'workspace_settings',
    resource_id: 'ws_default',
    details: JSON.stringify({ setting: 'enforce_agent_signatures', old_value: false, new_value: true }),
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), // 4h ago
  },
  {
    id: 'log_05',
    action: 'invite.created',
    actor_id: 'user_01',
    actor_name: 'Alex Rivier',
    actor_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
    actor_type: 'user',
    resource_type: 'invite',
    resource_id: 'inv_882734',
    details: JSON.stringify({ email: 'security-lead@company.com', role: 'admin' }),
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1d ago
  },
  {
    id: 'log_06',
    action: 'webhook.created',
    actor_id: 'user_02',
    actor_name: 'Jordan Smith',
    actor_image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jordan',
    actor_type: 'user',
    resource_type: 'webhook',
    resource_id: 'wh_928374',
    details: JSON.stringify({ url: 'https://hooks.slack.com/services/...', events: ['signal.*', 'approval.*'] }),
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), // 2d ago
  },
  {
    id: 'log_07',
    action: 'role.changed',
    actor_id: 'system',
    actor_type: 'system',
    resource_type: 'member',
    resource_id: 'mem_092834',
    details: JSON.stringify({ member: 'Casey Doe', old_role: 'viewer', new_role: 'editor', reason: 'Automatic promotion via policy' }),
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3d ago
  },
  {
    id: 'log_08',
    action: 'usage.limit_reached',
    actor_id: 'system',
    actor_type: 'system',
    resource_type: 'quota',
    resource_id: 'quota_actions_monthly',
    details: JSON.stringify({ limit: 10000, current: 10005, period: 'March 2026' }),
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(), // 4d ago
  },
];

export const demoAuditStats = {
  total: 8,
  today: 2,
  unique_actors: 3,
};
