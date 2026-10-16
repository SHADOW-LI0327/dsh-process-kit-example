# AGENTS.md

本文件为 AI Agent 在此仓库中工作时的指导说明。

> **维护原则**：本文件持续参与每次对话上下文，只保留必须时刻遵守的**规范**与高频入口；操作手册、设计文档、部署/测试指南一律放 `docs/`，此处只留链接。

## 开发流程（docs/process，强制）

**功能开发必须走 [`docs/process`](docs/process/README.md) 流程，禁止绕过流程直接改源码。**

- **唯一真源**：[`docs/process/README.md`](docs/process/README.md)（总纲 + 续跑锚点）。**流程分级 · 状态续跑 · Gate 必停与摘要格式 · 产物属主 · subagent 复用 · journal · git 纪律 · 命令集一律以该文件为准。**
- **项目适配**：[`docs/process/PROJECT.md`](docs/process/PROJECT.md)（端与目录 / 命令槽 / 产物属主表 / 脚本配置 / 凭据 / 通知）。**一切项目专属信息只从那里读。**
- **调度手册**：[`docs/process/orchestrator.md`](docs/process/orchestrator.md)（与总纲冲突时以总纲为准）。
- **本文件不复述流程细则**——复述只会产生过期副本。

**常驻动作**：每轮唤醒先调 `process_status` 取状态机快照与下一步动作（不靠聊天历史）；对人的输出用两段式（✅ 完成了什么 / ❓ 还需要裁定什么）；journal 只追加不覆写（用 `process_journal`）。

**角色**：由 `dsh-process-kit` 插件自带同名技能提供——`product-manager` · `ui-designer` · `test-agent` · `dev-agent` · `uat-agent` · `code-review-agent` · `security-review-agent` · `logic-review-agent`。派单时让 subagent 读对应技能，不要在本文件里复述角色职责。

---

## 项目概览

一个最小可用的电商 app：**后端 API + Web 前端两端**，由 `server/` 在同一端口（默认 3000）同时提供 JSON 接口与静态前端。五个功能面 —— 商品列表 / 商品详情 / 购物车 / 下单（假支付，下单即已支付）/ 订单列表。**数据落库（`node:sqlite`）、重启不丢；已引入最小账号（会话 cookie `sid`，下单与订单面需登录）**。

## 快速命令

```bash
npm install       # 只装开发依赖（jsdom，供前端结构断言使用；运行时零依赖）
npm start         # 起服务（node server/src/index.mjs），默认 http://127.0.0.1:3000
npm test          # 快速验证：node --test 'test/**/*.test.mjs'（勿写 node --test test/，Node 24 下不跑用例）
```

流程门禁（CI 可直接跑，判据即退出码）：

```bash
node scripts/process/check-artifact-paths.mjs   # 产物落点
node scripts/process/check-rules.mjs            # 台账 ↔ 测试 ↔ PRD 三层自洽
```

## 目录结构

```
server/            后端 API 与静态托管（index.mjs 起服务；app.mjs 导出可注入的 createApp 工厂）
web/               前端：原生 HTML + CSS + ES Module，无构建步骤
test/              测试（test/packages/<需求包 ID>/ 放需求专属用例，其余为常驻测试）
e2e/               端到端 / 黑盒脚本
docs/process/      流程骨架：总纲 README.md · 项目适配 PROJECT.md · 调度手册 orchestrator.md
scripts/process/   流程门禁脚本（零依赖 Node ESM，判据即退出码）
reports/           过程产物与归档（按项目忽略规则不入库）
```

## 规范要点

- **运行时零依赖**：后端只用 `node:http` 等内置模块；前端不引入框架、不加构建步骤。新增依赖须先回流 PRD 裁定。
- **金额一律用整数分**存储与传输，展示层才换算成元；禁止浮点累加。
- **接口前缀 `/api/v1`**；错误响应体固定为 `{ code, message }`（`code` 取自封闭词表），不返回堆栈与内部结构。
- **有鉴权，但越权一律 `404`**：购物车以服务端下发的匿名 `cartId` cookie 归属；受保护面（下单 / 订单 / `auth/me`）需登录，**他人资源返回 `404 NOT_FOUND`（不暴露存在性）**。**结论仍是不存在 `403` 面**（理由已由「无鉴权」变为「有鉴权但越权按 404 处置」）。
- **测试不得依赖夹具主键**：需要定位商品时按名称查（种子商品只读且顺序固定）。

---

<!-- 以下按需保留：技术栈规范、API 规范、数据库规范、前端规范、测试方式、部署与发布等。
     原则同上：只留「必须时刻遵守」的规范与高频入口，细则放 docs/ 并在此留链接。 -->
