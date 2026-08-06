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
  completeTask, uncompleteTask, deleteTask,
  getStats,
  getWeeklySummary, getMonthlySummary,
  getQuarterSummary, getCurrentYearSummary, getSummaryByDateRange,
} from './task-store.js';
import { enqueueSend, getPendingSends, markSent } from './send-queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse Chinese relative date expressions into ISO dates
function resolveRelativeDate(hint, today) {
  const t = new Date(today);
  const text = hint.toLowerCase().replace(/\s/g, '');

  // Day-of-week mapping
  const dayMap = {
    '周日':0,'星期天':0,'星期日':0,
    '周一':1,'星期一':1,
    '周二':2,'星期二':2,
    '周三':3,'星期三':3,
    '周四':4,'星期四':4,
    '周五':5,'星期五':5,
    '周六':6,'星期六':6,
  };

  // Check explicit day-of-week: "周五", "下周三"
  for (const [name, targetDay] of Object.entries(dayMap)) {
    if (text.includes(name)) {
      let daysUntil = targetDay - t.getDay();
      if (text.includes('下')) daysUntil += 7;
      if (daysUntil <= 0 && !text.includes('下')) daysUntil += 7; // "周五" = this coming Friday
      if (daysUntil === 0 && !text.includes('今天') && !text.includes('今')) daysUntil = 7; // next week same day
      // Edge: "这周五" → this week
      if (text.includes('这') && daysUntil > 7) daysUntil -= 7;

      t.setDate(t.getDate() + daysUntil);
      return t.toISOString().slice(0, 10);
    }
  }

  // "明天" / "后天"
  if (text.includes('后天')) {
    t.setDate(t.getDate() + 2);
    return t.toISOString().slice(0, 10);
  }
  if (text.includes('明天')) {
    t.setDate(t.getDate() + 1);
    return t.toISOString().slice(0, 10);
  }

  // "下周" without specific day → next Monday
  if (text.includes('下周')) {
    const daysUntil = (8 - t.getDay()) % 7 || 7; // next Monday
    t.setDate(t.getDate() + daysUntil);
    return t.toISOString().slice(0, 10);
  }

  // "周末" → this Saturday
  if (text.includes('周末')) {
    const daysUntil = (6 - t.getDay() + 7) % 7 || 7;
    t.setDate(t.getDate() + daysUntil);
    return t.toISOString().slice(0, 10);
  }

  // "本月" → end of this month
  if (text.includes('月底') || text.includes('月末')) {
    t.setMonth(t.getMonth() + 1, 0); // last day of current month
    return t.toISOString().slice(0, 10);
  }

  return null;
}

export function createServer(sendToWhatsApp) {
  const app = express();
  // 静态文件：Web Dashboard
  app.use(express.static(resolve(__dirname, '..', 'public')));

  app.use(express.json());

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
    const { from: sender, to: phone, message: text, pushName } = req.body;
    if (!sender || !text) {
      return res.status(400).json({ error: 'from 和 message 必填' });
    }

    console.log(`[server] 📩 收到消息 ${sender}${pushName ? ' (' + pushName + ')' : ''}: ${text.slice(0, 80)}`);

    // 内置 DeepSeek AI 分析
    if (config.deepseekApiKey) {
      try {
        const axios = (await import('axios')).default;
        const today = new Date();
        const todayISO = today.toISOString().slice(0, 10);
        const weekDay = ['周日','周一','周二','周三','周四','周五','周六'][today.getDay()];
        const aiResp = await axios.post('https://api.deepseek.com/chat/completions', {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: `你是一个 WhatsApp 任务管理助手。分析用户消息，提取任务。

今天是 ${todayISO} (${weekDay})。

关于 deadline 字段的规则：
- 如果用户说了具体日期（如"8月15号"），用 YYYY-MM-DD 格式
- 如果用户说的是相对时间（如"周五前""下周三""明天下午"），deadlineHint 写原文（如"周五""下周三"），deadline 写 null
- 如果没有提到时间，两个都写 null

返回纯JSON（不要markdown包裹）：
{"action":"create|query|complete|summary|ignore","title":"任务标题","priority":"high|medium|low","deadline":"YYYY-MM-DD或null","deadlineHint":"用户原文时间描述或null","description":"备注或null"}` },
            { role: 'user', content: text }
          ],
          temperature: 0.1,
        }, {
          headers: { Authorization: `Bearer ${config.deepseekApiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        });

        const aiContent = aiResp.data?.choices?.[0]?.message?.content || '';
        const jsonStr = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        // Resolve relative dates ("周五", "下周三", "明天") into real dates
        let resolvedDeadline = parsed.deadline || null;
        if (!resolvedDeadline && parsed.deadlineHint) {
          resolvedDeadline = resolveRelativeDate(parsed.deadlineHint, today);
          if (resolvedDeadline) {
            console.log(`[server] 📅 解析相对日期: "${parsed.deadlineHint}" → ${resolvedDeadline}`);
          }
        }

        if (parsed.action === 'create' && parsed.title) {
          const task = await createTask({
            title: parsed.title,
            description: parsed.description || '',
            priority: parsed.priority || 'medium',
            deadline: resolvedDeadline,
            source: 'whatsapp',
            sourceChat: phone || sender,
            sourceName: pushName || '',
          });
          console.log(`[server] ✅ 已创建任务: ${task.id} - ${parsed.title} (deadline: ${resolvedDeadline || '无'})`);
        } else {
          console.log(`[server] ℹ️ AI 分析结果: action=${parsed.action}`);
        }
      } catch (err) {
        console.error('[server] DeepSeek 分析失败:', err.message);
      }
    }

    // n8n 转发（保留兼容，DeepSeek 优先）
    if (!config.deepseekApiKey && config.n8nWebhookUrl) {
      try {
        const axios = (await import('axios')).default;
        await axios.post(config.n8nWebhookUrl, {
          phone: sender, jid: phone || sender, message: text, pushName: pushName || '',
        }, { timeout: 30000 });
        console.log('[server] 已转发到 n8n');
      } catch (err) {
        console.error('[server] n8n webhook 失败:', err.message);
      }
    }

    if (!config.deepseekApiKey && !config.n8nWebhookUrl) {
      console.log('[server] ⚠ DEEPSEEK_API_KEY 和 N8N_WEBHOOK_URL 均未配置，消息未处理');
    }

    res.json({ success: true });
  });

  // ==================== 任务 CRUD ====================

  // 创建任务
  app.post('/api/tasks', async (req, res) => {
    const { title, description, priority, deadline, source, sourceChat, sourceName } = req.body;
    if (!title) return res.status(400).json({ error: 'title 必填' });
    try {
      const task = await createTask({ title, description, priority, deadline, source, sourceChat, sourceName });
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

  // 撤销完成
  app.post('/api/tasks/:id/undone', async (req, res) => {
    try {
      const task = await uncompleteTask(req.params.id);
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
