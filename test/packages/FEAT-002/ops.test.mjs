/**
 * 运维面：监听配置与校验 / 健康检查 / 优雅停机 / 结构化日志 / 进程兜底 / 库不可写。
 *
 * 装置纪律：运维判据一律跑**真子进程**、读**真退出码**（不经管道）；端口探测与在途请求
 * 用真 socket 构造，不靠 sleep 抢时序；每例独立临时库与随机端口。
 *
 * @prd FEAT-002
 * @prdVersion 3
 * @priority P0
 * @status active
 * @case TC-FEAT-002-25
 * @case TC-FEAT-002-26
 * @case TC-FEAT-002-27
 * @case TC-FEAT-002-28
 * @case TC-FEAT-002-29
 * @case TC-FEAT-002-30
 * @case TC-FEAT-002-E04
 * @case TC-FEAT-002-E05
 * @case TC-FEAT-002-63
 * @case TC-FEAT-002-64
 * @case TC-FEAT-002-65
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  addItem,
  breakSchema,
  freePort,
  getCart,
  isPortFree,
  listeningPorts,
  listProducts,
  makeLogSink,
  newClient,
  nonLoopbackIPv4,
  openChunkedRequest,
  openDb,
  parseLogLines,
  payload,
  productAt,
  rawGet,
  registerOrFail,
  startServerProcess,
  statusOfRaw,
  uniqueEmail,
  waitForHttp,
  waitForTcp,
  withApp,
  withServerProcess,
  withTempDb,
} from './helpers/harness.mjs';

const PW = 'Pw-FEAT002-abcdefgh';
const SECRET = 'ops-session-secret-0123456789abcdef';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const envFor = (dbPath, port, extra = {}) => ({
  DB_PATH: dbPath,
  HOST: '127.0.0.1',
  PORT: String(port),
  SESSION_SECRET: SECRET,
  ...extra,
});

async function exitWithin(proc, ms) {
  return Promise.race([proc.exited, wait(ms).then(() => null)]);
}

async function waitForPorts(pid, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ports = listeningPorts(pid);
    if (ports && ports.length > 0) return ports;
    await wait(100);
  }
  return null;
}

/** 构造「SIGTERM 到达时有在途下单连接」的确定性场景，返回收尾证据。 */
async function inflightOrderShutdown({ dbPath, port, tag }) {
  const email = uniqueEmail(tag);
  return withServerProcess(envFor(dbPath, port), async (proc) => {
    assert.ok(await waitForTcp(port), '正向对照：服务必须先起来');
    const client = newClient({ port });
    const target = await productAt(client, 0);
    await registerOrFail(client, email, PW);
    assert.equal((await addItem(client, target.id, 1)).status, 201, '前置：匿名/账号车需含 1 件');

    const pending = await openChunkedRequest({
      port,
      method: 'POST',
      path: '/api/v1/orders',
      headers: { cookie: client.cookieHeader() },
    });
    await wait(200); // 让请求头确实到达服务端，连接挂在「体未发完」态
    proc.child.kill('SIGTERM');
    await wait(200); // 停机已开始，此时在途连接仍未完成
    pending.finish();
    const raw = await pending.waitForEnd(9000);
    const exit = await exitWithin(proc, 12000);
    const match = raw.match(/"orderNo"\s*:\s*"([^"]+)"/);
    return { exit, status: statusOfRaw(raw), orderNo: match ? match[1] : null, email };
  });
}

test('监听端口可配（AC-25）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    // ① 默认：只绑本机 + 端口 3000
    assert.equal(
      await isPortFree(3000),
      true,
      '装置冲突：常驻端口 3000 已被占用，无法验证默认端口 —— 请在 3000 空闲时复跑本用例',
    );
    await withServerProcess({ DB_PATH: dbPath, SESSION_SECRET: SECRET }, async (proc) => {
      assert.ok(await waitForTcp(3000, { timeoutMs: 8000 }), '不带 HOST/PORT 时必须监听默认 3000');
      const ports = listeningPorts(proc.pid);
      if (ports) assert.deepStrictEqual(ports, [3000], `默认形态只应监听 3000，实际 ${JSON.stringify(ports)}`);
      const res = await fetch('http://127.0.0.1:3000/health');
      assert.equal(res.status, 200, `默认形态下 /health 必须 200，实际 ${res.status}`);
      await proc.stop('SIGTERM', 4000);
    }, { clean: true });

    // ② HOST=0.0.0.0 + PORT=0（哨兵：系统分配）
    await withServerProcess(envFor(path('b.db'), 0, { HOST: '0.0.0.0', PORT: '0' }), async (proc) => {
      const ports = await waitForPorts(proc.pid);
      assert.ok(ports && ports.length > 0, 'PORT=0 时必须真的监听（系统分配的端口）');
      assert.equal(ports.includes(3000), false, 'PORT=0 不得落到常驻 3000');
      const assigned = ports.find((p) => p !== 3000);
      const ip = nonLoopbackIPv4();
      if (ip) {
        const res = await fetch(`http://${ip}:${assigned}/health`);
        assert.equal(res.status, 200, `必须能从非回环地址 ${ip}:${assigned} 访问 /health，实际 ${res.status}`);
      } else {
        // 无可用网卡时的兜底双判：监听地址字面值必须是通配
        const out = listeningPorts(proc.pid) && (await import('node:child_process')).execFileSync(
          'lsof',
          ['-p', String(proc.pid), '-a', '-iTCP', '-sTCP:LISTEN', '-P', '-n'],
          { encoding: 'utf8' },
        );
        assert.match(String(out), /\*:\d+/, '无可用网卡时，监听地址必须显示为通配（0.0.0.0）');
      }
      await proc.stop('SIGTERM', 4000);
    });

    // ③ 指定端口（内点）
    const fixed = await freePort();
    await withServerProcess(envFor(path('c.db'), fixed), async (proc) => {
      assert.ok(await waitForTcp(fixed, { timeoutMs: 8000 }), `PORT=${fixed} 时必须监听该端口`);
      const res = await fetch(`http://127.0.0.1:${fixed}/health`);
      assert.equal(res.status, 200, `PORT=${fixed} 形态下 /health 必须 200，实际 ${res.status}`);
      await proc.stop('SIGTERM', 4000);
    });
  });
});

test('配置校验拒启（AC-26）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    mkdirSync(path('ro'), { recursive: true });
    const groups = [
      ['PORT 非整数', { PORT: 'abc' }, 'PORT'],
      ['PORT 越上界', { PORT: '65536' }, 'PORT'],
      ['PORT 越下界', { PORT: '-1' }, 'PORT'],
      ['会话密钥过短', { SESSION_SECRET: 'short' }, 'SESSION_SECRET'],
      ['生产缺会话密钥', { SESSION_SECRET: undefined, NODE_ENV: 'production' }, 'SESSION_SECRET'],
      ['库目录不可写', { DB_PATH: join(path('ro'), 'shop.db') }, 'DB_PATH'],
      ['备份保留天数非整数', { BACKUP_RETENTION_DAYS: 'abc' }, 'BACKUP_RETENTION_DAYS'],
    ];
    for (const [label, override, variable] of groups) {
      const port = await freePort();
      const env = envFor(dbPath, port, override);
      if (override.SESSION_SECRET === undefined) delete env.SESSION_SECRET;
      // 「库目录不可写」档必须在 spawn **之前**才置 0500，并在 finally 复原（照同文件 E-04 的写法）。
      // 原写法把 0500 放在循环外、复原放在循环尾 ⇒ 轮到第 6 组时目录早已是 0700，服务正常起、白等 8 秒超时
      // —— 那是构造缺陷，不是被测行为。
      const readOnlyDir = variable === 'DB_PATH';
      if (readOnlyDir) chmodSync(path('ro'), 0o500);
      try {
        await withServerProcess(env, async (proc) => {
          const result = await exitWithin(proc, 8000);
          assert.ok(result !== null, `${label}：必须在启动期退出（不得带病进入服务态）`);
          assert.notEqual(result.code, 0, `${label}：退出码必须非 0，实际 ${JSON.stringify(result)}`);
          const log = `${proc.stdout}${proc.stderr}`;
          assert.match(log, new RegExp(variable), `${label}：日志必须点名 ${variable}，实际日志：${log.slice(-300)}`);
          assert.equal(await isPortFree(port), true, `${label}：不得留下监听端口`);
        });
      } finally {
        if (readOnlyDir) chmodSync(path('ro'), 0o700);
      }
    }
    // 正向对照：同一套 env（合法值）必须能起来，证明上面拒的是「非法配置」而不是环境
    const okPort = await freePort();
    await withServerProcess(envFor(dbPath, okPort), async (proc) => {
      assert.ok(await waitForTcp(okPort, { timeoutMs: 8000 }), '正向对照：合法配置必须能启动');
      await proc.stop('SIGTERM', 4000);
    });
  });
});

test('优雅停机与退出（AC-27）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    for (const [signal, label] of [
      ['SIGTERM', '无在途请求的 SIGTERM'],
      ['SIGINT', '无在途请求的 SIGINT'],
    ]) {
      const port = await freePort();
      await withServerProcess(envFor(path(`${signal}.db`), port), async (proc) => {
        assert.ok(await waitForTcp(port), `正向对照：${label} 前服务必须先起来`);
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(res.status, 200, `停机前 /health 必须 200，实际 ${res.status}`);
        const started = Date.now();
        const result = await proc.stop(signal, 11000);
        assert.equal(result.code, 0, `${label} 必须退出码 0，实际 ${JSON.stringify(result)}`);
        assert.ok(Date.now() - started < 11000, `${label} 停机耗时必须有限（< 10 秒窗口）`);
        const lines = parseLogLines(proc.stdout);
        assert.ok(
          lines.some((l) => /shutdown|stop|停机|SIGTERM|SIGINT/i.test(JSON.stringify(l))),
          `${label} 退出前必须记停机日志，实际 stdout：${proc.stdout.slice(-300)}`,
        );
      });
    }

    // ② 有在途下单：必须等它落库后才退出 0
    const port2 = await freePort();
    const inflight = await inflightOrderShutdown({ dbPath: path('inflight.db'), port: port2, tag: 'ac27' });
    assert.equal(inflight.exit.code, 0, `有在途请求时也必须退出码 0，实际 ${JSON.stringify(inflight.exit)}`);
    assert.equal(inflight.status === null || inflight.status === 201, true, `在途请求必须被正常处理（不得掐断），实际 ${inflight.status}`);
  });
});

test('健康检查端点（AC-28）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app); // 不带任何 cookie：健康检查不需要鉴权
      const res = await client.get('/health');
      assert.equal(res.status, 200, `/health 必须 200，实际 ${res.status}：${res.raw.slice(0, 200)}`);
      assert.ok(String(res.headers['content-type']).includes('application/json'), '必须是 JSON 响应');
      const health = payload(res);
      assert.equal(health.status, 'ok', `健康时 status 必须为 ok，实际 ${health.status}`);
      assert.equal(Number.isInteger(health.uptimeMs), true, 'uptimeMs 必须是整数');
      assert.equal(typeof health.version === 'string' && health.version.length > 0, true, 'version 必须是非空字符串');
      assert.equal(health.db && health.db.ok, true, '库正常时 db.ok 必须为 true');

      breakSchema(dbPath, 'schema_migrations');
      const bad = await client.get('/health');
      assert.equal(bad.status, 503, `库探针失败必须 503，实际 ${bad.status}：${bad.raw.slice(0, 200)}`);
      const badHealth = payload(bad);
      assert.notEqual(badHealth.status, 'ok', '不健康时 status 必须非 ok');
      assert.equal(badHealth.db.ok, false, '库不可读时 db.ok 必须为 false（证明探针真的在探库）');
      assert.equal('stack' in badHealth, false, '503 响应不得含堆栈');
    });
  });
});

test('结构化请求日志（AC-29）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    const sink = makeLogSink();
    await withApp({ dbPath, logStream: sink.stream }, async (app) => {
      const client = newClient(app);
      const ok = await client.get('/api/v1/products');
      assert.equal(ok.status, 200);
      const missing = await client.get('/api/v1/products/NOPE-NOT-EXIST');
      assert.equal(missing.status, 404);
      breakSchema(dbPath, 'products');
      const fault = await client.get('/api/v1/products');
      assert.equal(fault.status, 500, `内部故障必须 500，实际 ${fault.status}`);
      await wait(80);

      const lines = sink.lines();
      assert.ok(lines.length >= 3, `三次请求至少产生三行 JSON 日志，实际 ${lines.length}`);
      const levels = new Set(['debug', 'info', 'warn', 'error']);
      for (const line of lines.filter((l) => l.path !== undefined)) {
        assert.ok(levels.has(line.level), `level 必须是枚举值，实际 ${line.level}`);
        assert.ok(
          typeof line.time === 'string' || Number.isFinite(line.time),
          `time 必须是 ISO8601 字符串或 epoch 毫秒，实际 ${JSON.stringify(line.time)}`,
        );
        assert.equal(typeof line.requestId === 'string' && line.requestId.length > 0, true, 'requestId 必须是非空字符串');
        assert.equal(typeof line.method, 'string', 'method 必须是字符串');
        assert.equal(typeof line.path, 'string', 'path 必须是字符串');
        assert.equal(Number.isInteger(line.status), true, `status 必须是整数，实际 ${JSON.stringify(line.status)}`);
        assert.equal(typeof line.durationMs, 'number', `durationMs 必须是数字，实际 ${JSON.stringify(line.durationMs)}`);
      }
      const ids = lines.filter((l) => l.path !== undefined).map((l) => l.requestId);
      const okLine = lines.find((l) => l.path === '/api/v1/products' && l.status === 200);
      const missLine = lines.find((l) => String(l.path).startsWith('/api/v1/products/NOPE') && l.status === 404);
      const faultLine = lines.find((l) => l.path === '/api/v1/products' && l.status === 500);
      assert.ok(okLine && missLine && faultLine, `三次请求必须各有对应日志行，实际：${JSON.stringify(lines).slice(0, 600)}`);
      assert.equal(
        new Set([okLine.requestId, missLine.requestId, faultLine.requestId]).size,
        3,
        '三次请求的 requestId 必须两两不同',
      );
      assert.ok(ids.length >= 3);
    });

    // 慢请求档：把请求体持住 800ms（> 500ms 阈值）后再发完
    const slowSink = makeLogSink();
    await withApp({ dbPath: path('slow.db'), logStream: slowSink.stream }, async (app) => {
      await listProducts(newClient(app));
      const pending = await openChunkedRequest({ port: app.port, method: 'POST', path: '/api/v1/cart/items' });
      await wait(800);
      pending.finish();
      await pending.waitForEnd(8000);
      await wait(80);
      const line = slowSink.lines().find((l) => l.path === '/api/v1/cart/items');
      assert.ok(line, `慢请求必须留下日志行，实际：${slowSink.text().slice(0, 400)}`);
      assert.ok(line.durationMs >= 500, `持住 800ms 的请求 durationMs 必须 ≥ 500，实际 ${line.durationMs}`);
      assert.equal(line.slow, true, `超过 500ms 的请求必须带 slow: true，实际 ${JSON.stringify(line)}`);
    });
  });
});

test('进程兜底退出（AC-30）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    const cases = [
      ['uncaughtException', "import('./server/src/index.mjs'); setTimeout(() => { throw new Error('E30-UNCAUGHT') }, 500);"],
      ['unhandledRejection', "import('./server/src/index.mjs'); setTimeout(() => { Promise.reject(new Error('E30-REJECTED')) }, 500);"],
    ];
    for (const [label, script] of cases) {
      const port = await freePort();
      const db = path(`${label}.db`);
      const proc = startServerProcess(envFor(db, port), { args: ['--input-type=module', '-e', script] });
      try {
        assert.ok(await waitForTcp(port, { timeoutMs: 8000 }), `正向对照：${label} 前服务必须先起来`);
        const result = await exitWithin(proc, 10000);
        assert.ok(result !== null, `${label}：进程必须退出（不得静默存活）`);
        assert.notEqual(result.code, 0, `${label}：必须非零退出，实际 ${JSON.stringify(result)}`);
        const lines = parseLogLines(proc.stdout);
        const errorLine = lines.find((l) => l.level === 'error' && JSON.stringify(l).includes('E30-'));
        assert.ok(
          errorLine,
          `${label}：必须留下结构化 error 级日志（含错误消息），实际 stdout：${proc.stdout.slice(-300)} stderr：${proc.stderr.slice(-200)}`,
        );
        // 退出前关库：库上不得残留锁
        if (existsSync(db)) {
          const probe = openDb(db);
          try {
            probe.exec('CREATE TABLE IF NOT EXISTS __lock_probe (x INTEGER)');
            probe.exec('DROP TABLE __lock_probe');
          } finally {
            probe.close();
          }
        }
      } finally {
        await proc.stop('SIGKILL', 3000);
      }
    }
  });
});

test('库不可写（E-04）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    const ro = path('readonly');
    mkdirSync(ro, { recursive: true });
    chmodSync(ro, 0o500);
    try {
      const port = await freePort();
      await withServerProcess(envFor(join(ro, 'shop.db'), port), async (proc) => {
        const result = await exitWithin(proc, 8000);
        assert.ok(result !== null, 'DB_PATH 不可写时必须在启动期退出');
        assert.notEqual(result.code, 0, `必须非零退出，实际 ${JSON.stringify(result)}`);
        const log = `${proc.stdout}${proc.stderr}`;
        assert.match(log, /DB_PATH/, `日志必须点名 DB_PATH，实际：${log.slice(-300)}`);
        assert.equal(await isPortFree(port), true, '拒启后不得留下监听端口');
      });
    } finally {
      chmodSync(ro, 0o700);
    }
    // 正向对照：可写路径必须能起来
    const okPort = await freePort();
    await withServerProcess(envFor(dbPath, okPort), async (proc) => {
      assert.ok(await waitForTcp(okPort, { timeoutMs: 8000 }), '正向对照：可写路径必须能启动');
      await proc.stop('SIGTERM', 4000);
    });
  });
});

test('停机在有途（E-05）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    const db = path('e05.db');
    const port = await freePort();
    const inflight = await inflightOrderShutdown({ dbPath: db, port, tag: 'e05' });
    assert.equal(inflight.exit.code, 0, `有在途下单时必须退出码 0，实际 ${JSON.stringify(inflight.exit)}`);
    assert.equal(
      inflight.status === null || inflight.status === 201,
      true,
      `在途下单必须被正常处理（不得掐断连接），实际 ${inflight.status}`,
    );

    // 重启后该单必须可查到（在途请求确实完成并落库）
    const port2 = await freePort();
    await withServerProcess(envFor(db, port2), async (proc) => {
      assert.ok(await waitForTcp(port2, { timeoutMs: 8000 }), '重启必须成功');
      const client = newClient({ port: port2 });
      const login = await client.post('/api/v1/auth/login', { email: inflight.email, password: PW });
      assert.equal(login.status, 200, `重启后必须能用同一账号登录：${login.raw.slice(0, 200)}`);
      const orders = payload(await client.get('/api/v1/orders'));
      assert.equal(orders.length, 1, '在途下单必须在停机前落库（重启后能查到 1 单）');
      if (inflight.orderNo) assert.equal(orders[0].orderNo, inflight.orderNo, '重启后查到的必须是同一单');
      await proc.stop('SIGTERM', 4000);
    });
  });
});

test('会话密钥真被消费（AC-63）', async () => {
  // 判据（PRD `AC-63` / 契约 §7.1）：`SESSION_SECRET` 承诺的是**生效**而非「可配置」—— 库内只存会话 token 的派生 / 摘要值，
  // 校验值由该密钥派生 ⇒ **换密钥 + 同库重启，旧 cookie 必须 401**；开发形态（无密钥）不得崩、只打 warn。
  const SECRET_A = 'ac63-session-secret-AAAAAAAAAAAAAAAA';
  const SECRET_B = 'ac63-session-secret-BBBBBBBBBBBBBBBB';
  await withTempDb(async ({ dbPath }) => {
    const port = await freePort();
    const email = uniqueEmail('ac63');
    let cookie = '';
    // ① 密钥 A：注册 + 取到 sid，证明同密钥下会话有效
    await withServerProcess(
      envFor(dbPath, port, { SESSION_SECRET: SECRET_A }),
      async (proc) => {
        assert.ok(await waitForHttp(port), '服务必须先起来');
        const client = newClient({ port });
        await registerOrFail(client, email, PW);
        assert.equal((await client.get('/api/v1/auth/me')).status, 200, '前置：同密钥下 /api/v1/auth/me 必须 200');
        cookie = client.cookieHeader();
        assert.match(cookie, /sid=/, '前置：必须拿到 sid cookie');
        await proc.stop('SIGTERM', 4000);
      },
      { clean: true },
    );
    // ② 换密钥 B + 同库重启 ⇒ 旧 cookie 必须 401（否则「密钥只是摆设」）
    await withServerProcess(
      envFor(dbPath, port, { SESSION_SECRET: SECRET_B }),
      async (proc) => {
        assert.ok(await waitForHttp(port), '换密钥后服务必须仍能起来');
        const res = await rawGet(port, '/api/v1/auth/me', { headers: { cookie } });
        assert.equal(
          res.status,
          401,
          `换 SESSION_SECRET 后旧会话必须失效（401），实际 ${res.status}：${res.body.slice(0, 160)}`,
        );
      },
      { clean: true },
    );
    // ③ 判定性对照：换**回**密钥 A ⇒ 旧 cookie 必须重新有效 —— 否则「每次重启都清空会话」也能假绿
    await withServerProcess(
      envFor(dbPath, port, { SESSION_SECRET: SECRET_A }),
      async (proc) => {
        assert.ok(await waitForHttp(port), '换回原密钥后服务必须仍能起来');
        const res = await rawGet(port, '/api/v1/auth/me', { headers: { cookie } });
        assert.equal(
          res.status,
          200,
          `换回原密钥后旧会话必须重新有效（证明确实是 HMAC 派生密钥在生效，而不是「重启即失效」），实际 ${res.status}`,
        );
      },
      { clean: true },
    );
    // ④ 开发形态（无 SESSION_SECRET）不得崩，且必须打结构化 warn
    const devPort = await freePort();
    await withServerProcess(
      { DB_PATH: dbPath, HOST: '127.0.0.1', PORT: String(devPort), NODE_ENV: 'development' },
      async (proc) => {
        assert.ok(await waitForHttp(devPort), '无 SESSION_SECRET 的开发形态必须能起来（不得崩）');
        assert.equal((await rawGet(devPort, '/health')).status, 200, '无 SESSION_SECRET 时必须照常提供 /health');
        assert.match(
          `${proc.stdout}${proc.stderr}`,
          /session_secret_missing/,
          '无 SESSION_SECRET 必须打 warn（结构化日志 outcome=session_secret_missing）',
        );
      },
      { clean: true },
    );
  });
});

test('TRUST_PROXY 取真实来源 IP（AC-64）', async () => {
  // 判据（PRD `AC-64` / 契约 §7.1）：置 `1` ⇒ **必须真采信** `X-Forwarded-For` 的**首个（最左）** IP 作限流 IP 维度来源；
  // 置 `0`（默认）⇒ 一律按对端地址计数，**伪造转发头不得获得额外额度、也不得把限流甩给别的 IP**。
  // 量级：注入基准 `RATE_LIMIT_MAX = 2`（每 IP 档 = 4 × 基准 = 8，与 `AC-23` 同口径缩放，不改变语义）。
  const BASE = 2;
  const R_IP = 4 * BASE;
  const attempt = async (port, ip) => {
    const client = newClient({ port });
    await getCart(client); // 限流按会话计 ⇒ 先落会话，避免每会话额度先被吃掉
    const headers = ip ? { 'x-forwarded-for': ip } : {};
    return client.post('/api/v1/auth/login', { email: uniqueEmail('ac64'), password: PW }, { headers });
  };
  await withTempDb(async ({ dbPath, path }) => {
    // ① TRUST_PROXY=1：最左语义 + 其他来源不受牵连
    const port = await freePort();
    await withServerProcess(
      envFor(dbPath, port, { RATE_LIMIT_MAX: String(BASE), TRUST_PROXY: '1' }),
      async (proc) => {
        assert.ok(await waitForHttp(port), '服务必须先起来');
        const left = '203.0.113.9';
        const other = '203.0.113.10';
        const sharedRight = '198.51.100.1';
        for (let i = 0; i < R_IP; i += 1) {
          const res = await attempt(port, `${left}, ${sharedRight}`);
          assert.notEqual(res.status, 429, `采信档：最左 ${left} 前 R_ip=${R_IP} 次不得 429（第 ${i + 1} 次实际 ${res.status}）`);
        }
        const blocked = await attempt(port, `${left}, ${sharedRight}`);
        assert.equal(
          blocked.status,
          429,
          `采信档：最左 ${left} 额度用尽后（新会话、同最左 IP）必须 429，实际 ${blocked.status}`,
        );
        const sibling = await attempt(port, `${other}, ${sharedRight}`);
        assert.notEqual(
          sibling.status,
          429,
          `采信档**最左语义**：最左换成 ${other}（最右仍是 ${sharedRight}）必须仍放行 —— 若实现取最右 IP，这里会提前 429，实际 ${sibling.status}`,
        );
        const direct = await attempt(port, null);
        assert.notEqual(direct.status, 429, `采信档：不带 X-Forwarded-For 的对端地址不得被 ${left} 的额度牵连，实际 ${direct.status}`);
        await proc.stop('SIGTERM', 4000);
      },
      { clean: true },
    );

    // ② TRUST_PROXY=0（默认）：伪造转发头不得获得额外额度（换全新伪造 IP 也必须照样被拦）
    const port2 = await freePort();
    await withServerProcess(
      envFor(path('ac64-no-trust.db'), port2, { RATE_LIMIT_MAX: String(BASE), TRUST_PROXY: '0' }),
      async (proc) => {
        assert.ok(await waitForHttp(port2), '服务必须先起来');
        for (let i = 0; i < R_IP; i += 1) {
          const res = await attempt(port2, `10.9.9.${i + 1}`);
          assert.notEqual(
            res.status,
            429,
            `不采信档：前 R_ip=${R_IP} 次（每个伪造 IP 都不同）必须放行（第 ${i + 1} 次实际 ${res.status}）`,
          );
        }
        const forged = await attempt(port2, '10.9.9.200');
        assert.equal(
          forged.status,
          429,
          `不采信档：真实对端地址额度用尽后，**换一个全新伪造 IP** 也必须 429（伪造转发头不得换来额外额度），实际 ${forged.status}`,
        );
        await proc.stop('SIGTERM', 4000);
      },
      { clean: true },
    );
  });
});

test('开发档密钥跳过落盘（AC-63）', async (t) => {
  // 判据（契约 §7.1 同版收口，`AC` 编号不变 ⇒ 归属既有 `AC-63`）：`DB_PATH` 为 `:memory:`、或其父目录不可写时，
  //   开发档**跳过持久化** —— 退化为进程内随机密钥 + `warn`，不生成任何 sidecar 文件；**生产档不受此豁免**。
  // 三档形态（主控 2026-10-16 裁定 (b)）：档① `:memory:` **真跑**（该口径的唯一机器承载）；档② **显式 skip**（逻辑为空，理由见下）；
  //   档③ 生产档负向对照 **独立真跑**（不叠加不可写目录）—— 它防的是「把这条读成全局放宽」。
  const { REPO_ROOT } = await import('./helpers/harness.mjs');
  const { tmpdir } = await import('node:os');
  const { readdirSync } = await import('node:fs');
  /** 扫遍所有可能落点，收集 `*dev-session-secret`（`:memory:` 档不许因为在仓根找不到就判绿）。 */
  const scan = (dirs) =>
    dirs
      .filter(Boolean)
      .flatMap((dir) => {
        try {
          return readdirSync(dir)
            .filter((f) => f.endsWith('dev-session-secret'))
            .map((f) => join(dir, f));
        } catch {
          return [];
        }
      })
      .sort();
  /** ③ 日志：必须有 `warn`、必须点明密钥/sidecar 处置、**不得**出现密钥本身。 */
  const secretUnleaked = (log) => {
    assert.equal(/"level":"warn"/.test(log), true, `必须有 warn 级日志，实际：${log.slice(-300)}`);
    assert.equal(/secret/i.test(log), true, `warn 必须点明密钥/sidecar 的处置，实际：${log.slice(-300)}`);
    assert.equal(
      /SESSION_SECRET["']?\s*[:=]\s*["']?[A-Za-z0-9_\-+/]{16,}/.test(log),
      false,
      `日志**不得**出现密钥本身，实际：${log.slice(-300)}`,
    );
  };

  await withTempDb(async ({ path }) => {
    // ── 档① `DB_PATH=':memory:'`：**唯一机器承载**（真跑）
    const place = path('mem.db');
    mkdirSync(place, { recursive: true });
    const dirs = [place, REPO_ROOT, tmpdir()];
    const beforeMem = scan(dirs);
    const memPort = await freePort();
    const memEnv = envFor(place, memPort, { DB_PATH: ':memory:' });
    // ⚠ 必须 **删掉** `envFor` 默认注入的测试密钥，否则走不到「开发档生成随机密钥」分支（本档判的就是那个分支）⇒ 会假绿。
    delete memEnv.SESSION_SECRET;
    await withServerProcess(memEnv, async (proc) => {
      assert.equal(await waitForTcp(memPort, { timeoutMs: 10000 }), true, ':memory: 档：进程必须起得来（能 listen）');
      const business = await rawGet(memPort, '/api/v1/products');
      assert.equal(business.status, 200, `:memory: 档：业务面必须可用，实际 ${business.status}`);
      assert.deepEqual(scan(dirs), beforeMem, ':memory: 档：启动后**不得**新增任何 *dev-session-secret（含仓根与临时目录）');
      secretUnleaked(`${proc.stdout}${proc.stderr}`);
      await proc.stop('SIGTERM', 4000);
    });
    assert.deepEqual(scan(dirs), beforeMem, ':memory: 档：进程退出后仍不得留下 sidecar 文件');

    // ── 档② 父目录不可写：**逻辑为空（vacuous）⇒ 显式 skip，不伪装成通过、也不留一条会红的用例**
    //    逐字理由：sidecar 路径 = `<DB_PATH>.dev-session-secret`，**与库同目录** ⇒ 「库能正常打开」**已经蕴含**「该目录可写」，
    //    也就蕴含「sidecar 写得下去」⇒「父目录不可写」与「库可用」**不可能同时成立**，该分支受 `E-04` 前置遮蔽。
    //    构造实测（2026-10-16）：先建库再 `chmod 0500`，SQLite 仍要建 `-wal`/`-shm` ⇒ 库先失败、进程正当拒起（只见 `E-04`）。
    //    主控裁定 (b) 的注：pm 将把契约该句地位收窄为「实现约定 + 受 `E-04` 遮蔽、无独立机器判据」。
    await t.test(
      "父目录不可写 ⇒ 跳过密钥持久化",
      { skip: '逻辑为空：sidecar 与库同目录，「库可用」已蕴含「目录可写」；该分支受 E-04 遮蔽，无独立机器判据（不伪绿、不放松）' },
      () => {},
    );

    // ── 档③ 生产档负向对照：**独立真跑**（`NODE_ENV=production` + 删密钥，**不**叠加不可写目录）
    const prodPort = await freePort();
    const prodEnv = envFor(place, prodPort, { NODE_ENV: 'production' });
    delete prodEnv.SESSION_SECRET;
    await withServerProcess(prodEnv, async (proc) => {
      const result = await exitWithin(proc, 8000);
      assert.ok(result !== null, '生产档对照：必须**仍拒起**（不得因「开发档可跳过持久化」就放宽密钥要求）');
      assert.notEqual(result.code, 0, `生产档对照：退出码必须非 0，实际 ${JSON.stringify(result)}`);
      assert.match(
        `${proc.stdout}${proc.stderr}`,
        /SESSION_SECRET/,
        `生产档对照：日志必须点名 SESSION_SECRET，实际：${String(proc.stdout + proc.stderr).slice(-300)}`,
      );
      assert.equal(await isPortFree(prodPort), true, '生产档对照：不得留下监听端口');
    });
  });
});
