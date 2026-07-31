# WhatsApp Task Agent — 启动指南

## 在线服务（无需本地操作）

| 服务 | URL |
|------|-----|
| Dashboard | https://task-api-production-785e.up.railway.app/dashboard.html |
| API 健康检查 | https://task-api-production-785e.up.railway.app/api/health |
| n8n | https://n8n-production-581c2.up.railway.app |

## 本地启动 Bridge（需要翻墙/VPN）

```bash
# 1. 进入项目目录
cd ~/Documents/Codex/2026-07-25/wa-h/outputs/whatsapp-task-agent

# 2. 启动 Bridge
# 如果有 VPN 直接连，不需要 PROXY_URL:
RAILWAY_API_URL=https://task-api-production-785e.up.railway.app node src/bridge-pairing.js 8614776384961

# 如果 mihomo/Clash 做了透明代理，也不需要 PROXY_URL:
# （mihomo 需开启 TUN Mode 才能代理 WebSocket）

# 如果需要代理（仅 HTTP），试试:
# PROXY_URL=http://127.0.0.1:7897 RAILWAY_API_URL=https://task-api-production-785e.up.railway.app node src/bridge-pairing.js 8614776384961
```

## 导入 n8n Workflow

1. 打开 https://n8n-production-581c2.up.railway.app
2. 点右上角 **Import from File**
3. 选择 `n8n-workflows/whatsapp-message-processing.json`
4. 设置环境变量: `DEEPSEEK_API_KEY` = 你的 DeepSeek API Key
5. 激活 Workflow

## Supabase 可选升级

打开 Supabase → SQL Editor，运行:
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_name TEXT DEFAULT ''::text;
```

## Dashboard 使用指南

- **点击行** = 标记完成/撤销完成
- **+ 截止日** = 弹出日历选择日期
- **+ 备注** = 添加备注说明
- **编辑** = 打开编辑弹窗（标题/优先级/截止日/备注/来源）
- **+ 新建任务** = 手动创建任务
- **日程配置** = 展开可开关早报/晚报/周报/月报
