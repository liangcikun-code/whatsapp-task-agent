# SDD — Solution Design Document

## 项目名称

WhatsApp Task Agent v2.0

## 版本

2026-08-06

---

## 1. 技术选型

### 1.1 总体决策原则

- **零成本优先**: 免费额度能覆盖的场景，不引入付费服务
- **极简依赖链**: 每少一个服务，就少一个故障点
- **本地 + 云端混合**: 需要常驻网络连接的部分放本地，需要稳定在线的部分放云端

### 1.2 选型对比

#### WhatsApp 接入层

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| WhatsApp Business API (官方) | 合规、稳定 | 需要 FB 企业认证、月费、审核周期长 | ❌ 个人开发者门槛高 |
| Twilio WhatsApp API | 托管式 | 每条消息收费、国内不方便 | ❌ 贵且慢 |
| **Baileys v7** (开源 Web 协议) | 免费、功能完整、WebSocket 直连 | 非官方 API、有封号风险 | ✅ 选型 |

#### AI 引擎

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Dify | 工作流可视化 | 多一层部署、免费版限流 | ❌ v1.0 用到，v2.0 移除 |
| n8n | 自动化工作流 | 配置复杂、不可靠 | ❌ v1.0 用到，v2.0 移除 |
| **DeepSeek API 直调** | 最简链路、国产、便宜 | 无工作流 UI | ✅ 选型 |

#### 云平台

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Vercel | 静态+Serverless | 不支持 WebSocket 长连接 | ❌ |
| **Railway** | 支持长连接、免费额度、GitHub 自动部署 | 冷启动稍慢 | ✅ 选型 |

#### 数据库

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| SQLite | 零配置 | 不适合云端多实例 | ❌ |
| MongoDB Atlas | 免费 512MB | NoSQL 不适合任务管理 | ❌ |
| **Supabase** | PostgreSQL + 免费 500MB + REST API | 偶尔冷启动 | ✅ 选型 |

#### 进程守护 (本地)

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| pm2 | Node.js 生态 | 需额外安装 | ❌ |
| systemd | Linux 标准 | 不支持 macOS | ❌ |
| **launchd** | macOS 原生、零安装、KeepAlive | 仅 macOS | ✅ 选型 |

#### 代理方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| Clash TUN 模式 | 全局透明代理 | 配置复杂、影响其他应用 | ❌ |
| **Clash 混合端口 + hpagent** | 仅 Bridge 走代理、不影响其他 | 需要 Clash 在运行 | ✅ 选型 |

---

## 2. 技术栈总览

```
┌─────────────────────────────────────────────────┐
│                   前端                           │
│  Dashboard: Vanilla JS + HTML5 + CSS3           │
│  零框架、零构建、纯静态 SPA                       │
├─────────────────────────────────────────────────┤
│                   后端                           │
│  Task API: Node.js 22 + Express.js              │
│  AI 引擎: DeepSeek Chat API (直调 HTTP)          │
│  进程守护: macOS launchd                        │
├─────────────────────────────────────────────────┤
│                   数据                           │
│  Supabase PostgreSQL (cloud)                    │
│  Baileys Auth State (本地 filesystem)            │
├─────────────────────────────────────────────────┤
│                   网络                           │
│  Bridge → WhatsApp: WebSocket over Clash Proxy  │
│  Bridge → Task API: HTTPS                      │
│  Task API → DeepSeek: HTTPS                    │
│  Task API → Supabase: HTTPS                    │
└─────────────────────────────────────────────────┘
```

### 依赖清单

| 包 | 版本 | 用途 |
|---|---|---|
| `@whiskeysockets/baileys` | ^7.0.0-rc14 | WhatsApp Web 协议实现 |
| `express` | ^4.21 | HTTP 框架 |
| `@supabase/supabase-js` | ^2.110 | 数据库客户端 |
| `hpagent` | latest | HTTP CONNECT 代理 (WebSocket 兼容) |
| `qrcode-terminal` | latest | 终端显示 QR 码 |
| `axios` | latest | Bridge 端 HTTP 请求 (动态 import) |
| `pino` | latest | 结构化日志 (Bridge 端) |
| `dayjs` | latest | 日期处理 |
| `node-cron` | latest | 定时任务调度 |
| `ws` | latest | WebSocket |

---

## 3. 架构设计

### 3.1 消息处理链路

```
WhatsApp 消息到达
    │
    ▼
Baileys messages.upsert 事件
    │
    ├─ fromMe? ────────────── NO ──→ 检查白名单
    │                                  │
    └─ 提取 rawText                     ├─ 不在白名单 → 丢弃
       │                                └─ 在白名单 → 继续
       ├─ 不以 /t 开头 → 丢弃
       │
       └─ 以 /t 开头 → 剥离前缀 → 提取纯文本
                                        │
                                        ▼
                              POST /api/messages/incoming
                                        │
                                        ▼
                              DeepSeek AI 分析
                              (system prompt + 当前日期)
                                        │
                                        ▼
                              解析 AI 返回 JSON
                              { action, title, priority, deadline, deadlineHint }
                                        │
                                        ▼
                              resolveRelativeDate()
                              "周五" + 今天周四 → 2026-08-07
                                        │
                                        ▼
                              createTask() → Supabase INSERT
                                        │
                                        ▼
                              Dashboard 实时刷新
```

### 3.2 消息队列 (Bridge 发送)

当系统需要向 WhatsApp 发送消息时 (后续版本的提醒功能):

```
Scheduler → POST /api/queue/send → 消息入队 (内存)
                                        │
Bridge 每 3s 轮询 ← GET /api/queue/poll ←┘
    │
    ▼
sendWhatsApp(jid, text)
    │
    ▼
POST /api/queue/ack { id }  → 标记已发送
```

### 3.3 数据流方向

```
读路径:  Dashboard → Task API → Supabase → JSON → 渲染
写路径:  WhatsApp → Bridge → Task API → DeepSeek → Supabase
```

---

## 4. 核心模块设计

### 4.1 Bridge (`src/bridge-pairing.js`)

```
connectWhatsApp(phoneNumber)
  ├── useMultiFileAuthState()      // 会话持久化
  ├── makeWASocket({ agent })      // 创建 WebSocket (过代理)
  ├── connection.update 事件
  │     ├── QR → 尝试配对码 / 显示 QR
  │     ├── open → 打印已连接
  │     └── close → 10s 后重连 (除非 401)
  ├── messages.upsert 事件
  │     └── /t 前缀检查 → POST /api/messages/incoming
  ├── creds.update → 保存凭据
  └── setInterval(pollAndSend, 3s)  // 出站消息轮询
```

### 4.2 Task API (`src/server.js`)

```
Express App
  ├── /api/health                   → 健康检查
  ├── /api/messages/incoming        → 消息处理 (含 DeepSeek)
  ├── /api/tasks                    → 任务 CRUD
  ├── /api/tasks/stats              → 统计
  ├── /api/tasks/summary            → 摘要
  ├── /api/queue/send               → 消息入队
  ├── /api/queue/poll               → 消息出队
  ├── /api/queue/ack                → 确认已发
  ├── /api/schedule/config          → 日程配置
  └── static (public/)              → Dashboard SPA
```

### 4.3 DeepSeek 集成 (`resolveRelativeDate` + `createTask`)

```
AI 系统提示:
  "你是 WhatsApp 任务管理助手。
   今天是 2026-08-06 (周四)。
   返回 JSON: { action, title, priority, deadline, deadlineHint }"

日期解析规则:
  输入               → 输出
  "周五"             → 这周五 = 明天 (天+1)
  "下周三"           → 下周 (天+7)
  "明天"             → 天+1
  "后天"             → 天+2
  "周末"             → 本周六
  "月底"             → 本月最后一天
  "8月15号"          → AI 直接返回 YYYY-MM-DD
  
  currentDay + daysUntil = targetDay
  if (daysUntil <= 0 && !下周) daysUntil += 7  // 未来的同一天
```

### 4.4 数据层 (`src/task-store.js`)

```
Supabase Client
  ├── createTask({title, priority, deadline, source, ...})
  │     → generateTag() → INSERT → SELECT → mapTask()
  ├── listTasks({status, priority})
  │     → SELECT (with filters) → mapTask() × N
  ├── getTask(id) → SELECT by id
  ├── updateTask(id, updates) → UPDATE → SELECT
  ├── completeTask(id) / uncompleteTask(id)
  ├── deleteTask(id) → DELETE
  └── getStats() / getWeeklySummary() / getMonthlySummary()
        → SQL aggregations (COUNT, GROUP BY, date ranges)
```

---

## 5. 部署架构

### 5.1 物理拓扑

```
┌─────────────────────────────────────────┐
│              用户 Mac                    │
│                                         │
│  Clash Verge (7897 mixed-port)          │
│       ↓ 代理 WebSocket                  │
│  Bridge (launchd 守护, 崩溃自动重启)     │
│       ↓ HTTPS                           │
│  WhatsApp Server (via proxy)            │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────────┐   ┌──────────────┐
│  Railway     │   │  DeepSeek     │
│  Task API    │──→│  API          │
│  (Express)   │   │  (HTTPS)      │
└──────┬───────┘   └──────────────┘
       │
       ▼
┌─────────────┐
│  Supabase    │
│  PostgreSQL  │
└─────────────┘
```

### 5.2 环境变量映射

```
Railway 端 (Task API):
  SUPABASE_URL          → Supabase 连接
  SUPABASE_ANON_KEY     → Supabase 认证
  DEEPSEEK_API_KEY      → DeepSeek 认证
  PORT                  → 3000

本地 Bridge:
  PROXY_URL             → http://127.0.0.1:7897 (Clash)
  RAILWAY_API_URL       → https://xxx.up.railway.app
```

### 5.3 启动顺序

```
1. Clash Verge 启动 (系统代理)
2. launchd 自动拉起 Bridge
3. Bridge 读取 data/auth/ 会话凭据
4. WebSocket 连接 WhatsApp (通过 Clash 代理)
5. 连接成功 → 开始监听消息 & 轮询队列
6. Railway Task API 已就绪 (GitHub push 自动部署)
```

---

## 6. 安全设计

| 层级 | 措施 |
|---|---|
| 传输 | 全链路 HTTPS (Bridge→API, API→DeepSeek, API→Supabase) |
| 认证 | DeepSeek Key 仅存 Railway 环境变量，不暴露到前端 |
| 数据 | Supabase RLS 限制表访问 |
| 输入 | AI 输出 JSON 解析有 try-catch 保护 |
| 日志 | 不记录完整消息内容 (仅前 80 字符) |
| 会话 | Baileys auth 文件仅本地存储，不上传 |

## 7. 容错设计

| 故障场景 | 处理 |
|---|---|
| Bridge 崩溃 | launchd KeepAlive 自动重启 |
| WhatsApp WebSocket 断开 | Baileys 自动重连 (10s 间隔) |
| DeepSeek API 超时 | 30s timeout, 消息不丢失 (返回 success) |
| Railway 冷启动 | 等待 30s-60s 即可恢复 |
| Supabase 不可用 | Task API 返回 500, Dashboard 显示错误 |
| 代理断开 | Bridge 离线, 消息在 WhatsApp 服务器排队 |

## 8. 性能指标

| 指标 | 目标 | 实测 |
|---|---|---|
| 消息→Dashboard 延迟 | < 3s | ~1.5s |
| API 响应 (健康检查) | < 100ms | ~50ms |
| Dashboard 首屏 | < 3s | ~1s |
| Bridge 重连 | < 10s | ~5s (取决于代理) |
| 数据库查询 | < 200ms | ~80ms |
