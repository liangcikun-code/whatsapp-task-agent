/**
 * Express API 服务器 (Dify HTTP Tool 的后端)
 * Dify Agent 通过 HTTP 请求来 CRUD 任务
 */
import express from 'express';
import { config } from './config.js';
import {
  createTask, listTasks, getTask, updateTask,
  completeTask, deleteTask,
  getStats,
  getWeeklySummary, getMonthlySummary,
  getQuarterSummary, getCurrentYearSummary, getSummaryByDateRange,
} from './task-store.js';

export function createServer(sendToWhatsApp) {
  const app = express();
  app.use(express.json());

  // ==================== 健康检查 ====================
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
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

  // 列出任务
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

  // 获取单个任务
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
      if (sendToWhatsApp) {
        await sendToWhatsApp(req.body.phone || '', `✅ 已完成: ${task.title}`);
      }
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

  // ==================== 统计 & 总结 ====================

  // ==================== 统一摘要 API ====================

  app.get('/api/tasks/summary', async (req, res) => {
    try {
      const { range, from, to } = req.query;

      if (from && to) {
        return res.json(await getSummaryByDateRange(from, to));
      }

      let result;
      switch (range) {
        case 'week':
          result = await getWeeklySummary();
          break;
        case 'month':
          result = await getMonthlySummary();
          break;
        case 'quarter':
          result = await getQuarterSummary();
          break;
        case 'year':
          result = await getCurrentYearSummary();
          break;
        default:
          result = await getWeeklySummary();
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ==================== 兼容旧端点 ====================

  app.get('/api/tasks/stats', async (req, res) => {
    try {
      res.json(await getStats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tasks/summary/weekly', async (req, res) => {
    try {
      res.json(await getWeeklySummary());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tasks/summary/monthly', async (req, res) => {
    try {
      res.json(await getMonthlySummary());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 手动触发发送 ====================
  app.post('/api/send', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone 和 message 必填' });
    if (!sendToWhatsApp) return res.status(503).json({ error: 'WhatsApp 未连接' });
    await sendToWhatsApp(phone, message);
    res.json({ success: true });
  });

  return app;
}

export function startServer(app) {
  return new Promise(resolve => {
    app.listen(config.port, () => {
      console.log(`🌐 本地 API 服务已启动: http://localhost:${config.port}`);
      console.log(`   任务列表:  GET  http://localhost:${config.port}/api/tasks`);
      console.log(`   Dify 调用: POST http://localhost:${config.port}/api/tasks`);
      resolve();
    });
  });
}
