/**
 * WhatsApp Bridge (本地运行版 — 配对码登录 v2)
 *
 * 正确用法: 先连 WebSocket，等 open 后再请求配对码
 *
 * 用法:
 *   PROXY_URL=http://127.0.0.1:7897 node src/bridge-pairing.js
 */
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { HttpsProxyAgent } from 'hpagent';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import readline from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AUTH_DIR = join(__dirname, '..', 'data', 'auth');
const API_URL = process.env.RAILWAY_API_URL || 'https://task-api-production-785e.up.railway.app';
const PROXY_URL = process.env.PROXY_URL || '';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '3000');

let sock = null;
let lastPollTime = new Date().toISOString();

console.log('╔══════════════════════════════════════════╗');
console.log('║   WhatsApp Bridge (配对码登录 v2)          ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`   🌐 API:  ${API_URL}`);
if (PROXY_URL) console.log(`   🔒 代理: ${PROXY_URL}`);
console.log(`   📡 轮询: ${POLL_INTERVAL}ms\n`);

// ==================== 代理 ====================
let proxyAgent = null;
if (PROXY_URL) {
  proxyAgent = new HttpsProxyAgent({ proxy: PROXY_URL });
  console.log(`   🔒 已设置代理: ${PROXY_URL}`);
}

// ==================== 输入手机号 ====================
function askPhone() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('📱 请输入你的 WhatsApp 手机号 (带国家代码，如 8613800000000): ', answer => {
      rl.close();
      const cleaned = answer.trim().replace(/\D/g, '');
      console.log(`   使用号码: ${cleaned}`);
      resolve(cleaned);
    });
  });
}

// ==================== 轮询发送 ====================
async function pollAndSend() {
  try {
    const resp = await axios.get(`${API_URL}/api/queue/poll`, {
      params: { since: lastPollTime },
      timeout: 10000,
    });
    const items = resp.data?.items || [];
    for (const item of items) {
      if (!sock) continue;
      try {
        await sendWhatsApp(item.phone, item.message);
        await axios.post(`${API_URL}/api/queue/ack`, { id: item.id }, { timeout: 5000 });
      } catch (err) {
        // ignore
      }
    }
    lastPollTime = new Date().toISOString();
  } catch (_) { /* network jitter */ }
}

function sendWhatsApp(jid, text) {
  if (!sock) return;
  if (!text) return;
  const fullJid = jid.includes('@s.whatsapp.net') ? jid : `${jid}@s.whatsapp.net`;
  return sock.sendMessage(fullJid, { text });
}

async function connectWhatsApp(phoneNumber) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const logger = { level: 'warn', info() {}, warn() {}, error() {}, trace() {}, debug() {} };
  logger.child = () => logger;

  sock = makeWASocket({
    auth: state,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    qrTimeout: 60000,
    agent: proxyAgent,
    logger,
  });

  let pairingRequested = false;

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect, isNewLogin }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('\n📱 请用 WhatsApp 扫描上方 QR 码');
      console.log('   WhatsApp → 设置 → 已关联设备 → 扫码关联\n');
    }

    if (connection === 'open') {
      const me = sock.user?.id?.split(':')[0];
      if (me) console.log(`✅ WhatsApp 已连接! 号码: ${me}`);
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      let code = err?.output?.statusCode || 500;
      // Don't reconnect on 405 — it means auth failed (device limit/mismatch)
      if (code === 405) {
        console.log('[whatsapp] ⚠️ 405 鉴权失败 — 检查是否超过4个设备，或删除 data/ 重试');
        return;
      }
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`[whatsapp] 断开 (${code})，${shouldReconnect ? '10s后重连...' : '已登出'}`);
      if (shouldReconnect) setTimeout(() => connectWhatsApp(phoneNumber), 10000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // 消息转发
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      // Accept all message types (including self-messages for testing)
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text.trim()) continue;

      const phone = msg.key.remoteJid;

      const sender = phone.split('@')[0];
      const pushName = msg.pushName || '';
      console.log(`[whatsapp] 📩 ${sender}${pushName ? ' (' + pushName + ')' : ''}: ${text.slice(0, 80)}`);

      try {
        await axios.post(`${API_URL}/api/messages/incoming`, {
          from: sender, to: phone, message: text, pushName,
        }, { timeout: 30000 });
      } catch (err) {
        // ignore
      }
    }
  });

  return sock;
}

// ==================== 主入口 ====================
async function main() {
  let phone = process.argv[2];
  if (!phone) phone = await askPhone();
  else phone = phone.replace(/\D/g, '');

  await connectWhatsApp(phone);

  setInterval(pollAndSend, POLL_INTERVAL);
  console.log(`[bridge] 🔄 轮询已启动\n👂 等待 WhatsApp 消息...\n`);
}

main().catch(err => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});
