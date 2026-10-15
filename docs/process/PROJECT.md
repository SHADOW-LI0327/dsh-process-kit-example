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
> **`README.md` 属主（2026-10-15 补，收口后）**：仓库根 `README.md` 是**本仓对外的入口文档**（示例项目的「这是什么 / 怎么跑 / 这一步一步花了多久」），归 `orchestrator`。**补这条的原因**：它此前不在任何角色的可写路径里 ⇒ 一旦落盘就会被落点门禁与属主审计判**越界**（两条门禁均 exit 1），而把对外入口文档写进 `reports/` 又不合人读习惯；属主表是**项目适配接口**，路径该增就增，**但不允许「先写文件再指望门禁放行」**。改动只影响「可写路径」列（35 → 36 条），**不改变任何判据与状态位**。

| 角色 | 可写路径 | 禁止 |
| --- | --- | --- |
| `orchestrator`（主控） | `docs/process/README.md`、`docs/process/orchestrator.md`、`docs/process/PROJECT.md`、`docs/process/input/**`、`docs/process/ui/**`、`docs/process/tools/README.md`、`docs/process/prd/*.journal.jsonl`、`docs/process/prd/*.journal.jsonl.meta.json`、`scripts/process/**`、`reports/orchestrator/**`、`reports/gaps/**`、`reports/_archives/**`、`AGENTS.md`、`README.md`、`.gitignore`、`.npmrc`、`package.json`、`package-lock.json` | 写实现 / 写测试 / 替人做 Gate 决策 |
| `pm` | `docs/process/prd/**`、`docs/process/contracts/**`、`docs/process/uat/*-checklist.md`、`reports/pm-review/**` | 读业务实现 / 测试 / e2e / 日志；写实现 |
| `ui-designer` | `docs/process/prd/*-ui-spec.md`、`docs/process/prototypes/**` | 改实现源码；读后端实现 / 前端组件内部实现 / 测试 / e2e / 日志 |
| `test-agent` | `test/**`、`docs/process/rules/**`、`reports/test/**`、`docs/process/tools/FEAT-001/**` | 改 `server/`、`web/` 实现源码；读业务实现细节（接口签名 / schema 除外） |
| `dev-agent` | `server/**`、`web/**`、`package.json` | 改 `test/`；改 `e2e/` |
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

---

## 5. UAT 前置自检

| 配置项 | 取值 | 说明（默认值 / 示例 / 是否可选） |
| --- | --- | --- |
| core 后端 | `http://127.0.0.1:3000` | 存活探测与端点探测基地址 |
| web 前端 | `http://127.0.0.1:3000` | 本包前后端**同端口**，故与 core 同址 |
| 目标端点 | `products`、`cart`、`orders` | 相对「端点前缀」；应返回 HTTP 200。**不写具体商品 ID** —— 判据与探测一律不得依赖夹具主键 |
| 端点前缀 | `/api/v1` | 拼在 `core 后端` 之后 |
| 清单目录 | `docs/process/uat` | `<ID>-checklist.md` 缺失即判阻断 |
| 证据目录 | `reports/uat/evidence` | `--progress` 时报逐项完成度 |

> **未启用的行一律删掉，不要写「不适用」** —— 这是实测踩到的坑，见下方「填写纪律」：
> 「移动端」「验收账号」「验收口令」「登录路径」「令牌字段」「真机 CDP」六项本包均未启用，故**整行删除**（删掉即回落默认值；无账号时登录与端点探测自动降级为 ⚠）。
> 本包无鉴权、无移动端、无真机与 CDP 端点，三项状态在 §6 有说明。

---

## 6. 环境与凭据

| 项 | 取值 / 路径 | 说明 |
| --- | --- | --- |
| 服务地址（本地） | `http://127.0.0.1:3000` | 后端 API 与 Web 前端同端口（`server/src/index.mjs` 一并托管） |
| 数据库 | 不适用 | 内存态存储，进程重启即重置；本包显式不做持久化（见核对件 §6 不做项） |
| 测试账号 | 不适用 | 无鉴权、无账号；共享数据无被改风险 |
| 真机 / 设备 | 不适用 | 本机无浏览器驱动（无 Chrome / CDP）；UAT 走 HTTP 黑盒，界面观感交人裁 |
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
