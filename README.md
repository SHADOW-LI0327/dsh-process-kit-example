# dsh-process-kit-example

**一个「全新空仓 + 一句话需求」跑到交付的端到端实例**，用来演示 [`dsh-process-kit`](https://github.com/SHADOW-LI0327/dsh-process-kit) 的流程长什么样、每一步花多久、留下什么证据。

- **需求**：一句话 —— 「**做一个电商 app**」（人工只给了这一句，其余全程无人参与）。
- **交付物**：一个**零运行时依赖**的电商 app —— 后端 `server/` 用 `node:http`，前端 `web/` 是原生 HTML/CSS/ESM（**无构建步骤**），同一端口同时提供 JSON 接口与静态前端。五个功能面：商品列表 / 商品详情 / 购物车 / 下单（假支付，下单即已支付）/ 订单列表；数据全在内存，**重启即重置**。
- **流程产物**：需求核对件 → PRD + 接口契约 + 设计与说明 + UI 规格/原型 → 写红存档 → 测试台账 → UAT 清单与两轮真机报告 → 独立复跑报告 → pm 完备性审核 → 归档包，**全部留在本仓**（见 §5 产出物地图）。

> **一句话结论**：**能跑、能点、判据可复核** —— 5 个功能面在真机浏览器（CDP 驱动 Edge）与 HTTP 直连两条路径上都实测可用（`npm test` 53/53 exit 0、两条门禁 exit 0、UAT 24 条 = ✅22 / 不由 UAT 承载 2 / ❌0），过程中 UAT 真抓到 1 个违反冻结判据的真缺陷并闭环修掉。
> **但不能拿它宣称「流程保证质量」**：本次四个 Gate **全部是 AI 托管代签、人零参与**，且**只跑了 1 次**（机器可核验证据链要求的 `chainHash` / `via` / 门禁证据段属于 0.5.0，本机装的是 0.4.0）。完整理由与全部原始读数见 🔒 [验收报告](reports/orchestrator/FEAT-001-验收报告.md)（**该报告不入库**，见 §5 说明）。

---

## 1. 怎么跑起来

```bash
npm install     # 只装开发依赖 jsdom（供前端结构断言用）；运行时零依赖
npm start       # 起服务，默认 http://127.0.0.1:3000
```

浏览器打开 <http://127.0.0.1:3000/>。

```bash
npm test                                        # 快速验证：node --test 'test/**/*.test.mjs'（53 条）
node scripts/process/check-artifact-paths.mjs   # 流程门禁①：产物落点，exit 0 = 无越界
node scripts/process/check-rules.mjs            # 流程门禁②：台账 ↔ 测试 ↔ PRD 三层自洽
```

> ⚠ **别写成 `node --test test/`** —— 在 Node 24 上它把 `test/` 当模块路径，**一条用例都不跑**却报 1 个失败（本次实测踩过，已修；见验收报告 §5 与 `PROJECT.md` §2）。

## 2. 试什么（5 件事）

1. **首页 → 详情 → 回列表**：8 件商品（无图片素材，首字色块）；点**商品名**进详情，把价格/库存/描述与列表逐项比对。
2. **加购 → 改件数看灰化**：连点 3 次「加入购物车」（徽标 1→3）→ 购物车把件数点到 **8**（「＋」变灰，**在灰键上继续点没有反应也不发请求**）→ 再点回 1（「－」变灰）。
3. **两步下单**：「去结算」→「提交订单」→ **下单即已支付**（假支付，无需填收货信息）→ 订单列表**最近一单在最上**、购物车被清空、回详情看**库存少了对应件数**。
4. **踩错误路径**：某件加到 8 再点加购 →「已达上限：单件商品最多买 8 件」；空车点提交 →「购物车是空的，无法提交订单」；把 hash 改成 `#/products/xxx` →「找不到该商品」。
5. **隔离与复位**：开**全新无痕窗口** ⇒ 空车空订单（浏览器与 curl 各自一辆车是预期）；`Ctrl+C` 再 `npm start` ⇒ 数据全部复位。

**两个最容易踩的坑**：① 前端是**哈希路由**，购物车是 **`/#/cart`**（手敲 `/cart` 会得到 404 JSON）；② 用 curl 试写接口必须带 `-H 'Content-Type: application/json'`（默认的 form-urlencoded 会被判 `400 INVALID_BODY`）。

## 3. 这一场跑了多久（**步骤时长**，取自 journal 机器时间戳）

| # | 环节 | 起 → 止（本地时间 UTC+8） | 时长 | 这一步留下什么 |
| --- | --- | --- | --- | --- |
| 0 | `process_init` 骨架 + `PROJECT.md` 项目适配 | 10:46:20（基线提交 `dffa22b`）→ 10:47:14 | **0m54s** | 流程骨架 + 端/命令槽/属主表/配置 |
| 1 | intake：需求核对件（`R-01`~`R-09`、`Q-1`~`Q-7`、`N-1`~`N-8`、`RSK-01`~`04`） | 10:47:14 → 10:47:14 | **<1m**（批量写入） | [`需求核对件`](docs/process/input/FEAT-001-电商app需求核对件.md) |
| 2 | **Gate0**（AI 托管代签）+ 装置取证（判别力反向对照、能力探针） | 10:47:14 → 10:49:31 | **2m17s** | journal `#4` 批准；4 种 journal 篡改情形的判读读数 |
| 3 | **pm + ui-designer 并行出件 → Gate1**（PRD / 契约 / 设计与说明 / UI 规格 / 31 个原型文件；含 **4 轮退回 pm** 与 3 轮 UI 返工） | 10:50:54 → 11:15:30 | **24m36s** | `prd/FEAT-001.md`(30 AC+14 E)、`contracts/`、`-design.md`、`-ui-spec.md`(28 条)、`prototypes/FEAT-001/`(6 屏) |
| 4 | Gate1 收尾（状态位锁步 + 几何门禁 `42 ✓ / 0 ❌`） | 11:15:30 → 11:16:39 | **1m09s** | journal `#53` 批准 |
| 5 | **test 写红波次**（44 条需求用例全红 + 判别力自证 + 潜伏缺陷排查） | 11:16:39 → 11:35:16 | **18m37s** | [`red-1.md`](reports/test/FEAT-001-red-1.md)(323 行) + [`addendum`](reports/test/FEAT-001-red-1-addendum.md)(222 行) + `test/packages/FEAT-001/**`(8 文件) + 台账 |
| 6 | **Gate2**（含 P0 修复：`npm test` 命令槽假红 + 红灯归因复核） | 11:35:16 → 11:37:05 | **1m49s** | journal `#65` 批准（批准对象 = 写红存档） |
| 7 | **dev 实现到绿**（8 端点 + 5 页面；自查中修掉 2 个真缺陷） | 11:37:05 → 11:48:35 | **11m30s** | `server/**`(6 文件) + `web/**`(11 文件) |
| 8 | 清潜伏测试缺陷（漏 import）+ 主控独立复跑绿 | 11:48:35 → 11:52:21 | **3m46s** | `npm test` 53/53 exit 0 的首个读数 |
| 9 | UAT 托管（3000 + CDP 9222）+ **test 独立 verify-1（裁判员复跑）** | 11:52:21 → 11:57:25 | **5m04s** | [`verify-1.md`](reports/test/FEAT-001-verify-1.md)（28 条指纹 + 5 组变形抽检） |
| 10 | **UAT 第 1 轮真机黑盒**（CDP 驱动 Edge，30 张截图） | 11:57:25 → 12:05:45 | **8m21s** | [`uat-1.md`](reports/uat/FEAT-001-uat-1.md)(401 行) + 30 张截图；**抓到 1 个真缺陷**（`E-11` Content-Type） |
| 11 | **返工闭环**：test 写红 `red-2`（拆混因变体）→ dev 修 → 全绿 | 12:05:45 → 12:20:06 | **14m20s** | [`red-2.md`](reports/test/FEAT-001-red-2.md)（红 `201 !== 400` → 绿） |
| 12 | **verify-2（独立复跑）+ UAT 第 2 轮复验**（并行） | 12:20:06 → 12:23:39 | **3m34s** | [`verify-2.md`](reports/test/FEAT-001-verify-2.md) + [`uat-2.md`](reports/uat/FEAT-001-uat-2.md)（`U-19` ❌→✅） |
| 13 | **pm 验收完备性审核**（需求 ↔ 判据 ↔ 覆盖三列对照） | 12:23:39 → 12:30:06 | **6m27s** | [`pm-review.md`](reports/pm-review/FEAT-001-pm-review.md) |
| 14 | **Gate4 放行 + 收口归档 + 释放托管资源** | 12:30:06 → 12:34:34 | **4m28s** | journal `#97` 批准；`_archives/…tar.gz`(89 件) + 验收报告定稿 |

**总墙钟：10:46:20 → 12:34:34 = `1h48m14s`**（journal 覆盖 `#1`→`#101` 的一段是 `1h47m21s`）。
**规模**：journal **101 行** · **6 个 actor**（`orchestrator` 81 / `pm` 6 / `ui-designer` 5 / `test-agent` 5 / `dev-agent` 2 / `uat-agent` 2）· 4 个 Gate 批准 + 29 条 `run` 记录 · 自动化用例 **53 条** · 真机截图 **45 张** · 归档 **89 件**。

**怎么读这张表（三条口径，别当成精确的工时统计）**：

1. **时间戳是「记录落盘」的机器时间，不是「人/agent 开始动手」的时间**。主控的 journal 是**批量写入**的（同一秒可能出现好几条），所以第 1、2 行的 `<1m` 只是批量写入的假象 —— intake 的实际起草发生在基线提交之前。
2. **并行环节的时长会重叠**：第 3 行是 `pm` 与 `ui-designer` **并行**出件的合并区间；第 12 行是 `verify-2` 与 `UAT 第 2 轮` 并行 ⇒ **各行相加 > 总墙钟**。
3. **`journal` `#32`/`#33` 两条的 `at` 是占位符**（`__AT__`，主控 heredoc 引号事故的 errata，按只追加纪律**未回改**），**未参与**本表计算。

## 4. 流程长什么样（这一步到下一步的门禁）

```
一句话需求
  └─ intake：需求核对件（复述需求 + 收敛疑问）
       └─ 【Gate0】← 人/托管代签，产物冻结
            └─ pm：PRD + 接口契约 + 设计与说明      ┐
            └─ ui-designer：UI 规格 + 原型（并行）  ┘
                 └─ 【Gate1】← 送审四件套
                      └─ test：写红（先证明判据会红，且红因正确）
                           └─ 【Gate2】← 批准写红存档
                                └─ dev：实现到绿
                                     └─ test：独立 verify 复跑（裁判员 / 运动员分离）
                                          └─ uat：真机黑盒验收（不知代码，只判「用起来对不对」）
                                               └─ pm：验收完备性审核
                                                    └─ 【Gate4】→ status: done + 归档
```

四个 Gate 中，**只有人能 approve**；本仓这一场的四签都是**AI 托管代签**（`via: "ai-hosted"`，用户明示「我全程不会参与」）。

## 5. 产出物地图

> ⚠ **先看这一条再点链接**：本仓 `.gitignore` 把 **`reports/**`（验收报告 / 写红存档 / 独立复跑 / UAT 报告与 45 张截图 / 归档包）**与 **`docs/process/tools/**`（真机驱动脚本等过程载体）** 排除在版本库外（总纲 §6.5 / §10.1 的纪律：过程载体与批次报告不入库）。
> 所以**克隆下来的仓里没有它们**，下表带 🔒 的行只在「跑这一场的工作区」里可见。**入库可核验的证据是**：journal（`docs/process/prd/FEAT-001.journal.jsonl`，逐条命令 + 真实退出码）、需求核对件、PRD / 契约 / 设计与说明 / UI 规格 / 原型、台账 `rules/FEAT-001.yaml`、测试 `test/packages/FEAT-001/**`、UAT 清单 `docs/process/uat/FEAT-001-checklist.md`。
> 要把过程报告也发布出去，就得先改 `.gitignore`（或 `git add -f`）——**这是人的决定，不是流程自动做的**。

| 我想看… | 去哪 |
| --- | --- |
| **全过程结论、9 项检查单判定、装置缺陷、未覆盖项** | 🔒 [验收报告](reports/orchestrator/FEAT-001-验收报告.md) |
| 需求是怎么被复述与收敛的 | [`docs/process/input/…核对件.md`](docs/process/input/FEAT-001-电商app需求核对件.md) |
| 产品判据（30 AC + 14 E）与待裁定问题（`Q-1`~`Q-10`） | [`prd/FEAT-001.md`](docs/process/prd/FEAT-001.md) |
| 接口契约（8 端点 / 8 错误码 / 字段表） | [`contracts/FEAT-001.md`](docs/process/contracts/FEAT-001.md) |
| UI 规格（28 条）与 6 屏原型 | [`prd/FEAT-001-ui-spec.md`](docs/process/prd/FEAT-001-ui-spec.md) · [`prototypes/FEAT-001/`](docs/process/prototypes/FEAT-001) |
| 写红存档 + 独立复跑报告 | 🔒 [`reports/test/`](reports/test) |
| 真机 UAT 两轮（结论 + 截图 + 原始响应） | 🔒 [`reports/uat/`](reports/uat) · [`evidence/`](reports/uat/evidence) |
| pm 完备性审核 | 🔒 [`reports/pm-review/`](reports/pm-review) |
| 逐条执行证据（命令 + 真实退出码） | journal：[`docs/process/prd/FEAT-001.journal.jsonl`](docs/process/prd/FEAT-001.journal.jsonl)（**入库**，103 行，只追加） |
| 收口归档包（91 件 + 清单 + 校验和） | 🔒 [`reports/_archives/`](reports/_archives) |
| 流程规则本身（唯一真源 / 项目适配） | [`docs/process/README.md`](docs/process/README.md) · [`docs/process/PROJECT.md`](docs/process/PROJECT.md) |
| 真机驱动脚本（UAT 载体，5 个零依赖 `.mjs`） | 🔒 [`docs/process/tools/FEAT-001/`](docs/process/tools/FEAT-001) |

## 6. 装置与环境（照实记，别照抄成「标准配置」）

| 项 | 本场实测 |
| --- | --- |
| 流程插件 | **0.4.0**（`ACCEPTANCE.md` 判的机器可核验证据链要求 0.5.0 ⇒ 检查单第 1/4/5 项按口径**不达标**，属装置能力缺口，非流程失败） |
| 运行时 | Node `v24.14.1` · npm 11.11.0 · 开发依赖仅 `jsdom 30.1.2` |
| 真机 | Microsoft Edge 155.0.4283.45 无头 + CDP（需 `--headless=new --no-sandbox`，且 `--user-data-dir` / `--crash-dumps-dir` 必须落在可写目录） |
| 归档 | `reports/_archives/` 与 `reports/**` 按 `.gitignore` 不入库 |
| git | 基线 `dffa22b`（`process_init` 骨架）→ 交付提交 **`4d94ab4`**「feat(FEAT-001): 一句话需求「做一个电商 app」的端到端交付」（72 文件，+12751/−17）；作者身份是本仓占位配置 `dsh-process-kit-example <dev@example.local>`，要挂到自己名下需 `git commit --amend --reset-author` |
| **克隆即用（实测）** | `git clone` 到空目录 → `npm install --offline`（36 包，仅一条无害 `EBADENGINE`）→ **`npm test` = 53/53 exit 0** → `PORT=0 npm start` → `GET /` 200（2907B，「共 8 件商品」）+ `/api/v1/products` 200 ⇒ **交付仓自带自足、无需本机预设** |

**已知偏离与未覆盖（不掩盖）**：收口归档**不删原件**、状态位由主控写（属主表缺口已补注）、`V-01`（库存 <8 时「＋」不禁用）登记不返工、`U-12`/`E-14` 属自动化专有面、**场景只跑了 1 次**（第二次必须在 0.5.0 上跑）—— 逐条见 🔒 [验收报告](reports/orchestrator/FEAT-001-验收报告.md) §4 与 §7（该报告不入库，见 §5）。
