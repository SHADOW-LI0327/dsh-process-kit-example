# FEAT-002 UAT 结论索引（uat-agent）

- **完整报告（唯一真源副本）**：[`reports/uat/FEAT-002-uat-20261015T0659Z.md`](../../../reports/uat/FEAT-002-uat-20261015T0659Z.md)
- **人读截图**：`reports/uat/FEAT-002-uat-*.png`（15 张：首轮 11 + `P-19` 复验 4）
- **机读原始证据**：`reports/uat/evidence/FEAT-002-uat/**`
- **黑盒复跑脚本**：`e2e/uat-feat002/**`
- **执行时间**：2026-10-15 06:42Z~07:00Z（+ 复验① 07:20Z~07:24Z `P-19`、复验② 08:00Z~08:14Z `E7`/`P-17`、**终次复验③ 08:2xZ~08:3xZ `E9` 崩溃路径 ⇒ `P-17` 达标**）｜ **被测**：`http://127.0.0.1:3000`（托管实例，`NODE_ENV=production`）｜ **真机**：Edge headless `Edg/155.0.4283.45` + CDP（390×844@2x、1280×900@1x）
- **判据来源**：`docs/process/prd/FEAT-002.md` §1.3（`T-1`~`T-10`）与 §1.4（`P-01`~`P-19`）+ `docs/DEPLOY.md`（当用户文档读）
- **黑盒性**：未读 `docs/process/input/**`、任何源码/测试/既有报告或日志；收到 `AGENTS.md` 注入并按纪律视为不可用信息（详见报告 §0）

## 结论计数

| 清单 | 达标 | 不达标 | 无法判定 |
| --- | --- | --- | --- |
| `T-1`~`T-10`（淘宝风观感，真浏览器渲染+截图） | **10** | 0 | 0 |
| `P-01`~`P-19`（可投产能力，黑盒操作） | **19** | **0** | 0（`P-19` 内 2 子项仍无法判定：公网 ACME 证书链、`TRUST_PROXY` 生效） |

> **`P-19` 复验①（2026-10-15 07:20Z~07:24Z）**：首轮判 **不达标**（文档写的 `--profile proxy` 不存在、静默不起 TLS 终结器）；dev 补齐 `proxy` 档案后，本人**逐字照 `docs/DEPLOY.md` HTTPS 一节复验通过 → 改判「达标」**。原始读数见完整报告 **§11** 与 `reports/uat/evidence/FEAT-002-uat/p19b-tls.out`。

> **复验②（2026-10-15 08:00Z~08:14Z，dev 修文档后）**：只复验 `E7`（回滚卷名不符 ⇒ 静默空操作）并给 `P-17` 定案。**E7 已闭环**（改后命令逐字跑通、回滚三层读数全达成、旧写法对照判为空操作、卷集合前后逐字相同、`-p` 隔离读数证明 dev「不改 compose」成立）；**但同一节发现 `E9`**：非正常停机残留 `-wal` 时，照文档逐字回滚 `rc=0`、库文件与快照**逐位相同**、`/health 200`，应用读到的却仍是**回滚前**数据（静默失效）⇒ 按派单口径 **`P-17` 判「不达标」**（`P-14` 建议维持达标，连带与否待主控裁）。原始读数见完整报告 **§12** 与 `ops/e7b-rollback.out`、`ops/e7d-stalewal2.out`、`ops/e7e-walfix.out`。

> **终次复验③（2026-10-15 08:2xZ~08:3xZ，dev 按 E9/E8 建议第二次修文档后）**：只复验 `E9` 崩溃路径 + `E8` + 逐条可执行性。在**残留非空 `-wal`（70072 B）**的 SIGKILL 崩溃场景下逐字照抄改后第 2 步：`rc=0`；动库前卷内取证 `EXISTS /data/shop.db-wal`，回滚后**起服前** `ABSENT -wal/-shm` 且库 sha256 **逐位＝快照**；起服 `/health 200`，**`curl -s -b jar.txt localhost:3000/api/v1/orders` → 200 且只含快照时刻那笔**（第 2 单未复活），库级 1 单 ⇒ **回滚真的生效**。同轮内「省掉 `rm`」的对照复现了「`rc=0`＋指纹逐位相同＋`200` 仍未回滚」的假成功形态，证实文档新判据声明必要且如实；`E8` 复核（同日仍 1 个文件、sha256 `5f7c2cc3…`→`17f6d7af…`、内容变成后一次状态）与文档新口径一致 ⇒ **`P-17` 改判「达标」**，`P` 计数 **19/0/0**。原始读数见完整报告 **§13** 与 `ops/e7f-final.out`、`ops/e7g-crashpath.out`。（项目隔离：本轮用我自己的 `COMPOSE_PROJECT_NAME=uate7f`，未碰 test 的 `feat002t` 卷。）

## `T-1`~`T-10` 判定（截图：`FEAT-002-uat-T*/PN-*.png`）

| # | 判定 | 一句话证据（原始读数） |
| --- | --- | --- |
| `T-1` | 达标 | `body` bg `rgb(245,245,245)`、卡片 `rgb(255,255,255)`；旧深色令牌 `#0d1117`/`#161b22` 全页扫描 **0 命中** |
| `T-2` | 达标* | CTA 渐变 `rgb(217,58,0)→rgb(179,48,0)`；价格 `#7A2200`/700/21px，`¥` 13px < 21px（*色值口径见待裁定 3） |
| `T-3` | 达标 | 390 `grid-template-columns: 178px 178px`（2 列）；1280 `269.5px ×4`（4 列）；卡内序 `img→h3→p`，标题 2 行截断 |
| `T-4` | 达标* | `.tabbar` fixed bottom 49px，实测 **4 项**（判据表写 3 项），当前项 `rgb(122,34,0)`、其余 `rgb(51,57,64)`；无左侧栏 |
| `T-5` | 达标 | 卡 radius 16px；`box-shadow rgba(31,35,41,.08) 0 2px 6px`；全页有阴影元素 8 个 |
| `T-6` | 达标 | `.btn--cta` radius `9999px`、高 44px、橙色渐变、白字（详情/购物车/结算/登录/空态一致） |
| `T-7` | 达标 | `#search-input` 可真实聚焦；输入「咖啡」+ 回车 → CDP 新增请求 **0**、hash 不变 |
| `T-8` | 达标 | 角标「包邮」`bg rgb(240,253,244)`、「秒杀」`bg rgb(255,228,214)`，radius 9px/11px；Tab 件数角标 |
| `T-9` | 达标 | 8/8 主图 `complete&&naturalWidth>0`（首帧与滚到底同）；主图占卡 **66.7%**（390）/69.3%（1280），详情 340×600（占 panel 65.1%） |
| `T-10` | 达标 | `meta viewport` 就位；390/1280 均无横向滚动；宽屏容器 **1160px + 左右 60px**；2 列↔4 列自适应 |

## `P-01`~`P-19` 判定（命令与读数见完整报告 §5）

| # | 判定 | 一句话证据 |
| --- | --- | --- |
| `P-01` | 达标 | `PORT=3101` → `127.0.0.1:3101 (LISTEN)`、`/health 200` |
| `P-02` | 达标 | 默认 `127.0.0.1`；`HOST=0.0.0.0` → `*:3103 (LISTEN)` |
| `P-03` | 达标 | 7 组非法配置全 `exit=1` 且错误 JSON 点名变量 |
| `P-04` | 达标 | SIGTERM：新连接被拒、在途 4.19s 请求仍 `201`（`slow:true`）、`shutdown_complete`、**rc=0**；SIGINT 同 |
| `P-05` | 达标 | `/health 200 {"db":{"ok":true}}`（容器内亦然）；**503 分支黑盒无法构造**（子项 U1） |
| `P-06` | 达标 | 逐请求一行 JSON：`requestId/method/path/status/durationMs/level`，慢请求 `slow:true` |
| `P-07` | 达标 | 注入未捕获异常 → `uncaught_exception` + **rc=1**；未处理拒绝 → `unhandled_rejection` + **rc=1** |
| `P-08` | 达标 | 四头齐备：`x-content-type-options/referrer-policy/x-frame-options/content-security-policy` |
| `P-09` | 达标 | 131072 B → `201`；200000 B → `413 PAYLOAD_TOO_LARGE` |
| `P-10` | 达标 | `RATE_LIMIT_MAX=3`：前 3 次 `201`，第 4/5 次 `429` + `retry-after: 60`；读不受限 |
| `P-11` | 达标 | HTML `no-cache`+ETag（`If-None-Match`→`304`）；指纹脚本 `max-age=31536000, immutable` |
| `P-12` | 达标 | `schema_migrations=1`；重启幂等、`integrity_check ok`；人为 `version=999` → 启动 `exit=1`；回滚口径=快照恢复 |
| `P-13` | 达标 | 首启建库+8 条种子（金额整数分）；重启仍 8 条 |
| `P-14` | 达标（维持） | `backup.mjs exit=0` 产出 `shop-20261015.db`；保留期删 30 天前/留 5 天前；失败路径 `exit=1` 且不删快照；快照恢复后按 `orderNo` 查到订单。**复验②/③补证**：官方快照是**可直接打开的独立库**（读到快照时刻订单行）⇒ 备份侧无问题。`E9`（残留 `-wal` 时替换库文件会被回放）经主控裁定**记在 `P-17` 名下**，`P-14` **维持达标**（产品侧备份/恢复能力本身良好）|
| `P-15` | 达标 | build `exit=0`、`User=node`、9s healthy、`uid=1000(node)`、`/app` 不可写、`--read-only` 下 `/health 200`+加购 `201`、卷持久化 |
| `P-16` | 达标 | compose `up -d exit=0`（先跑 backup 服务）→ `healthy`、`ReadonlyRootfs=true`；容器内下单闭环 `201/201/201`；`down -v` 清空无残留 |
| `P-17` | **达标**（终次复验③定案；首轮达标 → 复验② 因 E9 不达标 → dev 修文档 → 崩溃路径逐字复验通过） | 首轮：三种起法 + 15 项变量表 + 升级/回滚/数据在哪齐备。**E7 已闭环**（复验②）：改后第 2 步 `rc=0`、起服前库 sha256 **逐位＝快照**、库级 1 单、起服后订单只剩快照时刻那笔；旧写法 `-v shop-data:/data` 实测**静默空操作**（指纹不变、仍 2 单、多垃圾卷）；卷集合前后逐字相同；发现命令逐字可跑；`-p uate7a/uate7b` 证明 dev「不改 compose」成立。**E9 已闭环**（终次复验③，崩溃路径）：第 1 单→快照（`5f7c2cc3…`）→第 2 单→`docker compose kill app`（`rc=0` `Killing/Killed`）→`down`；**动库前** `EXISTS /data/shop.db-wal`（**70072 B**）+ `-shm 32768`；照改后第 2 步 `rm -f …-wal …-shm && cp -pf … && ls -l …` → **`rc=0`**；**起服前** `ABSENT -wal/-shm` 且库 sha256 **逐位＝快照**（`90f45191…`）；起服 `/health 200`、`curl -s -b jar.txt localhost:3000/api/v1/orders` → **200 且只含 `SO-20261015-1`**、库级 1 单 ✓。**判据声明如实**：同轮「省掉 `rm`」对照 = `rc=0` + 指纹逐位＝快照 + `/health 200` + 接口 **2 单** ⇒ 文档「唯一判据是数据本身」必要。**`E8`**：同日仍 1 个文件、内容变成后一次状态；文档已明写「同日只有一份快照、不是后悔药、重要变更前手工另存」⇒ 与机制一致 |
| `P-18` | 达标 | CI 关键行 `on: push/pull_request` + node 24 + 两条门禁 + `npm test`；我本地两条门禁 `exit=0`（落点 0 越界、台账 176✓/0❌）；`npm test exit=1` 是用例自带「3000 被占用」装置断言（见 E5） |
| `P-19` | **达标**（复验；首轮不达标） | 复验：`config --profiles` → `proxy`；`--profile proxy up -d` `exit=0` 且 `ps` 里 **app+proxy 双 healthy**（`0.0.0.0:80/443`）；文档四条命令逐字跑通 —— `curl -k … https://localhost/health` → **`200`**、body **`db.ok:true`**；issuer `CN = Caddy Local Authority - ECC Intermediate`（自签，不带 `-k` → `exit=60`）；80 → **`308` 跳 HTTPS**；`sid`/`cartId` 均带 **`Secure`**；**真实浏览器**开 `https://localhost/` → 8 卡 8 图全渲染、注册/加购/购物车全通（第三方域名 0）；**不带档案 `up -d` → 无 proxy 容器、80/443 监听 0、https `000`**；`down -v` 0 残留 |

## 额外发现（只报告不修复）

- **E1** 注册**不**并入匿名车：匿名车「单品豆×1（¥88）」→ 注册 → 「我的」购物车 **0 件**、购物车页空；对照登录并入正常（滤杯×1 + 磨豆机×1 → 登录后 2 行 ¥467）。复现：`e2e/uat-feat002/p3-merge.mjs`，读数 `evidence/…/p3-merge.json`。
- **E2** `T-4` 实测 4 项 Tab（判据表写 3 项）。
- **E2'** 主色实测 `#D93A00`／价格 `#7A2200`，判据示例 `#FF5000`（同色相、明度更低）。
- **E3** 搜索框输入即本地过滤（8→1，无请求）且值跨路由保留。
- **E4** 编排发布 `0.0.0.0:3000` 与托管实例并存，宿主环回 curl 打到旧实例（取证必须进容器）。
- **E5** `npm test` 本环境 `exit=1`（红用例自带断言「常驻端口 3000 已被占用…请在 3000 空闲时复跑」，两次复现）→ **已结案**：主控腾空 3000 后我第三次执行 **`exit=0`，`tests 134 / pass 134 / fail 0`**（`ops/p18-npmtest3.out`）⇒ **装置冲突，非产品缺陷**。
- **E6** `--profile proxy` 曾不存在 → **dev 已修复，复验通过**（`config --profiles` → `proxy`；`up -d --profile proxy` 起出 `caddy:alpine` 并双 healthy；文档四条命令逐字跑通）。
- **E7（已闭环）** `docs/DEPLOY.md` 回滚/数据在哪曾把库卷写成 `shop-data`（实际 `shop_shop-data`）⇒ 照抄为**静默空操作**。首轮实测 `ops/p19b-volume-mismatch.out`；dev 改文档（回滚第 2 步交 compose 解析卷 + 一条 `docker inspect` 发现命令）后，我**逐字复验通过**：`rc=0`、起服前库 sha256 **逐位＝快照**、库级 1 单、起服后订单只剩快照时刻那笔、旧写法对照判为空操作、卷集合无副作用（`ops/e7b-rollback.out`，报告 §12.3/§12.4）。
- **E8（已结案：只改文档）** 快照名为 `shop-<UTC 日>.db` ⇒ **同日多次打快照同名覆盖**。实测（复验② `423e215f…`→`a7da1f68…`；终次复验③ `5f7c2cc3…`→`17f6d7af…`，内容均变成后一次状态）⇒ 原「兜住换错快照的后悔药」在**同日**不成立。dev 已按建议改文档（明写「同一 UTC 日只有一份快照、**不是**后悔药、重要变更前请**手工另存**」）；快照命名粒度（建议带时刻）登记为**后续包增强**（`scripts/ops/backup.mjs` 未改）。
- **E9（已闭环：`P-17` 曾因此判不达标 → 修复后复验通过 ⇒ 达标）** 非正常停机（SIGKILL/OOM/宿主重启）后残留非空 `-wal`，照**旧版**文档逐字回滚：`rc=0`、`/data/shop.db` sha256 **＝快照**、`/health 200`，但 SQLite **回放残留 WAL** ⇒ 读到**回滚前**数据（2 单）。dev 采纳「补一行 `rm -f /data/shop.db-wal /data/shop.db-shm`（并 `cp -f`→`cp -pf`、去掉 `chown`）+ 加判据声明」；我在崩溃路径逐字复验**通过**（`ops/e7f-final.out`、`ops/e7g-crashpath.out`）。**方法学（已按要求写入报告 §0 第 6 条「最终偏差清单」）**：**「读库」这个动作本身会把 `-wal` checkpoint 进主文件并删掉 `-wal`/`-shm`** ⇒ 采集顺序固定为「卷内 `ls -l`/`test -f` → 纯字节 sha256 → 最后才打开库/调 API」；踩坑过程 `ops/e7c-stalewal.out` 保留备查不作依据。

## 无法判定（逐条原因）

`U1` `P-05` 503 分支（黑盒构造不出库不可读）；`U2` `P-19` **公网域名 + ACME 真证书链 + 浏览器默认信任**（本地已验通 Caddy 终结 TLS 与自签内部 CA，剩真域名签发未测）；`U3` `P-19` `TRUST_PROXY` 生效（限流不按转发头分桶、日志无客户端 IP、本机无法用第二源地址）；`U4` 物理真机观感（无手机，仅 Edge headless + 分辨率模拟）；`U5` 真公网部署面。

## 收尾状态

- **托管实例：交付时处于停止状态**（主控为腾出 3000/80/443 于复验前停掉；我全程未复起）。**主控裁定：不要复起**（`AC-25` 需要 3000 空闲才能变绿，见待裁定 7）。
- 复验后 `down -v`：本项目容器/卷/网络 **0 残留**，`80/443/3000` 监听数 `0/0/0`，`docker ps -a` 只剩他人的 `yente-postgres`；我起的端口/容器/卷/镜像 tag 全部清理。
- 只写 `reports/uat/**`、`docs/process/uat/**`、`e2e/**` 三处（落点门禁 `exit=0`）；未改 `deploy/**`、`docs/DEPLOY.md`、`test/**`、`docs/process/prd|contracts|rules/**`。
- **复验②收尾**：五轮编排（e7b~e7e）每轮都以 `docker compose -f deploy/docker-compose.yml down -v --remove-orphans`（`rc=0`）结束；`shop*` 卷/网络 **0 残留**、`80/443/3000` 监听数 `0/0/0`、`docker ps -a` 只剩他人的 `yente-postgres`；对照实验的垃圾卷 `shop-data` 每次都已清除。期间 Docker Desktop 守护进程停过一次（`docker info` 连不上），我 `open -a Docker` 恢复后继续（环境事件，未改仓库文件）。托管实例按主控裁定**保持停止**（未复起）。
- **`P-19` 复验新增产物**：`reports/uat/FEAT-002-uat-P19-https*.png`（4 张）、`reports/uat/evidence/FEAT-002-uat/p19b-tls.out`、`p19b-browser-phase.out`、`p8-tls-browser.json`、`ops/p19b-*`；脚本 `e2e/uat-feat002/p-ops-tls2.sh`、`p-ops-tls3-browser.sh`、`p8-tls-browser.mjs`。
- **复验③（E9/`E8`/`P-17` 终判）收尾**：两轮编排（e7f/e7g）各以 `down -v --remove-orphans`（`rc=0`）结束；**本轮用我自己的项目名 `COMPOSE_PROJECT_NAME=uate7f`**（容器 `uate7f-app-1`、卷 `uate7f_shop-data`、网络 `uate7f_default`），未碰 test 的 `feat002t` 卷；收尾 `shop*`/`feat*` 卷为空、`3000/80/443` 监听数 `0/0/0`（3000 已还回）、`docker ps -a` 只剩 `yente-postgres`。
- **复验②（E7/`P-17`）新增产物**：`reports/uat/evidence/FEAT-002-uat/ops/e7b-rollback.out`（改后文档回滚全流程 + 旧写法对照 + 卷集合比对 + `-p` 读数）、`ops/e7d-stalewal2.out`（E9 照文档 → 仍 2 单）、`ops/e7e-walfix.out`（补一行 `rm -f …-wal …-shm` → 1 单）、`ops/e7c-stalewal.out`（方法学踩坑，不作依据）、`ops/e7-rollback.out`/`ops/p19b-volume-mismatch.out`（备查）、`ops/e7-snap2/shop-20261015.db`（拷出的官方快照）；脚本 `e2e/uat-feat002/p-ops-rollback2.sh`（主）、`p-ops-rollback4.sh`、`p-ops-rollback5.sh`。

## 待主控裁定

1. ~~`P-19` 判不达标是否成立~~ → **已结案**：dev 补齐 `proxy` 档案，复验通过，改判 **达标**；仅剩真域名 ACME 证书链为无法判定（U2）。
2. `T-4` 四项 Tab 是否越判据。3. `T-2` 色值差距是否可接受。4. `E1` 注册不并车是否算缺陷（`AC-15` 字面只写「登录时」）。5. `E3` 搜索过滤期望口径。6. `U1`/`U3`/`U4`/`U5` 是否需换环境补测。
7. ~~是否需要我把托管实例按原起法复起~~ → **已裁定不复起**（`AC-25` 需 3000 空闲）；交付时保持停止。
8. ~~**E7 归属**：回滚卷名不符 → 是否派 dev 修文档？是否改判 `P-17`/`P-14`？~~ → **已结案**：主控核准，dev 已修文档；我复验逐字跑通、回滚实测生效 ⇒ E7 **闭环**。
9. ~~**E9**：请派 dev 在回滚第 2 步补 `rm -f …-wal …-shm`~~ → **已结案**：dev 已修，我终次复验③ 在 SIGKILL 崩溃路径逐字复验**通过** ⇒ **`P-17` 改判达标**（§13）。
10. ~~**E8（同日快照同名覆盖）**：是否在文档点明？~~ → **已结案**：dev 只改文档（明写同日覆盖、非后悔药、手工另存）；命名粒度登记为后续包增强。
11. ~~**`P-14` 是否连带**~~ → **已裁定：维持达标**，`E9` 记在 `P-17` 名下（`P-14` 判产品侧备份/恢复能力）。
12. ~~**`P-17` 口径确认**~~ → **已裁定**：「『必须先停服』不能解释成『必须干净停机』」，不达标判定成立，修完复验通过即改判 ⇒ **`P-17` 达标**（§13）。
13. **终次复验③ 新登记（小口径/文档缺口，不翻转判定）**：① 回滚第 4 步 `curl -s -b jar.txt …` 未说明「怎么拿到该账号 cookie 罐」，照字面在无罐目录跑给 **401**（响亮报错，非假成功）⇒ 建议补一行登录命令；② 上一版 `chown node:node` 被判红（test 侧 `AC-32`）我**无法复现**（我环境里该链 `rc=0`），现版已改 `cp -pf`，仅登记口径差异；③ 线报称回滚节 4 个 bash 块，实测 **2 块**。
14. **新增产物（复验③）**：脚本 `e2e/uat-feat002/p-ops-rollback6-final.sh`、`p-ops-rollback7-jar.sh`；读数 `reports/uat/evidence/FEAT-002-uat/e7f-final.out`、`e7g-crashpath.out`、`ops/e7f-*`、`ops/e7g-*`（含 `e7g-orders-literal.json`、`e7g-06-prvw.out`/`e7g-08-postvw.out`）。
