/**
 * WhatsApp Bridge — 调试版 (增加消息追踪)
 */
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { SocksProxyAgent } from 'socks-proxy-agent';
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
const POLL_INTERVAL = 5000;

let sock = null;
let lastPollTime = new Date().toISOString();
let msgCount = 0;

console.log('╔══════════════════════════════════════════╗');
console.log('║   Bridge DEBUG mode                       ║');
console.log('╚══════════════════════════════════════════╝');

const logger = {
  level: 'debug',
  info: (...args) => console.log('[baileys:INFO]', ...args),
  warn: (...args) => console.log('[baileys:WARN]', ...args),
  error: (...args) => console.log('[baileys:ERROR]', ...args),
  trace: (...args) => console.log('[baileys:TRACE]', ...args),
  debug: (...args) => console.log('[baileys:DEBUG]', ...args),
};
logger.child = () => logger;

let proxyAgent = null;
if (PROXY_URL) {
  const socksUrl = PROXY_URL.replace(/^http/, 'socks');
  proxyAgent = new SocksProxyAgent(socksUrl);
  console.log(`Proxy: ${socksUrl}`);
}

function pollAndSend() {
  axios.get(`${API_URL}/api/queue/poll`, { params: { since: lastPollTime }, timeout: 10000 })
    .then(async resp => {
      const items = resp.data?.items || [];
      for (const item of items) {
        if (!sock) continue;
        try {
          const fullJid = item.phone.includes('@s.whatsapp.net') ? item.phone : `${item.phone}@s.whatsapp.net`;
          await sock.sendMessage(fullJid, { text: item.message });
          console.log(`[poll] ⬆️ 已发送 → ${item.phone}`);
          await axios.post(`${API_URL}/api/queue/ack`, { id: item.id }, { timeout: 5000 });
        } catch (err) {
          console.error(`[poll] 发送失败:`, err.message.slice(0, 80));
        }
      }
      lastPollTime = new Date().toISOString();
    }).catch(() => {});
}

async function connectWA(phoneNumber) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    ...(proxyAgent ? { agent: proxyAgent } : {}),
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    qrTimeout: 60000,
    logger,
  });

  let pairingReq = false;

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    console.log(`[ev] connection=${connection} qr=${!!qr} time=${new Date().toISOString()}`);

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('\n📱 扫描上方 QR 码');
    }

    if (connection === 'connecting' && phoneNumber && !state.creds?.me?.id && !pairingReq) {
      pairingReq = true;
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          console.log(`\n📲 配对码: ${code}`);
        } catch (err) {
          console.error('配对码失败:', err.message);
        }
      }, 5000);
    }

    if (connection === 'open') {
      console.log(`✅ 已连接! 号码: ${sock.user?.id?.split(':')[0]}`);
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const sc = typeof err?.output?.statusCode === 'number' ? err.output.statusCode : undefined;
      const reconnect = sc !== DisconnectReason.loggedOut;
      console.log(`[ev] 断开 (${sc}), ${reconnect ? '10s后重连' : '已登出'}`);
      if (reconnect) setTimeout(() => connectWA(phoneNumber), 10000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ★★★ 核心: 消息接收 ★★★
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[MSG] #${++msgCount} type=${type} count=${messages?.length || 0}`);

    for (const msg of (messages || [])) {
      // DEBUG: 打印每条消息的详细信息
      console.log(`[MSG] key:`, JSON.stringify({
        fromMe: msg.key?.fromMe,
        remoteJid: msg.key?.remoteJid,
        id: msg.key?.id?.slice(0, 20)
      }));
      console.log(`[MSG] message keys:`, msg.message ? Object.keys(msg.message).join(',') : 'NO_MESSAGE');

      if (msg.key.fromMe) {
        console.log(`[MSG] ⏭ 跳过自己的消息`);
        continue;
      }
      if (!msg.message) {
        console.log(`[MSG] ⏭ 没有 message 字段`);
        continue;
      }

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      console.log(`[MSG] text="${text.slice(0, 80)}"`);

      const phone = msg.key.remoteJid;
      const sender = phone.split('@')[0];

      console.log(`[MSG] 📩 ${sender}: ${text.slice(0, 80)}`);

      try {
        await axios.post(`${API_URL}/api/messages/incoming`, {
          from: sender, to: phone, message: text,
        }, { timeout: 30000 });
        console.log(`[MSG] ✅ 已转发到 API`);
      } catch (err) {
        console.error(`[MSG] ❌ 转发失败:`, err.message.slice(0, 80));
      }
    }
  });

  // ★ 监听所有其他事件
  ['contacts.update', 'contacts.upsert', 'groups.update', 'group-participants.update',
   'presence.update', 'chats.update', 'chats.upsert', 'chats.delete', 'labels.edit',
   'labels.association', 'call', 'messaging-history.set'
  ].forEach(evName => {
    sock.ev.on(evName, (...args) => {
      console.log(`[ev:${evName}] ${new Date().toISOString()}`);
    });
  });

  return sock;
}

async function main() {
  let phone = process.argv[2];
  if (!phone) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    phone = await new Promise(resolve => {
      rl.question('📱 手机号: ', answer => {
        rl.close();
        resolve(answer.replace(/\D/g, ''));
      });
    });
  }
  phone = phone.replace(/\D/g, '');
  console.log(`使用号码: ${phone}`);

  await connectWA(phone);
  setInterval(pollAndSend, POLL_INTERVAL);
  console.log('Debug bridge ready. 等待消息...\n');
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
