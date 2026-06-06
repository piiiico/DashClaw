export const demoAgents = [
  { agent_id: 'agent_deployment_bot_01', agent_name: 'Deployment Bot' },
  { agent_id: 'api_monitor_02', agent_name: 'API Monitor' },
  { agent_id: 'customer_support_03', agent_name: 'Support Agent' },
];

export const demoIntegrationsConnections = [
  { id: 'conn_01', provider: 'openai', agent_id: 'agent_deployment_bot_01', auth_type: 'api_key', plan_name: 'Tier 5', status: 'active' },
  { id: 'conn_02', provider: 'anthropic', agent_id: 'api_monitor_02', auth_type: 'api_key', plan_name: 'Enterprise', status: 'active' },
  { id: 'conn_03', provider: 'github', agent_id: 'agent_deployment_bot_01', auth_type: 'oauth', status: 'active' },
  { id: 'conn_04', provider: 'slack', agent_id: 'customer_support_03', auth_type: 'bot_token', status: 'active' },
  { id: 'conn_05', provider: 'supabase', agent_id: 'agent_deployment_bot_01', auth_type: 'service_key', status: 'active' },
];

export const demoIntegrationsSettings = [
  { key: 'OPENAI_API_KEY', value: 'sk-svc-****************************************', hasValue: true, is_inherited: false },
  { key: 'OPENAI_ORG_ID', value: 'org-demo-123', hasValue: true, is_inherited: false },
  { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-****************************************', hasValue: true, is_inherited: false },
  { key: 'GITHUB_TOKEN', value: 'ghp_****************************************', hasValue: true, is_inherited: false },
  { key: 'SLACK_BOT_TOKEN', value: 'xoxb-****************************************', hasValue: true, is_inherited: false },
  { key: 'SUPABASE_URL', value: 'https://demo.supabase.co', hasValue: true, is_inherited: false },
  { key: 'SUPABASE_ANON_KEY', value: '****************************************', hasValue: true, is_inherited: false },
];
