/**
 * WhatsApp Task Agent — Railway API 版
 *
 * 混合架构:
 * - Railway: 跑此 API + 调度器 (Supabase 直连)
 * - 本地: 跑 WhatsApp Bridge (走代理)
 *
 * API 启动 → 不连 WhatsApp，只提供 API 和消息队列
 */
import { config, validateConfig } from './config.js';
import { createServer, startServer } from './server.js';
import { startScheduler, registerSender } from './scheduler.js';
import { enqueueSend } from './send-queue.js';

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    WhatsApp Task Agent — Railway API      ║');
  console.log('║    📡 Railway: API + 调度器              ║');
  console.log('║    📱 本地: WhatsApp Bridge              ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // 校验 Supabase 配置
  validateConfig();

  // 启动 API (sendToWhatsApp = null, 消息通过队列投递)
  const app = createServer(null);
  await startServer(app);

  // 定时任务：提醒/总结通过队列发送，本地 bridge 会轮询投递
  registerSender((phone, message) => {
    enqueueSend(phone, message);
  });

  // 调度器发给配置的电话号（改成你的手机号，或者用环境变量 MY_PHONE）
  const myPhone = process.env.MY_PHONE || '';
  if (myPhone) {
    startScheduler(myPhone);
    console.log(`   📅 定时任务已启动 (电话: ${myPhone})`);
  } else {
    console.log('   ⚠ MY_PHONE 未设置，跳过定时任务');
  }

  console.log(`\n✅ API 就绪`);
  console.log(`   🌐 健康检查: http://localhost:${config.port}/api/health`);
  console.log(`   📋 任务列表:  GET  http://localhost:${config.port}/api/tasks\n`);
}

main().catch(err => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
