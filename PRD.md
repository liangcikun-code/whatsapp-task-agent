# PRD — Product Requirements Document

## 版本

v2.0 (2026-08-06)

---

## 1. 产品架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户交互层                             │
│                                                         │
│  WhatsApp 客户端                Web Dashboard            │
│  (发 /t 创建任务)               (管理/查看/编辑)          │
└──────────┬──────────────────────────┬───────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────┐  ┌───────────────────────────────┐
│   本地 Bridge 层      │  │       Railway 云端              │
│                      │  │                               │
│  Baileys v7          │  │  Task API (Express)            │
│  WhatsApp Web 协议   │  │  内置 DeepSeek AI 分析          │
│  消息过滤 (/t)       │  │  日期解析 (resolveRelativeDate) │
│  队列轮询            │  │  REST API (CRUD + 统计)        │
│  launchd 守护        │  │  静态文件 (Dashboard SPA)      │
└──────────────────────┘  └───────────┬───────────────────┘
                                      │
                                      ▼
                           ┌───────────────────────────────┐
                           │     Supabase (PostgreSQL)      │
                           │  tasks 表                      │
                           └───────────────────────────────┘
```

## 2. 功能规格

### 2.1 消息触发 (`/t` 命令)

| 属性 | 规格 |
|---|---|
| 触发前缀 | `/t` (小写 t) |
| 前缀处理 | Bridge 侧自动剥离，只发送 `/t` 之后的内容给 API |
| 消息来源 | 任何人 (包括自己发给自己的) |
| 白名单 | 可选，通过 `WHITELIST_PHONES` 环境变量限制 |
| 非 `/t` 消息 | 直接忽略，不消耗 API 调用 |

**示例:**

| 输入 | 是否触发 |
|---|---|
| `/t 明天下午3点开会` | ✅ |
| `/t 周五前把材料整理好 高优先级` | ✅ |
| `  /t 记得买菜` (前面有空格) | ✅ (trim 后匹配) |
| `明天下午3点开会` | ❌ |
| `/T 明天开会` (大写 T) | ❌ |

### 2.2 AI 任务提取

**模型:** DeepSeek Chat (`deepseek-chat`)

**输入:**
```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "你是WhatsApp任务管理助手。分析用户消息提取任务。今天2026-08-06(周四)。deadlineHint为用户原文时间描述。返回JSON..." },
    { "role": "user", "content": "周五前把dsp材料整理好" }
  ],
  "temperature": 0.1
}
```

**输出 (AI 返回):**
```json
{
  "action": "create",
  "title": "整理DSP材料",
  "priority": "medium",
  "deadline": null,
  "deadlineHint": "周五",
  "description": null
}
```

**后处理:**
- `deadlineHint` 由 `resolveRelativeDate()` 函数解析为实际日期
- "周五" + 今天周四 → `2026-08-07`
- 支持: "明天"/"后天"/"下周X"/"这周X"/"周末"/"月底"

### 2.3 任务数据模型

```sql
CREATE TABLE tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag         TEXT,           -- 可读序号 (00001, 00002...)
  title       TEXT NOT NULL,  -- 任务标题
  description TEXT,           -- 备注
  priority    TEXT DEFAULT 'medium',  -- high / medium / low
  status      TEXT DEFAULT 'pending', -- pending / done
  deadline    TIMESTAMPTZ,    -- 截止时间
  source      TEXT,           -- 'whatsapp'
  source_chat TEXT,           -- WhatsApp JID
  source_name TEXT,           -- WhatsApp 昵称
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### 2.4 Dashboard 功能

| 功能 | 操作 | 实现 |
|---|---|---|
| 查看任务列表 | GET /api/tasks | 按状态筛选 pending/done/all |
| 创建任务 | POST /api/tasks | 手动创建 (非 WhatsApp) |
| 编辑任务 | PATCH /api/tasks/:id | 标题/优先级/截止日/备注 |
| 标记完成 | POST /api/tasks/:id/done | 点击行即切换 |
| 删除任务 | DELETE /api/tasks/:id | 软删除或硬删除 |
| 统计 | GET /api/tasks/stats | 总数/待办/已完成/高优先级数 |

## 3. 接口规格

### 3.1 Bridge → Task API

```
POST /api/messages/incoming
Content-Type: application/json

{
  "from": "8614776384961",     // 发送者手机号
  "to": "8614776384961",       // JID
  "message": "周五前把材料整理好", // 已剥离 /t 前缀
  "pushName": "Cecilia"        // WhatsApp 昵称
}

Response: { "success": true }
```

### 3.2 消息队列 (Bridge 发送)

```
GET /api/queue/poll?since=2026-08-06T12:00:00Z
→ { "items": [{ "id": "msg_1", "phone": "86138...", "message": "..." }] }

POST /api/queue/ack
{ "id": "msg_1" }
→ { "success": true }
```

### 3.3 任务 CRUD

详见 [README.md](./README.md#api) 的 API 列表。

## 4. 部署规格

### 4.1 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SUPABASE_URL` | 是 | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | 是 | Supabase 匿名密钥 |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API Key |
| `PORT` | 否 | 服务端口 (默认 3000) |
| `WHITELIST_PHONES` | 否 | 逗号分隔的白名单号码 |
| `RAILWAY_API_URL` | 否 | Bridge 连接的目标 API (默认 Railway 域名) |
| `PROXY_URL` | 否 | 代理地址 (中国大陆需要) |

### 4.2 运行要求

| 组件 | 要求 |
|---|---|
| Bridge | Node.js ≥ 18, 能访问 WhatsApp 服务器 (需代理) |
| Task API | Railway 免费计划 |
| 数据库 | Supabase 免费计划 (500MB) |
| AI | DeepSeek API (注册即送 ¥10 额度) |

## 5. 非功能需求

### 5.1 性能

| 指标 | 目标 |
|---|---|
| 消息到 Dashboard 延迟 | < 3 秒 |
| API 响应时间 | < 500ms (p95) |
| Dashboard 首屏加载 | < 3 秒 |
| Bridge WebSocket 重连 | < 10 秒 |

### 5.2 安全

- Supabase RLS (Row Level Security) 保护数据
- DeepSeek API Key 仅在服务端，不暴露到前端
- Bridge 消息通过 HTTPS 传输
- 不存储 WhatsApp 消息原文 (只保留提取后的任务)

### 5.3 可靠性

- launchd KeepAlive 保证 Bridge 崩溃自动重启
- Task API 无状态设计 (状态全在 Supabase)
- DeepSeek API 不可用时不崩溃，返回 success (静默失败)

## 6. 用户流程

### 6.1 首次设置

```
1. Fork GitHub 仓库
2. Railway 部署 → 填 3 个环境变量
3. git clone + npm install → node bridge-pairing.js
4. WhatsApp 扫码配对
5. 发 /t 测试
6. cp plist → launchctl load (开机自启)

总耗时: ~10 分钟
```

### 6.2 日常使用

```
打开 WhatsApp → 发 /t 任务描述 → Dashboard 自动出现新任务 → 完成后打勾
```

## 7. 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2025-07 | 初版: Baileys + Dify + n8n |
| v2.0 | 2026-08 | 重构: 移除 n8n/Dify, 内置 DeepSeek, `/t` 触发, launchd 自启, 日期解析 |
