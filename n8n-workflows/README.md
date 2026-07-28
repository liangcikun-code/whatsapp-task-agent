# n8n Workflow 设计文档

> n8n 替换 Dify 作为 AI 自动化和编排层。
> WhatsApp Bridge + Task API 保持不变，n8n 负责 AI 对话分析和任务逻辑。

## 架构

```
┌─ Railway Project ─────────────────────────────────────────┐
│                                                            │
│  Service 1: n8n (Docker)                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Workflow 1: 消息处理 (Webhook)                       │    │
│  │ 收到 WhatsApp 消息 → LLM 分析 → CRUD 任务 → 回复    │    │
│  │                                                     │    │
│  │ Workflow 2: 每日提醒 (Cron 09:00)                    │    │
│  │ 查询待办 → 生成提醒 → 发送 WhatsApp                   │    │
│  │                                                     │    │
│  │ Workflow 3: 周/月总结 (Cron 周日/1号)                │    │
│  │ 查询总结 → 生成报告 → 发送 WhatsApp                   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                            │
│  Service 2: WhatsApp Bridge + Task API (Docker)            │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Baileys (WhatsApp Web 协议)                         │    │
│  │ Express API (task CRUD + send)                     │    │
│  │ 收到消息 → 转发到 n8n Webhook URL                   │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
          │
          ▼
┌─ Supabase (免费) ─────────────┐
│  PostgreSQL: tasks + conversations│
└──────────────────────────────────┘
┌─ DeepSeek API (按量 ¥1/百万token) ─┐
│  LLM 推理                           │
└────────────────────────────────────┘
```

## 部署 n8n 到 Railway

### 方法一：一键部署 (推荐)

1. 登录 [railway.app](https://railway.app)
2. 点 **New Project** → **Deploy from Docker Image**
3. 输入镜像名：`n8nio/n8n`
4. 设置环境变量：

| 变量 | 值 | 用途 |
|------|-----|------|
| `N8N_PORT` | `5678` | n8n 端口 |
| `N8N_PROTOCOL` | `https` | |
| `WEBHOOK_URL` | Railway 分配的域名 | 让 n8n 知道自己的公网地址 |

5. Railway 会自动生成一个域名（如 `n8n-production.up.railway.app`）
6. 打开这个域名，注册 n8n 管理员账号

### 方法二：Docker Compose（本地测试用）

```yaml
version: '3.8'
services:
  n8n:
    image: n8nio/n8n
    ports:
      - "5678:5678"
    environment:
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
```

## 三个核心 Workflow 设计

---

### Workflow 1: WhatsApp 消息处理

**触发器**: Webhook Node
- 路径: `/webhook/whatsapp-incoming`
- 接收: `{ "phone": "+8613800000000", "message": "帮我记住周五交报告", "jid": "138..." }`

**节点 2 — Code Node (提取消息)**
```javascript
// 从 webhook 中提取消息内容
const body = $input.first().json.body;
return {
  phone: body.phone,
  message: body.message,
  jid: body.jid,
};
```

**节点 3 — HTTP Request (调用 DeepSeek API 分析意图)**
- Method: POST
- URL: `https://api.deepseek.com/chat/completions`
- Headers: `Authorization: Bearer {{DEEPSEEK_API_KEY}}`
- Body (JSON):
```json
{
  "model": "deepseek-chat",
  "messages": [
    {"role": "system", "content": "分析消息意图，仅返回JSON: {"action": "create|query|complete|summary", "title": "...", "priority": "high|medium|low", "deadline": "..."}"},
    {"role": "user", "content": "{{message}}"}
  ],
  "temperature": 0.1
}
```

**节点 4 — Switch Node (路由)**
```
action = create  → 节点 5a
action = query   → 节点 5b
action = complete → 节点 5c
action = summary → 节点 5d
```

**节点 5a — HTTP Request (创建任务)**
- Method: POST
- URL: `http://task-api:3000/api/tasks`
- Body: `{"title": "{{title}}", "priority": "{{priority}}", "deadline": "{{deadline}}", "source": "whatsapp", "sourceChat": "{{phone}}"}`

**节点 5b — HTTP Request (查询任务)**
- Method: GET
- URL: `http://task-api:3000/api/tasks?status=pending`

**节点 5c — HTTP Request (完成任务)**
- Method: POST
- URL: `http://task-api:3000/api/tasks/{{taskId}}/done`

**节点 5d — HTTP Request (获取总结)**
- Method: GET
- URL: `http://task-api:3000/api/tasks/summary?range=week`

**节点 6 — HTTP Request (生成回复)**
- Method: POST
- URL: `https://api.deepseek.com/chat/completions`
- Body: 用 LLM 把 CRUD 结果转成自然语言回复

**节点 7 — HTTP Request (回复 WhatsApp)**
- Method: POST
- URL: `http://task-api:3000/api/send`
- Body: `{"phone": "{{phone}}", "message": "✅ 已创建..."}`

---

### Workflow 2: 每日提醒

**触发器**: Schedule Trigger (Cron)
- 时间: `0 9 * * *` (每天 09:00)

**节点 2 — HTTP Request (查询待办)**
- Method: GET
- URL: `http://task-api:3000/api/tasks?status=pending`

**节点 3 — Code Node (生成提醒文案)**
```javascript
const tasks = $input.first().json.tasks;
const highPri = tasks.filter(t => t.priority === 'high');
const overdue = tasks.filter(t => t.deadline && new Date(t.deadline) < new Date());

let msg = `📋 今日待办 (共 ${tasks.length} 项)\n`;
if (overdue.length) msg += `⚠️ 已逾期 ${overdue.length} 项\n`;
if (highPri.length) {
  msg += `\n🔥 高优先级:\n`;
  highPri.forEach(t => msg += `  ⭐ ${t.title}\n`);
}
msg += `\n💡 回复"完成 XXX" 标记完成`;

return { phone: process.env.MY_PHONE, message: msg };
```

**节点 4 — HTTP Request (发送 WhatsApp)**
- Method: POST
- URL: `http://task-api:3000/api/send`
- Body: `{"phone": "{{phone}}", "message": "{{message}}"}`

---

### Workflow 3: 周/月总结

**触发器**: Schedule Trigger (Cron)
- 周报: `0 20 * * 0` (周日 20:00)
- 月报: `0 20 1 * *` (每月1号 20:00)

**节点 2 — Switch Node (判断周/月)**
```
month() == 1 && day() == 1 → month
其他 → week
```

**节点 3 — HTTP Request (获取总结数据)**
- 周: GET `http://task-api:3000/api/tasks/summary?range=week`
- 月: GET `http://task-api:3000/api/tasks/summary?range=month`

**节点 4 — Code Node (格式化)**
```javascript
const data = $input.first().json;
let msg = `📊 任务总结 (${data.period})\n`;
msg += `完成 ${data.done}/${data.total} 项 (${data.completionRate}%)\n`;
if (data.overdue) msg += `⚠️ 逾期 ${data.overdue} 项\n`;
return { phone: process.env.MY_PHONE, message: msg };
```

**节点 5 — HTTP Request (发送)**
- POST `http://task-api:3000/api/send`

## n8n 与 WhatsApp Bridge 联动

n8n 的 Webhook URL 需要在 WhatsApp Bridge 中配置。

在 `.env` 中添加：
```
N8N_WEBHOOK_URL=https://your-n8n.up.railway.app/webhook/whatsapp-incoming
```

WhatsApp Bridge 收到消息后会 POST 到这个 URL，n8n 处理后通过 `POST /api/send` 回复。

## Railway 服务间通信

在 Railway 项目中，服务之间通过内部域名通信：
- n8n 服务内部域名: `http://n8n:5678`
- Task API 服务内部域名: `http://task-api:3000`

在 n8n 的 HTTP Request 节点中，Task API 地址填 `http://task-api:3000`（Railway 内部 DNS）

---

## 统一摘要 API 用法

更新后的 Task API 支持以下时间范围筛选：

| 方式 | 示例 URL | 说明 |
|------|----------|------|
| 本周 | `/api/tasks/summary?range=week` | 当前 ISO 周 |
| 本月 | `/api/tasks/summary?range=month` | 当前自然月 |
| 本季 | `/api/tasks/summary?range=quarter` | 当前季度 (Q1-Q4) |
| 本年 | `/api/tasks/summary?range=year` | 当前自然年 |
| 自定义 | `/api/tasks/summary?from=2025-01-01&to=2025-03-31` | 任意日期范围 |
| 默认 | `/api/tasks/summary` | 默认本周 |
