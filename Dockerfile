# WhatsApp Task Agent — Docker 镜像
# 用于 Railway 部署

FROM node:22-slim

# 安装 git 和 SSH 客户端（libsignal 这类私有 git 依赖需要）
RUN apt-get update && \
    apt-get install -y --no-install-recommends git openssh-client && \
    rm -rf /var/lib/apt/lists/*

# 强制 git 通过 HTTPS 访问 GitHub（避免 SSH 认证问题）
RUN git config --global url."https://github.com/".insteadOf "git+ssh://git@github.com/"

WORKDIR /app

# 复制依赖文件
COPY package.json package-lock.json ./

# 只安装生产依赖
RUN npm install --omit=dev

# 复制源码
COPY . .

# 运行时目录（Baileys 认证数据）
RUN mkdir -p data/auth

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/index.js"]
