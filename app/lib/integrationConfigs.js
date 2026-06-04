import { Plug, Bot, Database, MessageSquare, FileText, Wrench, Globe, CreditCard } from 'lucide-react';

// Integration configurations with their settings fields
export const INTEGRATION_CONFIGS = {
  // === AI PROVIDERS ===
  openai: {
    name: 'OpenAI',
    category: 'AI',
    description: 'GPT models & embeddings',
    fields: [
      { key: 'OPENAI_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'OPENAI_ORG_ID', label: 'Organization ID', type: 'text', required: false }
    ]
  },
  anthropic: {
    name: 'Anthropic',
    category: 'AI',
    description: 'Claude models',
    fields: [
      { key: 'ANTHROPIC_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  },
  groq: {
    name: 'Groq',
    category: 'AI',
    description: 'Ultra-fast LLM inference',
    fields: [
      { key: 'GROQ_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  },
  together: {
    name: 'Together AI',
    category: 'AI',
    description: 'Open source model hosting',
    fields: [
      { key: 'TOGETHER_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  },
  replicate: {
    name: 'Replicate',
    category: 'AI',
    description: 'Run ML models in the cloud',
    fields: [
      { key: 'REPLICATE_API_TOKEN', label: 'API Token', type: 'password', required: true }
    ]
  },
  huggingface: {
    name: 'Hugging Face',
    category: 'AI',
    description: 'Models, datasets, spaces',
    fields: [
      { key: 'HUGGINGFACE_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  },
  perplexity: {
    name: 'Perplexity',
    category: 'AI',
    description: 'AI-powered search',
    fields: [
      { key: 'PERPLEXITY_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  },
  elevenlabs: {
    name: 'ElevenLabs',
    category: 'AI',
    description: 'Text-to-speech voice generation',
    fields: [
      { key: 'ELEVENLABS_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'ELEVENLABS_VOICE_ID', label: 'Default Voice ID', type: 'text', required: false }
    ]
  },

  // === DATABASES ===
  neon: {
    name: 'Neon',
    category: 'Database',
    description: 'Serverless PostgreSQL',
    fields: [
      { key: 'DATABASE_URL', label: 'Connection String', type: 'password', required: true, placeholder: 'postgresql://user:pass@host/db' }
    ]
  },
  supabase: {
    name: 'Supabase',
    category: 'Database',
    description: 'Postgres + Auth + Storage',
    fields: [
      { key: 'SUPABASE_URL', label: 'Project URL', type: 'text', required: true },
      { key: 'SUPABASE_ANON_KEY', label: 'Anon Key', type: 'password', required: true },
      { key: 'SUPABASE_SERVICE_KEY', label: 'Service Key', type: 'password', required: false }
    ]
  },
  planetscale: {
    name: 'PlanetScale',
    category: 'Database',
    description: 'Serverless MySQL',
    fields: [
      { key: 'PLANETSCALE_URL', label: 'Connection String', type: 'password', required: true }
    ]
  },
  mongodb: {
    name: 'MongoDB',
    category: 'Database',
    description: 'NoSQL document database',
    fields: [
      { key: 'MONGODB_URI', label: 'Connection URI', type: 'password', required: true }
    ]
  },
  redis: {
    name: 'Redis',
    category: 'Database',
    description: 'In-memory cache & data store',
    fields: [
      { key: 'REDIS_URL', label: 'Connection URL', type: 'password', required: true }
    ]
  },
  pinecone: {
    name: 'Pinecone',
    category: 'Database',
    description: 'Vector database for AI',
    fields: [
      { key: 'PINECONE_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'PINECONE_ENVIRONMENT', label: 'Environment', type: 'text', required: true }
    ]
  },

  // === COMMUNICATION ===
  telegram: {
    name: 'Telegram',
    category: 'Communication',
    description: 'Chat bot interface',
    fields: [
      { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', type: 'password', required: true },
      { key: 'TELEGRAM_ADMIN_CHAT_ID', label: 'Admin Chat ID', type: 'text', required: false },
      { key: 'DASHCLAW_ALERTS_TELEGRAM', label: 'Enable approval alerts', type: 'toggle', required: false }
    ]
  },
  discord: {
    name: 'Discord',
    category: 'Communication',
    description: 'Post governance alerts to a Discord channel',
    fields: [
      { key: 'DISCORD_WEBHOOK_URL', label: 'Webhook URL', type: 'password', required: true, placeholder: 'https://discord.com/api/webhooks/...' },
      { key: 'DASHCLAW_ALERTS_DISCORD', label: 'Enable governance alerts', type: 'toggle', required: false }
    ]
  },
  slack: {
    name: 'Slack',
    category: 'Communication',
    description: 'Workspace messaging',
    fields: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot Token', type: 'password', required: true },
      { key: 'SLACK_SIGNING_SECRET', label: 'Signing Secret', type: 'password', required: false },
      { key: 'SLACK_APP_TOKEN', label: 'App Token', type: 'password', required: false },
      { key: 'SLACK_WEBHOOK_URL', label: 'Webhook URL (for alerts)', type: 'password', required: false },
      { key: 'SLACK_CHANNEL_ID', label: 'Alert Channel ID', type: 'text', required: false },
      { key: 'DASHCLAW_ALERTS_SLACK', label: 'Enable governance alerts', type: 'toggle', required: false }
    ]
  },
  twilio: {
    name: 'Twilio',
    category: 'Communication',
    description: 'SMS & voice APIs',
    fields: [
      { key: 'TWILIO_ACCOUNT_SID', label: 'Account SID', type: 'text', required: true },
      { key: 'TWILIO_AUTH_TOKEN', label: 'Auth Token', type: 'password', required: true },
      { key: 'TWILIO_PHONE_NUMBER', label: 'Phone Number', type: 'text', required: false }
    ]
  },
  resend: {
    name: 'Resend',
    category: 'Communication',
    description: 'Developer-first email API',
    fields: [
      { key: 'RESEND_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'DASHCLAW_ALERT_EMAIL', label: 'Alert recipient email', type: 'email', required: false },
      { key: 'DASHCLAW_ALERTS_EMAIL', label: 'Enable governance alerts', type: 'toggle', required: false }
    ]
  },
  sendgrid: {
    name: 'SendGrid',
    category: 'Communication',
    description: 'Email delivery service',
    fields: [
      { key: 'SENDGRID_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'SENDGRID_DEFAULT_TO', label: 'Alert recipient email', type: 'email', required: false },
      { key: 'SENDGRID_FROM_EMAIL', label: 'Sender email', type: 'email', required: false },
      { key: 'DASHCLAW_ALERTS_EMAIL', label: 'Enable governance alerts', type: 'toggle', required: false }
    ]
  },

  // === PRODUCTIVITY ===
  google: {
    name: 'Google Workspace',
    category: 'Productivity',
    description: 'Calendar, Gmail, Drive',
    fields: [
      { key: 'GOOGLE_ACCOUNT', label: 'Account Email', type: 'email', required: true },
      { key: 'GOOGLE_CREDENTIALS_PATH', label: 'Credentials Path', type: 'text', required: false }
    ]
  },
  notion: {
    name: 'Notion',
    category: 'Productivity',
    description: 'Workspace & documentation',
    fields: [
      { key: 'NOTION_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'NOTION_PARENT_PAGE_ID', label: 'Parent Page ID', type: 'text', required: false }
    ]
  },
  linear: {
    name: 'Linear',
    category: 'Productivity',
    description: 'Issue tracking for teams',
    fields: [
      { key: 'LINEAR_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'DASHCLAW_ALERTS_LINEAR', label: 'Enable governance alerts (creates issues)', type: 'toggle', required: false }
    ]
  },
  airtable: {
    name: 'Airtable',
    category: 'Productivity',
    description: 'Spreadsheet-database hybrid',
    fields: [
      { key: 'AIRTABLE_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'AIRTABLE_BASE_ID', label: 'Base ID', type: 'text', required: false }
    ]
  },
  calendly: {
    name: 'Calendly',
    category: 'Productivity',
    description: 'Scheduling automation',
    fields: [
      { key: 'CALENDLY_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  },

  // === DEV & HOSTING ===
  github: {
    name: 'GitHub',
    category: 'Development',
    description: 'Code repos & version control',
    fields: [
      { key: 'GITHUB_TOKEN', label: 'Personal Access Token', type: 'password', required: true },
      { key: 'GITHUB_USERNAME', label: 'Username', type: 'text', required: false },
      { key: 'GITHUB_REPO', label: 'Alert Repo (owner/repo)', type: 'text', required: false },
      { key: 'DASHCLAW_ALERTS_GITHUB', label: 'Enable governance alerts (creates issues)', type: 'toggle', required: false }
    ]
  },
  vercel: {
    name: 'Vercel',
    category: 'Development',
    description: 'Frontend deployment',
    fields: [
      { key: 'VERCEL_TOKEN', label: 'API Token', type: 'password', required: true },
      { key: 'VERCEL_PROJECT_ID', label: 'Project ID', type: 'text', required: false }
    ]
  },
  railway: {
    name: 'Railway',
    category: 'Development',
    description: 'Full-stack deployment',
    fields: [
      { key: 'RAILWAY_TOKEN', label: 'API Token', type: 'password', required: true }
    ]
  },
  cloudflare: {
    name: 'Cloudflare',
    category: 'Development',
    description: 'CDN, DNS, Workers',
    fields: [
      { key: 'CLOUDFLARE_API_TOKEN', label: 'API Token', type: 'password', required: true },
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID', type: 'text', required: false }
    ]
  },
  sentry: {
    name: 'Sentry',
    category: 'Development',
    description: 'Error detection & reporting',
    fields: [
      { key: 'SENTRY_DSN', label: 'DSN', type: 'password', required: true },
      { key: 'SENTRY_AUTH_TOKEN', label: 'Auth Token', type: 'password', required: false }
    ]
  },

  // === SOCIAL & SEARCH ===
  twitter: {
    name: 'Twitter/X',
    category: 'Social',
    description: 'Social media integration',
    fields: [
      { key: 'TWITTER_API_KEY', label: 'API Key', type: 'password', required: true },
      { key: 'TWITTER_API_SECRET', label: 'API Secret', type: 'password', required: true },
      { key: 'TWITTER_ACCESS_TOKEN', label: 'Access Token', type: 'password', required: false },
      { key: 'TWITTER_ACCESS_SECRET', label: 'Access Secret', type: 'password', required: false }
    ]
  },
  brave: {
    name: 'Brave Search',
    category: 'Social',
    description: 'Web search API',
    fields: [
      { key: 'BRAVE_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  },
  moltbook: {
    name: 'Moltbook',
    category: 'Social',
    description: 'AI social platform',
    fields: [
      { key: 'MOLTBOOK_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  },

  // === PAYMENTS ===
  stripe: {
    name: 'Stripe',
    category: 'Payments',
    description: 'Payment processing',
    fields: [
      { key: 'STRIPE_SECRET_KEY', label: 'Secret Key', type: 'password', required: true },
      { key: 'STRIPE_PUBLISHABLE_KEY', label: 'Publishable Key', type: 'text', required: false },
      { key: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook Secret', type: 'password', required: false }
    ]
  },
  lemonsqueezy: {
    name: 'Lemon Squeezy',
    category: 'Payments',
    description: 'Merchant of record',
    fields: [
      { key: 'LEMONSQUEEZY_API_KEY', label: 'API Key', type: 'password', required: true }
    ]
  }
};

export const CATEGORY_ICONS = {
  all: Plug,
  AI: Bot,
  Database: Database,
  Communication: MessageSquare,
  Productivity: FileText,
  Development: Wrench,
  Social: Globe,
  Payments: CreditCard
};

export const CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'AI', name: 'AI Providers' },
  { id: 'Database', name: 'Databases' },
  { id: 'Communication', name: 'Communication' },
  { id: 'Productivity', name: 'Productivity' },
  { id: 'Development', name: 'Dev & Hosting' },
  { id: 'Social', name: 'Social & Search' },
  { id: 'Payments', name: 'Payments' }
];
