# WhatsApp Task Agent

**WhatsApp 聊天 → AI 自动提取待办 + 优先级排序 + Web Dashboard 管理**

用 WhatsApp 发 `/t` 命令来创建任务，AI 自动解析任务内容、优先级和截止时间，存入数据库，在 Web 面板统一管理。

---

## Demo

```
你在 WhatsApp 发:  /t 周五前把签证材料整理好
                        ↓
AI 自动提取:  📋 整理签证材料   ⚡ medium   📅 2026-08-07
                        ↓
Dashboard 实时显示，可打勾完成、编辑、筛选
```

---

## 架构

```
WhatsApp 消息
    │
    ▼
本地 Bridge (Baileys v7)  ← 你的 Mac/服务器，24h 在线
    │  只转发 /t 开头的消息
    ▼
Railway Task API (Express)
    │  内置 DeepSeek AI 分析 → 提取任务
    ▼
Supabase (PostgreSQL)
    │
    ▼
Web Dashboard  ← 管理面板
```

**没有 n8n，没有 Dify。** DeepSeek 直接内置在 Task API 里，少一层依赖，少一个故障点。

---

## 自己部署 (4 步)

### 你需要准备

- GitHub 账号
- Railway 账号 (免费额度够用)
- Supabase 账号 (免费额度够用)
- DeepSeek API Key ([platform.deepseek.com](https://platform.deepseek.com) 注册即送额度)
- 一台能 24h 开机的电脑 (Mac/Windows/Linux 都行，需要能翻墙连 WhatsApp)

### 1. Supabase 建表

在 Supabase SQL Editor 执行 `supabase/migration.sql`，记下 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`。

### 2. Railway 部署 Task API

- Fork 这个仓库
- 在 Railway 新建项目 → Deploy from GitHub → 选 fork 的仓库
- 添加环境变量：

| 变量 | 值 |
|---|---|
| `SUPABASE_URL` | 你的 Supabase URL |
| `SUPABASE_ANON_KEY` | 你的 Supabase anon key |
| `DEEPSEEK_API_KEY` | `sk-xxx` 你的 DeepSeek key |
| `MY_PHONE` | 你的 WhatsApp 手机号 (带国家码，如 `8613800000000`) |

- Railway 自动部署，记下生成的域名 (如 `xxx.up.railway.app`)

### 3. 启动本地 Bridge

```bash
# 克隆仓库到本地
git clone https://github.com/你的用户名/whatsapp-task-agent.git
cd whatsapp-task-agent

# 设置 Railway API 地址 (改成你 Railway 的域名)
export RAILWAY_API_URL=https://你的域名.up.railway.app

# 如果在中国大陆，需要代理连 WhatsApp
export PROXY_URL=http://127.0.0.1:7897

# 启动 Bridge (把手机号换成你的)
node src/bridge-pairing.js 8613800000000
```

终端会出现二维码或配对码，在手机上 **WhatsApp → 设置 → 已关联设备** 扫码/输入配对码完成关联。

### 4. macOS 开机自启 (推荐)

配对成功后，把 Bridge 设为开机自动启动，就不用每次手动开终端了。

1. 编辑仓库里的 `com.whatsapp.bridge.plist`，改 3 个地方：
   - node 路径 → `which node` 看你的 node 在哪
   - 仓库路径 → 你的 `pwd`（必须是绝对路径）
   - 手机号 → 改成你的号码
   - 如果不需要代理，删掉 `PROXY_URL` 那一节

2. 复制到 LaunchAgents 并加载：
```bash
cp com.whatsapp.bridge.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.whatsapp.bridge.plist
```

以后每次开机，Bridge 自动后台启动，**不需要再扫码配对**（会话凭据已保存）。

---

## 使用

### 创建任务

在 WhatsApp 给**任何人**（包括自己）发消息，以 `/t` 开头：

```
/t 明天下午3点跟客户开会
/t 周五前把材料整理好
/t 下周三之前完成报告 高优先级
```

### Dashboard 管理

打开 `https://你的域名.up.railway.app/dashboard.html`：

- 点击行 → 打勾完成
- **+ 新建任务** → 手动添加
- **编辑** → 修改标题/优先级/截止日/备注
- 搜索框 → 筛选任务
- 日程配置 → 开关提醒

### 触发规则

| 消息 | 是否处理 |
|---|---|
| `/t 明天开会` | ✅ AI 分析创建任务 |
| `/t 把报告写完 高优先级` | ✅ |
| `明天开会` (没有 /t) | ❌ 忽略 |
| 你自己发给自己的 `/t 记得买菜` | ✅ 支持自己给自己发 |

---

## API

| 端点 | 说明 |
|---|---|
| `GET /api/tasks` | 任务列表 |
| `POST /api/tasks` | 创建任务 |
| `PATCH /api/tasks/:id` | 更新任务 |
| `POST /api/tasks/:id/done` | 标记完成 |
| `DELETE /api/tasks/:id` | 删除 |
| `GET /api/tasks/stats` | 统计 |
| `GET /api/tasks/summary?range=week` | 周/月总结 |
| `POST /api/messages/incoming` | Bridge 转发消息 |
| `GET /api/queue/poll` | Bridge 轮询待发消息 |
| `POST /api/queue/send` | 入队待发消息 |

---

## 成本

| 服务 | 费用 |
|---|---|
| Railway | 免费额度 ($5/月，够用) |
| Supabase | 免费额度 (500MB) |
| DeepSeek API | ~¥0.002/条消息 |
| 本地电脑 | 电费 |

**每月总成本 < ¥5**（假设每天 10-20 条 /t 消息）。

---

## License

MIT
