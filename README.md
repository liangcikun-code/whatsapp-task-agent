# WhatsApp Task Agent

**WhatsApp 聊天 → AI 自动提取待办 + 优先级排序 + 定时提醒 + 周/月总结 + Web Dashboard**

双通道任务管理：**WhatsApp 做输入+提醒**，**Web Dashboard 做管理+概览**。

## 系统架构

```
WhatsApp 用户
      │
      ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  本地 Bridge      │────▶│  Railway Task API │────▶│  n8n Workflow     │
│  (Baileys v7)    │◀────│  (Express)        │◀────│  (AI 处理+CRUD)   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
      │                          │                        │
      ▼                          ▼                        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  WhatsApp 收发    │     │  Web Dashboard   │     │  Supabase         │
│  (消息队列轮询)    │     │  (纯前端 SPA)    │     │  (PostgreSQL)     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

## 双通道使用

| 通道 | 用途 | 场景 |
|------|------|------|
| **WhatsApp** | 输入 + 提醒 | 自然聊天创建任务、快速查询、随手标记完成、接收推送 |
| **Web Dashboard** | 管理 + 概览 | 任务看板（按优先级分组）、一键创建/完成/删除、日程配置开关 |

## 核心功能

| 功能 | 说明 |
|------|------|
| **自动提取任务** | AI 分析聊天内容，自动识别待办事项，支持中文自然语言 |
| **AI 优先级排序** | 根据截止日期、紧急性、来源自动分配 high/medium/low |
| **双通道管理** | WhatsApp 输入+提醒，Web Dashboard 管理+概览 |
| **标记完成** | 发一句"做完了"或点击 Dashboard 一键完成 |
| **每日提醒** | 每天早上 09:00 推送今日待办（含逾期提醒） |
| **每周总结** | 周日 20:00 推送周度任务完成情况报告 |
| **每月总结** | 每月 1 号 20:00 推送月度回顾（可选） |
| **日程配置** | Dashboard 一键开关：早报/晚报/周报/月报 |
| **Web Dashboard** | 纯前端 SPA，连接 Task API，按优先级分组展示 |
| **REST API** | Express 服务供 n8n/外部系统 通过 HTTP 调用 |

## 日程提醒策略

默认只开启高频价值推送，低频推送让用户自己选：

| 推送 | 时间 | 默认 |
|------|------|------|
| 每日早报 | 09:00 — 今日到期+逾期提醒 | ✅ 开启 |
| 每日晚报 | 21:00 — 今日创建+明日待办 | ❌ 关闭 |
| 周报 | 周日 20:00 — 本周完成率+下周待办 | ✅ 开启 |
| 月报 | 次月 1 号 20:00 — 月度回顾+趋势 | ❌ 关闭 |

通过 Web Dashboard 或 `PATCH /api/schedule/config` 开关。

## 快速开始

### 前置要求

- **Node.js 18+**（推荐 20+）
- **Railway 账号**（部署 API）+ **Supabase 账号**（数据库）
- **n8n** (Railway 上运行，或自建) — AI 处理引擎
- **本地机器** — 运行 WhatsApp Bridge (Baileys)

### 1. 创建 Supabase 数据库

1. 登录 [supabase.com](https://supabase.com) → 创建项目（免费）
2. 进入 **SQL Editor** → 复制粘贴 `supabase/migration.sql` → 运行
3. 进入 **Settings → API** → 复制 `Project URL` 和 `anon public key`

### 2. 部署 Task API 到 Railway

1. 将本项目推送到 GitHub 仓库
2. 登录 [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. 设置环境变量：

| 变量 | 值 |
|------|-----|
| `SUPABASE_URL` | 从 Supabase 复制 |
| `SUPABASE_ANON_KEY` | 从 Supabase 复制 |
| `N8N_WEBHOOK_URL` | n8n webhook URL（消息处理） |
| `MY_PHONE` | 接收定时提醒的手机号 |
| `RAILWAY_PUBLIC_DOMAIN` | Railway 自动生成 |

4. Railway 自动检测 Dockerfile 并构建部署

### 3. 配置 n8n Workflow

详见 `n8n-workflows/README.md`。需要创建 3 个 workflow：
- **WhatsApp 消息处理** — Webhook 接收 → Code node → Task CRUD → 回复队列
- **WhatsApp 每日提醒** — Cron 每天 09:00 → 查询待办 → 发送提醒
- **WhatsApp 周月总结** — Cron 每天 20:00 → 周日=周报，1号=月报

### 4. 启动本地 Bridge

```bash
cd whatsapp-task-agent
npm install
PROXY_URL=http://127.0.0.1:7897 \
RAILWAY_API_URL=https://task-api-production-xxxx.up.railway.app \
node src/bridge-pairing.js 86xxxxxxxxxxx
```

终端会显示配对码，在手机 WhatsApp 上输入完成登录。

### 5. 打开 Web Dashboard

浏览器访问 `https://task-api-production-xxxx.up.railway.app/dashboard.html`

或者本地开发时：`http://localhost:3000/dashboard.html`

## 本地开发

```bash
# 复制配置
cp .env.example .env
# 编辑 .env 填入 SUPABASE_URL, SUPABASE_ANON_KEY 等

# 安装依赖
npm install

# 启动（只启动 API，不连 WhatsApp）
npm start

# 打开 Dashboard
open http://localhost:3000/dashboard.html
```

## 项目结构

```
whatsapp-task-agent/
├── src/
│   ├── index.js            # 入口：启动 API + 调度器
│   ├── config.js           # 配置加载 (env vars)
│   ├── whatsapp.js         # WhatsApp 桥接 (Baileys v7)
│   ├── task-store.js       # 任务存储 (Supabase PostgreSQL)
│   ├── server.js           # Express API + 静态文件服务
│   ├── scheduler.js        # 定时任务调度 (node-cron)
│   ├── send-queue.js       # 消息发送队列
│   ├── schedule-config.js  # 日程配置持久化
│   ├── bridge-pairing.js   # 本地 Bridge (配对码登录)
│   └── phone-helper.js     # 手机号格式处理
├── public/
│   └── dashboard.html      # Web Dashboard (纯前端 SPA)
├── n8n-workflows/
│   └── README.md           # n8n 工作流设计文档
├── supabase/
│   └── migration.sql       # 数据库建表脚本
├── dify-agent/
│   ├── system-prompt.md    # Dify Agent 系统提示词 (legacy)
│   └── workflow-design.md  # Workflow 设计文档 (legacy)
├── data/
│   ├── schedule.json       # 日程配置
│   └── auth/               # WhatsApp 登录凭证
├── Dockerfile
├── package.json
└── README.md
```

## API 端点

### 任务 CRUD

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/tasks` | 列出任务 (?status=pending&priority=high) |
| `POST` | `/api/tasks` | 创建任务 |
| `GET` | `/api/tasks/:id` | 获取单个任务 |
| `PATCH` | `/api/tasks/:id` | 更新任务 |
| `POST` | `/api/tasks/:id/done` | 标记完成 |
| `DELETE` | `/api/tasks/:id` | 删除任务 |

### 统计 & 总结

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/tasks/stats` | 任务统计 (total/done/pending) |
| `GET` | `/api/tasks/summary?range=week` | 周/月/季/年总结 |
| `GET` | `/api/tasks/summary?from=...&to=...` | 自定义日期范围 |

### 消息队列

| 方法 | 端点 | 说明 |
|------|------|------|
| `POST` | `/api/queue/send` | 入队消息 (n8n/scheduler → Bridge) |
| `GET` | `/api/queue/poll` | 轮询待发送消息 (Bridge → 队列) |
| `POST` | `/api/queue/ack` | 确认已发送 |
| `POST` | `/api/messages/incoming` | 接收 WhatsApp 消息 (Bridge → API) |

### 日程配置

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/schedule/config` | 获取日程开关配置 |
| `PATCH` | `/api/schedule/config` | 更新开关 (`{"morningReport":false}`) |
| `POST` | `/api/schedule/config/reset` | 重置为默认值 |

### 健康检查

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |

## 手动测试 API

```bash
# 创建任务
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"测试任务","priority":"high","deadline":"2026-08-01T10:00:00Z"}'

# 列出待办
curl http://localhost:3000/api/tasks?status=pending

# 标记完成
curl -X POST http://localhost:3000/api/tasks/xxxxx/done

# 获取日程配置
curl http://localhost:3000/api/schedule/config

# 切换晚报开关
curl -X PATCH http://localhost:3000/api/schedule/config \
  -H "Content-Type: application/json" \
  -d '{"eveningReport":true}'
```

## 部署成本

| 服务 | 月费 | 用途 |
|------|------|------|
| Railway Free | ¥0 | Task API (500h/月) |
| Supabase Free | ¥0 | PostgreSQL (500MB) |
| n8n (Railway self-host) | ¥0 | AI 工作流引擎 |
| DeepSeek API | ¥10-30 | LLM 推理（按量） |
| **总计** | **¥10-30/月** | |

## Roadmap

- [x] WhatsApp 消息收发 (Baileys)
- [x] n8n + Task API + Supabase 混合架构
- [x] 任务 CRUD + 优先级排序
- [x] 每日提醒 + 周/月总结定时推送
- [x] 日程配置开关 (早报/晚报/周报/月报)
- [x] Web Dashboard（任务看板+日程配置）
- [ ] WhatsApp 消息接收修复 (Baileys v7 messages.upsert)
- [ ] 多用户支持（群聊分析）
- [ ] 导出任务到 Todoist / Notion
- [ ] Dify Workflow 版本（替代 Agent 模式）

## License

MIT
