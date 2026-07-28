/**
 * 消息发送队列 (内存版)
 * - Railway 上的调度器/n8n 把要发送的消息入队
 * - 本地 bridge 轮询并发送 WhatsApp 消息
 */
const queue = [];
const MAX_SIZE = 500;

export function enqueueSend(phone, message) {
  if (!phone || !message) return null;
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    phone,
    message,
    createdAt: new Date().toISOString(),
  };
  queue.push(item);
  // 防止队列无限增长
  if (queue.length > MAX_SIZE) {
    queue.splice(0, queue.length - MAX_SIZE);
  }
  console.log(`[send-queue] 📥 入队 → ${phone}: ${message.slice(0, 50)}... (队列 ${queue.length})`);
  return item;
}

export function getPendingSends(since) {
  if (!since) return [...queue];
  return queue.filter(item => item.createdAt > since);
}

export function markSent(id) {
  const idx = queue.findIndex(item => item.id === id);
  if (idx !== -1) {
    const removed = queue.splice(idx, 1)[0];
    console.log(`[send-queue] ✅ 已发送 → ${removed.phone} (队列剩余 ${queue.length})`);
    return true;
  }
  return false;
}
