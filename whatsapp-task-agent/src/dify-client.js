/**
 * Dify Cloud API 客户端
 * 负责将 WhatsApp 消息转发至 Dify Agent，并获取 AI 回复
 * 使用 Dify 的 Conversation API (chat-messages)
 */
import axios from 'axios';
import { config } from './config.js';
import { getConversation, setConversation } from './task-store.js';

const client = axios.create({
  baseURL: config.dify.apiUrl,
  headers: {
    Authorization: `Bearer ${config.dify.apiKey}`,
    'Content-Type': 'application/json',
  },
  timeout: 60000, // LLM 回复可能较慢
});

/**
 * 发送消息到 Dify Agent 并获取回复
 * @param {string} text - 用户消息
 * @param {string} phone - 用户 WhatsApp 号码（用于 conversation 路由）
 * @param {object} extras - 额外上下文
 * @returns {Promise<{answer: string, conversationId: string}>}
 */
export async function sendMessage(text, phone, extras = {}) {
  // 从本地缓存获取该用户的 conversation_id
  let conversationId = await getConversation(phone);

  const payload = {
    inputs: {
      ...extras,
      source: 'whatsapp',
      phone,
    },
    query: text,
    response_mode: 'blocking', // 同步等回复；生产环境建议 streaming
    user: config.dify.user,
  };

  if (conversationId) {
    payload.conversation_id = conversationId;
    payload.auto_generate_name = false;
  }

  try {
    const res = await client.post('/chat-messages', payload);
    const data = res.data;

    // 首次对话会返回新的 conversation_id，缓存起来
    if (data.conversation_id && !conversationId) {
      await setConversation(phone, data.conversation_id);
    }

    return {
      answer: data.answer || '',
      conversationId: data.conversation_id,
      messageId: data.message_id,
      metadata: data.metadata || {},
    };
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.message || err.message;
    console.error(`[dify] 请求失败 (${status}): ${detail}`);
    throw new Error(`Dify API 错误: ${detail}`);
  }
}

/**
 * 获取对话历史
 */
export async function getMessages(conversationId, limit = 20) {
  if (!conversationId) return [];
  try {
    const res = await client.get('/messages', {
      params: { conversation_id: conversationId, limit, user: config.dify.user },
    });
    return res.data.data || [];
  } catch {
    return [];
  }
}

/**
 * 健康检查
 */
export async function healthCheck() {
  try {
    await client.get('/parameters');
    return true;
  } catch {
    return false;
  }
}
