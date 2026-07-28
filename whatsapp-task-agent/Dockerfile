# WhatsApp Task Agent — Docker 镜像
# 用于 Railway 部署

FROM node:20-slim

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm install --production

# 复制源码
COPY . .

# 运行时目录（Baileys 认证数据）
RUN mkdir -p data/auth

ENV NODE_ENV=production

EXPOSE 3000

# Railway 会在启动时注入 SUPABASE_URL, SUPABASE_ANON_KEY, DIFY_API_KEY
CMD ["node", "src/index.js"]
