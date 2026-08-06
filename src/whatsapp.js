/**
 * WhatsApp 桥接层
 * 基于 @whiskeysockets/baileys 连接 WhatsApp
 * - 接收消息 → 转发到 n8n / Dify
 * - 通过 WhatsApp 发送回复
 */
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { join } from 'path';
import { config, DATA_DIR } from './config.js';

const AUTH_DIR = join(DATA_DIR, 'auth');
let sock = null;
let onMessage = null; // 外部注入的消息处理回调
let reconnectTimer = null;

export function onIncomingMessage(fn) {
  onMessage = fn;
}

/**
 * 发送 WhatsApp 消息
 */
export async function sendWhatsApp(jid, text) {
  if (!sock) throw new Error('WhatsApp 未连接');
  if (!text) return;

  // Baileys 使用手机号+后缀作为 jid
  const fullJid = jid.includes('@s.whatsapp.net') ? jid : `${jid}@s.whatsapp.net`;

  try {
    await sock.sendMessage(fullJid, { text });
    console.log(`[whatsapp] 📤 已发送给 ${jid.split('@')[0]}`);
  } catch (err) {
    console.error(`[whatsapp] 发送失败:`, err.message);
  }
}

/**
 * 连接 WhatsApp
 */
export async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // Provide proper logger (baileys v6+ calls logger.trace internally)
  const logger = { level: 'warn', info() {}, warn() {}, error() {}, trace() {}, debug() {} };
  logger.child = () => logger;

  sock = makeWASocket({
    auth: state,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 30000,
    qrTimeout: 60000,
    logger,
  });

  let qrShown = false;

  // QR 码事件 — also log connection updates for debugging
  sock.ev.on('connection.update', ({ qr, connection, lastDisconnect, isNewLogin }) => {
    if (qr && !qrShown) {
      qrShown = true;
      qrcode.generate(qr, { small: true });
      console.log('\n📱 请用 WhatsApp 扫描上面的二维码完成登录');
    }

    if (connection) {
      console.log(`[whatsapp] connection.update: connection=${connection}, isNewLogin=${isNewLogin || false}`);
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp 已连接! 号码: ${sock.user?.id?.split(':')[0] || '未知'}`);
    }

    if (connection === 'close') {
      // Baileys v6: error object is in lastDisconnect?.error
      const err = lastDisconnect?.error;
      // Status code 405 means "Method Not Allowed" from WhatsApp — can happen on initial
      // connection before QR is displayed; always retry
      const statusCode = typeof err?.output?.statusCode === 'number'
        ? err.output.statusCode
        : (err?.message?.includes('405') ? 405 : undefined);

      // Only stop reconnecting if explicitly logged out (401)
      // 405, 408, 428, 440, 500, 503, 515 should all retry
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const delay = shouldReconnect ? 10000 : 0; // 10s backoff
      if (!shouldReconnect) qrShown = false; // Reset QR flag on logout for fresh session

      console.log(`[whatsapp] 连接断开 (statusCode=${statusCode})，${shouldReconnect ? `${delay/1000}s 后重连...` : '已登出'}`);

      if (shouldReconnect) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => connectWhatsApp(), delay);
      }
    }
  });

  // 凭证更新
  sock.ev.on('creds.update', saveCreds);

  // 消息处理
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      await handleMessage(msg);
    }
  });

  return sock;
}

async function handleMessage(msg) {
  if (!msg.message || !msg.message.conversation && !msg.message.extendedTextMessage) return;

  const rawText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
  if (!rawText.trim()) return;

  // Only process messages starting with /t (command trigger)
  if (!rawText.trimStart().startsWith('/t')) return;

  // Strip the /t prefix (and optional space)
  const text = rawText.trimStart().replace(/^\/t\s*/, '').trim();
  if (!text) return; // nothing after /t

  const phone = msg.key.remoteJid;
  const sender = phone.split('@')[0];

  // Allow self-messages (fromMe) — they must also start with /t
  // Whitelist filtering still applies to messages from others
  if (!msg.key.fromMe && config.whatsapp.whitelist.length > 0 && !config.whatsapp.whitelist.includes(sender)) {
    console.log(`[whatsapp] ⛔ 忽略非白名单消息: ${sender}`);
    return;
  }

  const fromTag = msg.key.fromMe ? '(自己)' : '';
  console.log(`[whatsapp] 📩 ${sender}${fromTag}: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);

  // 如果注册了外部处理器，转交处理
  if (onMessage) {
    try {
      await onMessage(sender, phone, text);
    } catch (err) {
      console.error(`[whatsapp] 消息处理失败:`, err.message);
      await sendWhatsApp(phone, `抱歉，处理消息时出错了: ${err.message}`);
    }
  }
}

/**
 * 获取连接状态
 */
export function isConnected() {
  return sock?.user ? true : false;
}

export function getPhone() {
  return sock?.user?.id?.split(':')[0] || null;
}
