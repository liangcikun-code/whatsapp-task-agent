/**
 * Express API 服务器 (Dify/n8n HTTP Tool 的后端)
 *
 * 混合架构: Railway 跑此 API + n8n，本地跑 WhatsApp Bridge
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from './config.js';
import { loadConfig, saveConfig, resetConfig } from './schedule-config.js';
import {
  createTask, listTasks, getTask, updateTask,
  completeTask, deleteTask,
  getStats,
  getWeeklySummary, getMonthlySummary,
  getQuarterSummary, getCurrentYearSummary, getSummaryByDateRange,
} from './task-store.js';
import { enqueueSend, getPendingSends, markSent } from './send-queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(sendToWhatsApp) {
  const app = express();
  // 静态文件：Web Dashboard
  app.use(express.static(resolve(__dirname, '..', 'public')));

  app.use(express.json());

  // ==================== 健康检查 ====================

  // ==================== 日程提醒配置 ====================

  app.get('/api/schedule/config', (req, res) => {
    res.json(loadConfig());
  });

  app.patch('/api/schedule/config', (req, res) => {
    const saved = saveConfig(req.body);
    res.json(saved);
  });

  app.post('/api/schedule/config/reset', (req, res) => {
    res.json(resetConfig());
  });
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ==================== 消息投递 ====================
  // 入队：Railway 上 n8n/scheduler 通过此端点发送 WhatsApp 消息
  app.post('/api/queue/send', (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone 和 message 必填' });
    }
    // 如果本机有 WhatsApp 连接，直接发送；否则入队
    if (sendToWhatsApp) {
      sendToWhatsApp(phone, message).catch(err => {
        console.error('[server] 直接发送失败，入队:', err.message);
        enqueueSend(phone, message);
      });
    } else {
      enqueueSend(phone, message);
    }
    res.json({ success: true, queued: !sendToWhatsApp });
  });

  // 轮询：本地 bridge 定时调用此端点取出消息
  app.get('/api/queue/poll', (req, res) => {
    const { since } = req.query;
    const items = getPendingSends(since || null);
    res.json({ items, count: items.length });
  });

  // 确认已发送：本地 bridge 发送成功后调用
  app.post('/api/queue/ack', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id 必填' });
    markSent(id);
    res.json({ success: true });
  });

  // ==================== WhatsApp 消息接收 ====================
  // 本地 bridge 把收到的 WhatsApp 消息转发到此
  app.post('/api/messages/incoming', async (req, res) => {
    const { from: sender, to: phone, message: text } = req.body;
    if (!sender || !text) {
      return res.status(400).json({ error: 'from 和 message 必填' });
    }

    console.log(`[server] 📩 收到消息 ${sender}: ${text.slice(0, 80)}`);

    // 转发到 n8n
    if (config.n8nWebhookUrl) {
      try {
        const axios = (await import('axios')).default;
        await axios.post(config.n8nWebhookUrl, {
          phone: sender,
          jid: phone || sender,
          message: text,
        }, { timeout: 30000 });
        console.log('[server] 已转发到 n8n');
      } catch (err) {
        console.error('[server] n8n webhook 失败:', err.message);
      }
    } else {
      console.log('[server] ⚠ N8N_WEBHOOK_URL 未配置，消息未处理');
    }

    res.json({ success: true });
  });

  // ==================== 任务 CRUD ====================

  // 创建任务
  app.post('/api/tasks', async (req, res) => {
    const { title, description, priority, deadline, source, sourceChat } = req.body;
    if (!title) return res.status(400).json({ error: 'title 必填' });
    try {
      const task = await createTask({ title, description, priority, deadline, source, sourceChat });
      res.status(201).json(task);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 列出任务 — 必须放在 /api/tasks/:id 前面
  app.get('/api/tasks', async (req, res) => {
    const { status, priority } = req.query;
    try {
      const tasks = await listTasks({ status, priority });
      const stats = await getStats();
      res.json({ tasks, stats, total: tasks.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 统计 & 总结 ====================

  // 统计 — 必须放在 /api/tasks/:id 前面，防止 'stats' 被当成 id
  app.get('/api/tasks/stats', async (req, res) => {
    try { res.json(await getStats()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // 统一摘要 API — 必须放在 /api/tasks/:id 前面
  app.get('/api/tasks/summary', async (req, res) => {
    try {
      const { range, from, to } = req.query;
      if (from && to) return res.json(await getSummaryByDateRange(from, to));

      let result;
      switch (range) {
        case 'week':   result = await getWeeklySummary(); break;
        case 'month':  result = await getMonthlySummary(); break;
        case 'quarter': result = await getQuarterSummary(); break;
        case 'year':   result = await getCurrentYearSummary(); break;
        default:       result = await getWeeklySummary();
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 获取单个任务 — 必须在 stats/summary 之后
  app.get('/api/tasks/:id', async (req, res) => {
    try {
      const task = await getTask(req.params.id);
      if (!task) return res.status(404).json({ error: '任务不存在' });
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 更新任务
  app.patch('/api/tasks/:id', async (req, res) => {
    try {
      const task = await updateTask(req.params.id, req.body);
      if (!task) return res.status(404).json({ error: '任务不存在' });
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 标记完成
  app.post('/api/tasks/:id/done', async (req, res) => {
    try {
      const task = await completeTask(req.params.id);
      if (!task) return res.status(404).json({ error: '任务不存在' });
      res.json(task);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 删除任务
  app.delete('/api/tasks/:id', async (req, res) => {
    try {
      const ok = await deleteTask(req.params.id);
      if (!ok) return res.status(404).json({ error: '任务不存在' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 兼容旧端点 summary/weekly, summary/monthly

  app.get('/api/tasks/summary/weekly', async (req, res) => {
    try {
      const { range, from, to } = req.query;
      if (from && to) return res.json(await getSummaryByDateRange(from, to));

      let result;
      switch (range) {
        case 'week':   result = await getWeeklySummary(); break;
        case 'month':  result = await getMonthlySummary(); break;
        case 'quarter': result = await getQuarterSummary(); break;
        case 'year':   result = await getCurrentYearSummary(); break;
        default:       result = await getWeeklySummary();
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/tasks/stats', async (req, res) => {
    try { res.json(await getStats()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/tasks/summary/weekly', async (req, res) => {
    try { res.json(await getWeeklySummary()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/tasks/summary/monthly', async (req, res) => {
    try { res.json(await getMonthlySummary()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // 兼容旧接口 POST /api/send
  app.post('/api/send', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone 和 message 必填' });
    enqueueSend(phone, message);
    res.json({ success: true, queued: true });
  });

  return app;
}

export function startServer(app) {
  return new Promise(resolve => {
    app.listen(config.port, () => {
      console.log(`🌐 API 服务已启动: http://localhost:${config.port}`);
      console.log(`   消息队列:  POST http://localhost:${config.port}/api/queue/send`);
      console.log(`   消息轮询:  GET  http://localhost:${config.port}/api/queue/poll`);
      console.log(`   接收消息:  POST http://localhost:${config.port}/api/messages/incoming`);
      resolve();
    });
  });
}
