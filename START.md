# WhatsApp Task Agent — 启动指南

## 第一次使用前

1. 打开 n8n: https://n8n-production-581c2.up.railway.app/signin
   - 账号: liangcikun@gmail.com
   - 密码: WA-task-2026!
   
2. 找到工作流 "WhatsApp 消息处理 v2", 点击编辑
   
3. 找到 HTTP Request 节点 (创建任务), 把 Body 改成 JSON:
   ```json
   {
     "title": "={{$json.title}}",
     "priority": "={{$json.priority}}", 
     "source": "whatsapp",
     "sourceChat": "={{$json.phone}}"
   }
   ```

4. 找到 HTTP Request1 节点 (回复), 把 Body 改成 JSON:
   ```json
   {
     "phone": "={{$json.phone}}",
     "message": "={{$json.message}}"
   }
   ```

5. 保存并激活

## 启动 WhatsApp Bridge

在终端运行:

```bash
export NODE_HOME="/Users/Admin/Documents/Codex/2026-07-25/ni-s/node-install/node-v22.14.0-darwin-arm64"
export PATH="$NODE_HOME/bin:$PATH"
cd /Users/Admin/Documents/Codex/2026-07-25/wa-h/outputs/whatsapp-task-agent
PROXY_URL=http://127.0.0.1:7897 RAILWAY_API_URL=https://task-api-production-785e.up.railway.app node src/bridge-pairing.js 8614776384961
```

用手机 WhatsApp 输入终端显示的 8 位配对码即可登录。
