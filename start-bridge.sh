#!/bin/bash
rm -rf /Users/Admin/Documents/Codex/2026-07-25/wa-h/outputs/whatsapp-task-agent/data
cd /Users/Admin/Documents/Codex/2026-07-25/wa-h/outputs/whatsapp-task-agent
export PROXY_URL=http://127.0.0.1:7897
/Users/Admin/Documents/Codex/2026-07-25/ni-s/node-install/node-v22.14.0-darwin-arm64/bin/node src/bridge-pairing.js 8614776384961
