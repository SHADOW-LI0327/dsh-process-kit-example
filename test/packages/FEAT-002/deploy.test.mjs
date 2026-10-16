/**
 * 部署面：备份与保留 / 容器化 / 编排 / 部署文档 / CI 三项 / 反代终结 TLS。
 *
 * 判据落点纪律（PRD §4.4 与总纲 §6.4 第 34 条②）：交付物「存在」不单独承载结论 ——
 * 静态件必带结构判据，能真跑的命令一律跑真命令并读真退出码（`spawnSync.status`，不过管道）。
 * 真容器编排（`up -d` / `down`+`up` 数据留存 / 反代转发）需 Docker 常驻态与端口占用，
 * 归**真机层 UAT** 与主控复跑，本文件不假绿。
 *
 * @prd FEAT-002
 * @prdVersion 3
 * @priority P1
 * @status active
 * @case TC-FEAT-002-32
 * @case TC-FEAT-002-33
 * @case TC-FEAT-002-34
 * @case TC-FEAT-002-35
 * @case TC-FEAT-002-36
 * @case TC-FEAT-002-37
 * @case TC-FEAT-002-E06
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, globSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  addItem,
  dbRows,
  newClient,
  openDb,
  payload,
  productAt,
  registerOrFail,
  repoFileExists,
  repoText,
  uniqueEmail,
  withApp,
  withTempDb,
} from './helpers/harness.mjs';

const PW = 'Pw-FEAT002-abcdefgh';
const DAY = 24 * 60 * 60 * 1000;
const CONTRACT_VARS = [
  'HOST',
  'PORT',
  'DB_PATH',
  'SESSION_SECRET',
  'COOKIE_SECURE',
  'TRUST_PROXY',
  'LOG_LEVEL',
  'BODY_LIMIT_BYTES',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX',
  'BACKUP_DIR',
  'BACKUP_RETENTION_DAYS',
  'NODE_ENV',
];

const run = (cmd, args, options = {}) =>
  spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? '/tmp/dockercfg', ...(options.env ?? {}) },
    timeout: options.timeoutMs ?? 120000,
  });

/** 跑一次备份入口脚本（单次备份 = 一条命令）。 */
function runBackup(env) {
  return run(process.execPath, ['scripts/ops/backup.mjs'], { env });
}

/** 造一份「N 天前」的备份：文件名带日期**且** mtime 也设为 N 天前（两种实现口径都覆盖）。 */
function fabricateBackup(dir, sourceDb, daysAgo, tag, offsetMs = 0) {
  const when = new Date(Date.now() - daysAgo * DAY + offsetMs);
  const stamp = when.toISOString().slice(0, 10);
  const name = `shop-${stamp}-${tag}.db`;
  const full = join(dir, name);
  copyFileSync(sourceDb, full);
  utimesSync(full, when, when);
  return { name, full, mtime: when };
}

/**
 * 取 compose 里**生效的** profile 定义（服务级 `profiles:` 键的流式 / 块式取值）。
 *
 * 「生效」是关键字：整行注释（`# profiles: ["proxy"]`）**不算**定义 —— 被注释掉的服务其 profile 根本不存在。
 * 反之 `profiles: ["proxy"]` 本身就是 compose 的「默认不启动、`--profile proxy` 才起」机制。
 * 依据：UAT `P-19`（文档承诺 `--profile proxy` 起 HTTPS，实际反代被整段注释 ⇒ `docker compose config --profiles`
 * 为空、`up -d` 静默 `exit 0` 且无 443）+ 主控裁定（`d23d6ff1`）；契约 §五 `AC-37` 的意图是真转发 `https://localhost/health`。
 */
function composeProfiles(lines) {
  const out = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^\s*#/.test(raw)) continue;
    const m = /^\s*profiles\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const inline = m[1].replace(/\s+#.*$/, '').trim();
    if (inline.startsWith('[')) {
      for (const part of inline.replace(/^\[/, '').replace(/\]$/, '').split(',')) {
        const value = part.trim().replace(/^["']|["']$/g, '');
        if (value) out.add(value);
      }
    } else if (inline === '' || inline === 'null') {
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = lines[j].replace(/\s+#.*$/, '');
        const b = /^\s*-\s*([A-Za-z0-9_.-]+)\s*$/.exec(item);
        if (!b) break;
        out.add(b[1]);
      }
    } else {
      const value = inline.replace(/^["']|["']$/g, '');
      if (value) out.add(value);
    }
  }
  return out;
}

/** 把 compose 文本切成服务块（只认**未被注释**的服务定义；块内含各自原始行）。 */
function composeServices(text) {
  const services = new Map();
  let inServices = false;
  let current = null;
  for (const raw of text.split('\n')) {
    if (/^\s*#/.test(raw)) {
      if (current) current.lines.push(raw);
      continue;
    }
    if (/^services\s*:\s*$/.test(raw)) {
      inServices = true;
      continue;
    }
    if (inServices && /^[A-Za-z]/.test(raw)) break; // 顶层键（volumes: 等）⇒ services 块结束
    const svc = /^  ([A-Za-z0-9_.-]+)\s*:\s*$/.exec(raw);
    if (inServices && svc) {
      current = { name: svc[1], lines: [] };
      services.set(svc[1], current);
      continue;
    }
    if (current) current.lines.push(raw);
  }
  return services;
}

const COMPOSE_FILE = 'deploy/docker-compose.yml';
// UAT `E7` 的反例与动态判据一律在**独立项目名**下跑：compose 顶层 `name: shop` 会被
// `COMPOSE_PROJECT_NAME` 覆盖（实测卷名 `feat002t_shop-data`）⇒ 文档里那条命令可以**逐字**执行，
// 而卷与容器全落在本项目里，绝不与 UAT 正在跑的 `shop` 栈抢卷或抢 3000/80/443。
const E7_PROJECT = 'feat002t';
/**
 * 测试用环境：`E7_PROJECT` 隔离项目名 + **测试专用 `SESSION_SECRET`**。
 *
 * 为什么必须注入：dev 按 SEC-05 去掉了 compose 里那个「能用的默认密钥」⇒ 生产档**缺密钥即拒起**（fail-closed 生效，
 * 实测 `compose run app` rc=1 并逐字点名 `SESSION_SECRET`）。这是**产品正确行为**，不是缺陷 ⇒ 装置必须自己给密钥。
 * ⚠ 该值**只用于测试**（≥32 字符以满足生产档校验），不是任何环境的真实凭据，也不写入任何入库文件。
 */
const E7_ENV = {
  COMPOSE_PROJECT_NAME: E7_PROJECT,
  SESSION_SECRET: 'feat002-deploy-verify-only-secret-0123456789abcdef',
};

/** 在独立项目名下调 compose（`-f` 指向交付物本身，不做任何改写）。 */
function compose(args, options = {}) {
  return run('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    env: { ...E7_ENV, ...(options.env ?? {}) },
    timeoutMs: options.timeoutMs ?? 120000,
  });
}

/** 在「应用自己的卷」里执行一段 shell（`run --rm --no-deps --entrypoint sh app`）。 */
function composeRunApp(script, options = {}) {
  return compose(['run', '--rm', '--no-deps', '--entrypoint', 'sh', 'app', '-c', script], options);
}

/** 当前 docker 卷名集合（排序后的数组）—— 用来断言「不得凭空多出垃圾卷」。 */
function volumeNames() {
  const res = run('docker', ['volume', 'ls', '--format', '{{.Name}}']);
  assert.equal(res.status, 0, `docker volume ls 必须退出 0，实际 ${res.status}：${res.stderr}`);
  return res.stdout.split('\n').filter(Boolean).sort();
}

/**
 * 抽出 `docs/DEPLOY.md`「回滚」一节里的 bash 代码块（含 `SNAP=` 赋值），用于**逐字执行**。
 * 判据要测的是「文档里那条命令照敲的效果」，所以这里只做抽取、不做任何改写 ——
 * 文档若回退成旧写法（手写宿主卷名），下面的效果断言必须随之变红。
 */
function rollbackBashBlock(docText) {
  const section = docText.split('## 回滚')[1];
  assert.ok(section, 'docs/DEPLOY.md 必须有「回滚」一节');
  const block = /```bash\n([\s\S]*?)```/.exec(section);
  assert.ok(block, '「回滚」一节必须给出可执行的 bash 代码块（UAT E7 的落点就在这条命令上）');
  return block[1].trim();
}

/** 同步小睡：判据是顺序执行的，不需要 async 轮询。 */
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** 在容器里跑一段 ESM：脚本走 base64（`+/=` 全为 shell 安全字符），避开多层嵌套转义把判据写歪。 */
function nodeInContainer(js) {
  const b64 = Buffer.from(js, 'utf8').toString('base64');
  return `printf %s ${b64} | base64 -d > /tmp/verify-scratch.mjs && node /tmp/verify-scratch.mjs`;
}

/** 起一个**常驻** app 容器：`compose run -d` 不带 `--service-ports` ⇒ 不发布宿主端口，绝不占 3000/80/443。 */
function startAppContainer(name) {
  const res = compose(['run', '-d', '--no-deps', '--name', name, 'app']);
  assert.equal(res.status, 0, `起常驻 app 容器必须成功，实际 ${res.status}：${res.stdout}${res.stderr}`);
  return name;
}

/** 等卷内库文件出现（app 启动即建库并播种）。 */
function waitForDb() {
  for (let i = 0; i < 40; i += 1) {
    if (composeRunApp('test -f /data/shop.db').status === 0) return true;
    sleepMs(300);
  }
  return false;
}

/** 在常驻容器里执行一段脚本（`docker exec`，不经宿主 shell）。 */
function execIn(name, script) {
  return run('docker', ['exec', name, 'sh', '-c', script]);
}

/** 卷内 `/data` 的文件名清单 —— 只 `ls`，**不打开数据库**（打开会触发 WAL checkpoint，污染 E9 判据）。 */
function volumeFiles() {
  const res = composeRunApp('ls -1 /data');
  assert.equal(res.status, 0, `ls /data 必须退出 0，实际 ${res.status}：${res.stderr}`);
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+$/.test(l));
}

/** 快照目录清单（文件名 + 内容指纹）：在容器里算 sha256，**不打开数据库**。 */
function listSnapshots(container) {
  const res = execIn(
    container,
    'cd /data/backups 2>/dev/null || exit 0; for f in *.db; do [ -e "$f" ] || continue; '
      + 'printf "%s %s\\n" "$(sha256sum "$f" | cut -c1-64)" "$f"; done',
  );
  assert.equal(res.status, 0, `列快照必须退出 0，实际 ${res.status}：${res.stderr}`);
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f]{64} /.test(l))
    .map((l) => ({ sha: l.slice(0, 64), name: l.slice(65) }));
}

/** E9 哨兵：写进**应用真正在用**的那个库（WAL 模式）；读回同样只经过 SQLite 引擎（回放发生在引擎里）。 */
const sentinelWrite = (v) => `
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/data/shop.db");
db.exec("PRAGMA journal_mode=WAL");
db.exec("CREATE TABLE IF NOT EXISTS e9_sentinel(k TEXT PRIMARY KEY, v TEXT)");
db.prepare("INSERT INTO e9_sentinel(k,v) VALUES('s',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(${JSON.stringify(v)});
db.close();
`;
const SENTINEL_READ = `
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/data/shop.db");
const row = db.prepare("SELECT v FROM e9_sentinel WHERE k='s'").get();
process.stdout.write("SENTINEL=" + (row ? row.v : "MISSING") + "\\n");
db.close();
`;
const HEALTH_PROBE = `
const res = await fetch("http://127.0.0.1:3000/health");
process.stdout.write("HEALTH=" + res.status + "\\n");
process.exit(res.ok ? 0 : 1);
`;

test('备份保留十四天（AC-32）', async () => {
  assert.ok(repoFileExists('scripts/ops/backup.mjs'), '交付物缺失：scripts/ops/backup.mjs（备份单次入口）');
  await withTempDb(async ({ dbPath, path }) => {
    const backupDir = path('backups');
    mkdirSync(backupDir, { recursive: true });
    const email = uniqueEmail('ac32');
    let orderNo;
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const target = await productAt(client, 0);
      await registerOrFail(client, email, PW);
      assert.equal((await addItem(client, target.id, 1)).status, 201, '前置：购物车需含 1 件');
      orderNo = payload(await client.post('/api/v1/orders')).orderNo;
    });

    // ① 一次备份 → 目录出现新快照，且快照可独立打开并读到那条订单
    const first = runBackup({ DB_PATH: dbPath, BACKUP_DIR: backupDir, BACKUP_RETENTION_DAYS: '14' });
    assert.equal(first.status, 0, `备份入口必须退出 0，实际 ${first.status}；输出：${first.stdout}${first.stderr}`);
    const afterFirst = readdirSync(backupDir).filter((f) => f.endsWith('.db'));
    assert.equal(afterFirst.length, 1, `备份目录必须出现一个新的库快照，实际 ${JSON.stringify(afterFirst)}`);
    const snapshot = join(backupDir, afterFirst[0]);
    {
      const db = openDb(snapshot);
      try {
        const rows = dbRows(db, 'orders');
        assert.equal(rows.length, 1, '快照必须可被独立打开并读到那条订单');
        assert.equal(rows[0].no, orderNo, '快照里的订单号必须与下单单号一致');
      } finally {
        db.close();
      }
    }

    // ② 保留窗口：15 天前删、14 天前留、最新在
    // 端点留 1 分钟余量：15 天 + 1 分钟（必删）与 14 天 − 1 分钟（必留），
    // 避免「恰好 14 天」被运行时毫秒漂移推过阈值造成假红；文件名日期仍分别是 15 / 14 天前。
    const old = fabricateBackup(backupDir, dbPath, 15, 'old', -60 * 1000);
    const edge = fabricateBackup(backupDir, dbPath, 14, 'edge', 60 * 1000);
    const second = runBackup({ DB_PATH: dbPath, BACKUP_DIR: backupDir, BACKUP_RETENTION_DAYS: '14' });
    assert.equal(second.status, 0, `清理档备份必须退出 0，实际 ${second.status}；输出：${second.stdout}${second.stderr}`);
    const names = readdirSync(backupDir).filter((f) => f.endsWith('.db'));
    assert.equal(names.includes(old.name), false, `15 天前的备份必须被删除，实际仍在：${JSON.stringify(names)}`);
    assert.equal(names.includes(edge.name), true, `14 天前的备份必须保留（窗口含端点），实际：${JSON.stringify(names)}`);
    assert.ok(names.includes(afterFirst[0]), '最新备份必须存在');

    // ③ 恢复：用最新快照起一个实例，按订单号必须能查到
    const restored = path('restored.db');
    copyFileSync(snapshot, restored);
    await withApp({ dbPath: restored }, async (app) => {
      const client = newClient(app);
      assert.equal((await client.post('/api/v1/auth/login', { email, password: PW })).status, 200, '恢复实例必须能登录');
      const orders = payload(await client.get('/api/v1/orders'));
      assert.equal(orders.length, 1, '恢复实例必须能查到那条订单');
      assert.equal(orders[0].orderNo, orderNo, '恢复实例查到的必须是同一单号');
    });
  });

  // ④ （UAT `E7` 后补）容器卷回滚：**真执行文档里那条命令**并断言效果 —— 不读它的字面。
  //    旧缺陷形态：文档手写宿主卷名 `shop-data`（真名是 `shop_shop-data`）⇒ 命令把快照拷进**新建的空卷**，
  //    仍 `exit 0`、应用仍 healthy、`/health` 仍 `200`，但应用读的那个库**一个字节没变**（静默空操作）＋多出垃圾卷。
  //    故判据＝「文档承诺的起法必须真的生效」：哨兵写进快照 → 照抄执行 → 应用侧必须读到哨兵、卷集合必须逐字不变。
  const docText = repoText('docs/DEPLOY.md');
  const rollback = rollbackBashBlock(docText);
  const snap = (/^\s*SNAP=([^\s#]+)/m.exec(rollback) ?? [])[1];
  assert.ok(snap, `「回滚」脚本必须给出 SNAP=<快照名> 才能照抄执行，实际脚本：${rollback}`);
  const appService = composeServices(repoText(COMPOSE_FILE)).get('app');
  const appImage = appService && /^\s*image:\s*(\S+)\s*$/m.exec(appService.lines.join('\n'))?.[1];
  assert.ok(appImage, 'compose 的 app 服务必须声明 image（动态判据要用它起回滚容器）');
  if (run('docker', ['image', 'inspect', appImage]).status !== 0) {
    const built = compose(['build', 'app'], { timeoutMs: 600000 });
    assert.equal(
      built.status,
      0,
      `缺 ${appImage} 镜像，且按文档升级第 1 步构建也失败（属**基建假红**，须与真缺口红分列）：`
        + `${built.status}：${String(built.stderr).slice(-300)}`,
    );
  }
  const MARK = 'E7-SENTINEL-CONTENT';
  try {
    compose(['down', '-v', '--remove-orphans']); // 前置：清掉本项目可能的历史残留（无残留时也应为 0）
    const seed = composeRunApp(
      `printf %s ${MARK} > /data/backups/${snap} && printf STALE-OLD-DB > /data/shop.db && sha256sum /data/shop.db`,
    );
    assert.equal(
      seed.status,
      0,
      `前置：必须能在应用自己的卷里放好哨兵快照与旧库，实际 ${seed.status}：${String(seed.stderr).slice(-300)}`,
    );
    const hashOf = (out) => (/^([0-9a-f]{64})\s/m.exec(out) ?? [])[1];
    const beforeHash = hashOf(seed.stdout);
    assert.ok(beforeHash, `前置：必须能在应用卷里读到旧库指纹，实际输出：${String(seed.stdout).slice(-200)}`);
    const volumesBefore = volumeNames();
    const ran = run('bash', ['-c', rollback], { env: E7_ENV });
    // rc=0 本身是一条真判据：文档命令是给人**照抄**的，非零退出码即缺陷。
    // 陷阱登记（2026-10-15 Gate4）：**别把多操作数 `ls` 放在 `&&` 链尾** —— `ls -l a b c` 只要有一个操作数
    // 不存在就**退出 1**，`2>/dev/null` 只吞报错文字、不改退出码；快照覆盖后 `-wal`/`-shm` 本就不存在
    // ⇒ 链主体（rm + cp）其实做成了、退出码却非 0。这是**假失败**（与 P-19/E7/E9 的静默假成功相反，
    // 但同属「退出码与语义不一致」的陷阱面）。文档历史红报文「文档「回滚」命令必须退出 0，实际 1」
    // 的真凶即此（**不是** `chown`：实测容器内以 node 身份 `chown node:node` 自己拥有的文件 rc=0）；
    // 现版链尾已收成单文件 `ls -l /data/shop.db` ⇒ rc=0。此处**不加新判据**，只留这条备注。
    assert.equal(ran.status, 0, `文档「回滚」命令必须退出 0，实际 ${ran.status}：${ran.stdout}${ran.stderr}`);
    // 只比对**指纹**而不是整段 stdout：`docker compose run` 会往 stdout 打容器生命周期行（含随机容器 id），
    // 整段比对会被那点噪声救成假绿 —— 正是「看着在断、其实抓不住」的写法，已避开。
    const view = composeRunApp('sha256sum /data/shop.db && cat /data/shop.db');
    assert.equal(view.status, 0, `善后读库必须退出 0，实际 ${view.status}：${String(view.stderr).slice(-300)}`);
    const afterHash = hashOf(view.stdout);
    assert.ok(afterHash, `善后必须能读到库指纹，实际输出：${String(view.stdout).slice(-200)}`);
    assert.notEqual(afterHash, beforeHash, '回滚命令必须真的改动**应用读到的那个库**（静默空操作即红）');
    assert.match(view.stdout, new RegExp(MARK), '应用侧读到的必须就是快照里的哨兵（证明写进了应用真正在用的卷）');
    assert.deepStrictEqual(volumeNames(), volumesBefore, '回滚不得凭空多出垃圾卷（docker 卷集合必须逐字不变）');
  } finally {
    compose(['down', '-v', '--remove-orphans']);
  }

  // ⑤ （UAT `E9` 后补）**崩溃路径**回滚：非干净停机留下的 `-wal` 会把回滚**原地撤销**。
  //    为什么必须真 `kill`：干净 `down` 会 checkpoint，`-wal` 根本不存在 —— 只走干净路径的断言（本用例 ④ 段）
  //    **永远抓不到**这一条。E9 的证据形态：命令 rc=0、库文件指纹与快照逐位相同、`/health` 200，
  //    **但快照之后的写入被 WAL 回放复活**（UAT `ops/e7d-*.out`：回滚后订单仍是 2 单）。
  const E9_C = 'feat002t-e9';
  try {
    compose(['down', '-v', '--remove-orphans']);
    startAppContainer(E9_C);
    assert.ok(waitForDb(), '装置前提：常驻 app 容器必须建出 /data/shop.db');
    assert.equal(execIn(E9_C, nodeInContainer(sentinelWrite('A'))).status, 0, '前置：哨兵 A 必须写入成功');
    const snapRes = execIn(E9_C, 'node /app/scripts/ops/backup.mjs');
    assert.equal(
      snapRes.status,
      0,
      `前置：快照必须成功（文档第 2 步依赖它），实际 ${snapRes.status}：${snapRes.stdout}${snapRes.stderr}`,
    );
    const snapReal = (listSnapshots(E9_C)[0] ?? {}).name;
    assert.ok(snapReal, '装置前提：快照目录里必须有一份 .db 快照');
    // 日期无关：把真实快照名对齐成文档示例里的 SNAP 名（同一份内容两个名字），文档命令仍**逐字**执行
    const snapInDoc = (/^\s*SNAP=([^\s#]+)/m.exec(rollback) ?? [])[1];
    if (snapReal !== snapInDoc) {
      assert.equal(
        execIn(E9_C, `cp -p /data/backups/${snapReal} /data/backups/${snapInDoc}`).status,
        0,
        '前置：文档示例快照名必须就位（同一份内容的别名）',
      );
    }
    assert.equal(
      execIn(E9_C, nodeInContainer(sentinelWrite('B'))).status,
      0,
      '前置：哨兵 B（快照之后的事务，只落在 WAL 里）必须写入成功',
    );
    assert.equal(run('docker', ['kill', E9_C]).status, 0, 'docker kill（SIGKILL）必须成功 —— 这是制造残留 WAL 的唯一手段');
    assert.equal(compose(['down']).status, 0, 'down 必须成功（**不带 -v**：卷要留给回滚用）');
    const crashed = volumeFiles();
    assert.ok(
      crashed.includes('shop.db-wal'),
      `装置前提未成立：kill 后卷内必须残留 shop.db-wal，否则本用例无对象、不得静默放行；实际 ${JSON.stringify(crashed)}`,
    );
    const ranCrash = run('bash', ['-c', rollback], { env: E7_ENV });
    assert.equal(
      ranCrash.status,
      0,
      `文档「回滚」命令必须退出 0（E9 的可怕之处正是 rc=0），实际 ${ranCrash.status}：${ranCrash.stdout}${ranCrash.stderr}`,
    );
    // 残留判据用**读库之前**的清单：下面读哨兵会打开数据库，SQLite 可能顺手 checkpoint 掉残留 WAL，
    // 若把它放在读之后，C2 就会被自己的取证动作救成假绿（「看着在断、其实抓不住」）。
    const afterFiles = volumeFiles();
    const read = composeRunApp(nodeInContainer(SENTINEL_READ));
    assert.equal(read.status, 0, `善后读库必须退出 0，实际 ${read.status}：${String(read.stderr).slice(-300)}`);
    const seen = (/SENTINEL=(\S+)/.exec(read.stdout) ?? [])[1];
    assert.ok(seen, `必须能读到哨兵值，实际输出：${String(read.stdout).slice(-200)}`);
    assert.equal(
      seen,
      'A',
      `C1：回滚后读到的必须是快照时刻的 A —— 读到 ${seen} 说明 WAL 被回放、回滚被自己撤销（UAT E9）`,
    );
    assert.equal(
      afterFiles.some((f) => f === 'shop.db-wal' || f === 'shop.db-shm'),
      false,
      `C2：执行后卷内不得再留 -wal/-shm（残留即回滚可被撤销），以读库前的清单为准，实际 ${JSON.stringify(afterFiles)}`,
    );
    // 文档第 3 步的「起服」也要真的能起：容器内自测 /health（不发布宿主端口）
    const UP_C = `${E9_C}-up`;
    startAppContainer(UP_C);
    let healthy = false;
    for (let i = 0; i < 20 && !healthy; i += 1) {
      healthy = execIn(UP_C, nodeInContainer(HEALTH_PROBE)).status === 0;
      if (!healthy) sleepMs(500);
    }
    assert.ok(healthy, '起服后（文档第 3 步）应用必须能起来并通过 /health');
  } finally {
    compose(['down', '-v', '--remove-orphans']);
  }

  // C2 的静态半：命令文本必须**同时**含三种动作（清 -wal / 清 -shm / 覆盖主文件）。
  // 刻意放在动态块**之后**：效果断言要先拿到话语权 —— 少了清理行时应该红在「读到 B」上，
  // 而不是红在这条文本检查上（否则一个跑在效果之前的文本断言会把效果判据整个短路掉）。
  const cleanupSteps = [
    ['清主文件的 WAL 侧车（-wal）', /rm\s+-f[^\n]*\/data\/shop\.db-wal/],
    ['清 WAL 索引（-shm）', /rm\s+-f[^\n]*\/data\/shop\.db-shm/],
    ['覆盖主文件', /cp\s+-\S*\s*\/data\/backups\/\$SNAP\s+\/data\/shop\.db/],
  ];
  for (const [what, pattern] of cleanupSteps) {
    assert.match(rollback, pattern, `「回滚」第 2 步必须同时含「${what}」—— 少一样都可能让回滚被 WAL 撤销（UAT E9）`);
  }

  // ⑥ （UAT `E8` 后补）同日快照**同名覆盖**：文档承诺必须与机制一致 —— 它**不是**「换错快照的后悔药」。
  const E8_C = 'feat002t-e8';
  try {
    compose(['down', '-v', '--remove-orphans']);
    startAppContainer(E8_C);
    assert.ok(waitForDb(), '装置前提：常驻 app 容器必须建出 /data/shop.db');
    assert.equal(execIn(E8_C, nodeInContainer(sentinelWrite('v1'))).status, 0, '前置：写库 v1');
    assert.equal(execIn(E8_C, 'node /app/scripts/ops/backup.mjs').status, 0, '前置：同日第一次备份必须成功');
    const first = listSnapshots(E8_C);
    assert.equal(first.length, 1, `同日第一次备份后快照目录应只有 1 份，实际 ${JSON.stringify(first)}`);
    assert.equal(
      execIn(E8_C, nodeInContainer(sentinelWrite('v2'))).status,
      0,
      '前置：改写库 v2（让同日第二份快照的内容确实变）',
    );
    assert.equal(execIn(E8_C, 'node /app/scripts/ops/backup.mjs').status, 0, '同日第二次备份必须成功');
    const second = listSnapshots(E8_C);
    assert.equal(
      second.length,
      1,
      `同日再打快照必须覆盖同一份（文件名只精确到 UTC 日），实际 ${JSON.stringify(second)}`,
    );
    assert.equal(second[0].name, first[0].name, '同日两次快照必须是同一个文件名（覆盖，而不是新增）');
    assert.notEqual(second[0].sha, first[0].sha, '同日第二次快照必须覆盖出**新内容**，否则「覆盖」这条承诺无从验证');
  } finally {
    compose(['down', '-v', '--remove-orphans']);
  }
  // 文档口径（**限定在「回滚」一节内**，避免「数据在哪」节里另一份同类表述把它救成假绿）：
  // 快照名只精确到 UTC 日 ⇒ 同日再打是覆盖、**不是**后悔药；要留退路必须手工另存。
  const rollbackSection = docText.split('## 回滚')[1].split(/\n## /)[0];
  const utcAt = rollbackSection.search(/UTC\s*日/);
  assert.ok(utcAt >= 0, '「回滚」一节必须写明快照文件名只精确到 UTC 日（同日再打是覆盖、不是后悔药）');
  const utcWindow = rollbackSection.slice(utcAt, utcAt + 400);
  assert.match(utcWindow, /同日|同一天/, '「回滚」一节必须写明同日再打快照是**覆盖同一份**');
  assert.match(utcWindow, /覆盖/, '「回滚」一节必须写明同日快照会**覆盖**同一份');
  assert.match(utcWindow, /另存/, '「回滚」一节必须给出退路：重要变更前把快照**手工另存**成别的文件名');
});

test('容器化非root（AC-33）', async () => {
  const dockerfile = repoText('deploy/Dockerfile');
  assert.match(dockerfile, /^FROM\s+node:24-alpine/m, '基础镜像必须是 node:24-alpine');
  const userLines = dockerfile.split('\n').filter((l) => /^\s*USER\s+/i.test(l) && !/^\s*#/.test(l));
  assert.ok(userLines.length > 0, 'Dockerfile 必须显式 USER（非 root 运行）');
  const lastUser = userLines[userLines.length - 1].trim().split(/\s+/)[1];
  assert.equal(/^(root|0)$/i.test(lastUser), false, `最后一个 USER 不得是 root，实际 ${lastUser}`);
  assert.equal(/node/.test(lastUser), true, `容器内必须用 node 用户运行，实际 ${lastUser}`);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/health/, 'Dockerfile 必须有命中 GET /health 的 HEALTHCHECK');
  assert.match(
    dockerfile,
    /CMD|ENTRYPOINT/,
    'Dockerfile 必须有启动命令',
  );
  assert.match(dockerfile, /server\/src\/index\.mjs/, '启动命令必须跑 server/src/index.mjs');

  const ignore = repoText('.dockerignore');
  for (const excluded of ['docs/', 'reports/', 'test/', 'node_modules/', '.git/']) {
    assert.match(ignore, new RegExp(excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `.dockerignore 必须排除 ${excluded}`);
  }
  for (const line of dockerfile.split('\n')) {
    if (!/^\s*(COPY|ADD)\s+/i.test(line) || /^\s*#/.test(line)) continue;
    for (const forbidden of ['docs/', 'reports/', 'test/', '.git', 'node_modules']) {
      assert.equal(
        line.includes(forbidden),
        false,
        `构建上下文拷贝不得包含 ${forbidden}（只拷运行所需）：${line.trim()}`,
      );
    }
  }
  // 真容器检查（uid / 只读根 / healthy）归真机层，见本用例 note
});

test('单机编排一键起（AC-34）', async () => {
  const composePath = 'deploy/docker-compose.yml';
  const compose = repoText(composePath);
  const envExample = repoText('deploy/.env.example');
  assert.match(envExample, /SESSION_SECRET/, '.env.example 必须覆盖必填变量');

  const cfg = run('docker', ['compose', '-f', composePath, 'config'], { timeoutMs: 120000 });
  assert.equal(
    cfg.status,
    0,
    `docker compose config 必须退出 0，实际 ${cfg.status}；输出：${String(cfg.stdout).slice(-400)}${String(cfg.stderr).slice(-400)}`,
  );

  assert.match(compose, /^\s*volumes:/m, 'compose 必须声明具名卷（库目录不得写在容器层）');
  assert.match(compose, /read_only:\s*true/, 'compose 必须声明只读根文件系统');
  assert.match(compose, /tmpfs:/, 'compose 必须给临时目录挂 tmpfs');
  assert.match(compose, /healthcheck:/, 'compose 必须声明健康检查');
  assert.match(compose, /depends_on:/, 'compose 必须声明 depends_on 条件');
  // 反代：断「能力」不断「写法」—— ⭐ 跨件一致（最前，正是 P-19 形态）→ ① opt-in → ③ 证书落盘。
  const services = composeServices(compose);
  const proxy = [...services.values()].find(
    (s) => /proxy|caddy/i.test(s.name) || s.lines.some((l) => /^\s*image\s*:.*caddy/i.test(l)),
  );
  assert.ok(
    proxy,
    `compose 必须定义反代服务（服务名含 proxy/caddy 或 image 为 caddy），实际服务：${[...services.keys()].join(',')}`,
  );
  // ⭐ 跨件一致性：docs/DEPLOY.md 里凡出现 `--profile <名>`，compose 就必须定义同名 profile。
  // 这条本可在测试层就抓住 P-19 ——「凡文档承诺的起法必须真的存在」。
  const declared = composeProfiles(compose.split('\n'));
  const promised = [
    ...new Set([...repoText('docs/DEPLOY.md').matchAll(/--profile\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1])),
  ];
  assert.ok(promised.length > 0, '前置：docs/DEPLOY.md 必须给出至少一条 --profile 起法（否则本断言无对象）');
  for (const name of promised) {
    assert.ok(
      declared.has(name),
      `docs/DEPLOY.md 承诺的 --profile ${name} 必须在 compose 里有同名 profile 定义（文档承诺的起法必须真的存在）；`
        + `compose 实际定义：${[...declared].join(',') || '（空）'}`,
    );
  }
  const proxyProfiles = composeProfiles(proxy.lines);
  assert.ok(
    proxyProfiles.has('proxy'),
    `反代服务必须带**生效的** profiles 且含 proxy（语义即「默认不启动、--profile proxy 才起」）；`
      + `把整段服务注释掉会让该 profile 不存在、文档里的命令静默失效。实际 profiles：${[...proxyProfiles].join(',') || '（无）'}`,
  );
  assert.ok(
    proxy.lines.some((l) => /^\s*-\s*\S*Caddyfile:\/etc\/caddy\/Caddyfile/.test(l)),
    `反代服务必须挂载 deploy/Caddyfile 到 /etc/caddy/Caddyfile；实际挂载：${proxy.lines.filter((l) => /^\s*-/.test(l)).join(' | ')}`,
  );
  for (const vol of ['caddy-data', 'caddy-config']) {
    assert.ok(
      proxy.lines.some((l) => new RegExp(`^\\s*-\\s*${vol}:`).test(l)),
      `反代服务必须给 ${vol} 挂命名卷（证书与配置落盘，重建容器不重签）`,
    );
  }
  // 真 up -d / down+up 数据留存 / 宿主 200 归真机层，见本用例 note
});

test('部署文档齐备（AC-35）', async () => {
  const doc = repoText('docs/DEPLOY.md');
  const headings = doc.split('\n').filter((l) => /^#{1,6}\s+/.test(l));
  const need = [
    ['变量表', /变量|环境变量/],
    ['起法', /起法|启动|运行/],
    ['升级', /升级|更新/],
    ['回滚', /回滚|回退/],
    ['数据在哪', /数据|备份|卷/],
  ];
  for (const [label, pattern] of need) {
    assert.ok(
      headings.some((h) => pattern.test(h)),
      `docs/DEPLOY.md 必须有「${label}」一节，实际标题：${JSON.stringify(headings)}`,
    );
  }
  assert.match(doc, /14\s*天|十四天/, '部署文档必须写明备份保留 14 天');
  assert.match(doc, /TLS[\s\S]{0,80}(反代|代理)/, '部署文档必须写明「TLS 由反代终结」');
  assert.match(doc, /反代|证书/, '部署文档必须说明证书与续期不在应用内处理');

  // 变量表双向包含：文档 ⊆ 契约 且 契约 ⊆ 文档
  const sectionStart = doc.search(/^#{1,6}[^\n]*(变量|环境变量)[^\n]*$/m);
  let section = doc;
  if (sectionStart >= 0) {
    const rest = doc.slice(sectionStart);
    const next = rest.slice(1).search(/^#{1,6}\s+/m);
    section = next >= 0 ? rest.slice(0, next + 1) : rest;
  }
  const allow = new Set(['TLS', 'HTTP', 'HTTPS', 'API', 'JSON', 'SQL', 'UTC', 'CI', 'ID', 'URL', 'DOM', 'CSS', 'HTML', 'AC', 'PRD', 'DB', 'ENV', 'OS', 'CPU', 'RAM']);
  const documented = new Set(
    [...section.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((m) => m[1]).filter((v) => !allow.has(v)),
  );
  for (const variable of CONTRACT_VARS) {
    assert.ok(documented.has(variable), `部署文档变量表缺 ${variable}（集合并集方向：契约 ⊆ 文档）`);
  }
  const extras = [...documented].filter((v) => !CONTRACT_VARS.includes(v));
  assert.deepStrictEqual(extras, [], `部署文档变量表不得出现契约外变量（文档 ⊆ 契约），实际多出：${JSON.stringify(extras)}`);

  // .env.example：键集合 ⊆ 契约 + 覆盖必填 + 不含真实凭据
  const envText = repoText('deploy/.env.example');
  const envKeys = envText
    .split('\n')
    .map((l) => l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/))
    .filter(Boolean)
    .map((m) => m[1]);
  assert.ok(envKeys.length > 0, '.env.example 必须有变量定义行');
  for (const key of envKeys) {
    assert.ok(CONTRACT_VARS.includes(key), `.env.example 出现契约外变量 ${key}`);
  }
  for (const required of ['SESSION_SECRET']) {
    assert.ok(envKeys.includes(required), `.env.example 必须覆盖必填变量 ${required}`);
  }
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!/SECRET|PASSWORD|TOKEN|_KEY|CREDENTIAL/i.test(key)) continue;
    const v = value.trim();
    const looksPlaceholder = v === '' || /[<${]/.test(v) || /change|placeholder|openssl|gen|random|xxx|TODO/i.test(v);
    assert.ok(looksPlaceholder, `.env.example 的 ${key} 必须是占位或生成命令，不得填真实凭据：${v}`);
  }

  // ③ （UAT `E7` 同批）服务口径一致：文档说的服务名 / 服务数必须与 compose **已定义**的服务一致。
  //    注意默认 `config --services` **不含**档案门控的 `proxy`（只给 backup / app），
  //    故「已定义」要按**全部已声明档案启用**来取，否则会把正确的「3 个服务」错判成红。
  const declaredProfiles = [...composeProfiles(repoText(COMPOSE_FILE).split('\n'))];
  const svc = compose([...declaredProfiles.flatMap((p) => ['--profile', p]), 'config', '--services']);
  assert.equal(svc.status, 0, `docker compose config --services 必须退出 0，实际 ${svc.status}：${svc.stderr}`);
  const defined = svc.stdout.split('\n').filter(Boolean).sort();
  assert.ok(defined.length > 0, 'compose 必须定义至少一个服务');
  for (const name of defined) {
    const token = new RegExp(`(^|[\\s\`])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\`\\s（(]|$)`);
    assert.match(
      doc,
      token,
      `文档必须说明 compose 已定义的每个服务（缺「${name}」），已定义：${defined.join(' / ')}`,
    );
  }
  const stated = /一共\s*\*{0,2}(\d+)\s*个服务/.exec(doc);
  if (stated) {
    assert.equal(
      Number(stated[1]),
      defined.length,
      `文档自称「${stated[1]} 个服务」必须等于 compose 已定义的服务数 ${defined.length}（${defined.join(' / ')}）`,
    );
  }
  if (defined.length > 1) {
    assert.equal(
      /单服务/.test(doc),
      false,
      `compose 已定义 ${defined.length} 个服务时文档不得再称「单服务」（契约 §7.3 勘误 2 口径）`,
    );
  }
});

test('CI 三项必跑（AC-36）', async () => {
  const workflows = globSync('.github/workflows/*.{yml,yaml}', { cwd: REPO_ROOT });
  assert.ok(workflows.length > 0, '交付仓必须含 CI 配置（.github/workflows/**）');
  const text = workflows.map((rel) => repoText(rel)).join('\n');
  for (const command of ['npm test', 'node scripts/process/check-artifact-paths.mjs', 'node scripts/process/check-rules.mjs']) {
    assert.ok(text.includes(command), `CI 配置必须包含命令字面：${command}`);
  }
  assert.match(text, /push/, 'CI 触发条件必须包含 push');
  for (const cheat of ['--test-skip', 'continue-on-error: true', '|| true', 'if: false', '--exclude', '--ignore']) {
    assert.equal(text.includes(cheat), false, `CI 配置不得出现跳过 / 白名单 / 排除写法：${cheat}`);
  }

  // 本机等价复跑：可复跑的两条流程门禁读真退出码（npm test 全量复跑会自我递归，见 note）
  const gates = [
    ['check-artifact-paths', ['scripts/process/check-artifact-paths.mjs']],
    ['check-rules', ['scripts/process/check-rules.mjs']],
  ];
  for (const [label, args] of gates) {
    const result = run(process.execPath, args, { timeoutMs: 120000 });
    assert.equal(
      result.status,
      0,
      `${label} 本机复跑必须退出 0，实际 ${result.status}；输出：${String(result.stdout).slice(-300)}${String(result.stderr).slice(-300)}`,
    );
  }
});

test('反代终结TLS（AC-37）', async () => {
  const caddy = repoText('deploy/Caddyfile');
  assert.match(caddy, /reverse_proxy\s+app:3000/, 'Caddyfile 必须反代到 app:3000');
  assert.match(caddy, /localhost/, 'Caddyfile 必须以 localhost 为站点地址（自签证书）');
  assert.match(caddy, /tls\b/, 'Caddyfile 必须给出 TLS 配置（自签）');
  assert.match(caddy, /X-Forwarded|forwarded/i, 'Caddyfile 必须透传 X-Forwarded-*');

  // ① 应用只跑 HTTP：服务端源码不得出现 TLS 监听或证书读取
  const serverFiles = globSync('server/**/*.mjs', { cwd: REPO_ROOT });
  assert.ok(serverFiles.length > 0, '服务端源码必须存在');
  for (const rel of serverFiles) {
    const text = repoText(rel);
    for (const pattern of [/createSecureServer/, /https\.createServer/, /readFileSync\([^)]*\.(pem|key|crt)/, /\.pem\b/, /\.crt\b/]) {
      assert.equal(pattern.test(text), false, `${rel} 不得出现 TLS 监听 / 证书读取（应用只跑 HTTP）：${pattern}`);
    }
  }

  // ② 配置语法校验：真容器真退出码
  const validate = run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${join(REPO_ROOT, 'deploy/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      'caddy:alpine',
      'caddy',
      'validate',
      '--config',
      '/etc/caddy/Caddyfile',
    ],
    { timeoutMs: 180000 },
  );
  assert.equal(
    validate.status,
    0,
    `caddy validate 必须退出 0，实际 ${validate.status}（若为镜像拉取失败，属基建假红，须在报告分列）；输出：${String(validate.stdout).slice(-300)}${String(validate.stderr).slice(-300)}`,
  );
  // ③ 真转发 https://localhost/health 归真机层，见 note
});

test('备份失败可观测（E-06）', async () => {
  assert.ok(repoFileExists('scripts/ops/backup.mjs'), '交付物缺失：scripts/ops/backup.mjs（备份单次入口）');
  await withTempDb(async ({ dbPath, path }) => {
    const backupDir = path('backups');
    mkdirSync(backupDir, { recursive: true });
    // 既有备份（用于证明「不删除既有备份」）：先落一个真库文件再复制过去
    {
      const seedDb = openDb(dbPath);
      try {
        seedDb.exec('CREATE TABLE IF NOT EXISTS t (x INTEGER)');
      } finally {
        seedDb.close();
      }
    }
    copyFileSync(dbPath, join(backupDir, 'shop-existing.db'));
    const before = readdirSync(backupDir).sort();

    // 档 a：备份目标不可写
    const roDir = path('ro-backups');
    mkdirSync(roDir, { recursive: true });
    chmodSync(roDir, 0o500);
    let unrunnable;
    try {
      unrunnable = runBackup({ DB_PATH: dbPath, BACKUP_DIR: roDir, BACKUP_RETENTION_DAYS: '14' });
    } finally {
      chmodSync(roDir, 0o700);
    }
    assert.notEqual(unrunnable.status, 0, '备份目标不可写时必须非零退出');
    assert.match(
      `${unrunnable.stdout}${unrunnable.stderr}`,
      /"level"\s*:\s*"error"/,
      `备份失败必须记 error 级日志，实际：${unrunnable.stdout}${unrunnable.stderr}`,
    );

    // 档 b：备份过程抛错（库文件损坏）
    const broken = path('broken.db');
    writeFileSync(broken, 'this is not a sqlite database');
    const throwing = runBackup({ DB_PATH: broken, BACKUP_DIR: backupDir, BACKUP_RETENTION_DAYS: '14' });
    assert.notEqual(throwing.status, 0, '备份过程抛错时必须非零退出');
    assert.match(
      `${throwing.stdout}${throwing.stderr}`,
      /"level"\s*:\s*"error"/,
      `备份过程抛错必须记 error 级日志，实际：${throwing.stdout}${throwing.stderr}`,
    );
    const after = readdirSync(backupDir).sort();
    for (const name of before) {
      assert.ok(after.includes(name), `备份失败不得删除既有备份，${name} 已丢失（集合只增不减）`);
    }
  });
});
