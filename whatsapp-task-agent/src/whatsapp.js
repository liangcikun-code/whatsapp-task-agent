/**
 * WhatsApp 桥接层
 * 基于 @whiskeysockets/baileys 连接 WhatsApp
 * - 接收消息 → 转发到 Dify
 * - Dify 回复 → 通过 WhatsApp 发送回用户
 */
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { Boom } from '@whiskeysockets/baileys';
import { join } from 'path';
import { config, DATA_DIR } from './config.js';
import { sendMessage as difySend } from './dify-client.js';

const AUTH_DIR = join(DATA_DIR, 'auth');
let sock = null;
let onMessage = null; // 外部注入的消息处理回调

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

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    // 降低日志级别
    logger: { level: 'warn', info: () => {}, warn: () => {}, error: () => {}, child: () => this },
  });

  // QR 码事件
  sock.ev.on('connection.update', (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('\n📱 请用 WhatsApp 扫描上面的二维码完成登录');
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp 已连接! 号码: ${sock.user?.id?.split(':')[0] || '未知'}`);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`[whatsapp] 连接断开 (${reason})，${shouldReconnect ? '5秒后重连...' : '已登出'}`);
      if (shouldReconnect) {
        setTimeout(connectWhatsApp, 5000);
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
  // 跳过自己的消息
  if (msg.key.fromMe) return;
  if (!msg.message || !msg.message.conversation && !msg.message.extendedTextMessage) return;

  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
  if (!text.trim()) return;

  const phone = msg.key.remoteJid;
  const sender = phone.split('@')[0];

  // 白名单过滤
  if (config.whatsapp.whitelist.length > 0 && !config.whatsapp.whitelist.includes(sender)) {
    console.log(`[whatsapp] ⛔ 忽略非白名单消息: ${sender}`);
    return;
  }

  console.log(`[whatsapp] 📩 ${sender}: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);

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
