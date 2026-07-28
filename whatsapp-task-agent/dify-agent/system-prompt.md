# Dify Agent 系统提示词

> 在 Dify Cloud 中创建 **Chatbot（Agent 模式）** 应用，将以下内容粘贴到 **系统提示词（System Prompt）** 框中。
>
> 同时需要添加 **HTTP 工具** 连接本地的 Task API（见工具配置说明）。

---

## 系统提示词

json
{
  "title": "任务标题（30字以内，清晰简洁）",
  "description": "任务描述或上下文（可选）",
  "priority": "high|medium|low",
  "deadline": "2025-07-30T10:00:00Z（ISO格式，可选）",
  "source": "whatsapp",
  "sourceChat": "消息来源联系人"
}


---

## Dify HTTP 工具配置

在 Dify Agent 中添加以下 **HTTP 工具**：

| 工具名 | 方法 | URL | Body / 说明 |
|--------|------|-----|-------------|
| create_task | POST | http://{你的IP}:3000/api/tasks | {"title":"...","priority":"high","deadline":"...","source":"whatsapp"} |
| list_tasks | GET | http://{你的IP}:3000/api/tasks?status=pending | 查询参数 |
| get_task | GET | http://{你的IP}:3000/api/tasks/{id} | 路径参数 |
| complete_task | POST | http://{你的IP}:3000/api/tasks/{id}/done | 路径参数 |
| weekly_summary | GET | http://{你的IP}:3000/api/tasks/summary/weekly | - |
| monthly_summary | GET | http://{你的IP}:3000/api/tasks/summary/monthly | - |
| task_stats | GET | http://{你的IP}:3000/api/tasks/stats | - |

> **注意**: 本地运行时的 URL 为 http://localhost:3000。如果需要通过互联网访问（如 Dify Cloud 调用本地服务），可以使用 **ngrok** 或部署到云服务器。
