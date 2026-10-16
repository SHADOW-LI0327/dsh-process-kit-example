/**
 * 错误词表 / 未预期异常映射 / 安全最小集（体上限、限流、安全头、口令不落日志、客户端中断）。
 *
 * 装置纪律：阈值类判据一律「注入缩放配置断边界」+「默认配置断生产真值」两条腿；
 * 库故障用注入的临时库（删表）确定性制造，不依赖真实磁盘故障；
 * 时钟走注入缝，绝不真实等待。
 *
 * @prd FEAT-002
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-002-18
 * @case TC-FEAT-002-20
 * @case TC-FEAT-002-21
 * @case TC-FEAT-002-22
 * @case TC-FEAT-002-23
 * @case TC-FEAT-002-24
 * @case TC-FEAT-002-E07
 * @case TC-FEAT-002-E08
 * @case TC-FEAT-002-E20
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_CODES,
  SECURITY_CSP,
  abortMidRequest,
  assertErrorShape,
  breakSchema,
  data,
  dbRows,
  dbTables,
  getCart,
  listProducts,
  login,
  makeLogSink,
  newClient,
  openDb,
  payload,
  productAt,
  register,
  registerOrFail,
  uniqueEmail,
  withApp,
  withTempDb,
} from './helpers/harness.mjs';

const PW = 'Pw-FEAT002-abcdefgh';
const KIB = 1024;

/** 构造「字节数恰为 n」的 JSON 请求体（填充字段为 ASCII，字节数 = 字符数）。 */
function bodyOfBytes(n, productId) {
  const head = JSON.stringify({ productId, quantity: 1, pad: '' });
  const overhead = Buffer.byteLength(head);
  assert.ok(n >= overhead, `目标字节数 ${n} 小于最小体 ${overhead}`);
  return JSON.stringify({ productId, quantity: 1, pad: 'a'.repeat(n - overhead) });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('口令不落日志（AC-18）', async () => {
  await withTempDb(async ({ dbPath }) => {
    const sink = makeLogSink();
    const feature = `Pw-FEAT002-${Math.random().toString(36).slice(2, 10)}`;
    const email = uniqueEmail('ac18');
    await withApp({ dbPath, logStream: sink.stream }, async (app) => {
      const client = newClient(app);
      const registered = await register(client, email, feature);
      assert.equal(registered.status, 201, `注册必须 201，实际 ${registered.status}：${registered.raw.slice(0, 160)}`);
      const okLogin = await login(newClient(app), email, feature);
      assert.equal(okLogin.status, 200, `登录必须 200，实际 ${okLogin.status}`);
      const badLogin = await login(newClient(app), email, `${feature}-WRONG`);
      assert.equal(badLogin.status, 401);
      const bodies = [registered.raw, okLogin.raw, badLogin.raw];
      const sid = String(okLogin.setCookies.find((l) => /^sid=/i.test(String(l))) ?? '').split(';')[0].slice(4);
      const cartId = client.cookieValue('cartId') ?? '';

      await wait(60);
      const logs = sink.text();
      assert.ok(logs.length > 0, '必须捕获到结构化日志（logStream 注入缝）');
      for (const [label, text] of [['日志', logs], ...bodies.map((b, i) => [`响应体${i + 1}`, b])]) {
        assert.equal(text.includes(feature), false, `${label}不得含口令明文`);
      }
      const db = openDb(dbPath);
      let hash;
      try {
        assert.ok(dbTables(db).includes('users'), '库内必须有 users 表');
        const row = dbRows(db, 'users')[0];
        hash = row.password_hash;
        assert.ok(typeof hash === 'string' && hash.length > 0, '库内必须有 password_hash（前置）');
      } finally {
        db.close();
      }
      assert.equal(logs.includes(hash), false, '日志不得含 password_hash 的值');
      if (sid) assert.equal(logs.includes(sid), false, '日志不得含会话 token 明文');
      if (cartId) assert.equal(logs.includes(cartId), false, '日志不得含 cartId 的值');

      const lines = sink.lines();
      assert.ok(lines.length > 0, '日志必须是可解析的逐行 JSON');
      const paths = lines.map((l) => l.path).filter(Boolean);
      assert.ok(
        paths.some((p) => String(p).startsWith('/api/v1/auth/login')),
        `观测窗口内必须记录到登录路径，实际路径：${JSON.stringify(paths)}`,
      );
      const requestLines = lines.filter((l) => l.path !== undefined);
      assert.ok(requestLines.length > 0, '必须至少有一行请求级结构化日志');
      assert.ok(
        requestLines.every((l) => typeof l.requestId === 'string' && l.requestId.length > 0),
        '每行请求级日志都必须带 requestId',
      );
    });
  });
});

test('错误词表完备（AC-20）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    const seen = [];
    const record = async (label, options, fn) => {
      await withApp({ ...options, dbPath: path(`${label}.db`) }, async (app) => {
        const res = await fn(app);
        const body = data(res);
        assert.equal(typeof body.code, 'string', `${label}：错误响应必须含 code：${res.raw.slice(0, 200)}`);
        assert.equal(typeof body.message, 'string', `${label}：错误响应必须含 message`);
        assert.ok(body.message.length > 0, `${label}：message 不得为空`);
        assert.ok(ERROR_CODES.includes(body.code), `${label}：code 必须落在封闭词表内，实际 ${body.code}`);
        assert.equal('stack' in body, false, `${label}：不得含 stack`);
        for (const pattern of [/\/Users\//, /\bserver\/src\b/, /\berrno\b/i, /\bsyscall\b/i, /\bstack\b/i]) {
          assert.equal(pattern.test(res.raw), false, `${label}：响应体命中内部特征 ${pattern}：${res.raw.slice(0, 200)}`);
        }
        seen.push({ label, status: res.status, code: body.code });
        return res;
      });
    };

    await record('400 非法体', {}, (app) => newClient(app).post('/api/v1/auth/register', { email: 'x', password: 'y' }));
    await record('400 非法分页', {}, (app) => newClient(app).get('/api/v1/products?limit=0'));
    await record('401 未登录', {}, (app) => newClient(app).get('/api/v1/orders'));
    await record('401 凭据错', {}, (app) => login(newClient(app), uniqueEmail('ac20'), PW));
    await record('404 商品不存在', {}, (app) => newClient(app).get('/api/v1/products/NOPE-NOT-EXIST'));
    await record('409 空车下单', {}, async (app) => {
      const c = newClient(app);
      await registerOrFail(c, uniqueEmail('ac20empty'), PW);
      return c.post('/api/v1/orders');
    });
    await record('409 邮箱占用', {}, async (app) => {
      const email = uniqueEmail('ac20dup');
      await register(newClient(app), email, PW);
      return register(newClient(app), email, PW);
    });
    await record('409 缺货', {}, async (app) => {
      const owner = newClient(app);
      const target = await productAt(owner, 0);
      await registerOrFail(owner, uniqueEmail('ac20stock'), PW);
      // 把该商品库存**买空**（按实测库存循环，别写死种子初值），再由后来的账号加购：
      // 库存为 0 时加购必须 409 OUT_OF_STOCK —— 这正是本条要记录的错误码。
      const readStock = async () => payload(await owner.get(`/api/v1/products/${target.id}`)).stock;
      let stock = await readStock();
      assert.ok(stock > 0, `前置：本用例需要该商品初始有货，实际 ${stock}`);
      while (stock > 0) {
        const take = Math.min(stock, 8);
        assert.equal(
          (await owner.post('/api/v1/cart/items', { productId: target.id, quantity: take })).status,
          201,
          '前置：买空前加购必须 201',
        );
        assert.equal((await owner.post('/api/v1/orders')).status, 201, '前置：买空单必须 201');
        stock = await readStock();
      }
      const late = newClient(app);
      await registerOrFail(late, uniqueEmail('ac20stock2'), PW);
      const res = await late.post('/api/v1/cart/items', { productId: target.id, quantity: 8 });
      assert.equal(res.status, 409, `前置：库存耗尽后加购必须 409，实际 ${res.status}：${res.raw.slice(0, 160)}`);
      assert.equal(res.json.code, 'OUT_OF_STOCK', '前置：必须命中 OUT_OF_STOCK');
      return res;
    });
    await record('413 体超限', {}, (app) =>
      newClient(app).post('/api/v1/cart/items', undefined, { rawBody: bodyOfBytes(131072 + 1, 'x') }),
    );
    await record('429 限流', {}, async (app) => {
      const c = newClient(app);
      let last;
      for (let i = 0; i < 61; i += 1) last = await login(c, uniqueEmail('ac20rate'), PW);
      return last;
    });
    await record('500 内部错', {}, async (app) => {
      const c = newClient(app);
      await listProducts(c); // 前置：先确保迁移完成
      breakSchema(app.dbPath, 'products');
      return c.get('/api/v1/products');
    });

    const byStatus = new Map();
    for (const item of seen) {
      if (!byStatus.has(item.status)) byStatus.set(item.status, []);
      byStatus.get(item.status).push(item.code);
    }
    for (const [status, codes] of byStatus) {
      assert.equal(new Set(codes).size, codes.length, `同一 HTTP ${status} 下的 code 必须互不相同，实际 ${codes.join(',')}`);
    }
    assert.ok(seen.some((s) => s.code === 'PAYLOAD_TOO_LARGE'), '必须触发到 413 PAYLOAD_TOO_LARGE');
    assert.ok(seen.some((s) => s.code === 'RATE_LIMITED'), '必须触发到 429 RATE_LIMITED');
    assert.ok(seen.some((s) => s.code === 'INTERNAL_ERROR'), '必须触发到 500 INTERNAL_ERROR');
    assert.equal(seen.some((s) => !ERROR_CODES.includes(s.code)), false, '不得出现词表外的 code');
  });
});

test('内部错误不伪装（AC-21）', async () => {
  await withTempDb(async ({ dbPath }) => {
    const sink = makeLogSink();
    await withApp({ dbPath, logStream: sink.stream }, async (app) => {
      const client = newClient(app);
      await listProducts(client); // 前置：迁移完成
      breakSchema(app.dbPath, 'products');

      const res = await client.get('/api/v1/products');
      assert.equal(res.status, 500, `库故障必须 500（不得伪装 404），实际 ${res.status}：${res.raw.slice(0, 200)}`);
      assert.equal(data(res).code, 'INTERNAL_ERROR', '未预期异常必须映射 INTERNAL_ERROR');
      assert.equal(data(res).code === 'NOT_FOUND', false, '不得把内部故障伪装成 NOT_FOUND');
      assert.equal('stack' in data(res), false, '响应体不得含堆栈');

      await wait(60);
      const lines = sink.lines();
      const access = lines.find((l) => String(l.path).startsWith('/api/v1/products') && l.status === 500);
      assert.ok(access, `日志必须有该请求的 500 访问行，实际：${JSON.stringify(lines).slice(0, 500)}`);
      assert.ok(access.requestId, '500 访问行必须带 requestId');
      const errorLine = lines.find((l) => l.level === 'error' && l.requestId === access.requestId);
      assert.ok(
        errorLine,
        `必须有与该请求 requestId 关联的 error 级记录（否则「吞掉异常只回 500」也能过），实际：${JSON.stringify(lines).slice(0, 500)}`,
      );

      // 进程不退出：后续请求仍能得到响应
      const after = await client.get('/api/v1/products');
      assert.ok(after.status >= 200 && after.status < 600, '单次请求故障不得拖垮服务');
      assert.equal((await client.get('/api/v1/products?limit=0')).status, 400, '请求链路仍必须完整可用（分页校验仍生效）');
    });
  });
});

test('请求体大小上限（AC-22）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const target = await productAt(client, 0);
      const limit = 128 * KIB; // 生产默认上限（实测值）

      const atLimit = await client.post('/api/v1/cart/items', undefined, { rawBody: bodyOfBytes(limit, target.id) });
      assert.notEqual(atLimit.status, 413, `恰为上限（${limit} 字节）不得判 413，实际 ${atLimit.status}`);
      assert.ok([201, 400].includes(atLimit.status), `恰为上限必须按业务口径处理，实际 ${atLimit.status}`);

      const inner = await client.post('/api/v1/cart/items', undefined, { rawBody: bodyOfBytes(64 * KIB, target.id) });
      assert.ok([201, 400].includes(inner.status), `内点 64KiB 必须按业务口径处理，实际 ${inner.status}`);

      const over = await client.post('/api/v1/cart/items', undefined, { rawBody: bodyOfBytes(limit + 1, target.id) });
      assertErrorShape(over, { status: 413, code: 'PAYLOAD_TOO_LARGE' });

      const oneByte = await client.post('/api/v1/cart/items', undefined, { rawBody: '{' });
      assertErrorShape(oneByte, { status: 400, code: 'INVALID_BODY' });
      assert.notEqual(oneByte.status, 413, '1 字节不得判 413');

      // 进程不崩：后续正常请求仍 200
      assert.equal((await client.get('/api/v1/products')).status, 200, '超限请求不得打挂服务');
    });
  });
});

test('写接口频次限流（AC-23）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const R = 60; // 生产默认阈值（实测值）
      for (let round = 0; round < 3; round += 1) {
        const client = newClient(app);
        await getCart(client); // 先落到一个确定的会话（限流按会话计）
        let last;
        const codes = [];
        for (let i = 0; i < R + 1; i += 1) {
          last = await login(client, uniqueEmail(`ac23r${round}`), PW);
          codes.push(last.status);
        }
        assert.equal(
          codes.slice(0, R).some((s) => s === 429),
          false,
          `第 ${round + 1} 轮：前 ${R} 次不得出现 429，实际 ${codes.filter((s) => s === 429).length} 次`,
        );
        assert.equal(codes[R], 429, `第 ${round + 1} 轮：第 ${R + 1} 次必须 429，实际 ${codes[R]}`);
        assert.equal(data(last).code, 'RATE_LIMITED');
        assert.match(
          String(last.headers['retry-after'] ?? ''),
          /^\d+$/,
          `429 必须带整数 Retry-After，实际 ${JSON.stringify(last.headers['retry-after'])}`,
        );
      }

      // 被限流的请求不得产生副作用
      const worker = newClient(app);
      await getCart(worker);
      const target = await productAt(worker, 0);
      await registerOrFail(worker, uniqueEmail('ac23side'), PW);
      assert.equal((await worker.post('/api/v1/cart/items', { productId: target.id, quantity: 1 })).status, 201);
      let limited;
      for (let i = 0; i < R + 2; i += 1) {
        limited = await worker.patch(`/api/v1/cart/items/${target.id}`, { quantity: 1 });
      }
      assert.equal(limited.status, 429, '写接口超阈值必须 429');
      const cart = await getCart(worker);
      assert.equal(cart.quantityTotal, 1, '被限流的写请求不得改变购物车');
      assert.equal((await productAt(worker, 0)).stock, target.stock, '被限流的写请求不得改变库存');
    });
  });
});

test('安全响应头齐备（AC-24）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const targets = ['/', '/index.html', '/api/v1/products', '/health', '/no-such-path'];
      const expected = {
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      };
      const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
      for (const path of targets) {
        const res = await client.get(path);
        assert.ok(res.status >= 200 && res.status < 600, `${path} 必须得到响应，实际 ${res.status}`);
        for (const [header, value] of Object.entries(expected)) {
          assert.equal(
            normalize(res.headers[header]),
            value,
            `${path} 的 ${header} 必须为 ${value}，实际 ${res.headers[header]}`,
          );
        }
        const csp = normalize(res.headers['content-security-policy']);
        assert.equal(csp, SECURITY_CSP, `${path} 的 CSP 必须与契约策略逐字一致，实际 ${csp}`);
        assert.equal(
          /https?:\/\//.test(csp),
          false,
          `${path} 的 CSP 内不得出现任何第三方域名（含协议字面），实际 ${csp}`,
        );
      }
    });
  });
});

test('体积上限边界（E-07）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    const target = await withApp({ dbPath }, async (app) => productAt(newClient(app), 0));

    // 缩放档：注入小上限，逐字节判定（独立库，避免与默认实例同文件并发）
    const small = 2048;
    await withApp({ dbPath: path('scaled.db'), config: { BODY_LIMIT_BYTES: String(small) } }, async (scaledApp) => {
      const s = newClient(scaledApp);
      const atLimit = await s.post('/api/v1/cart/items', undefined, { rawBody: bodyOfBytes(small, target.id) });
      assert.notEqual(atLimit.status, 413, `恰为注入上限（${small} 字节）不得 413，实际 ${atLimit.status}`);
      const over = await s.post('/api/v1/cart/items', undefined, { rawBody: bodyOfBytes(small + 1, target.id) });
      assertErrorShape(over, { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    });

    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const empty = await client.post('/api/v1/cart/items', undefined, { rawBody: '' });
      assertErrorShape(empty, { status: 400, code: 'INVALID_BODY' });
      assert.notEqual(empty.status, 413, '0 字节必须是入参错误，不是 413');

      // 生产真值：默认上限恰为 128 KiB
      const exact = await client.post('/api/v1/cart/items', undefined, { rawBody: bodyOfBytes(128 * KIB, target.id) });
      assert.notEqual(exact.status, 413, '默认上限（131072 字节）本身必须可通过');
      const beyond = await client.post('/api/v1/cart/items', undefined, { rawBody: bodyOfBytes(128 * KIB + 1, target.id) });
      assert.equal(beyond.status, 413, `默认上限 +1 字节必须 413，实际 ${beyond.status}`);
    });
  });
});

test('限流窗口边界（E-08）', async () => {
  await withTempDb(async ({ dbPath }) => {
    let clock = Date.parse('2026-10-15T00:00:00.000Z');
    await withApp(
      {
        dbPath,
        now: () => clock,
        config: { RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' },
      },
      async (app) => {
        const client = newClient(app);
        await getCart(client); // 先落到一个确定的会话（限流按会话计）
        const attempt = () => login(client, uniqueEmail('e08'), PW);
        assert.equal((await attempt()).status, 401, '窗口内第 1 次必须按业务口径（401）');
        assert.equal((await attempt()).status, 401, '窗口内第 2 次必须按业务口径');
        assert.equal((await attempt()).status, 401, '窗口内第 3 次（= R）必须按业务口径');
        const over = await attempt();
        assertErrorShape(over, { status: 429, code: 'RATE_LIMITED' });
        assert.match(String(over.headers['retry-after'] ?? ''), /^\d+$/, '429 必须带整数 Retry-After');

        clock += 60 * 1000 + 1; // 越过窗口（注入时钟，不真实等待）
        const fresh = await attempt();
        assert.equal(fresh.status, 401, `新窗口必须恢复按业务口径应答，实际 ${fresh.status}：${fresh.raw.slice(0, 160)}`);
        assert.notEqual(fresh.status, 429, '新窗口不得继续 429');
      },
    );
  });
});

test('客户端中断（E-20）', async () => {
  await withTempDb(async ({ dbPath }) => {
    const sink = makeLogSink();
    await withApp({ dbPath, logStream: sink.stream }, async (app) => {
      const client = newClient(app);
      await listProducts(client); // 前置：确认日志链路已工作
      await abortMidRequest(app, { path: '/api/v1/auth/login', partialBody: '{"email":"' });
      await wait(150);

      const lines = sink.lines();
      const aborted = lines.find((l) => l.outcome === 'client_aborted');
      assert.ok(
        aborted,
        `客户端中断必须记一条 outcome=client_aborted 的日志，实际：${JSON.stringify(lines).slice(0, 500)}`,
      );
      assert.equal(aborted.level, 'warn', `中断必须记为 warn 级（不得算内部故障），实际 ${aborted.level}`);
      assert.equal(
        lines.some((l) => l.level === 'error'),
        false,
        `中断不得记为 error 级，实际 error 行：${JSON.stringify(lines.filter((l) => l.level === 'error')).slice(0, 300)}`,
      );
      assert.equal((await client.get('/api/v1/products')).status, 200, '中断不得影响进程后续请求');
    });
  });
});
