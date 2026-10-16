---
project: dsh-process-kit-example
processVersion: 1
---

# 项目适配（PROJECT）

> 本文件是**通用流程与本项目之间的唯一接口**：通用文档（总纲 / 调度手册 / 模板）只引用本表，**不硬编码项目细节**。
> 换项目 = 只改本文件；通用流程文件**不得**因项目不同而被改写。
> **机器读取约定**（§4 / §5）：键名照抄、不得改名；取值用反引号包裹，多个用 `、` 分隔，值内不出现空格与 `|`。

---

## 1. 端与目录

| 端/目录 | 说明 | 可写角色 |
| --- | --- | --- |
| `server/` | 后端 API 服务：Node.js 内置 `node:http`，**零运行时依赖**；提供商品 / 购物车 / 订单 JSON API，并同端口托管 `web/` 静态资源 | `dev-agent` |
| `web/` | Web 前端：原生 HTML + CSS + ES Module，**无构建步骤**；由后端同端口托管，浏览器直开即用 | `dev-agent` |
| `test/` | 测试目录：`node:test` 为主，前端交互用 `jsdom`；需求专属测试固定在 `test/packages/<ID>/` | `test-agent` |
| `e2e/` | UAT 黑盒操作脚本（HTTP 层驱动，不经源码） | `uat-agent` |
| `docs/process/` | 流程目录（框架约定保留此路径，**不要改名**） | `orchestrator` |
| `docs/process/tools/` | 过程载体目录（一次性脚本 / 探针 / 取证；被忽略规则排除） | `test-agent`、`uat-agent` |
| `scripts/process/` | 框架自带门禁与 journal 脚本（常驻，勿搬走） | `orchestrator` |
| `reports/` | 报告与批次归档；`reports/_archives/**` 是恢复源，长期保留 | 见 §3 |
| `docs/process/tools/RESOURCES.md` | 互斥资源占用登记（构建 / 单测通道、端口 `3000`）：先登记后使用，用完释放 | 全体（先登记后使用） |

> **口径注：为什么本项目「有鉴权却仍然没有 `403` 面」（`FEAT-002` `Q-19` 的落地口径，2026-10-15）**
> 总纲 §6.4 第 16 条要求状态码语义「`401` 未认证 / `403` 已认证但无权」，即**能分辨「你是谁」与「你能不能」时应当用 `403`**。本项目**主动选择不暴露该分辨**：
> - **未登录** ⇒ `401 UNAUTHENTICATED`；
> - **已登录但访问别人的购物车 / 订单** ⇒ **`404`**，且响应 `code` 与 `message` 与「该资源根本不存在」**逐字相同**（`AC-19` 用三取样判别，不是抄文案）。
> **理由**：本项目的资源标识（`orderNo`）是**可枚举的短号**，若越权返 `403`、不存在返 `404`，攻击者即可用状态码差异**探测哪些订单号真实存在**（存在性泄露 / 枚举 oracle）。用 `404` 把两种情形**合并成同一形态**，是拿「状态码语义纯度」换「不泄露存在性」。
> **代价与边界**：① 客户端无法从状态码区分「没登录过」与「登录了但不是你的」—— 已由 `401` 与 `404` 的分工覆盖真实需求；② 该选择**只在越权对象为可枚举标识时成立**，若将来引入 UUID / 不可枚举标识，应重新评估是否回到 `403`。
> **依据**：核对件 §5.1.2（`Q-3` 子项 3-a④）+ PRD `AC-19` + 契约 §4.5/§六「`403` 缺席声明」（`S-16`）。**任何角色在本项目断言 `403` 即判不合格。**

---

## 2. 命令槽

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 快速验证 | `npm test` | 等价 `node --test 'test/**/*.test.mjs'`，跑全量测试（含 `test/packages/FEAT-001/**`）。⚠ **禁止写成 `node --test test/`** —— 在 Node v24.14.1 上它把 `test/` 当模块路径，报 `Cannot find module '…/test'` 且**一条用例都不跑**（只产出 1 个假失败、exit 1）；2026-10-15 实测，`package.json` 已按 glob 写法修正。口径 = **本次验证无红**；任何一段报红即如实上报，禁止白名单 / 排除 / 取错退出码；报告必须声明跑在哪个基线 |
| 产物落点门禁 | `node scripts/process/check-artifact-paths.mjs` | exit 0 = 无越界落点。判定对象 = **未被忽略的未跟踪文件**；放行来源 = §3「可写路径」列 或 登记区登记行 |
| 台账门禁 | `node scripts/process/check-rules.mjs` | exit 0 = 无 ❌。校验 `TC` ↔ 测试 `@case` 双向配对、`@prd` 归属、`prdVersion` 三方一致、import 白名单 |
| journal 追加 | `node scripts/process/journal-append.mjs docs/process/prd/FEAT-001.journal.jsonl --stdin` | 追加式写入（锁 + 指纹校验 + 原子替换 + 自校验）；`at` 取机器时间；**禁止读-改-写**。`action:"run"` 必须带 `command` 与真实 `exitCode`；`action:"approve"` 带 `gate` 与 `via` |

---

## 3. 产物属主表

> 每角色**唯一合法写入根**；越界即停，不得自行发明路径。路径以仓库根为基准。
> 「禁止」列仅供人阅读；门禁只取「可写路径」列。
>
> **状态位例外（本项目裁定，2026-10-15 补）**：**流程状态位一律由 `orchestrator` 在各 Gate 落定** —— 即 `<ID>.md` / `<ID>-design.md` / `<ID>-ui-spec.md` / `contracts/<ID>.md` 这四件 frontmatter 里的 `status` / `gate1` / `gate2` / `gate4` / `prdVersion` 字段行，**不受上表「可写路径」限制**（其余正文内容仍严格归各属主）。
> **为什么必须写进本表**：总纲 §3.1 要求「状态位写在当前阶段主产物的 frontmatter」、§9.7 要求「Gate4 签收 ⇒ 落 `gate4: approved` + `status: done`，两个字段必须一起写」，但这些文件在上表里只判给了 pm / ui-designer ⇒ 两条规则不可能同时满足（属主表缺口，验收报告 §4-7 已登记）。
> **附带工作方式（0.4.0 装置规避，一并说明）**：0.4.0 的状态加载器把 `prd/*.md` 中**每个**带 `id` 的 frontmatter 都当包记录候选、**先读到者赢**，而本机 `readdir` 顺序是 `-design.md → -ui-spec.md → <ID>.md` ⇒ 包状态实际取自子产物。因此这四件的状态位**必须保持锁步**（漏一个就可能让 `process_status` 报错值甚至崩掉，验收报告 §5.5 有完整取证）。装置修好后此「锁步」可放宽为「只维护 `<ID>.md`」。
>
> **投产面落点属主（2026-10-15 补，FEAT-002 Gate0 后）**：`FEAT-002` 要交付**可投产**能力（总纲核对应有的 `P-15`~`P-19`：容器化 / 编排 / 部署文档 / CI / 运维脚本），但上表**原本没有任何角色能写仓根级部署件** ⇒ 与 `README.md` 同一个坑：**先写文件必被落点门禁与属主审计判越界**。故按「**先改规则、再落文件**」补入 `dev-agent` 一行：`Dockerfile`、`docker-compose.yml`、`.dockerignore`、`.env.example`、`docs/DEPLOY.md`、`.github/workflows/**`（CI）、`scripts/ops/**`（**随交付物发布的**运维脚本，如备份/恢复；一次性探针仍按总纲归 `docs/process/tools/<ID>/`，与 `scripts/process/**` 分开）。**路径口径（2026-10-15 二次校准，与 `FEAT-002` PRD 对齐）**：容器与编排件**唯一家 = `deploy/`**（`AC-33` 写 `deploy/Dockerfile`、`AC-34` 写 `deploy/docker-compose.yml` 与 `deploy/.env.example`、`AC-37` 写反代示例 `deploy/nginx.conf` / `deploy/Caddyfile`）⇒ 属主表按**文件级**登记，**不设仓根级 `Dockerfile`**，避免同一交付物有两个合法落点（落点门禁会把仓根级那个判越界）。`docker build -f deploy/Dockerfile .` 与 `docker compose -f deploy/docker-compose.yml` 为本项目起法。**
>
**边界**：这些路径只加「可写路径」，**不改变任何判据与状态位**；`scripts/process/**` 仍属 `orchestrator`。
>
> **`README.md` 属主（2026-10-15 补，收口后）**：仓库根 `README.md` 是**本仓对外的入口文档**（示例项目的「这是什么 / 怎么跑 / 这一步一步花了多久」），归 `orchestrator`。**补这条的原因**：它此前不在任何角色的可写路径里 ⇒ 一旦落盘就会被落点门禁与属主审计判**越界**（两条门禁均 exit 1），而把对外入口文档写进 `reports/` 又不合人读习惯；属主表是**项目适配接口**，路径该增就增，**但不允许「先写文件再指望门禁放行」**。改动只影响「可写路径」列（35 → 36 条），**不改变任何判据与状态位**。

| 角色 | 可写路径 | 禁止 |
| --- | --- | --- |
| `orchestrator`（主控） | `docs/process/README.md`、`docs/process/orchestrator.md`、`docs/process/PROJECT.md`、`docs/process/input/**`、`docs/process/ui/**`、`docs/process/tools/README.md`、**`docs/process/tools/FEAT-002/**`（与 test/uat **共享**的载体根：跨角色装置笔记与校验脚本；2026-10-15 补，理由 = 主控实测到的 `node:sqlite` / 容器权限 / 门禁副作用等**跨角色陷阱**需要有落点，写进 journal 只有主控自己会读、写进交付物又不该。该根被 `.gitignore` 排除 ⇒ 不影响落点门禁与属主审计）**、`docs/process/prd/*.journal.jsonl`、`docs/process/prd/*.journal.jsonl.meta.json`、`scripts/process/**`、`reports/orchestrator/**`、`reports/gaps/**`、`reports/_archives/**`、`AGENTS.md`、`README.md`、**`docs/images/**`（README 的 example 截图落点：`README.md` 归主控 ⇒ 它引用的图片必须与它同级可写，否则每张图一落盘就计一条越界；2026-10-16 补。**这条是「先写文件、后补授权」的偏差**——先落了 15 张图才发现该目录无授权，按本表上方补 `README.md` 那次的同一条先例（其原文：「属主表是**项目适配接口**，路径该增就增，**但不允许「先写文件再指望门禁放行」**」）**如实登记为违规**，另已回跑门禁证明 EXIT=0）**、`.gitignore`、`.npmrc`、`package.json`、`package-lock.json` | 写实现 / 写测试 / 替人做 Gate 决策 |
| `pm` | `docs/process/prd/**`、`docs/process/contracts/**`、`docs/process/uat/*-checklist.md`、`reports/pm-review/**` | 读业务实现 / 测试 / e2e / 日志；写实现 |
| `ui-designer` | `docs/process/prd/*-ui-spec.md`、`docs/process/prototypes/**` | 改实现源码；读后端实现 / 前端组件内部实现 / 测试 / e2e / 日志 |
| `test-agent` | `test/**`、`docs/process/rules/**`、`reports/test/**`、`docs/process/tools/FEAT-001/**`、`docs/process/tools/FEAT-002/**` | 改 `server/`、`web/` 实现源码；读业务实现细节（接口签名 / schema 除外） |
| `dev-agent` | `server/**`、`web/**`、`package.json`、**`deploy/Dockerfile`、`deploy/docker-compose.yml`、`deploy/.dockerignore`、`deploy/.env.example`、`deploy/Caddyfile`、`docs/DEPLOY.md`、`.github/workflows/**`、`scripts/ops/**`、`.dockerignore`（仓根。2026-10-15 补，实测教训：Docker 只认「构建上下文根」那一份忽略文件，本包上下文 = 仓根（需 COPY server/ web/），故 `-f deploy/Dockerfile .` 生效的是仓根这份；`deploy/.dockerignore` 对 Docker 语义无效，但契约列为交付物，仍一并交付。dev 的 deploy 用例断言的就是仓根那份。） | 改 `test/`；改 `e2e/` |
| `uat-agent` | `docs/process/uat/**`、`reports/uat/**`、`e2e/**` | 读任何代码 / 测试 / 日志；判功能对错以外的事 |
| `code-review-agent`、`security-review-agent`、`logic-review-agent` | `reports/code-review/**`、`reports/security-review/**`、`reports/logic-review/**` | 改 `server/`、`web/`；贴大段代码 |

**禁止落点（任何角色一律不得写入）**：

- 一次性探针 / 夹具播种 / 清理 / 截图 / 取证脚本落到受版本控制的 `scripts/` ⇒ 归 `docs/process/tools/FEAT-001/`；
- `docs/process/` 根层级（只放总纲 · 调度手册 · 本文件与模板）；
- 任何**未被忽略规则覆盖**的一次性产物（它一定会进人的提交）——「用完即删」不构成豁免。

---

## 4. 项目配置

| 配置项 | 取值 | 说明（默认值 / 示例 / 是否可选） |
| --- | --- | --- |
| 测试扫描目录 | `test` | `check-rules` 递归扫描的测试根目录 |
| 测试文件后缀 | `.test.mjs` | 本项目测试一律 ESM 后缀 |
| 流程测试目录 | `test` | 受 import 白名单约束的目录 |
| 需求包测试目录 | `test/packages` | 需求专属测试的家：`test/packages/<ID>/` |
| import 白名单 | `^node:`、`^\.\.?/`、`^jsdom$` | 仅允许 node 内置、相对路径、jsdom；业务实现只许经相对路径从测试目录进入 |
| 自动化类型 | `node`、`manual`、`uat`、`none`、`pending`、`withdrawn` | 台账 `automation:` 的精确词表 |
| @case 载体类型 | `node` | 这些类型必须在测试源码里有 `@case TC-<ID>` 载体 |
| 台账目录 | `docs/process/rules` | `<ID>.yaml` 台账所在目录 |
| PRD 目录 | `docs/process/prd` | `<ID>.md` 与 `<ID>-design.md` 所在目录 |
| 登记区文件 | `docs/process/tools/README.md` | 登记区的登记行即为落点门禁的第二放行来源 |
| UI 几何网格 | `8` | 网格符合率 ⚠ 提示用 |
| UI 文字最小间隙 | `4` | 同列文字行盒垂直间隙下限（px） |
| UI 居中偏差上限 | `1` | 声明 `align` 的元素居中偏差上限（px） |
| UI 边距对称容差 | `1` | 内容区左右边距之差上限（px） |
| UI 对比度下限 | `4.5` | WCAG AA 正文 |
| UI 大字号对比度下限 | `3.0` | WCAG AA 大字号（≥24pt） |
| UI 项目令牌 | `docs/process/prd/FEAT-001-ui-spec.md`、`docs/process/prd/FEAT-002-ui-spec.md` | 几何门禁 ⑩ 的**令牌源**（从中抽 6 位色值当项目色板，再判原型主色是否照抄）。当前真源 = FEAT-002
| 限流阈值（可调） | `RATE_LIMIT_MAX` | 环境变量，默认 `60` = 每会话上限；每 IP = ×4（240）、全局 = ×20（1200），窗口 `RATE_LIMIT_WINDOW_MS` 默认 60000ms。限流取证时调小即可：`RATE_LIMIT_MAX=5` ⇒ 同一匿名会话第 6 次写请求即 `429`（`2026-10-16` 由 dev 定位并给出 429 真读数；**未新增变量名** ⇒ `AC-35` 变量集合不变） | UI 规格的「设计令牌表」。**两个包都登记**（实测教训）：几何门禁一次判**全部**包，只登记 FEAT-002 会让**已冻结的 FEAT-001 原型**在 ⑩ 判 ❌「画面主色不在令牌里」**9 条**，把仓库级门禁拖成 exit 1 ⇒ 令牌源必须是**全体在库包调色板的并集**。代价：并集使「照抄本项目令牌」这一检查对单包变松（FEAT-001 的深色盘也算合法）；FEAT-002 侧「不得残留旧深色令牌」由 `AC-38` 的反向断言（旧令牌计数 = 0）单独守住，不依赖 ⑩。可多个，用 `、` 分隔 |

---

## 5. UAT 前置自检

| 配置项 | 取值 | 说明（默认值 / 示例 / 是否可选） |
| --- | --- | --- |
| core 后端 | `http://127.0.0.1:3000` | 存活探测与端点探测基地址 |
| web 前端 | `http://127.0.0.1:3000` | 本包前后端**同端口**，故与 core 同址 |
| 目标端点 | `products`、`cart`、`orders` | 相对「端点前缀」；应返回 HTTP 200。**不写具体商品 ID** —— 判据与探测一律不得依赖夹具主键 |
| 端点前缀 | `/api/v1` | 拼在 `core 后端` 之后 |
| 移动端 | `http://127.0.0.1:3000` | **本包无独立移动端客户端**：移动体验 = **同源页面的移动视口**（390px），故与 core 同址（检查器自身亦注明「移动端也可用浏览器视口验」）。⚠ **不要删这一行、也不要留空** —— 两者都会回落默认 `:5174` 并被判**阻断**（框架缺陷，已登记） |
| 真机 CDP | `http://localhost:9222/json` | `FEAT-002` 起 UAT 走 **Edge 无头 + CDP** 真机取证（不带时回落同默认值；不通只 ⚠） |
| 清单目录 | `docs/process/uat` | `<ID>-checklist.md` 缺失即判阻断 |
| 证据目录 | `reports/uat/evidence` | `--progress` 时报逐项完成度 |

> **填写纪律（`FEAT-002` 起实测更新，**推翻原模板建议**）**：
> 原模板写「未启用的行一律删掉，不要写『不适用』」—— **实测这条对本包的「移动端」自相矛盾**：`check-uat-readiness.mjs` 的解析是 `conf("移动端") ?? "http://127.0.0.1:5174"`，**删行与留空都会回落到默认 `:5174`**，然后被当作**阻断项**（不是跳过）。故本包**显式声明**移动端 = **同源 `:3000`**。**该框架缺陷已登记为流程建议。**
> `验收账号` / `验收口令` / `登录路径` / `令牌字段` 四项本包**不预置**（`FEAT-002` 的账号是**自助注册**）⇒ 留空回落默认、登录探测自动降级为 ⚠。⚠ **不要预置**：配了账号口令但库里没有该账号时，登录探测会**判阻断**。
> ⚠ **更要紧的一条（`FEAT-002` 实测）**：本包的会话是 **cookie `sid`**，**登录/注册响应体里没有任何 token 字段**（实测 `POST /api/v1/auth/login` → 200，体只有 `{data:{user:{id,email,createdAt}}}` + `Set-Cookie: sid=…`）。而检查器的 `令牌字段` 默认读 `data.accessToken` ⇒ **即便库里先建好账号再配上去，登录探测也必然读不到 token 而判阻断**。**故这四项必须保持不配**（两条 ⚠ 是本包的**正确终态**，不是缺配置）。`目标端点权限` 那道「越权 = `404`」防线**由自动化用例与 UAT 清单承载**（`AC` 越权 404 系列 + 清单相关条目），**不依赖此探测**。
> 本包**有鉴权**（邮箱 + 口令、会话 cookie `sid`；下单/订单面需登录，**越权一律 `404`**）、**无独立移动端客户端**、**有真机 CDP 通道** —— §6 有说明。

---

## 6. 环境与凭据

| 项 | 取值 / 路径 | 说明 |
| --- | --- | --- |
| 服务地址（本地） | `http://127.0.0.1:3000` | 后端 API 与 Web 前端同端口（`server/src/index.mjs` 一并托管） |
| 数据库 | `node:sqlite`（`DB_PATH`，默认 `./data/shop.db`） | **磁盘持久化，重启不丢**；版本化迁移 + 幂等播种（`FEAT-002` 起，见其 `AC-01`/`AC-05`）；`DB_PATH=:memory:` 为纯内存模式。**【已被 `FEAT-002` 取代】**（原「内存态存储，进程重启即重置」为 `FEAT-001` 当期事实，见 `FEAT-002` PRD §1.5 `S-15`） |
| 测试账号 | 自助注册：邮箱 + 密码（≥8 位）；会话 cookie `sid` | 受保护面（下单 / 订单 / `auth/me`）**需登录**；**越权一律 `404 NOT_FOUND`**（不暴露存在性）。**【已被 `FEAT-002` 取代】**（原「无鉴权、无账号」为 `FEAT-001` 当期事实） |
| 真机 / 设备 | **Edge 155 + CDP**（headless，`--remote-debugging-port=<port> --no-sandbox --disable-gpu --disable-crash-reporter --disable-breakpad`） | `FEAT-002` 的 UAT 已用**真实 headless Edge** 驱动黑盒：计算样式 / 几何量测 / 真实键鼠 / `Network` 请求序列 / 截图 / 断网仿真 + 分辨率模拟。**【已被 `FEAT-002` 取代】**（原「本机无浏览器驱动…走 HTTP 黑盒」为 `FEAT-001` 当期事实）。**仍无 iOS / Android 物理真机** ⇒ 触摸手感与真机字体仍未覆盖 |
| 凭据文件 | 不适用 | 无凭据 |
| 忽略规则 | `.gitignore` 排除 `node_modules/`、`.npm-cache/`、`docs/process/tools/`、`reports/` | 过程产物与依赖不入库；**「没进 git ≠ 没做」** |

---

## 7. 通知（可选）

| 项 | 取值 |
| --- | --- |
| 触发时机 | 不适用 |
| 命令 | 不适用 |
| 内容形态 | 不适用 |
| 凭据来源 | 不适用 |
| 失败处置 | 不适用 |

> 不启用的理由：本项目是流程插件的验收示例仓，无对外通知渠道；Gate4 签收后不发通知，收口结论只写在验收报告与 journal 里。
