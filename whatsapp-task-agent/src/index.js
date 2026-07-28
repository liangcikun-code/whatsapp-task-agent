/**
 * WhatsApp Task Agent - 入口
 *
 * 启动流程:
 * 1. WhatsApp 连接 (Baileys)
 * 2. 本地 API 服务 (Express)
 * 3. 定时任务调度器 (node-cron)
 * 4. Dify Agent 通过 HTTP Tool 调用本地 API
 */
import { config, validateConfig } from './config.js';
import { connectWhatsApp, onIncomingMessage, sendWhatsApp, getPhone } from './whatsapp.js';
import { sendMessage as difySend } from './dify-client.js';
import axios from 'axios';import { createServer, startServer } from './server.js';
import { startScheduler, registerSender } from './scheduler.js';
import { getStats } from './task-store.js';

let myPhone = null;

// ==================== WhatsApp 消息 → Dify 处理逻辑 ====================

async function handleIncoming(sender, phone, text) {
  // 如果配置了 n8n webhook，转发到 n8n
  if (config.n8nWebhookUrl) {
    try {
      await axios.post(config.n8nWebhookUrl, {
        phone: sender,
        jid: phone,
        message: text,
      }, { timeout: 30000 });
      // n8n 会通过 POST /api/send 异步回复
    } catch (err) {
      console.error('[index] n8n webhook 失败:', err.message);
      await sendWhatsApp(phone, '抱歉，处理消息时出错了: ' + err.message);
    }
    return;
  }

  // 否则使用 Dify
  const result = await difySend(text, sender, {
    stats: JSON.stringify(await getStats()),
  });

  // 将 Dify 回复发回 WhatsApp
  if (result.answer) {
    await sendWhatsApp(phone, result.answer);
  }
}

// ==================== 主启动 ====================

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    WhatsApp Task Agent v1.1               ║');
  console.log('║    🤖 WhatsApp ←→ Dify AI Agent          ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // 1. 校验配置
  validateConfig();

  // 2. 注册消息处理器 (先注册，确保 WhatsApp 连接后就有回调)
  onIncomingMessage(handleIncoming);

  // 3. 启动本地 API 服务 (Dify 通过 HTTP Tool 调用)
  const app = createServer((phone, message) => sendWhatsApp(phone, message));
  await startServer(app);

  // 4. 连接 WhatsApp
  console.log('\n📱 正在连接 WhatsApp...');
  await connectWhatsApp();

  // 5. 等 WhatsApp 就绪后获取本机号码并启动调度
  const waitInterval = setInterval(() => {
    const phone = getPhone();
    if (phone) {
      clearInterval(waitInterval);
      myPhone = phone;

      // 注册发送函数给调度器
      registerSender((target, message) => sendWhatsApp(target, message));

      // 启动定时任务（默认发给自己作为提醒）
      startScheduler(phone);

      console.log(`\n✅ 系统就绪！将 ${phone} 的 WhatsApp 消息发送到 Dify 处理`);
      console.log(`   🌐 API: http://localhost:${config.port}`);
      console.log(`   📋 任务列表: http://localhost:${config.port}/api/tasks\n`);
    }
  }, 2000);
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n👋 正在关闭...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

main().catch(err => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});
