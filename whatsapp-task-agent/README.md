# WhatsApp Task Agent

**WhatsApp 聊天记录 → AI 自动待办清单 + 优先级排序 + 定时提醒 + 周/月总结**

基于 **Dify (AI Agent)** + **Baileys (WhatsApp 协议)** 构建的个人任务管理助手。

## 系统架构

```
你的 WhatsApp 对话
      │
      ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  WhatsApp Bridge │────▶│   Dify Cloud    │────▶│  AI Agent 分析   │
│  (Baileys)      │◀────│  (api.dify.ai)  │◀────│  + 任务提取     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
      │                                                │
      ▼                                                ▼
┌─────────────────┐                          ┌─────────────────┐
│  定时提醒        │                          │  本地 Task API   │
│  周/月总结       │◀────────────────────────│  (task-store)   │
│  (node-cron)    │                          │  任务 CRUD      │
└─────────────────┘                          └─────────────────┘
```

## 核心功能

| 功能 | 说明 |
|------|------|
| **自动提取任务** | AI 分析聊天内容，自动识别待办事项，支持中文自然语言 |
| **AI 优先级排序** | 根据截止日期、紧急性、来源自动分配 high/medium/low |
| **聊天记录持久化** | 记住每个用户的对话上下文，持续跟踪任务 |
| **标记完成** | 发一句"做完了"就能标记完成，AI 自动匹配 |
| **每日提醒** | 每天早上推送今日待办（含逾期提醒） |
| **每周总结** | 每周末推送周度任务完成情况报告 |
| **每月总结** | 每月初推送月度任务统计 |
| **本地 API** | Express 服务供 Dify Agent 通过 HTTP Tool 调用 |

## 快速开始

### 前置要求

- **Node.js 18+** （推荐 20+）
- **一个 WhatsApp 账号**（用于登录 Baileys）
- **Dify Cloud 账号**（[dify.ai](https://dify.ai) 注册免费）

### 1. 注册 Dify Cloud

1. 访问 [https://dify.ai](https://dify.ai) 注册
2. 创建新应用 → **Chatbot** → **Agent 模式**
3. 选择模型（推荐 GPT-4o 或 Claude 3.5 Sonnet）
4. 复制 `dify-agent/system-prompt.md` 的全部内容 → 粘贴到 **系统提示词**
5. 添加 **HTTP 工具**（参考 `dify-agent/system-prompt.md` 中的工具表）
6. 点击 **发布** → **API 访问** → 复制 **API Key**

### 2. 下载并配置本项目

```bash
# 克隆或复制项目
cd whatsapp-task-agent
cp .env.example .env

# 编辑 .env，填入 DIFY_API_KEY
# DIFY_API_KEY=app-xxxxxxxxxxxx

# 安装依赖
npm install

# 启动
npm start
```

### 3. 扫码登录 WhatsApp

启动后终端会显示一个 **QR 码**，打开手机 WhatsApp → 设置 → 已登录设备 → 扫描二维码。

### 4. 开始使用

扫码成功后，给 **你自己** 发 WhatsApp 消息试试：

```
帮我记住下周五要交季度报告
→ ✅ 已创建任务：准备并提交季度报告（优先级：高，截止：下周五）

我有哪些待办
→ 📋 当前待办共 3 项：...

做完了，报告已交了
→ ✅ 已完成：准备并提交季度报告（剩余待办 2 项）

这周总结
→ 📊 本周完成 5/8 项任务，完成率 62.5%
```

## 项目结构

```
whatsapp-task-agent/
├── src/
│   ├── index.js         # 入口：启动所有服务
│   ├── config.js        # 配置加载
│   ├── whatsapp.js      # WhatsApp 桥接 (Baileys)
│   ├── dify-client.js   # Dify API 客户端
│   ├── task-store.js    # 本地任务存储
│   ├── scheduler.js     # 定时任务调度
│   └── server.js        # Express API 服务
├── dify-agent/
│   ├── system-prompt.md  # Dify Agent 系统提示词
│   └── workflow-design.md # Workflow 设计文档
├── data/
│   ├── tasks.json       # 任务数据
│   └── auth/            # WhatsApp 登录凭证
├── .env.example
├── package.json
└── README.md
```

## Railway + Supabase 部署（团队共享方案）

### 架构

```
┌─ Supabase (免费) ──────────────────────┐
│  PostgreSQL: tasks + conversations      │
└─────────────────────────────────────────┘
           ▲ API calls
           │
┌─ Railway (免费 500h/月) ───────────────┐
│  Docker 容器运行:                       │
│  ├─ WhatsApp Bridge (Baileys)          │
│  ├─ Express Task API                   │
│  └─ Node-Cron 调度器                    │
└─────────────────────────────────────────┘
           ▲ WhatsApp 消息
           │
      WhatsApp 用户（你和你的同事）
```

**费用：约 ¥0-40/月**（Railway 免费版 + Supabase 免费版 + DeepSeek API 按量付费）

### 第一步：创建 Supabase 数据库

1. 登录 [supabase.com](https://supabase.com) → 创建项目（免费）
2. 进入 **SQL Editor** → 复制粘贴 `supabase/migration.sql` → 运行
3. 进入 **Settings → API** → 复制 `Project URL` 和 `anon public key`
4. 填入本项目的 `.env` 文件的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`

### 第二步：部署到 Railway

1. 将本项目推送到 GitHub 仓库（或直接上传源码）
2. 登录 [railway.app](https://railway.app)
3. 点击 **New Project** → **Deploy from GitHub repo**
4. 选择你的仓库
5. 在 Railway Dashboard 中设置 **Environment Variables**：

| 变量 | 值 |
|---|---|
| `SUPABASE_URL` | 从 Supabase 复制 |
| `SUPABASE_ANON_KEY` | 从 Supabase 复制 |
| `DIFY_API_KEY` | 从 Dify Cloud 复制 |
| `RAILWAY_PUBLIC_DOMAIN` | Railway 会自动生成 |
| `WHITELIST_PHONES` | 可选，限制号码 |

6. Railway 会自动检测 Dockerfile 并构建部署
7. 首次构建后，点击 **Generate Domain** 获取公网 URL

### 第三步：登录 WhatsApp

部署成功后：
1. 在 Railway Dashboard 打开 **Deploy Logs**
2. 你会看到 QR 码日志（Railway 的 Web 终端可以显示）
3. 用手机 WhatsApp 扫码（设置 → 已登录设备 → 扫描）
4. 状态变为 `✅ WhatsApp 已连接`

### 第四步：配置 Dify 指向 Railway

在 Dify Agent 的 HTTP 工具配置中，将 URL 从 `http://localhost:3000/api/...` 改为你的 Railway 域名：

```
https://your-app.up.railway.app/api/tasks
```

### 第五步：本地测试验证

在本地终端测试 API 是否在线：
```bash
curl https://your-app.up.railway.app/api/health
# 返回: {"status":"ok","uptime":1234}
```

### 注意事项

- **Railway 免费版** 每月 500 小时（约 21 天持续运行），如果掉线了不用慌，重新 deploy 即可
- **WhatsApp 登录状态** 存在 `data/auth/` 目录，Railway 重启后会丢失，需要重新扫码。解决方案：
  - 设置 Railway 的 **Persistent Volume**（免费版不支持）
  - 或者使用云存储（如 Supabase Storage）保存 auth 文件
- 生产环境建议升级到 Railway **Developer 计划**（$5/月）获得持久存储和 24/7 运行

### 成本总结

| 服务 | 月费 | 用途 |
|---|---|---|
| Supabase Free | ¥0 | PostgreSQL 数据库（500MB） |
| Railway Free | ¥0 | 运行服务（500h/月） |
| Dify Cloud Free/Pro | ¥0-400 | AI Agent（200 msg/月免费） |
| DeepSeek API | ¥10-30 | LLM 推理（按量） |
| **总计** | **¥10-430/月** | 视使用量而定 |
## 高级配置

### 白名单模式

只处理指定号码的消息，在 `.env` 中设置：
```
WHITELIST_PHONES=+8613800000000,+8613900000000
```

### 自定义提醒时间

```
# 每日提醒
DAILY_REMINDER_TIME=09:00
# 周报（周日晚上）
WEEKLY_SUMMARY_DAY=0
WEEKLY_SUMMARY_TIME=20:00
# 月报（每月1号晚上）
MONTHLY_SUMMARY_DAY=1
MONTHLY_SUMMARY_TIME=20:00
```

### 让 Dify Cloud 访问本地 API

Dify Cloud 无法直接访问 `localhost`。使用 **ngrok** 暴露本地服务：

```bash
# 安装 ngrok（https://ngrok.com）
ngrok http 3000
# 将 Dify 工具配置的 URL 替换为 ngrok 提供的 https://xxxx.ngrok-free.app
```

或者部署到云服务器。

## 手动测试 API

无需 WhatsApp，你也可以直接用 curl 测试任务 API：

```bash
# 创建任务
curl -X POST http://localhost:3000/api/tasks   -H "Content-Type: application/json"   -d '{"title":"测试任务","priority":"high","deadline":"2025-07-30T10:00:00Z"}'

# 列出待办
curl http://localhost:3000/api/tasks?status=pending

# 标记完成
curl -X POST http://localhost:3000/api/tasks/xxxxx/done

# 周总结
curl http://localhost:3000/api/tasks/summary/weekly
```

## Roadmap

- [x] WhatsApp 消息收发 (Baileys)
- [x] Dify Agent 集成
- [x] 任务 CRUD + 优先级排序
- [x] 每日提醒 + 周/月总结定时推送
- [ ] 多用户支持（群聊分析）
- [ ] 导出任务到 Todoist / Notion
- [ ] Web Dashboard（任务可视化看板）
- [ ] Dify Workflow 版本（替代 Agent 模式）

## License

MIT
