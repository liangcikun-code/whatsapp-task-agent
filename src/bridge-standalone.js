/**
 * WhatsApp Bridge (本地运行版)
 *
 * 功能:
 * 1. 走 Clash 代理连接 WhatsApp (Baileys)
 * 2. 收到消息 → POST 到 Railway API /api/messages/incoming → n8n 处理
 * 3. 定时从 Railway API /api/queue/poll 拉取要发送的消息 → WhatsApp 发出
 *
 * 用法:
 *   RAILWAY_API_URL=https://task-api-production-785e.up.railway.app \
 *   PROXY_URL=http://127.0.0.1:7897 \
 *   node src/bridge-standalone.js
 */
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { HttpsProxyAgent } from 'hpagent';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AUTH_DIR = join(__dirname, '..', 'data', 'auth');
const API_URL = process.env.RAILWAY_API_URL || 'https://task-api-production-785e.up.railway.app';
const PROXY_URL = process.env.PROXY_URL || '';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '3000'); // 3秒轮询一次

let sock = null;
let lastPollTime = new Date().toISOString();

console.log('╔══════════════════════════════════════════╗');
console.log('║   WhatsApp Bridge (本地)                  ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`   🌐 API:  ${API_URL}`);
if (PROXY_URL) {
  console.log(`   🔒 代理: ${PROXY_URL}`);
} else {
  console.log(`   🔓 直连 (请开启 Clash TUN/增强模式)`);
}
console.log(`   📡 轮询: ${POLL_INTERVAL}ms\n`);

// ==================== 代理 Agent (可选) ====================
let proxyAgent = null;
if (PROXY_URL) {
  // hpagent: HttpsProxyAgent 需要 { proxy } 对象，不能直接用字符串
  proxyAgent = new HttpsProxyAgent({ proxy: PROXY_URL });
}

// ==================== 轮询 API 取消息并发送 ====================
async function pollAndSend() {
  try {
    const resp = await axios.get(`${API_URL}/api/queue/poll`, {
      params: { since: lastPollTime },
      timeout: 10000,
    });

    const items = resp.data?.items || [];
    for (const item of items) {
      if (!sock) {
        console.log('[poll] WhatsApp 未连接，跳过发送');
        continue;
      }
      try {
        await sendWhatsApp(item.phone, item.message);
        // 通知 API 已发送
        await axios.post(`${API_URL}/api/queue/ack`, { id: item.id }, { timeout: 5000 });
      } catch (err) {
        console.error(`[poll] 发送失败 (${item.phone}):`, err.message);
      }
    }

    if (items.length > 0) {
      console.log(`[poll] 📤 已处理 ${items.length} 条消息`);
    }
    lastPollTime = new Date().toISOString();
  } catch (err) {
    // 网络抖动，忽略
    if (err.code !== 'ECONNREFUSED' && err.code !== 'ETIMEDOUT') {
      console.error('[poll] 轮询错误:', err.message);
    }
  }
}

// ==================== WhatsApp ====================

export async function sendWhatsApp(jid, text) {
  if (!sock) throw new Error('WhatsApp 未连接');
  if (!text) return;

  const fullJid = jid.includes('@s.whatsapp.net') ? jid : `${jid}@s.whatsapp.net`;

  await sock.sendMessage(fullJid, { text });
  console.log(`[whatsapp] 📤 已发送给 ${jid.split('@')[0]}: ${text.slice(0, 50)}`);
}

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const logger = { level: 'warn', info() {}, warn() {}, error() {}, trace() {}, debug() {} };
  logger.child = () => logger;

  sock = makeWASocket({
    auth: state,
    ...(proxyAgent ? { agent: proxyAgent } : {}),  // 有代理才传
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 30000,
    qrTimeout: 60000,
    logger,
  });

  // QR 码
  sock.ev.on('connection.update', ({ qr, connection, lastDisconnect, isNewLogin }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('\n📱 请用 WhatsApp 扫描上面的 QR 码完成登录');
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp 已连接! 号码: ${sock.user?.id?.split(':')[0] || '未知'}`);
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = typeof err?.output?.statusCode === 'number'
        ? err.output.statusCode
        : (err?.message?.includes('405') ? 405 : undefined);

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const delay = shouldReconnect ? 10000 : 0;

      console.log(`[whatsapp] 连接断开 (statusCode=${statusCode})，${shouldReconnect ? `${delay/1000}s 后重连...` : '已登出'}`);

      if (shouldReconnect) {
        setTimeout(connectWhatsApp, delay);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // 消息处理 — 转发到 Railway API
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message || !msg.message.conversation && !msg.message.extendedTextMessage) continue;

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      if (!text.trim()) continue;

      const phone = msg.key.remoteJid;
      const sender = phone.split('@')[0];

      console.log(`[whatsapp] 📩 ${sender}: ${text.slice(0, 80)}`);

      // 转发给 Railway API → n8n
      try {
        await axios.post(`${API_URL}/api/messages/incoming`, {
          from: sender,
          to: phone,
          message: text,
        }, { timeout: 30000 });
      } catch (err) {
        console.error(`[whatsapp] 转发消息到 API 失败:`, err.message);
      }
    }
  });

  return sock;
}

// ==================== 主循环 ====================

async function main() {
  await connectWhatsApp();

  // 定时轮询发送队列
  setInterval(pollAndSend, POLL_INTERVAL);
  console.log(`[bridge] 🔄 开始轮询发送队列 (${POLL_INTERVAL}ms)\n`);

  console.log('👂 等待 WhatsApp 消息...\n');
}

main().catch(err => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
