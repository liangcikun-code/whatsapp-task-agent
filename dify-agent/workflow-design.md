# Dify Workflow 设计文档

## 架构总览

Dify Agent 是系统的"大脑"，负责所有的 AI 推理工作。
本地 WhatsApp Bridge + Task API 是"神经"和"记忆"，负责通信和持久化。

## 流程设计

### 1. 消息处理流程 (Chatflow)

```
用户 WhatsApp 消息
     │
     ▼
WhatsApp Bridge (Baileys)
     │
     ▼
Dify Chat-messages API ──────────────────────────────────────┐
     │                                                        │
     ▼                                                        │
Dify Agent (系统提示词 + LLM)                                  │
     │                                                        │
     ├─ 分析消息内容 → 判断是否包含任务                          │
     ├─ 如果是任务 → 调用 HTTP Tool: POST /api/tasks            │
     ├─ 如果是查询 → 调用 HTTP Tool: GET /api/tasks             │
     ├─ 如果是完成 → 调用 HTTP Tool: POST /api/tasks/:id/done   │
     ├─ 如果是总结 → 调用 HTTP Tool: GET /api/tasks/summary/... │
     │                                                        │
     ▼                                                        │
Dify 生成回复 ────────────────────────────────────────────────┘
     │
     ▼
WhatsApp Bridge → 发送回复到用户 WhatsApp
```

### 2. 定时任务流程

```
Node-Cron 调度器
     │
     ├─ 每日提醒 (09:00)
     │    ├─ 读取本地 task-store
     │    ├─ 生成今日待办文本
     │    └─ 通过 Baileys 发送 WhatsApp 消息
     │
     ├─ 每周总结 (周日 20:00)
     │    ├─ 读取本周完成/未完成 tasks
     │    ├─ 生成周报 Markdown 文本
     │    └─ 通过 Baileys 发送
     │
     └─ 每月总结 (1号 20:00)
          ├─ 读取本月完成/未完成 tasks
          ├─ 生成月报 Markdown 文本
          └─ 通过 Baileys 发送
```

### 3. Dify Agent 提示词策略

使用 Agent 模式（非 Chatflow 模式），因为需要：
- 灵活的 LLM 推理调用来决定何时调用哪个工具
- 上下文理解（区分"做完了"和"帮我做"）
- 自然语言回复生成

## 在 Dify 中的具体配置步骤

### Step 1: 创建应用
1. 登录 [dify.ai](https://dify.ai)
2. 点击 "创建应用" → 选择 **Chatbot**
3. 选择 **Agent** 模式（非 Chatflow）
4. 选择模型：推荐 GPT-4o 或 Claude 3.5 Sonnet（中文任务表现优秀）

### Step 2: 设置系统提示词
1. 将 `dify-agent/system-prompt.md` 中的内容复制到 "系统提示词" 框
2. 根据你的使用场景微调示例部分

### Step 3: 添加 HTTP 工具
1. 在 Agent 配置页面点击 "添加工具" → "HTTP 工具"
2. 逐个添加以下工具：

| 工具名 | 方法 | URL | 说明 |
|--------|------|-----|------|
| create_task | POST | http://localhost:3000/api/tasks | Body: {"title":"...","priority":"high","deadline":"...","source":"whatsapp"} |
| list_tasks | GET | http://localhost:3000/api/tasks?status=pending | 路径参数用 {{id}} |
| complete_task | POST | http://localhost:3000/api/tasks/{{id}}/done | 路径参数用 {{id}} |
| weekly_summary | GET | http://localhost:3000/api/tasks/summary/weekly | - |
| monthly_summary | GET | http://localhost:3000/api/tasks/summary/monthly | - |

> 如果本地运行 Dify Cloud 调用不了 localhost，使用 **ngrok**：
> ```
> ngrok http 3000
> ```
> 然后将 URL 替换为 ngrok 提供的公网地址

### Step 4: 发布 API
1. 点击右上角 "发布"
2. 在 "API 访问" 页面复制 **API Key**（格式: app-xxxxxxxx）
3. 填入本地 `.env` 文件的 `DIFY_API_KEY`

## 可选增强

### Chatflow + Agent 混合模式
如果希望更精细地控制流程，可以改用 Chatflow：
1. LLM Node: 判断消息意图（任务提取/查询/完成/总结）
2. Switch Node: 根据意图路由到不同分支
3. HTTP Request Node: 调用本地 Task API
4. LLM Node: 生成回复
5. Answer Node: 输出

### 多 Agent 协作
- Supervisor Agent: 意图识别 + 路由
- Task Agent: 任务 CRUD
- Summary Agent: 总结生成
- Reminder Agent: 定时检查
