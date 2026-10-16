# 运行时零依赖：单阶段即可，无需构建步骤（前端是原生 ESM，后端只用 node 内置模块）。
FROM node:24-alpine

# 服务默认监听容器网段；库与备份都落在卷挂载点 /data 下。
ENV HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/shop.db \
    BACKUP_DIR=/data/backups \
    BACKUP_RETENTION_DAYS=14

WORKDIR /app

# 只拷运行所需：服务端源码 + 前端静态件 + 备份入口脚本 + 包元信息。
COPY package.json ./package.json
COPY server ./server
COPY web ./web
COPY scripts ./scripts

# ① 放开读位：宿主上的源码可能是 0600（如从受限环境打包），非 root 用户会读不到；
# ② 卷挂载点先建好并交给 node 用户：容器以非 root 运行，挂载卷必须可写。
RUN chmod -R a+rX /app && mkdir -p /data /data/backups && chown -R node:node /data

USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.mjs"]
