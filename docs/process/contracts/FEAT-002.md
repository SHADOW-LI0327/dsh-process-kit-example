---
id: FEAT-002
kind: contract
title: 电商 app Phase 2（真实数据库 + 最小账号 + 可投产部署 + 淘宝风改版）· 接口契约
prd: docs/process/prd/FEAT-002.md
prdVersion: 3
author: pm
createdAt: 2026-10-15
status: done
gate1: approved
gate2: approved
gate4: approved
---

# FEAT-002 电商 app Phase 2 · 接口契约

> **本文件是什么**：`server/` 对外接口与数据实体的**契约层** —— 方法、路径、入参、出参、错误码、字段名与类型、库表形状、账号与会话口径、静态放行与部署落点。它是 test 写断言的字段来源、dev 实现的形状依据。
> **本文件不是什么**：不是 PRD（判据在 `prd/FEAT-002.md` 的 `AC` / `E`）、不写实现逻辑的分层与取舍（在 `prd/FEAT-002-design.md`）、不写前端组件内部结构。
> **基线声明（对齐口径）**：本包**有现状实现**（`server/**` 为 FEAT-001 交付物）⇒ 端点逐个标 `alignment: keep|change|new`。对齐依据 = 需求核对件 `§3.1`/`§3.3` 的**主控一手读数**（`file:line` 已在 PRD §3 登记：`server/src/static.mjs:103,109`、`server/src/store.mjs:62-75`、`server/src/app.mjs:242-249`）。**凡本契约与现状实现冲突处，一律以本契约为准，由 dev 改实现**（对齐是"契约向判据看齐"，不是"判据向实现看齐"）。

## 当前状态一览

> 一屏内可读完，只写"现在是什么状态"，不留沿革；随每次交付就地更新。

- 交付状态：**Gate1 已过**（`gate1: approved`）· **Gate2 已过**（`gate2: approved`）· **`gate4: pending`**（**交付后变更重开** —— 人于 2026-10-15 要求把商品主图改为**本仓自托管真实照片**，属**判据变更**（`AC-48` / `UI-12` / `UI-24` 原把主图钉成 `*.svg`）⇒ `prdVersion` **2**；**2026-10-16 `r3` 第二次交付后变更**（主控裁定：`AC-48` ③ 结构化完整性 · `?v=` 指纹定义钉死 · `AC-23` 三维限流 + 在途并发 · `AC-53` ③ 勘误 · 新增 `AC-57`~`AC-64`）⇒ `prdVersion` **3**）；当前 **`status: implementing`**。**本行由主控在重开/重签时同步**（`D-13` 纪律）。与 `prd/FEAT-002.md` · `prd/FEAT-002-design.md` · `prd/FEAT-002-ui-spec.md` 四件同批（四件状态位一致）。**本行由主控在 Gate4 签收时同步**（属 `D-13` 状态遮蔽纪律：状态位有多个载体时改一处等于没改）。
- `alignment` 汇总：**15 个端点** = `keep` **1** / `change` **8** / `new` **6**；**实体 8 张表** + `order_no_seq` 序列表（取号用，见 §三）。
- 词表规模：FEAT-001 的 **8 码全保留** + 新增 **7 码**（`UNAUTHENTICATED` / `INVALID_CREDENTIALS` / `EMAIL_TAKEN` / `INVALID_PAGINATION` / `PAYLOAD_TOO_LARGE` / `RATE_LIMITED` / `INTERNAL_ERROR`）= **15 码封闭词表**（§六）。
- 未决事项：与 PRD §7 同源（`Q-14`~`Q-23`）；其中 **`Q-20` 已解决**（属主表 46 条 → 撤 `deploy/nginx.conf` 后 45 条）、**`Q-21` 已裁定 A**（Gate1 后 pm 最小回填）、**`Q-22` 已裁定**（2026-10-15 交付后变更：主图 = **本仓自托管真实照片**）、**`Q-14` 已裁定 B**（2026-10-16：允许前端本地筛选 ⇒ 落成 `AC-60`）、**`Q-23` 新增**（三维限流后两维阈值与在途并发上限 = **暂定值**，与 `RATE_LIMIT_MAX` 成固定倍数 ⇒ 不新增环境变量）。契约内**无**未决措辞。
- 与本契约相关的**新引入缺陷面**：① 订单号跨重启重号（`AC-56`，§三 取号口径定死）；② 未预期异常伪装 `404`（`AC-21`，§六/§七 定死 5xx 映射）；③ 会话载体必须是库（`AC-01`，§四 定死）。
- 最后更新轮次：`r1`（初稿）+ **勘误 1~5**（§7.3 反代 profile 口径 · 同行「单服务」计数 → 三服务 · 卷名口径澄清 · §3.6 恢复/备份事实补齐 · **§5.15 二进制按字节原样送出**）+ **状态快照同型改正**（本条与上一行，随 frontmatter 同步）+ **交付后变更（`Q-22`）**：主图 = **本仓自托管真实照片**，`AC-48` / `AC-49` 判据语义确有变更 ⇒ **`prdVersion` 1 → 2**（勘误 1~5 本身判据句零变化，不单独抬版本）+ **`r3`（2026-10-16，主控裁定 ⇒ `prdVersion` 2 → 3）**：① **口令哈希改异步 `scrypt`**（`scryptSync` 会让单线程事件循环被 16 MiB 级内存硬哈希阻塞 ⇒ 写明参数与 `maxmem`）+ **登录路径对「账号不存在」也执行一次等价哈希**（消除时序侧信道，兑现 `AC-13` 的防枚举意图）；② **限流三维 + 在途并发上限**（§一「限流」行，`AC-23`；`TRUST_PROXY=1` 时按 `X-Forwarded-For` 首个 IP 计数，`AC-64`）；③ **内容指纹定义钉死** = 文件字节 `sha256` 前 10 位 hex，退化指纹不得换来强缓存（§7.2，`AC-31`）；④ **`SESSION_SECRET` / `TRUST_PROXY` 写明「生效」语义与消费点**（§7.1，`AC-63` / `AC-64`）；⑤ **JPEG 结构化完整性**口径与 PRD `AC-48` ③ 同步（§5.15 二进制行不变）。见文末变更记录。**收口轮（2026-10-16，`r4`）**：**Gate4 已签收** ⇒ `gate4: approved` / `status: done`（**`prdVersion` 保持 `3`**：本轮只**补机器断言** `TC-FEAT-002-69`（挂既有 `AC-54` = UI 行为继承）与**判据内的事实补写**，**判据句零变更**）。本轮落地：① 缺货（`stock === 0`）详情页两个 CTA **建好即 `disabled`** + 步进器改 **`min(现货, 8)` 封顶**（真根因：`stepper` 声明了 `max` 却按全局 `8` 判禁用 ⇒ **`FEAT-001 V-01` 同型**，`AC-54` 承载）；② 注册/登录页**本地预先校验 5 文案**（`W-79`~`W-83`，旧通用 400 文案与 `W-63` 合并式**已废弃**，新增第四个状态标签 `已废弃`）；③ **启动失败零残留**（`rollbackStartup()` **只删本次自建**文件，**预置库三重比对原样保留**）；④ `RATE_LIMIT_MAX`（默认 `60` = 每会话；IP ×4 / 全局 ×20）语义写入本契约 §表与 `docs/DEPLOY.md`，**未新增变量名** ⇒ `AC-35` 变量集合不变，`U-38` 由此可取证（`=5` ⇒ 第 6 次 `429`）。UAT 收口轮 **8/8 通过**（`U-32` **改判为通过**）；`cartId` 瞬时不一致**未改接口语义**，登记为已知行为（机制：服务端对不认识的 `cartId` 静默换发空车；正常路径 5/5 稳定）。

---

## 一、通用约定

| 项 | 约定 |
| --- | --- |
| 监听地址 | `HOST`（默认 **`127.0.0.1`**，**裁定值**：未裁前默认只绑本机）+ `PORT`（默认 `3000`，**暂定值**）。`PORT=0` = 由系统分配（哨兵），非拒绝档 |
| 基地址 | 直连 `http://{HOST}:{PORT}`（默认 `http://127.0.0.1:3000`，`PROJECT.md` §5 验收基地址沿用）；生产由反代终结 TLS ⇒ 对外 `https://`，**应用内只跑 HTTP** |
| 端点前缀 | 业务面 `/api/v1`；运维面 `GET /health`（**无**前缀，便于容器健康检查与反代放行） |
| 传输 | JSON over HTTP/1.1；请求与响应字符集 `UTF-8` |
| 请求头 | 带体的写操作**只接受 `application/json`**（含参数形式 `application/json; charset=utf-8`）；其它媒体类型或缺该头 ⇒ **`400 INVALID_BODY`**。**无体请求不受此校验**（沿用 FEAT-001 契约 §一，`prdVersion 2` 起的澄清条款**继续有效**） |
| 请求体上限 | **128 KiB**（**暂定值，依据 `Q-10` + `Q-9`①；PRD §7 `Q-17`**）。超出 ⇒ `413 PAYLOAD_TOO_LARGE`，且**不进入业务处理**、不产生副作用 |
| 限流 | 写接口（`POST`/`PATCH`/`DELETE`，含 `/auth/register`、`/auth/login`）**三维固定窗口计数**（窗口 **60 秒**，`AC-23`）：**每会话 `R = 60`**（暂定值，依据 `Q-10` + `Q-9`②；PRD §7 `Q-17`）· **每 IP `R_ip = 4 × RATE_LIMIT_MAX = 240`** · **全局 `R_all = 20 × RATE_LIMIT_MAX = 1200`**（后两维为**暂定值**，依据 `Q-10` 最小可用假设「并发 ≤50」；PRD §7 `Q-23`；**与 `RATE_LIMIT_MAX` 成固定倍数 ⇒ 不新增环境变量**）。**来源 IP 口径**：`TRUST_PROXY=0`（默认）取对端地址；`TRUST_PROXY=1` 取 `X-Forwarded-For` 的**首个（最左）** IP（`AC-64`）。**在途并发上限 `C = 16`**（暂定值，同上 `Q-23`；防 `scrypt` 占满线程池）⇒ 达到上限时新写请求同样 **`429 RATE_LIMITED`**（**复用既有词表码，不新增错误码**）。任一维超限 ⇒ `429 RATE_LIMITED` + `Retry-After`（秒，整数），**不产生副作用** |
| 鉴权 | **最小账号**（`Q-3` = B）：会话 cookie（**`sid`**，见 §四）。**未登录**访问受保护面 ⇒ **`401 UNAUTHENTICATED`**；**他人资源** ⇒ **`404 NOT_FOUND`**（不暴露存在性）；**本契约与实现均不存在 `403` 面** —— 理由从 FEAT-001 的「无鉴权」变为「**有鉴权，但越权一律 `404`、未登录才 `401`**」（PRD §1.5 `S-16`；张力登记见 PRD §7 `Q-19`） |
| 身份归属 | 两级：① **已登录**（`sid` 有效）⇒ 归属 `users.id`，购物车 = 该用户的库内车（惰性创建）；② **未登录** ⇒ 沿用服务端下发的匿名 **`cartId`** cookie（FEAT-001 口径保留）。判定顺序与 cookie 下发规则见 §四 |
| 权限码 | 本契约引入权限码清单（`Q-3` = B）⇒ 见 §四「权限码与数据范围」。**注**：权限码是**文档层口径**（用于说明谁可访问什么），本包**不引入** RBAC 表 / 角色字段 / 中间件抽象 |
| 金额单位 | **整数分**（`integer` cents），字段名一律以 `Cents` 结尾；接口层不返回「元」为单位的金额字段。元换算只发生在展示层 |
| 数量单位 | **件**（整数）。单行件数区间 **1..8**（暂定值，沿用 `FEAT-001 Q-1` 同源的 8）；购物车最多 **8 种**商品（沿用 FEAT-001） |
| 时间字段 | 响应中一律 **ISO8601 UTC 字符串**（如 `2026-10-15T08:30:00.000Z`，由库内**UTC 毫秒整数**经 `toISOString()` 得到）；**库内一律 `INTEGER` 毫秒** |
| 分页 | 参数 `limit` / `offset`，均为**十进制整数**。默认与上限见 §五 对应端点。非法（非整数 / `limit < 1` / `limit > 上限` / `offset < 0`）⇒ `400 INVALID_PAGINATION`；**未知查询参数一律忽略**（不报错，便于前端带无关参数） |
| 安全响应头 | **所有**响应（含 4xx / 5xx / 静态 / `/health`）统一带：`X-Content-Type-Options: nosniff` · `Referrer-Policy: no-referrer` · `X-Frame-Options: DENY` · `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'`。**CSP 内不得出现任何第三方域名**（与 `AC-52` 互为支撑） |
| 结构化日志 | 每请求**至少一行** JSON：`level` · `time` · `requestId` · `method` · `path` · `status` · `durationMs`（+ 慢请求 `slow: true`，阈值 **500 ms** 暂定值）。**禁止**记录口令明文 / `password_hash` / 会话 token / cookie 值（`AC-18`） |
| 运行时依赖 | **零运行时依赖**（只用 `node:*` 内置模块，含 `node:sqlite` / `node:crypto`）；开发依赖仅 `jsdom` |
| 最低 Node 版本 | **`>= 24.0.0`**（`node:sqlite` 的 `DatabaseSync` 与**模块级 `backup()`** 均在此线上）。启动时 `node:sqlite` 会打印 `ExperimentalWarning: SQLite is an experimental feature and might change at any time` —— **该告警属预期，不是错误**（`package.json` 的 `engines` 与部署文档须写明；不得为了消警去捕获 / 抑制全部告警） |
| 部署落点（**文件级，禁目录级通配**） | `deploy/Dockerfile` · `deploy/docker-compose.yml` · `deploy/.dockerignore` · `deploy/.env.example` · `deploy/Caddyfile` · `docs/DEPLOY.md` · `.github/workflows/**` · `scripts/ops/**`。**反代示例只交付 Caddy**（`deploy/nginx.conf` 不交付，理由与命令字面见 §七） |
| 起法（命令字面） | 构建：`docker build -f deploy/Dockerfile -t dsh-shop:feat002 .`；起：`docker compose -f deploy/docker-compose.yml up -d`；非容器：`npm start`（或 `HOST=0.0.0.0 PORT=3000 DB_PATH=./data/shop.db node server/src/index.mjs`） |

### 1.1 成功响应形态

```jsonc
{ "data": { /* 实体或实体数组 */ } }
```

- 顶层固定为 `data`；与错误响应的 `{ code, message }` **互斥**。
- `201` 用于「创建成功」（注册 / 加购 / 下单）；`200` 用于查询与更新；`304` 用于条件请求命中（静态面）。

### 1.2 错误响应形态（**统一，所有 4xx / 5xx 一致**）

```jsonc
{
  "code": "UNAUTHENTICATED",   // 大写下划线字符串，取自 §六 封闭词表
  "message": "请先登录",        // 面向用户的中文提示，非空
  "details": { }               // 可选；仅承载字段级校验细节
}
```

- 顶层固定 `code` + `message`（`details` 可选）；**禁止**出现 `stack` / `errno` / 绝对文件路径 / SQL 语句 / 内部对象（`AC-20` `AC-21`）。
- **未预期异常一律 `500` + `INTERNAL_ERROR`**（§六/§七），**禁止**再映射成 `404`（FEAT-001 的 `safeDispatch` 偏离已由本包结掉，PRD §1.5 `S-14`）。
- **`500` 不退出进程**：单次请求故障不影响服务存活（`AC-21`）；进程级未捕获异常才走「记录 + 非零退出」（`AC-30`）。

### 1.3 与 PRD 的追溯

| 端点 | 承载 `AC` | 相关 `E` |
| --- | --- | --- |
| `GET /api/v1/products` | `AC-08` `AC-09` `AC-55` | `E-09` |
| `GET /api/v1/products/{id}` | `AC-55` | `E-03` |
| `POST /api/v1/auth/register` | `AC-10` `AC-11` `AC-18` | `E-02` |
| `POST /api/v1/auth/login` | `AC-12` `AC-13` `AC-15` `AC-18` | `E-01` `E-19` |
| `POST /api/v1/auth/logout` | `AC-16` | `E-01` |
| `GET /api/v1/auth/me` | `AC-12` `AC-14` | `E-01` |
| `GET /api/v1/cart` | `AC-15` `AC-16` `AC-55` | `E-01` |
| `POST /api/v1/cart/items` | `AC-22` `AC-23` `AC-55` | `E-07` `E-08` |
| `PATCH /api/v1/cart/items/{id}` | `AC-23` `AC-55` | `E-08` |
| `DELETE /api/v1/cart/items/{id}` | `AC-23` `AC-55` | `E-08` |
| `POST /api/v1/orders` | `AC-03` `AC-04` `AC-14` `AC-56` | `E-05` `E-10` `E-11` `E-14` |
| `GET /api/v1/orders` | `AC-09` `AC-14` `AC-17` | `E-01` `E-09` |
| `GET /api/v1/orders/{orderNo}` | `AC-17` `AC-19` | `E-01` `E-03` |
| `GET /health` | `AC-28` | — |
| `GET /`（静态面，含 `/src/**` `/assets/**` `/favicon.ico`） | `AC-31` `AC-49` `AC-50` `AC-51` `AC-52` `AC-54` | `E-12` `E-16` `E-17` |

---

## 二、数据实体（契约层）

### 2.1 `Product`（**只读**，迁移时播种）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 形如 `P-001`；**判据禁止依赖它**（用商品名称定位） |
| `name` | `string` | 非空 |
| `description` | `string` | 可为空串 |
| `priceCents` | `integer` | ≥ 0 |
| `stock` | `integer` | ≥ 0；`0` 为**合法**（缺货），不是脏数据 |

### 2.2 `Cart` / `CartItem`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `cartId` | `string` | 车标识；登录态 = 该用户的库内车 id，匿名态 = cookie 里的 `cartId` |
| `items[]` | `CartItem[]` | 可为空数组；顺序按加入先后稳定 |
| `quantityTotal` | `integer` | Σ `quantity` |
| `totalCents` | `integer` | Σ `lineTotalCents` |
| `CartItem.productId` | `string` | — |
| `CartItem.productName` | `string` | 冗余投影（**下单时快照**，不随后续改名漂移） |
| `CartItem.unitPriceCents` | `integer` | 加入时**快照**价（下单按此价，防改价漂移；本包无改价面，只为契约稳定） |
| `CartItem.quantity` | `integer` | 1..8 |
| `CartItem.lineTotalCents` | `integer` | `unitPriceCents × quantity` |

### 2.3 `User`（**响应体永不包含口令相关字段**）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | UUID v4 |
| `email` | `string` | **小写归一**后的邮箱（响应回显的也是归一后的值） |
| `createdAt` | `string` | ISO8601 UTC |

> **`password_hash` / `password_salt` 只存在于库内**，不出现在任何响应、日志、错误体（`AC-18`）。

### 2.4 `Order` / `OrderItem`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `orderNo` | `string` | 形态 `SO-<YYYYMMDD>-<序号>`；**跨重启唯一**（§三） |
| `status` | `string` | 封闭枚举：**`paid`**（假支付，下单即已支付；`Q-4` 要求 UI 与文档显式标注演示） |
| `items[]` | `OrderItem[]` | 下单快照 |
| `itemCount` | `integer` | Σ `quantity` |
| `totalCents` | `integer` | Σ `lineTotalCents` |
| `createdAt` / `paidAt` | `string` | ISO8601 UTC（本包两值相等，但不合并字段） |
| `OrderItem.productId` / `productName` / `unitPriceCents` / `quantity` / `lineTotalCents` | 同 `CartItem` | 快照语义 |

### 2.5 `Health`（`GET /health` 出参，**无需鉴权**）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `string` | `"ok"`（健康）或非 `"ok"`（不健康） |
| `uptimeMs` | `integer` | 进程已运行毫秒（**只断类型，不断数值**） |
| `db.ok` | `boolean` | **真的执行一次库探针**（如 `SELECT 1` + 读 `schema_migrations` 最新版本）后的结果 |
| `version` | `string` | 非空版本串（取自 `package.json` 的 `version`） |

- 健康 ⇒ `200`；库探针失败 ⇒ **`503`**（状态码本身表达不健康，**不套用错误词表**；响应体仍为结构化 JSON，不含堆栈）。

### 2.6 字段命名一致性（不得出现同义异名）

| 概念 | 唯一字段名 | 禁止出现的别名 |
| --- | --- | --- |
| 金额 | `*Cents` | `price` / `amount` / `total`（无 `Cents` 后缀） |
| 件数 | `quantity` / `itemCount` / `quantityTotal` | `count` / `num` / `qty` |
| 订单号 | `orderNo` | `orderId` / `no` / `orderNumber` |
| 用户 | `user` / `userId` | `account` / `customer` |
| 会话 cookie 名 | `sid` | `session` / `token`（cookie 名） |

---

## 三、数据库 schema、迁移与事务（**契约层定死**）

### 3.1 通用 pragma 与连接口径

| 项 | 取值 | 依据 |
| --- | --- | --- |
| 引擎 | `node:sqlite` 的 **`DatabaseSync`**（**同步** API） | `Q-1` = A；实测 `DatabaseSync` 无 `backup` 方法 ⇒ 见 §三.6 |
| `journal_mode` | **`WAL`**（建库时设置一次，实测返回 `wal`） | 崩溃安全 + 读写并发 |
| **侧车文件**（背景事实） | `journal_mode = WAL` ⇒ 卷内库文件会**同时出现 `shop.db-wal` / `shop.db-shm` 侧车**（`-wal` 装着**尚未合并进主文件的事务**）；**它们属于库的一部分**，任何「拷贝 / 替换库文件」都必须**成组处置**（见 §3.6） | 见 §3.6 恢复步骤 |
| `foreign_keys` | **`ON`**（实测返回 `1`；**每个连接都要设**，不是持久设置） | 引用完整性 |
| `busy_timeout` | **`5000` ms**（暂定值） | 单实例 + WAL 下的锁等待兜底 |
| 主键风格 | `products` / `users` / `carts` 用 `TEXT`；`orders` 用 `INTEGER PRIMARY KEY AUTOINCREMENT`（内部主键，**不出现在接口**）；`order_items` / `cart_items` 用复合主键 | 订单号是**对外**标识，内部主键只做引用 |
| 时间戳 | 全部 `INTEGER`（**UTC epoch 毫秒**）；出参 `toISOString()` 转 ISO8601 UTC | §一「时间字段」 |

### 3.2 表清单（18 个字段级约束中的关键处已加粗）

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,          -- 存小写归一后的值；UNIQUE 即防重复注册（AC-11）
  password_hash TEXT NOT NULL,                 -- 仅库内，格式见 §四
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,               -- sha256(token) 的 hex；明文 token 不落库
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,               -- 空闲超时用它（AC-12）
  expires_at   INTEGER NOT NULL                -- 绝对过期（AC-12）
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS carts (
  id         TEXT PRIMARY KEY,                 -- 匿名车 = 下发过的 cartId；用户车 = 该用户的固定车 id
  user_id    TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,  -- UNIQUE ⇒ 一用户至多一辆车
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id    TEXT    NOT NULL REFERENCES carts(id)    ON DELETE CASCADE,
  product_id TEXT    NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 8),
  PRIMARY KEY (cart_id, product_id)            -- 同一车同一商品只有一行（AC-15 的"只有一行"由此保证）
);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  no         TEXT    NOT NULL UNIQUE,          -- AC-56：唯一约束是"重号"的最后一道闸
  user_id    TEXT    NOT NULL REFERENCES users(id),
  status     TEXT    NOT NULL CHECK (status IN ('paid')),
  item_count INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  paid_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);  -- AC-09 倒序分页

CREATE TABLE IF NOT EXISTS order_items (
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       TEXT    NOT NULL,
  product_name     TEXT    NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity         INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- 订单号取号（AC-56 的关键）：按日计数，跨重启单调
CREATE TABLE IF NOT EXISTS order_no_seq (
  day TEXT PRIMARY KEY,                        -- 'YYYYMMDD'（UTC 日）
  seq INTEGER NOT NULL CHECK (seq >= 1)
);
```

- **`cart_items` 的复合主键**是「登录合并后同一商品只有一行」的**结构性保证**，不靠应用层去重（`AC-15`）。
- **`orders.no` 的 `UNIQUE`** 是 `AC-56` 的兜底；应用层取号口径见 §三.4。
- 商品名称索引**不建**（`≤1k` 商品，全表扫足够；`Q-10` 最小可用假设）。

### 3.3 迁移与幂等播种（`AC-06` / `P-12` / `P-13` / `E-15` / `E-18`）

| 项 | 口径 |
| --- | --- |
| 迁移载体 | 代码内置的**有序数组**（`{ version: 1, sql }`、`{ version: 2, sql }`…），运行时逐个应用；**不引入迁移框架**（零依赖） |
| 记录方式 | 每个版本在**同一个事务**内：执行 DDL/DML → `INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)` |
| 幂等 | 启动时读 `MAX(version)`，只应用 `> MAX` 的版本；重复启动是 no-op（`AC-06` 断言三次重复执行） |
| 版本超前 | 库内 `MAX(version)` **高于**代码最新版本 ⇒ **拒绝启动 + 非零退出**，日志点名「库版本高于程序版本」（`E-18`）；**不得**静默降级运行 |
| 中断可重入 | 迁移中途失败 ⇒ 该版本整体回滚（不留半迁移态），重启后从该版本重试（`E-15`） |
| 播种 | 版本 1 的迁移内**幂等**插入 8 条种子商品（暂定值，沿用 `FEAT-001 Q-1`）：`INSERT ... ON CONFLICT(id) DO NOTHING`；**不覆盖**已存在的行（重启后不改价、不补库存） |
| 播种与库存 | 种子 `stock = 8`（暂定值）；重启**不得**把卖掉的库存补回来（`AC-01` 的判据之一） |

### 3.4 事务边界与**订单号取号口径**（`AC-03` `AC-04` `AC-56`）

> **唯一封口写法（实测约束）**：`DatabaseSync` 下**嵌套 `BEGIN IMMEDIATE` 会抛** `cannot start a transaction within a transaction` ⇒ 存储层**只暴露一个** `withTx(fn)`：

```js
// server/src/store.mjs（形状锁定，签名不得偏离语义）
store.withTx(fn)   // 内部：BEGIN IMMEDIATE → fn() → COMMIT；fn 抛错 ⇒ ROLLBACK 后原样抛出
```

- **禁止**在 `fn` 内再开事务；**禁止**裸 `BEGIN` / `COMMIT`（事务只能经 `withTx`）。
- `withTx` **可重入即报错**（不得静默嵌套），错误信息须可辨认（便于 test 抓「误用」而不是业务错）。

**`POST /api/v1/orders` 的完整事务（顺序固定，全部在**同一个** `withTx` 内）**：

| 步 | 动作 | 失败语义 |
| --- | --- | --- |
| ① | 读取该主体购物车全部行（含关联商品 `price_cents` / `stock`） | — |
| ② | 车为空 ⇒ 抛 `CART_EMPTY`（`409`） | 回滚（无副作用） |
| ③ | 逐行 `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`；**`changes === 0` ⇒ 抛 `INSUFFICIENT_STOCK`（`409`）** | **整个事务回滚**：不产生订单、不改任何库存（`AC-04` 防超卖的判据） |
| ④ | **取号**（见下），得到 `no` | 唯一冲突 ⇒ 重试一次（见下） |
| ⑤ | `INSERT INTO orders(...)` | — |
| ⑥ | `INSERT INTO order_items(...)`（逐行快照） | — |
| ⑦ | 清车：`DELETE FROM cart_items WHERE cart_id = ?` | — |

**取号口径（本期新引入缺陷面，`AC-56` 定死为唯一写法）**：

```sql
-- 同一 withTx 内执行；原子自增 + 返回新值
INSERT INTO order_no_seq(day, seq) VALUES (?, 1)
ON CONFLICT(day) DO UPDATE SET seq = seq + 1
RETURNING seq;
```

- `day` = **UTC 日期** `YYYYMMDD`（由注入时钟 / 当前时间算出；UTC 以避免时区漂移，也让单测可注入）。
- `no = 'SO-' + day + '-' + String(seq).padStart(4, '0')`；`seq > 9999` 时**自然变长**（如 `SO-20261015-10000`），**禁止截断**（截断即重号）。
- **为什么不用内存计数器**：现状 `server/src/store.mjs:62-75` 的 `nextOrderNo` 依赖内存 `orderSeq`（`:18` 初值 `0`）—— 在 FEAT-001 下重启即清空订单所以永不重号；**持久化之后**同一 UTC 日重启必然重号。本契约把取号搬进库、搬进事务。
- **单调性要求**：`order_no_seq` 只增不减（迁移与清理脚本**不得**删除该表行）；同日重启后序号**继续递增**（`AC-56` 断言两单号不同且历史单仍在）。
- **重试口径**：若 `INSERT INTO orders` 仍因 `no` 唯一冲突失败（理论上不该发生），在**同一 `withTx` 内**重取一次号并重试（最多 1 次）；再失败 ⇒ 抛 `INTERNAL_ERROR`（`500`），整个事务回滚。

### 3.5 并发与锁（`Q-8` = A）

| 项 | 口径 |
| --- | --- |
| 部署形态 | **单实例**（不横向扩展；`Q-8` = A） |
| 写并发 | 由 `BEGIN IMMEDIATE` + 条件 `UPDATE`（`stock >= ?`）保证**不超卖**（`AC-04` `E-14`） |
| 同会话并发下单 | 两单中最多一单成功（另一单因车已清空 ⇒ `CART_EMPTY`，或库存不足 ⇒ `INSUFFICIENT_STOCK`）；**库存不得为负** |
| 读并发 | WAL 下读不阻塞写；`/health` 探针为只读 |
| 锁等待 | `busy_timeout = 5000`；超时 ⇒ 抛错 ⇒ 映射 `500 INTERNAL_ERROR`（**不得**伪装 `404`） |

### 3.6 备份与恢复（`Q-11` = A / `AC-32` / `E-06`）

| 项 | 口径 |
| --- | --- |
| 备份方式（**首选**） | **模块级** `import { backup } from 'node:sqlite'` ⇒ `await backup(db, targetPath)`（实测：模块级函数存在、**返回 `Promise`**、产出的快照可独立打开；`db.backup` **不存在**，`typeof db.backup === 'undefined'`） |
| 备份方式（备选） | `VACUUM INTO 'target.db'`（实测可用；在同一连接上执行，产出压缩后的独立库文件） |
| **禁止** | 在 WAL 模式下**裸 `cp` 库文件** —— **备份方向**（`-wal` / `-shm` 未合并 ⇒ 可能拿到不一致快照）与**恢复方向**（覆盖主文件却把残留 `-wal` 留下 ⇒ 下次启库**回放该 WAL**、把恢复**原地撤销**，且 `rc=0` / 文件指纹相符 / `/health 200` **全绿零报错**）**都禁止**；恢复或替换库文件必须**同时 `rm -f` 掉 `-wal` / `-shm` 侧车**（触发条件是**非干净停机**：OOM / `docker kill` / 宿主断电或重启不会 checkpoint `-wal`；干净停机本就不存在该文件，故**无条件清一次**即可） |
| 落点 | `BACKUP_DIR`（默认 `./backups`，暂定值）下的 `shop-<YYYYMMDD>.db`，日期取 `BACKUP_DIR` 内文件名判定的 **UTC 日** |
| **快照命名粒度**（UAT 额外发现 `E8`） | 快照名**只精确到 UTC 日** ⇒ **同一 UTC 日重复备份是覆盖同一份**，**不是**「换错快照的后悔药」：要留退路须在重要变更前把当前快照**手工另存**成别的文件名；回滚后 `BACKUP_DIR` 内那份**已是回滚后的状态**，**不得**再拿它当回滚目标 |
| 保留 | **14 天**（`Q-11` = A，**裁定值**）：清理条件 = `now - 备份时间 > 14 天` ⇒ 删；`<= 14 天` ⇒ 留。时间取**文件名日期或 `mtime` 之一**（实现声明一种并写在 `docs/DEPLOY.md`；判据只断相对天数差） |
| 失败可观测 | 备份失败 ⇒ `error` 级日志 + **非零退出**；**不删除**既有备份（`E-06`） |
| 恢复步骤 | `docs/DEPLOY.md` 必须给出可执行步骤（停服 → **清 `-wal` / `-shm` 侧车** → 用备份文件替换 `DB_PATH` → 起服），并以「恢复后能按 `orderNo` 查到订单、行数对得上」作为演练判据（`AC-32` Then ③）。**恢复成功的唯一判据是数据本身** —— **不是**退出码、**不是**库文件指纹（sha256）、**不是** `GET /health` 为 `200`：**非干净停机残留非空 `-wal` 时这三者可以全绿而恢复实际未生效**（UAT 额外发现 `E9`，读数 `reports/uat/evidence/FEAT-002-uat/ops/e7d-stalewal2.out`（照原文 → 仍 2 单）vs `e7e-walfix.out`（补 `rm -f` → 快照时刻 1 单）） |
| 触发入口 | 单次入口脚本 `scripts/ops/backup.mjs`（可被 cron / 宿主任一调度器调用）；**不在应用进程内起定时器**（单实例 + 显式运维动作，便于测试） |

---

## 四、账号、会话与越权口径（`Q-3` = B / `Q-3` 子项 3-a / `RSK-10`）

### 4.1 凭据与口令存储

| 项 | 口径 |
| --- | --- |
| 邮箱归一 | `trim()` 后 `toLowerCase()`；入库与比较**都用归一键**；格式校验宽松（含 `@` 与 `.`、无空白、长度 3..254）；非法 ⇒ `400 INVALID_BODY` |
| 口令长度 | **8..128** 字符（**暂定值，依据 `RSK-10` 缓解建议；PRD §7 `Q-15`**）；不在区间内 ⇒ `400 INVALID_BODY`。**不强制**大小写 / 数字 / 符号组合（低摩擦 + 限流兜底） |
| 哈希算法 | **`node:crypto` 的异步 `scrypt`**（零依赖；**`r3` 由 `scryptSync` 改为异步** —— 同步版会在单线程事件循环上做 16 MiB 级内存硬哈希，`AC-23` 的并发面会被一个登录请求整体卡住）：`N = 16384`（`2^14`）、`r = 8`、`p = 1`、`keylen = 64`、`maxmem = 64 * 1024 * 1024`（= 64 MiB，须 ≥ 运行时所需 `128 · N · r = 16 MiB`）；盐 = **16 字节随机**（`randomBytes(16)`）；**实现必须走异步形式**（`promisify` 或 callback 包裹），**不得**保留 `scryptSync` 调用点 |
| 库内存储格式 | 单列 `password_hash` = `scrypt$16384$8$1$<saltHex>$<hashHex>`（自描述，便于日后换参数：读到不匹配的参数即视为需重算） |
| 比较 | **`crypto.timingSafeEqual`**（等长比较；长度不等直接判否，不泄露时序差异） |
| 时序一致性（防枚举，`AC-13`） | **登录路径对「账号不存在」也必须执行一次等价的 `scrypt` 校验**（用与该账号无关的固定哑元盐 / 哈希，参数完全相同），使「账号存在但口令错」与「账号不存在」两条路径**耗时同量级**；**不得**以「查不到就提前返回」短路（否则 `code` / `message` 虽逐字相同，仍可被时序枚举 —— 兑现 `AC-13` 的防枚举意图，不只是响应体一致） |
| 响应与日志 | 注册 / 登录 / 错误体 / 日志**一律不含**口令明文、`password_hash`、盐或会话 token（`AC-18`） |

### 4.2 会话（**必须持久化**，`AC-01` 的前置设计约束）

| 项 | 口径 |
| --- | --- |
| 载体 | **`sessions` 表**（不是内存 Map、不是纯签名 cookie） ⇒ **重启后旧 cookie 仍有效**（`AC-01` 直接跨重启比对数据的前提） |
| token 生成 | `randomBytes(32)` → `base64url`（43 字符）；**明文只出现在 `Set-Cookie`**，库内只存 `sha256(token)` 的 hex（`token_hash`） |
| cookie 名 | **`sid`** |
| cookie 属性 | `HttpOnly` · `SameSite=Lax` · `Path=/` · `Max-Age=604800`（**7 天** = 绝对有效期，**暂定值，PRD §7 `Q-16`**）· `Secure` **仅当** `COOKIE_SECURE=1`（默认 `0`；反代终结 TLS 的生产部署必须置 `1`） |
| 绝对过期 | `expires_at = created_at + 7 天`（不可续期） |
| 空闲过期 | `last_seen_at` 每次**成功鉴权**的请求刷新；`now - last_seen_at > 30 分钟` ⇒ 视为过期（**暂定值，PRD §7 `Q-16`**） |
| 过期 / 伪造 / 未知 token | 一律按**未登录**处置（`E-01`）：受保护面 `401 UNAUTHENTICATED`；购物车面按**新匿名车**返回 `200` 并下发新 `cartId`；**不得** 5xx |
| 登出 | `DELETE FROM sessions WHERE token_hash = ?` + `Set-Cookie: sid=; Max-Age=0; Path=/`（`AC-16`） |
| 时钟注入 | 时间判定一律走可注入的 `now()`（契约 §八）⇒ 过期档**不真实等待**（`AC-12` `Q-16` 的可测性前提） |
| 清理 | 过期会话 / 长期无主匿名车的清理**不在本期必做**（PRD §7 `Q-18`，本轮按 B 交付：不主动清理，文档写明增长与手工清理步骤；`scripts/ops/` 可放一个清理脚本作为可选运维动作） |

### 4.3 身份判定顺序与 cookie 下发（**顺序固定**）

1. 请求带 `sid` 且**有效**（存在、未绝对过期、未空闲过期）⇒ 主体 = 该 `user_id`；购物车 = 该用户的库内车（不存在则**惰性创建**）；刷新 `last_seen_at`。
2. 否则若带 `cartId` 且命中 `carts.user_id IS NULL` 的行 ⇒ 主体 = 匿名车。
3. 否则 ⇒ **新建**匿名车，并在响应中 `Set-Cookie: cartId=<新车 id>; HttpOnly; SameSite=Lax; Path=/`。

> **匿名车作废（`3-a①`）**：登录时匿名车行被**删除**（`carts` 行 + 级联 `cart_items`）⇒ 旧 `cartId` 不再可寻址；客户端再用旧 `cartId` 请求时命中第 3 条 ⇒ 得到一个**新的空匿名车**（绝不回放已并入的行）。

### 4.4 登录合并（`3-a①`，**整体原子**）

在**一个 `withTx`** 内：

1. 找到（或创建）该用户的库内车。
2. 若当前匿名车存在且非空：对每个匿名车行，与用户车同商品行**件数相加**（`quantity` 相加，**不是覆盖**）；相加后 > 8 ⇒ **抛 `QUANTITY_LIMIT_EXCEEDED`（`409`）**，**整个合并回滚**（用户车与匿名车**均保持合并前状态**，无部分写入 —— `E-19`）。
3. 写入合并结果（`INSERT ... ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity`）。
4. **删除**匿名车行（级联清 `cart_items`）。
5. 登录响应 `Set-Cookie: cartId=<用户车 id>`（覆盖旧匿名标识，避免客户端继续引用已作废的车）。

> **「未登录不能下单」优先于「空车」**：`POST /api/v1/orders` 在鉴权步就返回 `401 UNAUTHENTICATED`；只有**已登录**才可能拿到 `409 CART_EMPTY`（`AC-14` `E-11`）。

### 4.5 权限码与数据范围（**文档层口径**，不引入 RBAC 实现）

| 角色 | 权限码 | 数据范围 |
| --- | --- | --- |
| 匿名（未登录） | `product:catalog:read` · `ops:health:read` · `cart:own:read`（匿名车）· `cart:own:write`（匿名车） | 仅公开目录 + 自己那辆匿名车 |
| `user`（已登录，单角色） | 上述公开码 + `order:own:read` · `order:own:create` · `session:own:manage` | **仅本人资源**（`own`） |

**越权口径（本项目裁定，写死）**：

| 情形 | 返回 | 说明 |
| --- | --- | --- |
| 未登录访问受保护面（`POST /orders`、`GET /orders`、`GET /orders/{orderNo}`、`GET /auth/me`） | **`401 UNAUTHENTICATED`** | 唯一的鉴权失败码 |
| 已登录访问**他人**资源（如他人 `orderNo`） | **`404 NOT_FOUND`** | **与「资源不存在」逐字同形**（`code` 与 `message` 完全一致），不暴露存在性 |
| 已登录访问**不存在**的资源 | **`404 NOT_FOUND`** | 与上一行**不可区分**（这正是判据要的） |
| 本包是否存在 `403` | **不存在** | 有鉴权但越权一律 `404`（`S-16`）；任何角色断言 `403` 即判不合格 |

---

## 五、端点清单

> 每个端点标 `alignment`：`keep` = 语义不变（可能新增可选字段）· `change` = 入参 / 出参 / 鉴权 / 错误有变化（**必须逐条写明变化点**）· `new` = 本期新增。
> **`AC` 回指**见 §1.3；本节的「错误」列只列该端点**可能**出现的词表内码。

### 5.1 `GET /api/v1/products` — 商品列表（`change`）

| 项 | 内容 |
| --- | --- |
| 变化点 | ① 新增**可选**分页 `limit` / `offset`；② 数据源从内存种子改为**库表**（响应形状不变） |
| 入参 | `limit`（可选，默认 **200**，上限 **200**，**暂定值依据 `Q-10`**）· `offset`（可选，默认 `0`） |
| 出参 | `{ data: Product[] }`；`limit` 生效时返回至多 `limit` 条，顺序**稳定**（按 `products.id` 升序，与 FEAT-001 一致） |
| 错误 | `400 INVALID_PAGINATION`（非法分页）· `500 INTERNAL_ERROR` |
| 鉴权 | 公开 |

### 5.2 `GET /api/v1/products/{id}` — 商品详情（`keep`）

| 项 | 内容 |
| --- | --- |
| 变化点 | 无（读库实现细节变化不构成契约变化） |
| 出参 | `{ data: Product }` |
| 错误 | `404 NOT_FOUND`（商品不存在）· `500 INTERNAL_ERROR` |
| 鉴权 | 公开 |

### 5.3 `POST /api/v1/auth/register` — 注册（`new`）

| 项 | 内容 |
| --- | --- |
| 入参 | `{ email: string, password: string }` |
| 出参 | `201` + `{ data: { user: User } }`；**同时** `Set-Cookie: sid=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`（注册即登录，`AC-10`） |
| 错误 | `400 INVALID_BODY`（邮箱格式 / 口令长度 / 缺字段）· `409 EMAIL_TAKEN`（**大小写归一同键**，`AC-11`）· `413 PAYLOAD_TOO_LARGE` · `429 RATE_LIMITED` · `500 INTERNAL_ERROR` |
| 鉴权 | 公开（但**不得**在已登录态悄悄换用户：实现须忽略当前 `sid` 或直接允许——**契约取「允许」**，即注册成功即切换为**新用户**的会话） |
| 副作用 | 新 `users` 行 + 新 `sessions` 行；**不**自动并入当前匿名车（合并只发生在登录，`3-a①`） |

### 5.4 `POST /api/v1/auth/login` — 登录（`new`）

| 项 | 内容 |
| --- | --- |
| 入参 | `{ email: string, password: string }` |
| 出参 | `200` + `{ data: { user: User } }` + `Set-Cookie: sid=...`（并在发生合并时覆盖 `cartId`，§4.4） |
| 错误 | `400 INVALID_BODY` · **`401 INVALID_CREDENTIALS`**（口令错**与**邮箱不存在**返回完全相同的 `code` + `message`**，防枚举，`AC-13`）· `409 QUANTITY_LIMIT_EXCEEDED`（合并后越上限，`E-19`）· `413` · `429` · `500` |
| 鉴权 | 公开 |
| 副作用 | 新 `sessions` 行 + **匿名车并入**（原子，§4.4）+ 匿名车删除 |
| 时序 | 对「账号不存在」**同样执行一次等价的 `scrypt` 校验**（§4.1「时序一致性」），使两条路径耗时同量级 —— 与 `401 INVALID_CREDENTIALS` 的**逐字相同响应**共同构成防枚举面（`AC-13`；`r3` 起为明文契约要求） |

### 5.5 `POST /api/v1/auth/logout` — 登出（`new`）

| 项 | 内容 |
| --- | --- |
| 入参 | 无（可为空体） |
| 出参 | `200` + `{ data: { ok: true } }`；`Set-Cookie: sid=; Max-Age=0; Path=/` |
| 错误 | `500 INTERNAL_ERROR` |
| 鉴权 | **公开**（未登录调用也返回 `200`；不引入 `401`，因为「登出」是幂等无害动作） |
| 副作用 | 删除当前 `sessions` 行；**账号车与订单不受影响**（`AC-16`）；随后请求按未登录处置 ⇒ 下一次购物车请求会下发**新的空匿名车** |

### 5.6 `GET /api/v1/auth/me` — 当前用户（`new`）

| 项 | 内容 |
| --- | --- |
| 出参 | `200` + `{ data: { user: User } }` |
| 错误 | `401 UNAUTHENTICATED`（未登录 / 会话过期 / 伪造）· `500` |
| 鉴权 | **需要登录**（本条是「会话有效」的探针，`AC-12`） |

### 5.7 `GET /api/v1/cart` — 查购物车（`change`）

| 项 | 内容 |
| --- | --- |
| 变化点 | ① 归属从「匿名 `cartId`」变为**两级**（登录 ⇒ 用户车；未登录 ⇒ 匿名车）；② `cartId` 字段语义不变（回显当前生效的车 id） |
| 出参 | `{ data: Cart }` |
| 错误 | `500` |
| 鉴权 | 公开（未登录得到匿名车；**不**返回 `401`） |
| 副作用 | 无车时**惰性创建**并下发 `cartId` |

### 5.8 `POST /api/v1/cart/items` — 加入购物车（`change`）

| 项 | 内容 |
| --- | --- |
| 变化点 | 归属两级；其余口径沿用（件数上限 8、种数上限 8、`stock === 0` 缺货） |
| 入参 | `{ productId: string, quantity: integer }`（`quantity` 缺省 `1`） |
| 出参 | `201` + `{ data: Cart }` |
| 错误 | `400 INVALID_BODY` · `400 INVALID_QUANTITY`（非整数 / ≤0 / >8）· `404 NOT_FOUND`（商品不存在）· `409 CART_FULL`（已有 8 种）· `409 QUANTITY_LIMIT_EXCEEDED`（累加 >8）· `409 OUT_OF_STOCK`（`stock === 0`）· `413` · `429` · `500` |
| 鉴权 | 公开（匿名车亦可加购） |

### 5.9 `PATCH /api/v1/cart/items/{id}` — 改件数（`change`）

| 项 | 内容 |
| --- | --- |
| 变化点 | 归属两级；`{id}` = `productId`（沿用）；其余不变 |
| 入参 | `{ quantity: integer }`（1..8；`0` **不表示删除**，删除走 `DELETE`） |
| 出参 | `200` + `{ data: Cart }` |
| 错误 | `400 INVALID_BODY` · `400 INVALID_QUANTITY` · `404 NOT_FOUND` · `409 QUANTITY_LIMIT_EXCEEDED` · `409 OUT_OF_STOCK` · `429` · `500` |
| 鉴权 | 公开 |

### 5.10 `DELETE /api/v1/cart/items/{id}` — 删行（`change`）

| 项 | 内容 |
| --- | --- |
| 变化点 | 归属两级；其余不变 |
| 出参 | `200` + `{ data: Cart }` |
| 错误 | `404 NOT_FOUND`（行不存在）· `429` · `500` |
| 鉴权 | 公开 |

### 5.11 `POST /api/v1/orders` — 下单（假支付，`change`）

| 项 | 内容 |
| --- | --- |
| 变化点 | ① **需要登录**（未登录 ⇒ `401 UNAUTHENTICATED`，此前无此概念）；② 订单**落库**并归属 `user_id`；③ 订单号取号口径改为库内序列表（§3.4）；④ 下单三件事（建单 / 扣库存 / 清车）**同一事务** |
| 入参 | 无（可为空体） |
| 出参 | `201` + `{ data: Order }`（`status === "paid"`） |
| 错误 | `401 UNAUTHENTICATED` · `409 CART_EMPTY` · `409 INSUFFICIENT_STOCK` · `429` · `500` |
| 鉴权 | **需要登录** |
| 事务 | §3.4 的七步，全在一个 `withTx` 内；任一步失败 ⇒ 无订单、无库存变化、车不清空 |

### 5.12 `GET /api/v1/orders` — 我的订单列表（`change`）

| 项 | 内容 |
| --- | --- |
| 变化点 | ① **需要登录**；② **只返回本人订单**（`AC-17`）；③ 新增分页；④ 顺序**按下单时间倒序**（`created_at DESC`，同毫秒用 `id DESC` 兜底稳定性） |
| 入参 | `limit`（可选，默认 **20**，上限 **100**，**暂定值依据 `Q-10`**）· `offset`（可选，默认 `0`） |
| 出参 | `{ data: Order[] }` |
| 错误 | `401 UNAUTHENTICATED` · `400 INVALID_PAGINATION` · `500` |
| 鉴权 | **需要登录** |

### 5.13 `GET /api/v1/orders/{orderNo}` — 订单详情（`new`）

| 项 | 内容 |
| --- | --- |
| 出参 | `200` + `{ data: Order }`（仅本人订单） |
| 错误 | `401 UNAUTHENTICATED`（未登录）· **`404 NOT_FOUND`**（不存在 **或** 属于他人，**两种情形响应逐字相同**，`AC-19` `E-03`）· `500` |
| 鉴权 | **需要登录** |
| 为什么新增 | `AC-19` 的越权判据需要一个「按不可猜标识寻址的自有资源」作为取样点；`GET /orders`（列表）拿不到他人订单号，无法构成错位取样 |

### 5.14 `GET /health` — 健康与就绪（`new`）

| 项 | 内容 |
| --- | --- |
| 出参 | `200` + `{ data: Health }`（健康）· **`503`** + `{ data: Health }`（不健康：`status != "ok"`、`db.ok === false`） |
| 错误 | 不套用错误词表（`503` 用同一 JSON 结构表达）；**不得**返回堆栈 |
| 鉴权 | **公开**（容器健康检查与反代都要能无凭据访问） |
| 前缀 | **无** `/api/v1`（写死，避免健康检查依赖业务前缀版本） |
| 探针 | 真的执行一次库读（`SELECT 1` + 读 `schema_migrations` 最新版本）；**不得**返回常量 `200` |

### 5.15 静态托管（非 `/api` 面，`change`）

| 路径 | 方法 | `alignment` | 出参 |
| --- | --- | --- | --- |
| `/` · `/index.html` | `GET` | `change` | `200` + `text/html` → `web/index.html`（首帧内联商品数，**不得**残留 `{{PRODUCT_COUNT}}` / `{{NOSCRIPT_CATALOG}}` 占位符） |
| `/src/**` | `GET` | `change` | `200` + `text/javascript`（原生 ESM，无构建） |
| `/assets/products/*.jpg`（**本期新增放行**；`Q-22` 交付后变更：主图由 `*.svg` 改 `*.jpg`） | `GET` | `change` | `200` + **`image/jpeg`** → `web/assets/products/P-001.jpg`~`P-008.jpg`（**8 张本仓自托管真实照片主图**，响应体以 JPEG magic bytes `FF D8 FF` 开头；`AC-48` `AC-49` `Q-22`） |
| **二进制素材**（`.jpg` 等**非文本**资源，含今后同类新增） | `GET` | `change` | **必须按字节原样送出**：**禁止**经 UTF-8 / 字符串编解码处理**读盘**与**响应体**；`content-length` **必须等于磁盘字节数**，响应体与磁盘**逐字节相等**（**勘误 5**，见 §十 —— 这是 `AC-49` 能真正交付照片的**前置**：现状 `server/src/static.mjs:68` 的 `readFileSync(path,'utf8')` + `server/src/app.mjs:641` 的 `Buffer.from(body,'utf8')` 会把二进制写坏，test 实测 **2054 B → 2066 B**、JPEG SOI 首字节被替成 `U+FFFD` ⇒ **浏览器裂图**，而 `200` + `image/jpeg` 仍「看起来对」） |
| `/favicon.ico`（**本期新增**） | `GET` | `change` | `200` + `image/svg+xml` → 本仓自制 favicon SVG（`AC-51`） |
| 白名单外路径 / 不支持扩展名 | `GET` | `change` | **`404` + `text/plain`**（响应体固定 `404 Not Found`，**不含**任何商品 / 业务文案）；**不得** 5xx（`AC-51` `E-16` `E-17`） |
| 路径穿越（`/assets/../server/**`、`%2e%2e` 及其二次编码） | `GET` | `change` | `404`，**不得**返回 `web/` 之外任何文件内容（`AC-50`） |

**放行范围与实现约束（`S-13`，写死）**：白名单 = `/` · `/index.html` · `/src/**` · `/assets/**` · `/favicon.ico`；`CONTENT_TYPES` 增补 `.svg → image/svg+xml`（favicon）与 **`.jpg → image/jpeg`（主图，`Q-22` 交付后变更 —— 主图扩展名由 `.svg` 改 `.jpg`，不同批改就会重演「8 张图全裂」）**（`.html .mjs .js .css .json` 保留）。**必须复用** `server/src/static.mjs` 既有的 `resolveWithinWeb`（`normalize` + 前缀校验 + `safeDecode`）；**不得**另写一套路径校验（现状实测：`/assets/products/*.svg` 与 `/favicon.ico` 均为 `404 application/json` 且套用 API 商品文案 ⇒ 本期的失败形态就是「8 张图全裂」）。

**二进制透明性约束（**勘误 5**，写死）**：静态托管对**二进制素材**必须**全程走字节** —— `loadFile` 按 `Buffer` 读盘（**不得** `readFileSync(path, 'utf8')`）、`negotiate` / 响应体直接回该 `Buffer`（**不得** `Buffer.from(body, 'utf8')`）；`content-length` 必须等于**磁盘字节数**，线上响应体与磁盘文件**逐字节相等**。理由：文本通道会把非法 UTF-8 序列替成 `U+FFFD`（test 实测 2054 B → 2066 B、JPEG SOI 被破坏 ⇒ **浏览器裂图**），而白名单与 `CONTENT_TYPES` 全对、状态码与 `content-type` 也全对 —— **`AC-49` 的三项纸面判据全绿、照片仍是坏的**，故本条是 `AC-49` 交付真照片的**前置能力要求**（test 已按此加两条硬判据：`content-length` == 盘上字节数 · 线上字节与磁盘逐字节相等）。**同版收口（2026-10-16，主控裁定）**：逐字节相等只保证「**忠实**」，**不保证「完整」** —— 服务端**忠实转发一个结构损坏的文件**仍会绿；故 `AC-49` 同批新增「**转发字节本身亦须结构完整**」的断言（与 `AC-48` ③ **同口径**：`SOI` → 逐段 2 字节大端段长自洽且落在文件内 → `SOF` 正方形且边长 ≥ 400 → `SOS` 后非空熵编码数据 → **必须以 `EOI` 结束**且解析一致走到文件尾）；依据 = **`logic-review` 的反例** + 主控裁定。**分工不变**：`AC-48` 断**源文件**、`AC-49` 断**线上字节**，两者**都要过**。

---

## 六、错误码词表（**封闭词表，契约层定死**）

| `code` | HTTP | 触发条件 | 面向用户 `message`（关键字必须出现） | 承载 `AC` / `E` |
| --- | --- | --- | --- | --- |
| `INVALID_BODY` | `400` | 体非 JSON / 缺必填字段 / 字段类型或长度非法（含邮箱格式、口令长度） | 「请求格式不正确」 | `E-02` `E-07` |
| `INVALID_QUANTITY` | `400` | `quantity` 非整数 / `<= 0` / `> 8` | 「购买数量必须是 1 到 8 之间的整数」 | `AC-55` |
| **`INVALID_PAGINATION`** | `400` | `limit` / `offset` 非整数或越界 | 「分页参数不正确」 | `AC-08` `AC-09` `E-09` |
| `NOT_FOUND` | `404` | 商品不存在 / 购物车行不存在 / **订单不存在或不属于当前用户**（两种情形同形） | 「找不到该商品」/「购物车里没有这件商品」/「找不到该订单」 | `AC-19` `AC-55` `E-03` `E-16` `E-17` |
| **`UNAUTHENTICATED`** | `401` | 未登录 / 会话过期 / 会话伪造，访问受保护面 | 「请先登录」 | `AC-14` `AC-17` `E-01` `E-11` |
| **`INVALID_CREDENTIALS`** | `401` | 登录时口令错**或**邮箱不存在（**同形**） | 「邮箱或密码不正确」 | `AC-13` |
| `CART_EMPTY` | `409` | 空购物车提交下单（含重复提交） | 「购物车是空的」 | `AC-03` `E-10` `E-11` |
| `CART_FULL` | `409` | 购物车已含 8 种商品，再加第 9 种 | 「购物车最多放 8 种商品」 | `AC-55` |
| `QUANTITY_LIMIT_EXCEEDED` | `409` | 单行件数累加后超过 8（含**登录合并**后越限） | 「单件商品最多买 8 件」 | `AC-55` `E-19` |
| `OUT_OF_STOCK` | `409` | `stock === 0` 时加购 / 改件数 | 「该商品暂时缺货」 | `AC-55` |
| `INSUFFICIENT_STOCK` | `409` | 下单所需件数 > 当前库存 | 「库存不足」 | `AC-04` `E-14` |
| **`EMAIL_TAKEN`** | `409` | 注册时邮箱已存在（大小写归一同键） | 「该邮箱已注册」 | `AC-11` |
| **`PAYLOAD_TOO_LARGE`** | `413` | 请求体超过 **128 KiB** | 「请求内容过大」 | `AC-22` `E-07` |
| **`RATE_LIMITED`** | `429` | 写接口超限（`AC-23`，**三维**：每会话 `R = 60` / 每 IP `R_ip = 240` / 全局 `R_all = 1200` 次每 60 秒窗口，任一维超限；**另含在途并发上限 `C = 16`**）—— 响应头带 `Retry-After` | 「操作过于频繁，请稍后再试」 | `AC-23` `AC-64` `E-08` |
| **`INTERNAL_ERROR`** | **`500`** | **未预期异常**（库故障 / SQL 错 / 磁盘满 / 锁超时 / 迁移失败 / 代码缺陷） | 「服务器内部错误」 | `AC-21` `E-15` |

> **词表封闭性**：实现**不得**新增词表外的 `code`；需要新码 ⇒ 回流 PRD 待确认事项由人裁定后本表升版。
> **`500` 的映射纪律（结掉 FEAT-001 的未决偏离，`S-14`）**：请求处理链路的**最外层**兜 `try/catch` ⇒ **一律** `500 INTERNAL_ERROR`，响应体不带堆栈；**禁止**把未预期异常吞成 `404`（现状 `server/src/app.mjs:242-249` 的 `safeDispatch` 正是这么做的）。
> **客户端中断（`E-20`）不属 5xx**：请求在途被客户端断开时**无从写回响应** ⇒ 只记 `warn` 级日志 + 计数（日志字段 `outcome: "client_aborted"`），**不得**记为 `error` 级、**不得**当内部故障。理由：它不是「服务端出了错」，把它算成 `500` 会让错误率指标失真。
> **`403` 缺席声明（理由已变，结论不变）**：本包**有鉴权**，但**越权一律 `404`（不暴露存在性）、未登录才 `401`** ⇒ 仍**无 `403` 面**。任何角色断言 `403` 即判不合格（PRD §1.5 `S-16`；与总纲 §6.4 第 16 条的张力见 PRD §7 `Q-19`）。

---

## 七、静态、配置与部署条款

### 7.1 配置项清单（**环境变量，变量名定死**）

| 变量 | 必填 | 默认 | 说明 | 校验（非法 ⇒ 启动期非零退出 + 日志点名变量，`AC-26`） |
| --- | --- | --- | --- | --- |
| `HOST` | 否 | `127.0.0.1` | 监听地址（容器内需 `0.0.0.0`） | 非空字符串 |
| `PORT` | 否 | `3000` | 监听端口；`0` = 系统分配 | 整数且 `0 <= PORT <= 65535` |
| `DB_PATH` | 否 | `./data/shop.db` | 库文件路径（测试用 `:memory:` / 临时文件） | 父目录可写（不可写 ⇒ 非零退出，`E-04`） |
| `SESSION_SECRET` | **是**（生产） | 无（**开发档**可在无值时生成随机值并打 `warn` —— **且该值会持久化**，见说明） | 会话 token 的 HMAC 派生密钥（至少 32 字符）。**承诺的是「生效」而非「可配置」**：会话 token 的校验值由该密钥派生（库内**只存派生 / 摘要值**，不存可直接复用的明文 token）⇒ **换密钥后旧会话必须失效**（`AC-63`）。**开发档的密钥持久化（`r3` 同版收口，与 `docs/DEPLOY.md` 及 dev 实现一致）**：未显式提供时生成的随机密钥**持久化到 `<DB_PATH>.dev-session-secret`**（权限 **`0600`**；已存在且 ≥ 32 字符则复用），目的是「**换进程重启不掉线**」（每次随机会把已登录会话**全部踢下线**）；**日志只打路径字段 `secretFile` 与是否复用，不打密钥本身**；**不入库**（它是本地开发产物，`.gitignore` 已补 `*.dev-session-secret`；备份 / 迁移也不必带上它）。**compose 与 `.env.example` 均不提供可用的默认密钥**（`.env.example` 里 `SESSION_SECRET=` 是**空占位 + 生成命令**） | 存在时长度 ≥ 32；生产（`NODE_ENV=production`）**必须**提供，且**不落盘、不使用该文件**；缺失 / 短于 32 字符 ⇒ 启动期**非零退出（实测 `rc=1`）** + 日志点名变量（`AC-26` ③） |
| `COOKIE_SECURE` | 否 | `0` | 是否给会话 cookie 加 `Secure`（反代 TLS 生产必须 `1`） | `0` / `1` |
| `TRUST_PROXY` | 否 | `0` | 是否信任反代传来的 `X-Forwarded-*`（**限流取真实 IP 用**）。置 `1` ⇒ **必须真采信** `X-Forwarded-For` 的**首个（最左）** IP 作为限流 IP 维度来源（`AC-64`）；置 `0`（默认）⇒ 一律按对端地址计数，**伪造转发头不得获得额外额度、也不得把限流甩给别的 IP** | `0` / `1` |
| `LOG_LEVEL` | 否 | `info` | 日志级别 | `debug` / `info` / `warn` / `error` 之一 |
| `BODY_LIMIT_BYTES` | 否 | `131072` | 请求体上限 | 正整数 |
| `RATE_LIMIT_WINDOW_MS` | 否 | `60000` | 限流窗口 | 正整数 |
| `RATE_LIMIT_MAX` | 否 | `60` | 窗口内写请求上限 | 正整数 |
| `BACKUP_DIR` | 否 | `./backups` | 备份落点 | 可创建 / 可写 |
| `BACKUP_RETENTION_DAYS` | 否 | `14` | 备份保留天数 | 非负整数 |
| `NODE_ENV` | 否 | `development` | 运行环境 | `development` / `production` / `test` |

> `deploy/.env.example` 必须覆盖**全部必填**变量并给出占位 / 生成命令（**不得**含真实凭据）；`docs/DEPLOY.md` 的变量表与**本表双向包含**（`AC-35`）。

> **开发档密钥持久化的跳过条件（`r3` 同版收口 = 新增真源口径，`AC` 编号不变；`prdVersion` 仍 3）**：当 **`DB_PATH` 为 `:memory:`**、或其**父目录不可写**时，开发档**跳过持久化** —— 退化为**进程内随机密钥 + `warn`**，**不得生成任何 sidecar 文件**。
> - **`:memory:` 档 = 本条唯一的机器承载（可断判据）**，三项：① **不落 sidecar**（断言 `<DB_PATH>.dev-session-secret` 未生成，且工作目录 / 库目录**不新增**同名文件）；② **进程可起**（能正常 `listen` 并对外服务）；③ **日志有 `warn` 且不含密钥本身**（只打 `secretFile` 与是否复用）。
> - **「父目录不可写」档 = 实现约定 / 防御性兜底，无独立机器判据**：该支**受 `E-04` 前置遮蔽**且**逻辑上为空（vacuous）** —— sidecar 的路径就是 **`<DB_PATH>.dev-session-secret`**、**与库同目录** ⇒ 「**库能正常打开**」**已经蕴含**「该目录可写」⇒ 也就蕴含「sidecar 写得下去」⇒ **「父目录不可写」与「库可用」不可能同时成立**（test 实测：`chmod 0500` 下 SQLite 连 `-wal` / `-shm` 都建不了 ⇒ **库先失败、进程正当拒起**，那是 `E-04` 的正当行为，密钥分支走不到）。**保留该约定的意义**：若将来 sidecar 落点与库目录**解耦**，或实现改成「先写密钥、后开库」，它才会变成可观察行为 —— **现在只作约定，不声称有机器判据**。
> - **「不得因写密钥失败而拒起」这条约定本身保留**（防御性；理由：硬失败会把纯内存 / 只读环境下的开发与测试**全部挡死**，而这类环境本就不需要跨重启保持会话）。
> - **生产档不受此豁免**：`NODE_ENV=production` 缺失 / 短于 32 字符仍**拒起并点名变量**（test 已把它写成**独立于「不可写目录」**的对照档 ⇒ **会真跑到**）。
> - **`AC` 归属**：**本条不新增 `AC` 编号**，机器承载挂在**既有 `AC-63`（会话密钥真被消费）**名下（`TC-FEAT-002-65`）—— **不是漏编号**。

### 7.2 静态资源的缓存与安全头（`AC-31` `AC-24`）

| 资源 | `Cache-Control` | 条件请求 |
| --- | --- | --- |
| HTML（`/`、`/index.html`） | `no-cache`（或 `max-age=0, must-revalidate`） | 带 `ETag` ⇒ 可 `304` |
| `/src/**`（无指纹） | `no-cache` | 带 `ETag` ⇒ 可 `304` |
| `/src/**?v=<真指纹>`（带**真**指纹） | `public, max-age=31536000, immutable`（**暂定值**，口径为「≥ 31536000」） | — |
| `/src/**?v=<非真指纹>`（退化 / 伪造） | `200` + `no-cache`（**不得 `immutable`**） | 带 `ETag` ⇒ 可 `304`；**不得 `404`**（文件存在） |
| `/assets/**`（带**真**指纹时同上；不带指纹**或指纹不等于该文件真值时 `200` + `no-cache`**，**不得 `404`** —— 文件存在） | 同上 | 带 `ETag` ⇒ 可 `304` |
| `/favicon.ico` | `public, max-age=86400`（**暂定值**） | 带 `ETag` ⇒ 可 `304` |

- **指纹定义（钉死，`r3` 主控裁定；同版收口 2026-10-16 收紧为单一处置）**：`?v=` 的值 = 该资源**文件字节**的 **`sha256` 前 10 位 hex**（小写）。**服务端必须校验**该值是否等于该文件的**真指纹** —— 相等才进「带指纹」档；**不等（含 `?v=0` / `?v=000000` 这类形态合法但退化的值）⇒ 必须仍返回 `200` 且按无指纹档处置（`200` + `no-cache` + `ETag` 协商）**。**不接受 `404`**（或任何「把已存在的资源说成不存在」的处置）—— 理由：**资源文件确实存在**，一个伪造查询串**不得**把已存在的资源变成「不存在」；**该档真正要断的是「不得得到 `immutable`」**，不是「可以 `404`」。该档**不得**返回 `public, max-age=31536000, immutable`（否则一次伪造 / 退化指纹会把错误版本钉在客户端一年；`AC-31` ⑤ 判红口径：出现 `immutable` 或返回非 `200` **均判红**）
- **指纹注入前置**：HTML 渲染期为脚本 / 样式 / 主图 URL 注入**真**内容指纹查询串（`?v=<sha256 前 10 位>`）。若实现不做注入 ⇒ `AC-31` 的「带**真**指纹」档**不可构造**，用例须在报告里如实标注该前置是否成立（**不得**静默改判据）；**⑤ 退化指纹档不受该前置影响**（可直接构造）。
- 安全响应头对**全部**响应生效，取值见 §一（同一套策略，**不按路径分叉**，`AC-24`）。

### 7.3 部署与容器（`AC-33` `AC-34` `AC-35` `AC-36`）

| 项 | 口径 |
| --- | --- |
| `deploy/Dockerfile` | 基础镜像 `node:24-alpine`；**非 root 运行**（`USER node` 且 `id -u != 0`）；`HEALTHCHECK` 命中 `GET /health`；构建上下文 = 仓库根（`docker build -f deploy/Dockerfile .`）；**只拷贝运行所需**（`server/`、`web/`、`package.json`、`scripts/ops/`）；`.dockerignore` 排除 `docs/`、`reports/`、`test/`、`node_modules/`、`.git/` |
| `deploy/docker-compose.yml` | **三个服务** —— `backup`（一次性；`restart: "no"`；被 `app` 的 `depends_on` 以 `service_completed_successfully` 前置）· `app`（常驻；具名卷挂载库目录与备份目录，`DB_PATH` 落在卷内）· `proxy`（**档案门控**，见下）；**只读根文件系统**（`read_only: true`）+ `tmpfs` 供临时目录；健康检查与 `depends_on` 条件；反代服务**必须已定义且 opt-in** —— 以**生效的** `profiles: ["proxy"]` 键表达（compose 语义：**默认不启动**，`docker compose --profile proxy up -d` 才起）；**不得把服务整段注释掉**（那会使该 profile **根本不存在**，文档里的 `--profile proxy` 命令**失效且静默 `exit 0`**）；反代服务除只读挂载 `./Caddyfile` 外另挂具名卷 **`caddy-data:/data`** + **`caddy-config:/config`**（证书 / ACME 状态与 Caddy 自动生成的配置落盘 ⇒ 容器重建**不重签**）；`docker compose -f deploy/docker-compose.yml config` 必须通过。**（`r3` 同版收口：SEC-05 / SEC-06 落地后的两条交付物事实）** ① **宿主发布端口只绑回环**：`ports` 为 **`127.0.0.1:3000:3000`**（**不是** `3000:3000`）⇒ 默认**只有宿主本机可直连** `http://127.0.0.1:3000`，对外一律经反代（`proxy` 侧另发布 `443` 与 `80`，后者仅用于明文跳转与 ACME 校验；宿主 `80` / `443` 必须空闲）。**「宿主发布」与「容器内监听」是两件事，不得混成一句**：`ports:` 里的 `127.0.0.1:3000:3000` 决定「**外面能不能连**」，而容器里的 `HOST=0.0.0.0` + `PORT=3000` 只是应用在**容器网络内**听哪个地址 —— 它**必须是对内全网卡**，否则反代与健康检查都连不进来；**默认配置不裸听在对外网卡上**。② **反代档启动自检（fail-fast）**：`--profile proxy` 要求 **`COOKIE_SECURE=1` 且 `TRUST_PROXY=1`**，任一不为 `1` ⇒ **打印原因**（「反代档必须同时置 `COOKIE_SECURE=1` 与 `TRUST_PROXY=1`」）**并以非零退出（实测 `rc=1`）、不接流量**；两者都置 `1` ⇒ 同一段自检 **`rc=0`** 并继续起 Caddy。**为什么是「拒起」而不是「替你置 1」**：compose **无法按 profile 条件改同一个服务的环境值** —— 与其静默降级成「反代起来了、cookie 却不带 `Secure`」，**不如不接流量**（拒起比悄悄降级安全） |
| 库卷名（**两套起法不通用**，`r3` 同版收口） | **compose 档**：卷**键**名 = `shop-data`，而**实际 Docker 卷名带项目名前缀**（compose 顶层 `name: shop`）⇒ 实为 **`shop_shop-data`**（**具体值随 `name:` 变，不要照抄**；获取方式见 `docs/DEPLOY.md` 的「数据在哪」节 / `docker volume ls`）。**独立容器起法**（`docs/DEPLOY.md` 的 `docker run … -v shop-standalone-data:/data …`）用的是**另一个卷名 `shop-standalone-data`**。**两者互不通用** —— 混用时命令会 **`rc=0`**、库却起在**另一个空卷**上（本包 `E7` 同类坑：卷名不符、命令成功、**数据却在别处**；照 `shop-data` 写会把快照拷进另一个空卷 ⇒ **静默空操作**）⇒ **迁移 / 恢复 / 快照前必须先用 `docker volume ls` 核对实际卷名**，不得凭字面拼。 |
| `deploy/Caddyfile` | **本期唯一的反代示例**：`https://localhost` 终结 TLS（自签证书）+ `reverse_proxy app:3000` + 透传 `X-Forwarded-*`；应用侧只需 `COOKIE_SECURE=1` |
| `deploy/nginx.conf` | **不交付**（撤登记）。理由（实测）：nginx 在校验期即解析 `proxy_pass` 主机名 ⇒ 在 compose 网络**之外**跑 `nginx -t` 时 `proxy_pass http://app:3000;` 因 `host not found in upstream "app"` **退出 1**；要可用就得改用变量上游 `set $up app:3000;` + `proxy_pass http://$up;` 或在校验命令带 `--add-host`。Caddy 把上游解析推迟到运行期 ⇒ `caddy validate` 开箱退出 0。**一条判据、一条命令、一个文件** |
| 反代语法校验（命令字面，`AC-37`） | `docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:alpine caddy validate --config /etc/caddy/Caddyfile`（容器内执行；镜像 `caddy:alpine` 已实测可拉取） |
| `docs/DEPLOY.md` | 五节齐备：变量表 / 起法（容器 + 非容器）/ 升级 / 回滚 / 数据在哪（库路径 · **卷名的获取方式** · 备份目录 · 保留 14 天）+ 恢复演练步骤 + 「TLS 由反代终结，应用内不处理证书与续期」 |
| `.github/workflows/**` | 三条命令必跑：`npm test` · `node scripts/process/check-artifact-paths.mjs` · `node scripts/process/check-rules.mjs`；触发含 `push`；**不得**跳过 / 白名单 / 排除用例 |
| `scripts/ops/**` | 运维脚本（`backup.mjs` 单次备份入口；可选的会话 / 匿名车清理）；**一次性探针**不落这里（归 `docs/process/tools/FEAT-002/`） |

> **勘误 · `deploy/docker-compose.yml` 反代服务行的 profile 口径（2026-10-15，`prdVersion` 保持 1）**：
> - **原文（逐字，已改正）**：「……可选**注释掉**的反代服务定义（`profiles: ["proxy"]`）；……」。**这是事实错误**：compose 的 `profiles:` **本身就是「默认不启动、`--profile X` 才起」的 opt-in 机制**；把服务**整段注释掉**会让该 profile **根本不存在** ⇒ 文档里 `--profile proxy up -d` 一类命令**永久失效且静默 `exit 0`**（命令退出码为 0，读者会误以为反代已起）。
> - **正确口径（上方已改）**：反代服务**必须已定义且 opt-in** —— 保留**生效的** `profiles: ["proxy"]` 键：不带 `--profile proxy` 时 `up -d` **不起**该服务，带 `--profile proxy` 时才起。
> - **证据链**：① UAT 黑盒复现 **`P-19`**（TLS / 反代，`AC-37`；真缺陷，非观感项）；② 主控裁定「opt-in 用 `profiles:` 表达，**不得注释掉服务**」；③ **交付物实测** `deploy/docker-compose.yml:67`（`proxy:` 服务）+ **`:69`（`profiles: ["proxy"]`，键生效）** + `:80`~`:81`（`caddy-data:/data` · `caddy-config:/config`）+ `:104`~`:107`（三个具名卷声明）。**卷名口径**：compose 卷**键**名为 `shop-data` / `caddy-data` / `caddy-config`，而实际 Docker 卷名带项目名前缀（compose 顶层 `name: shop`）⇒ **库卷实为 `shop_shop-data`**；本契约不复制该字面值以免照抄误用（UAT `E7` 实测：照 `shop-data` 写会把快照拷进另一个空卷 ⇒ 静默空操作）；④ 测试与台账侧同源修正：**`TC-FEAT-002-34`** 已按同一裁定改判（`docs/process/rules/FEAT-002.yaml:14` 记「原判据要求反代服务被**注释掉**，把实现失误固化成了规范」）。
> - **结论**：**实现与文档现已一致；本条是勘误，`AC` / `E` 判据一字未改，不是新增判据** ⇒ 不触发 Gate1 重判、**不改 `prdVersion`**；同处按交付物补齐 `caddy-config:/config` 卷描述（原文只提 `caddy-data`），使本行**逐字与交付物一致**。

> **勘误 · 同行的「单服务」计数（2026-10-15，`prdVersion` 保持 1）**：
> - **原文（逐字，已改正）**：「**单服务** + 具名卷挂载库目录与备份目录（`DB_PATH` 落在卷内）」。
> - **为何错**：交付物 `deploy/docker-compose.yml` 实为**三个服务** —— `backup`（`:9`，一次性，`restart: "no"`，被 `app` 的 `depends_on` 以 `service_completed_successfully` 前置）· `app`（`:23`，常驻）· `proxy`（`:67`，档案门控）。称「单服务」会让读者以为只起一个容器、**漏掉前置的一次性备份服务**，而 `AC-34` 的「一条命令起服务」正是靠它给升级 / 回滚兜底。
> - **正确口径（上方已改）**：**三个服务** —— `backup` 一次性 / `app` 常驻 / `proxy` 档案门控；`docker compose -f deploy/docker-compose.yml up -d` 一次起齐（`proxy` 需 `--profile proxy`）。
> - **证据链**：`deploy/docker-compose.yml:9` · `:23` · `:67` 实测 + `docker compose config` 通过（UAT `P-16` 达标读数：「`up -d exit=0`（先跑 backup 服务）→ `healthy`」）。
> - **结论**：**事实错误勘误**（`AC` / `E` 判据一字未改、不新增判据），与 dev 已在 `docs/DEPLOY.md` 统一的口径一致 ⇒ 不改 `prdVersion`。

> **同版收口 · §7.1 `SESSION_SECRET` 行 + §7.3 `deploy/docker-compose.yml` 行的两条交付物事实（2026-10-16，`r3`；`AC` / `E` 判据与 `prdVersion` 均不变）**：
> - **原文（逐字，已改正）**：§7.1 的默认列 = 「无（**开发可在无值时用随机值并打 `warn`**）」——**没登记该随机值会持久化**；§7.3 compose 行**完全未登记**「宿主发布只绑回环」与「反代档启动自检」两条事实。
> - **为何补齐**：`SEC-05` / `SEC-06` 落地后这两条已是**交付物行为**，而本契约对同一行为的描述**比实际窄** ⇒ 读者会以为「开发档每次随机会踢掉所有会话」（实际会落盘复用）、以为 `ports` 是 `3000:3000`（实际只绑宿主回环）、以为反代档缺 `COOKIE_SECURE` / `TRUST_PROXY` 也能起（实际**拒起**）。**契约比实现窄 = 下一轮实现者的错误前提**。
> - **正确口径（上方已改）**：① §7.1 —— 开发档未显式提供时生成的随机密钥**持久化到 `<DB_PATH>.dev-session-secret`（`0600`，已存在且 ≥ 32 字符则复用）**，日志只打 `secretFile` 与是否复用、**不打密钥**，**不入库**；**生产档不落盘也不使用该文件**，缺失 / 短于 32 字符仍**拒起并点名变量**；**compose 与 `.env.example` 均无可用的默认密钥**。② §7.3 —— `ports: 127.0.0.1:3000:3000`（**宿主发布只绑回环**）与容器内 `HOST=0.0.0.0` + `PORT=3000`（**对内全网卡**）是**两件事**；`--profile proxy` 起容器时**先自检 `COOKIE_SECURE=1` 且 `TRUST_PROXY=1`**，不满足 ⇒ 打印原因 + **非零退出、不接流量**。
> - **证据链**：① `docs/DEPLOY.md`「密钥的三点事实」段（生产拒启 / 开发落盘复用 + `secretFile` 不打密钥 / 不入库）+ dev 本轮五处行为变更自证（**13 个契约变量双向一致：缺 = [] 多 = []** ⇒ `AC-35` 仍绿）；② `docs/DEPLOY.md` 反代段实测对照 —— 两者未置 `1` ⇒ `docker compose -f deploy/docker-compose.yml --profile proxy run --rm --no-deps proxy` **退出码 `1`** + 「反代档必须同时置 COOKIE_SECURE=1 与 TRUST_PROXY=1」；两者置 `1` ⇒ 同一段自检 **`0`**；**主控本轮补 `.gitignore` 的 `*.dev-session-secret`**（可引为事实）。
> - **结论**：**事实补齐**（`AC` / `E` 判据句一字未改、不新增判据、变量集不变）⇒ 不触发 Gate1 重判、**不改 `prdVersion`**；两条事实同批并入 §十 的版本 3 行。

### 7.4 优雅停机与进程兜底（`AC-27` `AC-30`）

| 项 | 口径 |
| --- | --- |
| 信号 | `SIGTERM` / `SIGINT` ⇒ ① 停止接受新连接（`server.close()`）② **等在途请求完成**（上限 **10 秒**，暂定值）③ 关闭库句柄 ④ 记一条停机日志 ⑤ **退出码 `0`** |
| 超时 | 超过 10 秒仍未排空 ⇒ 强制退出（**非 0**，并记 `warn`） |
| 未捕获异常 / 未处理拒绝 | `error` 级日志 + 关库 + **非零退出**（`AC-30`）；**不得**静默存活 |
| 容器 | `STOPSIGNAL` 默认即 `SIGTERM` ⇒ 容器停止走同一条路径（`E-05`） |

### 7.5 日志与 request-id（`AC-29`）

| 项 | 口径 |
| --- | --- |
| 输出目标 | **标准输出**逐行 JSON（一行一条记录）；测试经注入缝捕获（§八） |
| 字段 | `level` · `time` · `requestId` · `method` · `path` · `status` · `durationMs`（慢请求加 `slow: true`） |
| `requestId` | 每请求生成（`randomUUID()`）；同一请求的**所有**日志行共用同一个值（`AC-21` 靠它关联故障日志） |
| 禁止内容 | 口令明文 / `password_hash` / 盐 / 会话 token / `sid` 与 `cartId` 的**值** / 请求体全文（`AC-18`） |
| 客户端中断 | `warn` + `outcome: "client_aborted"`（`E-20`） |
| 退出码采集纪律（**强制，防假绿**） | 凡判据是**退出码**的地方（`AC-36` `AC-37`），采集写法固定为 `<cmd> > "$log" 2>&1; rc=$?`；**禁止** `cmd \| tail` / `cmd \| grep` 后再取 `$?`（此时 `$?` 是管道末端命令的退出码 —— 实测曾把 nginx 的 `1` 读成 `0`）。**test 与 UAT 的脚本一律照此写** |

---

## 八、可测性条款（**test 侧可达入口**）

### 8.1 应用工厂入口（硬要求）

| 项 | 内容 |
| --- | --- |
| 入口 | **`server/src/app.mjs`** 导出 **`createApp`** |
| 相对仓库根的路径 | **`server/src/app.mjs`** |
| 测试侧 import 形态 | **相对路径** import（例：`import { createApp } from '../../../server/src/app.mjs'`）；import 白名单 = `^node:` / `^\.\.?/` / `^jsdom$`（`PROJECT.md` §4） |
| **必须保留（FEAT-001 契约 §五）** | ① `options.seed` 可注入**独立种子**（条数任意，**只校验字段合法性**：价格非整数分 / 价格 < 0 / 库存 < 0 / 名称为空 / `id` 为空 ⇒ 抛错）；② `options.store` 可注入**独立存储**（两个实例互不共享）；③ 返回的 `handle` **既可被监听**（`handle.listen(port)`）**又可直接注入请求**（`handle.fetch(request)` / `handle.handle(req, res)` 之一）。此三条**不得删除、不得改名** |
| **本期扩展（新增，语义定死）** | ④ `options.dbPath`：`:memory:` 或临时库文件路径 —— **测试一律不落生产库路径**（`RSK-04`/`RSK-03`）；⑤ `options.now`：可选**时钟注入**（返回毫秒整数的函数）—— 会话过期、备份保留期、订单号 `day`、限流窗口等**时间类判据全靠它**，禁止用真实等待；⑥ `options.logStream`（或等价的 `options.logger`）：可注入**可写流**用于捕获结构化请求日志（`AC-18` `AC-21` `AC-29` `E-20`）；⑦ `options.config`：可注入**配置对象**覆盖环境变量（限流阈值 / 体积上限 / 保留天数的**边界构造**都靠它，避免真改环境变量） |
| 真实进程入口 | `server/src/index.mjs` = `createApp(默认配置)` + `listen(HOST, PORT)` 的薄封装 + 信号处理与进程兜底；**测试不得依赖它启动常驻服务**（除了 `AC-27` `AC-30` `E-04` `E-18` 这几条**必须**用子进程） |
| 为什么必须 | 会话过期（`Q-16`）· 备份保留 14 天（`AC-32`）· 限流窗口（`AC-23`）· 体积上限（`AC-22`）· 日志捕获（`AC-18` `AC-29`）· 库故障注入（`AC-21` `AC-28` ②）**都无法用真实等待 / 真实环境变量 / 生产库构造** |

### 8.2 故障与边界注入（**必须可构造**）

| 目标判据 | 注入方式（契约允许的实现形状，语义不得偏离） |
| --- | --- |
| `AC-21`（内部异常 ⇒ `500`） | 测试侧以 `options.store` 传一个**包装存储**：其某个方法**确定性抛错**（或指向只读库）；断言 `500 INTERNAL_ERROR` + 日志含同一 `requestId` |
| `AC-28` ②（`/health` ⇒ `503`） | 同上（探针走被包装的库读 ⇒ 抛错 ⇒ `db.ok === false`） |
| `E-15`（迁移中断可重入） | 迁移执行器接受**可注入的故障点**（如在应用第 N 个版本后抛错）；重启后断言可继续到最新版本且无半迁移态 |
| `E-18`（库版本超前） | 预置一个 `schema_migrations` 版本号 > 代码最新版本 的库文件 ⇒ 启动子进程 ⇒ 断言非零退出 |
| `E-04`（库不可写） | `DB_PATH` 指向只读目录 / 不存在的父目录 ⇒ 子进程非零退出 + 日志含 `DB_PATH` |
| `E-06`（备份失败） | `BACKUP_DIR` 指向不可写位置 ⇒ `scripts/ops/backup.mjs` 非零退出 + 既有备份集合不变 |

### 8.3 其他可测性约定

| 项 | 内容 |
| --- | --- |
| 端口 | 测试用**随机端口**（`listen(0)` 取实际端口），避免与常驻 `3000` 冲突 |
| cookie | **显式 cookie jar**（自持 `Set-Cookie` → 回带 `Cookie` 头），不依赖浏览器存储 ⇒ 桌面 / 单测与真机行为一致 |
| 库隔离 | 每个测试文件用**独立临时库**（`mkdtemp` + `DB_PATH`；或 `:memory:`）；生产库路径（`./data/shop.db`）在测试期间**不得被创建 / 修改**（`AC-07` 断言前后文件清单与 `mtime` 差异为空） |
| 前端断言形态 | 界面类判据以 **jsdom 解析返回的 HTML** 或 **HTTP 结构断言**表达 —— **主动取舍**（零依赖 / 快 / 可重复），**不是**没有浏览器；真机交互与观感由 UAT 用 CDP 驱动覆盖，交人裁 |
| 定位方式 | 一律用**商品名称 + 可观察行为**定位；脚本**禁止写死商品主键**（总纲 §6.4 第 28 条） |
| 时间断言 | 只断言「字段存在 + 可被 `Date.parse` 解析」与「两单相对先后」，**不锁时区与精度** |
| 退出码采集 | §7.5 的写法**强制适用**（`<cmd> > "$log" 2>&1; rc=$?`） |
| Docker 相关判据 | `AC-33`~`AC-37` 在本机 Docker（29.8.0 / compose v5.5.1）**可全验**；镜像拉取失败属**基建假红**，须与真缺口红分列（总纲 §11.3 第 401 类） |

---

## 九、非目标（本契约不覆盖）

1. **支付真实化** —— 仍为假支付（下单即 `paid`），但 UI 与文档**必须显式标注演示**（`Q-4`）。
2. **搜索 / 排序 / 筛选端点** —— 顶部搜索框只作版式位，**不产生服务端搜索请求**（`AC-44`；功能面歧义见 PRD §7 `Q-14`）。
3. **商品管理后台（增删改）** —— 商品来源仍只有迁移播种（`AC-06`），无写接口。
4. **多角色 / RBAC / 权限管理界面** —— 只有匿名与 `user` 两种身份；§4.5 的权限码是**文档层口径**。
5. **横向扩展 / 读写分离 / 分布式锁** —— 单实例 + 库事务（`Q-8` = A）。
6. **邮件 / 短信 / 一次性验证码 / 找回密码** —— 只有邮箱 + 口令（`Q-3` = B）。
7. **真实图片素材** —— 只用**本仓自托管真实照片**（`web/assets/products/P-001.jpg`~`P-008.jpg`，`Q-22` 交付后变更取代原「自制 SVG」）；**外链、从淘宝下载或复制第三方素材一律禁止**（`Q-5` `Q-6` `N-2`）。**自托管 ⇒ 仍零第三方请求**（`AC-52`）。
8. **应用内 TLS / 证书续期** —— 由反代终结（`Q-12`）。
9. **前端构建步骤 / 第三方 JS 库 / 第三方域名请求** —— 仍为原生 ESM，运行期零第三方请求（`AC-52`）。
10. **迁移框架 / ORM / 连接池** —— 代码内置有序迁移数组 + 单连接同步 API。

---

## 十、变更记录

| 版本 | 日期 | 修改人 | 修改内容 | 状态流转 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-15 | pm | 初稿：15 个端点（`keep` 1 / `change` 8 / `new` 6）逐条对齐现状；8 张表 + `order_no_seq` 序列表；取号口径（事务内 UPSERT + `RETURNING`，`orders.no` UNIQUE）定死；会话持久化与过期口径（绝对 7 天 / 空闲 30 分钟）定死；口令 `scrypt` 存储格式定死；15 码封闭词表（新增 7 码，含 `500 INTERNAL_ERROR`）；反代**只交付 Caddy** + 退出码采集纪律；可测性条款在 FEAT-001 契约 §五 基础上扩展 `dbPath` / `now` / `logStream` / `config` 四个注入缝 | — → draft |
| 1（勘误 1） | 2026-10-15 | pm | **勘误：§7.3 `deploy/docker-compose.yml` 行的反代 profile 口径（`AC` / `E` 判据与 `prdVersion` 均不变）**。原文「可选**注释掉**的反代服务定义（`profiles: ["proxy"]`）」是**事实错误** —— 注释掉服务 ⇒ 该 profile **不存在** ⇒ 文档 `--profile proxy up -d` **失效且静默 `exit 0`**；已改正为「反代服务**必须已定义且 opt-in**：保留**生效的** `profiles: ["proxy"]` 键，不带 `--profile proxy` 不起该服务」。同处按交付物补齐反代具名卷 **`caddy-data:/data`** + **`caddy-config:/config`**（原只提 `caddy-data`），使该行逐字与交付物一致。依据：UAT 黑盒复现 `P-19`（`AC-37`）+ 主控裁定 + `deploy/docker-compose.yml:67,69,80,81,104-107` 实测 + 测试 / 台账侧同源改判 `TC-FEAT-002-34`（`rules/FEAT-002.yaml:14`）。**判据句零变化 ⇒ 不升版、不重判 Gate1** | 无流转（状态位未动） |
| 1（勘误 2） | 2026-10-15 | pm | **勘误：§7.3 同行的「单服务」计数（`AC` / `E` 判据与 `prdVersion` 均不变）**。原文「**单服务** + 具名卷挂载库目录与备份目录」与交付物不符 —— `deploy/docker-compose.yml` 实为**三个服务**（`backup` `:9` 一次性 / `app` `:23` 常驻 / `proxy` `:67` 档案门控），称「单服务」会漏掉**前置的一次性备份服务**（`AC-34` 的「一条命令起服务」靠它给升级 / 回滚兜底）；已改为三服务口径。同处顺带**卷名口径澄清**：compose 卷**键**为 `shop-data`（实际 Docker 卷名带项目名前缀 `shop` ⇒ 库卷 `shop_shop-data`），契约**不复制该字面值**以免照抄误用（UAT `E7`：照 `shop-data` 写会把快照拷进空卷 ⇒ 静默空操作）。依据：`deploy/docker-compose.yml:9,23,67` 实测 + UAT `P-16` 达标读数 + 主控裁定 | 无流转（状态位未动） |
| 1（勘误 3） | 2026-10-15 | pm | **状态快照同型改正（判据一字未改 ⇒ `prdVersion` 保持 1）**：「当前状态一览」的交付状态行原文「**Gate1 送审中**（`gate1: pending`）；与 `prd/FEAT-002.md`…同批送审」与文件头 frontmatter（`status: implementing` / `gate1: approved` / `gate2: approved` / `gate4: pending`）自相矛盾 ⇒ 已按 frontmatter 改正（该节自述「只写现在是什么状态」）；「最后更新轮次」由 `r1`（初稿）补为含两批勘误与本次状态改正。属 **`D-13` 状态遮蔽同类**（正文快照未随 frontmatter 同步），与 `prd/FEAT-001.md` 的同型改正一致 | 无流转（状态位未动） |
| 1（勘误 4） | 2026-10-15 | pm | **事实补齐：§3.6 恢复 / 备份口径（`AC` / `E` 判据句、阈值、边界取值一字未改 ⇒ `prdVersion` 保持 1；主控派单称「勘误 3」，因上一轮状态快照同型改正已占用该行号，此处顺延为勘误 4）**。① **恢复步骤行**（原「停服 → 用备份文件替换 `DB_PATH` → 起服 → `GET /health` 为 `200`」，演练判据「按 `orderNo` 查到订单」）：补齐**替换前必须清 `-wal` / `-shm` 侧车**，并写明**恢复成功的唯一判据是数据本身**（按 `orderNo` 查得到、行数对得上）—— **不是**退出码 / **不是**文件指纹 / **不是** `/health 200`。**为何错**：非正常停机（OOM / `docker kill` / 宿主断电）后残留非空 `-wal` 时，只 `cp` 覆盖主文件 ⇒ 下次启库**回放 WAL**、快照之后的事务**原地复活**，**回滚被自己撤销**，而 `rc=0` + 库 sha256 = 快照 + `/health 200` **全绿**（UAT 额外发现 `E9`；最小差异对照 = 只多一行 `rm -f …-wal …-shm` 即恢复）。② **`禁止` 行**：原只禁**备份方向**的「WAL 下裸 `cp`」，现**同时覆盖恢复方向**（同一机制的另一面）。③ **新增「快照命名粒度」行**（原缺口：UAT 额外发现 `E8` 的口径只存在于 `docs/DEPLOY.md`）：快照名只精确到 **UTC 日** ⇒ 同一 UTC 日重复备份**覆盖同一份**、**不是**「换错快照的后悔药」，要留退路须手工另存。④ **§3.1 新增「侧车文件」背景事实行**：`journal_mode = WAL` ⇒ 库文件带 `shop.db-wal` / `shop.db-shm` 侧车（属库的一部分，须成组处置），与 `journal_mode` 行呼应。⑤ **§7.3 `docs/DEPLOY.md` 行措辞**：「卷名」⇒「**卷名的获取方式**」（`E7` 修好后不应被读成必须写死宿主卷名）。**证据**：UAT 复验②（`docs/process/uat/FEAT-002-uat.md` 复验② 段 + 完整报告 §12）、读数 `reports/uat/evidence/FEAT-002-uat/ops/e7d-stalewal2.out`（照原文 → 仍 2 单）vs `ops/e7e-walfix.out`（补 `rm -f` → 快照时刻 1 单）vs `ops/e7b-rollback.out`（`E7` 全流程 + UAT 额外发现 `E8` 同日覆盖）；dev 已按同一口径修 `docs/DEPLOY.md`（回滚第 2 步含 `rm -f /data/shop.db-wal /data/shop.db-shm`，UAT 额外发现 `E8` 的口径见其「回滚」节末） | 无流转（状态位未动） |
| 2（**版本 2 · 交付后变更**，非勘误） | 2026-10-15 | pm | **判据变更（不是勘误）：商品主图由「本仓自制 SVG」改为「本仓自托管真实照片」** —— 人 2026-10-15 直接指令（交付后变更），主控裁决 `Q-22`。**与勘误 1~4 的性质区别**：那四条**判据句一字未改**（故 `prdVersion` 保持 1），本条**判据句确有变更** ⇒ `prdVersion` 1 → 2（四件同批）。**改了三处（判据句）**：① **§5.15 静态表主图行**：`/assets/products/*.svg` + `image/svg+xml`（8 个自制 SVG 主图）⇒ **`/assets/products/*.jpg` + `image/jpeg`**（`P-001.jpg`~`P-008.jpg`，响应体以 JPEG magic bytes `FF D8 FF` 开头）；② **§5.15 放行范围与实现约束**：`CONTENT_TYPES` 由只增 `.svg → image/svg+xml` ⇒ **同时增 `.jpg → image/jpeg`**（并写明**不同批改就会重演「8 张图全裂」**的既有陷阱）；③ **§7.3 第 7 条非目标**：「只用本仓自制 SVG」⇒「只用**本仓自托管真实照片**」。**未改动**：放行范围本身（`/assets/**` 已涵盖 `.jpg`）· 路径校验口径（仍复用 `resolveWithinWeb`）· `AC-52` 的「零第三方请求」（自托管 ⇒ 全同源，**语义不变**）· `§6 N-2`（**不外链、不下载、不复制淘宝素材 —— 一字未改**）。**原始读数（本轮）**：主控一手实测直连 `images.unsplash.com/<id>` 8/8 `rc=200` 且为真 JPEG（⇒ 证明「可下载」成立，但**仍不由本仓外链**）；人选定 **A：下载真实照片、本仓自托管**；人对「去淘宝找几张」的提议被主控以**版权 + `N-2` 明文非目标 + 防盗链易裂图**驳回，并给出「**同名覆盖即换图**」的合规路径。**同步件**：`prd/FEAT-002.md`（`R-05` / `AC-48` / `AC-49` + 补注的 `AC-52` + `S-9` / `S-13` / `E-17` / `§7 Q-22` / §11 变更记录第 2 行）· `prd/FEAT-002-design.md`（§一 `R-05`/`Q-5`/新增 `Q-22`、§二 `DEV-1`、§3.2 模块表、§3.8、§四）· `prd/FEAT-002-ui-spec.md`（`UI-12`/`UI-24` 的 `src` 正则，**由 ui-designer 同批改**）。**待办（非本件）**：dev 落 8 张 `.jpg` + `CREDITS.md` + 静态白名单；test 把 `TC-FEAT-002-48`/`-49` 断言由 SVG 改为 JPEG 并重跑（台账 `prdVersion` 同步 2） | `implementing`（交付后变更重开；`gate1`/`gate2` 值**不涂改**，Gate4 前重验） |
| 2（**勘误 5 · 判据句零变化**） | 2026-10-16 | pm | **事实补齐 / 能力要求显式化（与勘误 1~4 同性质：`AC` / `E` 判据句、阈值、边界取值一律未改 ⇒ `prdVersion` 保持 2 不变）**：§5.15 补**一条规则 + 一段约束** —— **二进制素材（`.jpg` 等）必须按字节原样送出**：**禁止**经 UTF-8 / 字符串编解码处理**读盘**与**响应体**；`content-length` 必须等于**磁盘字节数**，响应体与磁盘**逐字节相等**。**为何必须写进契约**：`AC-49` 只断「静态 `200` + `content-type: image/jpeg`」**不足以交付真照片** —— 现状 `server/src/static.mjs:68` 的 `readFileSync(path, 'utf8')` + `server/src/app.mjs:641` 的 `Buffer.from(body, 'utf8')` 会让二进制经文本通道被写坏（test **独立实测**：**2054 B → 2066 B**、JPEG SOI 首字节被替成 `U+FFFD` ⇒ **浏览器裂图**），而**白名单加了 `.jpg`、状态码与 `content-type` 全对**，纸面判据全绿、照片仍是坏的 ⇒ 按「**先改规则再落文件**」把能力要求写进契约。**test 侧已落两条硬判据**（`content-length` == 盘上字节数 · 线上字节与磁盘逐字节相等），故本条**只补契约规则、不动 `AC-48` / `AC-49` 判据文字**。**新增落点**：§5.15 表新增「**二进制素材**」行 + 表下「**二进制透明性约束（勘误 5，写死）**」段 | 无流转（`prdVersion` 保持 **2**） |
| 3 | 2026-10-16 | pm | **交付后变更 · 真源覆盖缺口补登 + 契约口径收口（主控裁定）⇒ `prdVersion` 2 → 3**。**§四（账号与会话）**：① §4.1「哈希算法」由 `scryptSync` 改为**异步 `scrypt`**（`N = 16384` / `r = 8` / `p = 1` / `keylen = 64` / `maxmem = 64 MiB`；写明必须走异步、不得保留 `scryptSync` 调用点 —— 同步版会在单线程事件循环上阻塞 16 MiB 级内存硬哈希，与 `AC-23` 的并发面相冲）；② §4.1 新增「**时序一致性（防枚举，`AC-13`）**」行 + §5.4 新增「时序」行：**登录路径对「账号不存在」也必须执行一次等价 `scrypt` 校验**（哑元盐 / 哈希，参数相同），不得提前返回短路 —— 与 `401 INVALID_CREDENTIALS` 的逐字相同响应共同构成防枚举面。**§一（通用约定）**：③ 「限流」行由「每会话 60 次/60 秒」扩为**三维固定窗口**（每会话 `R = 60` · 每 IP `R_ip = 4 × RATE_LIMIT_MAX = 240` · 全局 `R_all = 20 × RATE_LIMIT_MAX = 1200`）+ **在途并发上限 `C = 16`**（超限**复用 `429 RATE_LIMITED`，不新增错误码**），并写死来源 IP 口径（`TRUST_PROXY=1` 取 `X-Forwarded-For` 首个 IP）—— 后两维与 `C` 与 `RATE_LIMIT_MAX` 成**固定倍数**，**故不新增环境变量**（守住 `AC-35` 的「`docs/DEPLOY.md` 变量表 ↔ §7.1 双向包含」；本轮 `docs/DEPLOY.md` 不在可改范围，若将来改选独立变量须同批改该文档）。**§六（错误码词表）**：④ `RATE_LIMITED` 行同步三维 + `C` + 回指 `AC-64`（**码本身不新增、不删改** ⇒ 封闭词表仍为 15 码）。**§7.1（配置项）**：⑤ `SESSION_SECRET` 说明补「**承诺的是生效**：token 校验值由其派生、库内只存派生/摘要值 ⇒ 换密钥后旧会话必须失效（`AC-63`）」，校验列回指 `AC-26` ③；⑥ `TRUST_PROXY` 说明补「置 `1` **必须真采信** `X-Forwarded-For` 首个 IP（`AC-64`）；置 `0` 一律按对端地址计数，伪造头不得获得额外额度」—— 两个变量**不新增、不删改**（`AC-35` 变量集不变）。**§7.2（静态资源）**：⑦ **内容指纹定义钉死** = 该资源**文件字节**的 `sha256` **前 10 位 hex**（小写），服务端**必须校验**；`?v=0` / `?v=000000` 等**形态合法但退化**的值 ⇒ **必须仍返回 `200`** 且按无指纹档处置（`no-cache` + `ETag` 协商），**`404` 不接受**（**同版收口 2026-10-16** 收紧为单一处置：资源文件确实存在，伪造查询串不得把已存在的资源说成「不存在」；该档要断的是「不得得到 `immutable`」；`immutable` 或非 `200` **均判红**；`AC-31` ⑤ 判红口径），并把「带指纹」档的措辞统一为「带**真**指纹」。**为什么必须升版**：③⑦ 是**判据语义变更**、①⑥ 是**新要求**（此前只有「可配置 / 可走通」的隐含假设），同批新增 `AC-57`~`AC-64` ⇒ 按纪律升 `prdVersion`。**须同步（本契约不代改）**：test 台账与 `rules/FEAT-002.yaml` 到 `prdVersion: 3`；dev 实现异步 `scrypt` + 三维限流 + 指纹校验 + 密钥真实派生 + 转发头采信；ui-designer 侧见 PRD §11 同行清单。**同版收口（2026-10-16 第二次，`prdVersion` 仍 3、不另开版本号）**：⑧ **§7.1 `SESSION_SECRET` 行补齐开发档密钥持久化事实**（`<DB_PATH>.dev-session-secret` · 权限 `0600` · 已存在且 ≥ 32 字符则复用 · 日志只打 `secretFile` 与是否复用、不打密钥 · 不入库 · **生产档不落盘且不使用该文件**、缺失 / 短于 32 字符仍拒起；**compose 与 `.env.example` 均无可用的默认密钥**）；⑨ **§7.3 `deploy/docker-compose.yml` 行补齐两条交付物事实**（**宿主发布只绑回环** `127.0.0.1:3000:3000` ≠ **容器内监听** `HOST=0.0.0.0` + `PORT=3000`；`--profile proxy` 的 **`COOKIE_SECURE=1` + `TRUST_PROXY=1` fail-fast 自检**，实测未置 ⇒ `rc=1` 且不接流量、两者置 1 ⇒ `rc=0`），并在 §7.3 表下补一条同版收口说明（证据链 + 「契约比实现窄 = 下一轮实现者的错误前提」）；**两条均为事实补齐**（`AC` / `E` 判据句与 13 个变量集一字未改 ⇒ `AC-35` 仍绿）。**同版收口（2026-10-16 第三次，`prdVersion` 仍 3、不另开版本号）**：⑩ **§7.3 新增「库卷名（两套起法不通用）」行** —— compose 档实际卷名 = `<project>_shop-data`（随顶层 `name:` 变，实为 `shop_shop-data`）vs 独立容器起法 `shop-standalone-data`；**二者互不通用**，混用 `rc=0` 但起空卷（`E7` 同类坑）⇒ 迁移 / 恢复 / 快照前必须 `docker volume ls` 核对（**事实补齐**）；⑪ **§7.1 表下新增「开发档密钥持久化的跳过条件」= 新增真源口径**：`DB_PATH` 为 `:memory:` 或父目录不可写 ⇒ **跳过持久化**（进程内随机 + `warn`、**不生成任何 sidecar 文件**、**不因写密钥失败而拒起**；生产档不受豁免），**可断判据只由 `:memory:` 档承载**（① sidecar 文件**不存在** ② 进程**仍可起** ③ `warn` 且**不含密钥本身**）；**「父目录不可写」支已收窄为实现约定 / 防御性兜底、不声称有机器判据**（**逻辑上为空 / vacuous**：sidecar 与库**同目录** ⇒ 「库能打开」已蕴含「目录可写」，且受 **`E-04` 前置遮蔽** —— test 实测 `chmod 0500` 下 SQLite 连 `-wal`/`-shm` 都建不了、库先失败）；**生产档不受豁免、仍拒起**（test 写成**独立于不可写目录的对照档**、会真跑到）；**本条不新增 `AC` 编号**，机器承载挂在**既有 `AC-63`** 名下（`TC-FEAT-002-65`）—— 实现侧已有该行为（dev 自述「`:memory:` 不落盘」） | `implementing`（`gate1` / `gate2` 值**不涂改**，Gate4 前须重验） |
