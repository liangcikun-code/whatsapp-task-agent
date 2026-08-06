import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env') });

export const config = {
  // Dify
  dify: {
    apiKey: process.env.DIFY_API_KEY || '',
    apiUrl: process.env.DIFY_API_URL || 'https://api.dify.ai/v1',
    user: process.env.DIFY_USER || 'whatsapp-agent',
  },

  // n8n（替换 Dify 作为 AI 引擎，配了这个就不需要 Dify 了）
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || '',

  // DeepSeek（内置 AI，不需要 n8n）
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },

  // WhatsApp
  whatsapp: {
    whitelist: process.env.WHITELIST_PHONES
      ? process.env.WHITELIST_PHONES.split(',').map(s => s.trim())
      : [],
  },

  // Scheduling
  schedule: {
    dailyReminder: process.env.DAILY_REMINDER_TIME || '09:00',
    weeklySummaryDay: parseInt(process.env.WEEKLY_SUMMARY_DAY || '0'),
    weeklySummaryTime: process.env.WEEKLY_SUMMARY_TIME || '20:00',
    monthlySummaryDay: parseInt(process.env.MONTHLY_SUMMARY_DAY || '1'),
    monthlySummaryTime: process.env.MONTHLY_SUMMARY_TIME || '20:00',
  },

  // Server
  port: parseInt(process.env.PORT || '3000'),

  // Railway: public URL for Dify webhook callbacks
  publicUrl: process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || '',
};

export function validateConfig() {
  const warnings = [];
  const missing = [];

  // Dify / n8n 二选一
  const hasDify = config.dify.apiKey && config.dify.apiKey.startsWith('app-');
  const hasN8n = !!config.n8nWebhookUrl;

  if (!hasDify && !hasN8n) {
    missing.push('DIFY_API_KEY 或 N8N_WEBHOOK_URL（至少配一个）');
  }

  if (config.dify.apiKey && !config.dify.apiKey.startsWith('app-')) {
    warnings.push('DIFY_API_KEY 应以 app- 开头，请确认从 Dify 控制台复制的是 API Key');
  }

  if (!config.supabase.url) missing.push('SUPABASE_URL (task-store 启动需要)');
  if (!config.supabase.anonKey) missing.push('SUPABASE_ANON_KEY');

  if (missing.length > 0) {
    console.error(`❌ 缺少必要环境变量: ${missing.join(', ')}`);
    console.error('   请复制 .env.example 为 .env 并填写');
    process.exit(1);
  }

  warnings.forEach(w => console.warn('⚠', w));
}

export const DATA_DIR = resolve(__dirname, '..', 'data');
