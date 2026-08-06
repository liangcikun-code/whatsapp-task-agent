# WhatsApp Task Agent — 启动指南

## 在线服务 (已部署，无需操作)

| 服务 | URL |
|---|---|
| Dashboard | https://task-api-production-785e.up.railway.app/dashboard.html |
| API 状态 | https://task-api-production-785e.up.railway.app/api/health |

## 本地 Bridge 启动 (需要 Clash VPN)

```bash
cd /Users/Admin/Documents/Codex/2026-07-25/wa-h/outputs/whatsapp-task-agent

PROXY_URL=http://127.0.0.1:7897 \
  /Users/Admin/Documents/Codex/2026-07-25/ni-s/node-install/node-v22.14.0-darwin-arm64/bin/node \
  src/bridge-pairing.js 8614776384961
```

出 QR 码或配对码后，手机 WhatsApp 扫码关联。

## 开机自启 (launchd)

```bash
# 加载（开机自动启动）
launchctl load ~/Library/LaunchAgents/com.whatsapp.bridge.plist

# 检查运行状态
ps aux | grep bridge-pairing | grep -v grep

# 停止
launchctl unload ~/Library/LaunchAgents/com.whatsapp.bridge.plist
```

## 使用

在 WhatsApp 里发 `/t` 开头的消息：

```
/t 明天下午3点开会
/t 周五前把材料整理好 高优先级
/t 下周三之前完成报告
```

只有 `/t` 开头的消息会被 AI 分析。没有 `/t` 的普通聊天直接忽略。

Dashboard: https://task-api-production-785e.up.railway.app/dashboard.html

> **注意**: n8n 已不再使用。DeepSeek AI 直接内置在 Task API 里处理。
