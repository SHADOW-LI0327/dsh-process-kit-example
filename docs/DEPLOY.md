# 部署与运维（手冲小铺）

本服务是单进程 Node 应用：同端口既出 `/api/v1` JSON 接口，也出静态前端；运行时零第三方依赖，
库用 `node:sqlite` 落在 `DB_PATH`。**TLS 由反代（Caddy）终结**，应用自身只跑 HTTP，不读证书、
不监听 443 —— 证书签发与续期都不在应用内处理。

compose 编排里一共 **3 个服务**：`backup`（一次性，起服前给库打快照后退出）、`app`（常驻，唯一的
应用进程，库与备份都在它的卷里）与 `proxy`（反代，只在 `--profile proxy` 时起）。

## 起法

三种跑法，任选一种。

1）本机直跑（开发 / 演示）：

```bash
npm install                # 只装开发依赖（jsdom）；运行时零依赖
npm start                  # node server/src/index.mjs，默认 http://127.0.0.1:3000
curl -s http://127.0.0.1:3000/health
```

2）单容器（这条与 compose 编排**各用各的卷**，互不相通）：

```bash
docker build -f deploy/Dockerfile -t shop:local .
docker run --rm -p 127.0.0.1:3000:3000 -v shop-standalone-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" shop:local
```

3）单机编排一键起（推荐，库与备份都在具名卷里）：

```bash
cp deploy/.env.example deploy/.env      # 里面的 SESSION_SECRET 是空占位，必须自己填
openssl rand -hex 32                    # 生成一把，粘进 deploy/.env 的 SESSION_SECRET=
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps
```

> `SESSION_SECRET` 是**没有默认值的必需项**：`.env.example` 里那一行故意留空，compose 也不再给默认值 ——
> 任何「能用的」默认值都等于把所有人的会话交给一份公开值。缺失或短于 32 字符时应用**启动即失败**并点名变量
> （实测 `docker compose run --rm --no-deps app` ⇒ 退出码 `1`，日志
> `"outcome":"startup_failed","variable":"SESSION_SECRET"`），既不退回弱密钥，也不带病起服 —— 所以
> **别抄样例、也别跳过这一步**。

起服前会先跑一次 `scripts/ops/backup.mjs`（给现有库打快照，首次无库时跳过），健康检查走 `GET /health`：
返回 `200` 且 `db.ok === true` 才算健康。默认这条命令起 `backup`（跑完即退）与 `app` 两个服务；
`proxy` 要加 `--profile proxy` 才起（见下）。

需要 HTTPS 时启用反代档案（Caddy 终结 TLS，并把明文请求转给应用容器）：

```bash
# 先在 deploy/.env 里把 COOKIE_SECURE 与 TRUST_PROXY 同时置 1（起反代时必须），再：
docker compose -f deploy/docker-compose.yml --profile proxy up -d
docker compose -f deploy/docker-compose.yml --profile proxy ps   # app 与 proxy 都要 healthy
curl -k -s -o /dev/null -w '%{http_code}\n' https://localhost/health   # 期望 200
curl -k -s https://localhost/health                                    # 期望 db.ok:true
```

反代档案实际做了什么：

- `proxy` 服务用 `caddy:alpine`，只在 `--profile proxy` 时起（**默认 `up -d` 不含它**，默认只起 `backup` 与 `app`）；
  它会等 `app` 健康（`depends_on: app: condition: service_healthy`）才开始接流量。
- 发布 `443`（HTTPS）与 **`80`**（仅用于明文到 HTTPS 的跳转，以及 ACME 证书校验）；应用自己的
  `3000` 端口只发布在**宿主回环**（`127.0.0.1:3000`）：直连调试仍可用，但应用不会裸听在对外网卡上。
  **宿主 80 / 443 必须空闲**，否则反代会起不来。
- **「宿主发布」与「容器内监听」是两件事，别混**：`ports:` 里的 `127.0.0.1:3000:3000` 决定「外面能不能连」，
  所以默认**只有宿主本机能直连 `http://127.0.0.1:3000`**，对外一律经反代；而容器里的 `HOST=0.0.0.0` + `PORT=3000`
  只是应用在容器网络里听哪个地址 —— 它**必须**是对内全网卡，否则反代与健康检查都连不进来。
  真要对外直连（不走反代）才需要自己改这条映射，那时请自行承担暴露面。
- `proxy` 起容器时先自检 `COOKIE_SECURE` 与 `TRUST_PROXY` **是否都为 1**：不满足就打印原因并**以非零退出**
  （不接流量），免得 TLS 上线了却还在发不带 `Secure` 的会话 cookie。实测对照：两者未置 1 ⇒
  `docker compose -f deploy/docker-compose.yml --profile proxy run --rm --no-deps proxy` **退出码 `1`** +
  「反代档必须同时置 COOKIE_SECURE=1 与 TRUST_PROXY=1」；两者都置 1 ⇒ 同一段自检**退出码 `0`**（继续起 Caddy）。
  **为什么是「拒起」而不是「替你置 1」**：compose 无法按 profile 条件改同一个服务的环境值；与其静默降级成
  「反代起来了、cookie 却不带 Secure」，不如直接不接流量 —— 拒起比悄悄降级安全。
- 站点配置 `deploy/Caddyfile` 只读挂进容器；`caddy-data` / `caddy-config` 两个命名卷落证书、
  ACME 状态与自动生成的配置 ⇒ 容器重建不重签证书。
- 站点地址是 `localhost` ⇒ 证书由 Caddy 内部 CA 自签，访问要带 `-k`（或用浏览器手动信任）才能验证通过；
  换成真实域名时改 `deploy/Caddyfile` 的站点地址，Caddy 会自动走 ACME 签发。
- 开反代时 `COOKIE_SECURE` 与 `TRUST_PROXY` 必须同时置 1：前者让会话 cookie 带 `Secure`，
  后者让应用采信反代透传的转发头；两个值都由 `deploy/.env` 传给应用容器。反代到应用走 compose
  内部网络与容器名 `app:3000`，**不经过宿主端口**。

# 环境变量（变量表）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址；容器内用 `0.0.0.0` |
| `PORT` | `3000` | 监听端口；`0` 表示由系统分配（日志里会打出真实端口） |
| `DB_PATH` | `./data/shop.db` | SQLite 库文件路径；`:memory:` 为纯内存模式（重启即空） |
| `SESSION_SECRET` | 无 | 会话密钥；`NODE_ENV=production` 时必填且至少 32 字符 |
| `COOKIE_SECURE` | `0` | 置 `1` 时给会话 cookie 加 `Secure`（反代终结 TLS 时必须置 1） |
| `TRUST_PROXY` | `0` | 置 `1` 时采信反代透传的转发头（直连时保持 0） |
| `LOG_LEVEL` | `info` | 日志级别：debug / info / warn / error |
| `BODY_LIMIT_BYTES` | `131072` | 请求体上限（字节），超出即 413 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 写接口限流窗口（毫秒） |
| `RATE_LIMIT_MAX` | `60` | 限流**基数**（三维固定窗口计数的基准）：每会话 = 本值、**每 IP = ×4**（默认 240）、**全局 = ×20**（默认 1200），任一维超出即 `429` + `Retry-After`。验限流取证时把它调小即可（例：`RATE_LIMIT_MAX=5` ⇒ 同一匿名会话第 6 次写请求即 429） |
| `BACKUP_DIR` | `./backups` | 备份落点目录（快照文件名 `shop-<UTC 日>.db`） |
| `BACKUP_RETENTION_DAYS` | `14` | 备份保留天数，超过即清理 |
| `NODE_ENV` | `development` | 运行环境；`production` 触发上面那条密钥必填校验 |

变量取值一律走这一处校验：非法取值启动即失败，并在错误日志里点名是哪个变量（不给默认值兜底）。

密钥的三点事实：
- **生产档（`NODE_ENV=production`）**：没有它**直接拒启**，不退回任何内置值，也不往盘上落任何密钥文件。
- **开发档**：允许缺席 —— 此时在库文件旁生成一份随机密钥 `<DB_PATH>.dev-session-secret`（权限 `0600`，
  已存在且够长就复用）并打一条 `warn`。为什么要落盘而不是每次随机：本地**换进程重启是常态**，
  每次换一把会把已登录的会话全部踢下线。日志只打这份文件的**路径**（字段 `secretFile`）与是否复用，
  **不打密钥本身**。
- **这份文件不入库**：它是本地开发产物，默认库路径 `./data/shop.db` 落在已被忽略的 `data/` 下，sidecar 随之一并被忽略；
  若你把 `DB_PATH` 指到别的目录，请自行确认那份同名 sidecar 没被提交。备份/迁移也不必带上它 ——
  换一份即等于全员下线。

## 升级

1. 取新版本代码，重建镜像：`docker compose -f deploy/docker-compose.yml build`。
2. `up -d` 覆盖（`backup` 服务会先把当前库快照到 `BACKUP_DIR`，再起新版本）。
3. 看健康与日志：`docker compose -f deploy/docker-compose.yml ps` / `logs -f app`。

库结构变更由应用启动时的迁移负责（`schema_migrations` 记版本，逐版 `IF NOT EXISTS` 落地），
升级不需要手工执行 SQL；版本号高于本程序认识的上限时启动会失败而不是降级改写数据。

## 回滚

> **回滚成功的唯一判据是数据本身**（按 `orderNo` 查得到、行数对得上），不是退出码、不是文件指纹、
> 更不是 `/health` 返回 `200` —— 下面两种失败模式里，命令全是 `exit 0`、库文件指纹也与快照逐位相同、
> `/health` 照样 `200`，但**回滚其实没生效或又被撤销了**。

**第 1 步 · 停服**：`docker compose -f deploy/docker-compose.yml down`。
**必须先停服**，不要在应用还在写库时替换库文件。

**第 2 步 · 用快照替换库**（整段照抄；`SNAP` 换成你要用的那份快照文件名）：

```bash
SNAP=shop-20261015.db     # 换成你实际要用的那份快照文件名
docker compose -f deploy/docker-compose.yml run --rm --no-deps \
  --entrypoint sh app -c \
  "rm -f /data/shop.db-wal /data/shop.db-shm && cp -pf /data/backups/$SNAP /data/shop.db && ls -l /data/shop.db"
```

这条命令里的 `/data` 就是应用真正在用的那个具名卷（由 `docker compose run` 自己挂进去），所以写到
`/data/shop.db` 的内容一定落在应用读的那个卷里 —— 不需要知道卷叫什么，也不需要知道项目名。

- **`rm -f /data/shop.db-wal /data/shop.db-shm` 这一句不能省**：SQLite 的 `-wal` 是库的一部分，
  里面装着**尚未合并进主文件的事务**。只 `cp` 覆盖主文件、把残留的 `-wal` 留下，下次启库时 SQLite 会
  **把那个 WAL 回放**，快照之后的写入就原地复活 —— **回滚被自己撤销，而且全程零报错**。
  这个坑**偏偏只在最需要回滚的时候触发**：OOM、`docker kill`、宿主断电/重启等**非干净停机**不会
  checkpoint `-wal`，干净停机（`down`/`stop`）才会。所以无条件清一次，干净停机时它本来也就不存在。
- 两条要一起清：`-shm` 只是 WAL 的索引，主文件被换掉后它同样对不上；`rm -f` 对不存在的文件也退出 `0`。

> **为什么不用 `docker run -v <卷名>:/data`**：卷的宿主名由 compose 决定 —— 本项目顶层 `name: shop`
> 加上卷声明，拼出来的是 **`shop_shop-data`**，也就是说宿主卷**不是** `shop-data`。真按旧写法敲
> `docker run --rm -v shop-data:/data …`，Docker 会**新建一个空卷**并往里面拷：命令照样退出 `0`、
> 应用照样 `healthy`、`/health` 照样 `200`，但**库里一个字节都没变**（静默空操作），还平白多出一个
> 垃圾卷。任何硬编码的卷名（哪怕「写对」了那一个）在别人用 `-p` 换项目名时都会再次失效，
> 所以这里一律交给 compose 解析。

**第 3 步 · 起服**：`docker compose -f deploy/docker-compose.yml up -d`（镜像 tag 指回旧版本）。
起服前会再跑一次 `backup` 服务给**刚回滚后的库**打一份快照。但注意：**快照文件名只精确到 UTC 日**
（`shop-<UTC 日>.db`），**同一天再打就是覆盖同一份**，所以它**不是**「换错快照的后悔药」——
真要留退路，请在重要变更前把当前快照**手工另存成别的文件名**。同理，回滚后 `BACKUP_DIR` 里那份
已经是你回滚后的状态，别再拿它当回滚目标。

**第 4 步 · 验恢复**：`curl -s localhost:3000/health` 为 `200`，**并且按 `orderNo` 查得到、且只剩
快照时刻那些订单**。下面这一整段照抄即可（**没有 cookie 罐时 `GET /api/v1/orders` 只会给 `401`，
看不到订单**，所以先用注册把罐拿到手）：

```bash
# 注册并把会话 cookie 导出成 jar.txt（201，注册即登录）；已有账号就把这行换成 auth/login
curl -s -c jar.txt -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"me-password-123"}' \
  localhost:3000/api/v1/auth/register
# 用同一个罐查自己的订单：罐有效才看得到，列出的就是快照时刻那些 orderNo
curl -s -b jar.txt localhost:3000/api/v1/orders
```

（口令需 ≥ 8 个字符；邮箱被占用时注册给 `409`，改用 `auth/login` 登录即可 —— 入参与注册相同。）

只有 `200` 不能证明替换生效：**空操作**时它是 `200`，**WAL 把回滚撤销**时它同样是 `200`。

回滚前务必先停服再替换库文件：不要用裸 `cp` 去拷正在写入的库（WAL 未合并会拿到不一致快照）。

## 数据在哪（备份与恢复）

- 库：`DB_PATH`。容器里是具名卷的 `/data/shop.db`；容器根文件系统是只读的，只有卷与 `/tmp` 可写。
- **卷的宿主名不在本文档里写死**：它由 compose 项目名拼出来（本项目顶层 `name: shop` ⇒
  `shop_shop-data`；换 `-p` 换项目名就跟着变）。要看本机实际挂的是哪个卷，跑：

```bash
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' \
  "$(docker compose -f deploy/docker-compose.yml ps -q app)"
```

  或者直接用「回滚」第 2 步那条 `docker compose run` 命令 —— 那条不关心卷名。
- 备份：`BACKUP_DIR`（容器里 `/data/backups`），**保留 14 天**，超过 14 天的快照会被清理。
- **同一 UTC 日只有一份快照**（文件名精确到日、同日再打即覆盖，已实测：同一天两次备份后目录里仍是
  一个文件、内容变成后一次的状态）⇒ 它只保证「今天有备份」，**不保证「任意时点可回滚」**；
  重要变更（升级、改数据）前请把当前快照**手工另存成别的文件名**再动手。
- 备份口径：用 `node:sqlite` 的模块级 `backup()` 生成独立快照；禁止在 WAL 下裸 `cp` 库文件。
- 手动备份一次（cron / 调度器可直接调这条命令）：

```bash
DB_PATH=./data/shop.db BACKUP_DIR=./backups BACKUP_RETENTION_DAYS=14 node scripts/ops/backup.mjs
```

- 保留判定口径：按快照文件的 **mtime** 与 `BACKUP_RETENTION_DAYS` 比较，`now - mtime > N 天` 即删；
  备份失败时**不删除**任何既有快照，并以非零退出码 + `error` 级 JSON 日志暴露。
- 恢复步骤：停服 → 用最新快照替换 `DB_PATH`（卷路径交给 compose 解析，见「回滚」第 2 步那条
  `docker compose run` 命令，不要手写宿主卷名）→ 起服 → `GET /health` 为 `200` →
  **按 `orderNo` 能查到快照时刻那笔订单**（只有 `200` 不能证明替换真的生效）。
- 会话与匿名车的清理**不在本期自动执行，是一条手工步骤**（单实例、量小；口径见 PRD `Q-18` 选项 B
  「不主动清理，文档化增长 + 手工步骤」）：`sessions` 与无主 `cart` 行会随使用增长，需要时**停服后**手工删
  （`DELETE FROM sessions WHERE expires_at < <毫秒时间戳>`），或直接依赖快照 + 重建。
- 要用一条命令搞定时用可选的 `scripts/ops/cleanup-carts.mjs`（**手工执行；应用启动时不会跑它**）。
  它只清两类行：**已过期会话**（`expires_at` 已过）与**长期没动过的匿名车**
  （`user_id IS NULL` 且最后一次加购距今超过 `--days`，默认 30 天）。**登录车一律不动**；老车但近期还加过购也不动
  （判定按「最近一次加购时间」，没有行才退回建车时间）。**默认干跑只报告**（打印 `expiredSessions` /
  `idleAnonCarts`，一行 JSON），确认无误后加 `--apply` 才真删。例：
  `DB_PATH=/data/shop.db node scripts/ops/cleanup-carts.mjs --days=30` 先看一眼，
  再 `DB_PATH=/data/shop.db node scripts/ops/cleanup-carts.mjs --days=30 --apply`；
  **删之前建议先跑一次 `node scripts/ops/backup.mjs` 打快照**（清理是删除动作，没有 undo）。
