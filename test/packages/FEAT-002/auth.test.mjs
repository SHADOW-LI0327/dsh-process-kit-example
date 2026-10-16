/**
 * 账号与会话面：注册 / 登录 / 登出 / 会话属性与过期 / 车归属与合并 / 越权口径。
 *
 * 装置纪律：每例独立临时库；商品按名称定位；所有时钟类判据走注入时钟（不真实等待）；
 * 会话载体落库这件事由「新实例 + 同一 cookie」来证明，而不是读实现。
 *
 * @prd FEAT-002
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-002-10
 * @case TC-FEAT-002-11
 * @case TC-FEAT-002-12
 * @case TC-FEAT-002-13
 * @case TC-FEAT-002-14
 * @case TC-FEAT-002-15
 * @case TC-FEAT-002-16
 * @case TC-FEAT-002-17
 * @case TC-FEAT-002-19
 * @case TC-FEAT-002-E01
 * @case TC-FEAT-002-E02
 * @case TC-FEAT-002-E03
 * @case TC-FEAT-002-E19
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem,
  assertErrorShape,
  countRows,
  data,
  freePort,
  getCart,
  getMe,
  getOrders,
  listProducts,
  login,
  logout,
  me,
  newClient,
  openDb,
  payload,
  productAt,
  register,
  registerOrFail,
  uniqueEmail,
  waitForTcp,
  withApp,
  withDbApp,
  withServerProcess,
  withTempDb,
} from './helpers/harness.mjs';

const PW = 'Pw-FEAT002-abcdefgh';
const T0 = Date.parse('2026-10-15T00:00:00.000Z');
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const sidLine = (res) => res.setCookies.find((line) => /^sid=/i.test(String(line)));
const hasAttr = (line, attr) => new RegExp(`(^|;)\\s*${attr}`, 'i').test(String(line ?? ''));
const itemsOf = (cart) => cart.items.map((i) => `${i.productName}x${i.quantity}`).sort();

test('注册即开会话（AC-10）', async () => {
  await withDbApp({}, async (app) => {
    const client = newClient(app);
    const target = await productAt(client, 0);
    const email = `AC10-Buyer-${Date.now().toString(36)}@Example.COM`;
    const res = await register(client, email, PW);
    assert.equal(res.status, 201, `注册必须 201，实际 ${res.status}：${res.raw.slice(0, 200)}`);
    const user = payload(res).user;
    assert.equal(user.email, email.toLowerCase(), '邮箱必须小写归一后回显');
    assert.equal(typeof user.id, 'string');
    assert.equal(Date.parse(user.createdAt) > 0, true, 'createdAt 必须可被 Date.parse 解析');

    const cookie = sidLine(res);
    assert.ok(cookie, `注册必须下发会话 cookie，实际 Set-Cookie：${JSON.stringify(res.setCookies)}`);
    assert.ok(hasAttr(cookie, 'HttpOnly'), `会话 cookie 必须 HttpOnly：${cookie}`);
    assert.equal(/password/i.test(res.raw), false, '注册响应体不得含口令相关字段');
    assert.equal(/hash/i.test(res.raw), false, '注册响应体不得含哈希字面');

    assert.equal((await addItem(client, target.id, 1)).status, 201, '注册后同一 cookie jar 必须能加购');
    const ordered = await client.post('/api/v1/orders');
    assert.equal(ordered.status, 201, `注册即登录后必须能下单：${ordered.raw.slice(0, 200)}`);
    assert.equal(payload(ordered).status, 'paid', '下单即已支付（假支付）');
    assert.equal((await me(client)).status, 200, '注册后的会话必须可用');
  });
});

test('重复注册拒绝（AC-11）', async () => {
  await withDbApp({}, async (app) => {
    const client = newClient(app);
    const target = await productAt(client, 0);
    const email = uniqueEmail('ac11');
    await registerOrFail(client, email, PW);
    assert.equal((await addItem(client, target.id, 1)).status, 201);
    const orderNo = payload(await client.post('/api/v1/orders')).orderNo;

    const before = countRows(app.dbPath, 'users');

    const same = await register(newClient(app), email, PW);
    assertErrorShape(same, { status: 409, code: 'EMAIL_TAKEN' });
    const upper = email[0].toUpperCase() + email.slice(1);
    const variant = await register(newClient(app), upper, PW);
    assertErrorShape(variant, { status: 409, code: 'EMAIL_TAKEN' });
    assert.equal(countRows(app.dbPath, 'users'), before, '重复注册不得新增用户行');

    assert.equal((await me(client)).status, 200, '原会话不受重复注册影响');
    const orders = await getOrders(client);
    assert.equal(orders.length, 1, '原订单不受重复注册影响');
    assert.equal(orders[0].orderNo, orderNo);
  });
});

test('登录即开会话（AC-12）', async () => {
  await withTempDb(async ({ dbPath }) => {
    const email = uniqueEmail('ac12');
    let cookie = '';
    await withApp({ dbPath }, async (app) => {
      await registerOrFail(newClient(app), email, PW);
      const res = await login(newClient(app), email, PW);
      assert.equal(res.status, 200, `登录必须 200，实际 ${res.status}：${res.raw.slice(0, 200)}`);
      assert.equal(payload(res).user.email, email);
      const line = sidLine(res);
      assert.ok(line, `登录必须下发会话 cookie：${JSON.stringify(res.setCookies)}`);
      assert.ok(hasAttr(line, 'HttpOnly'), `会话 cookie 必须 HttpOnly：${line}`);
      assert.ok(/SameSite=Lax/i.test(line), `会话 cookie 必须 SameSite=Lax：${line}`);
      assert.ok(/Path=\//i.test(line), `会话 cookie 必须 Path=/：${line}`);
      assert.ok(
        /Max-Age=\d+/i.test(line) || /Expires=/i.test(line),
        `会话 cookie 必须有非空 Max-Age 或 Expires：${line}`,
      );
      assert.equal(hasAttr(line, 'Secure'), false, `本机 HTTP 下不得置 Secure（否则真机 cookie 被丢弃）：${line}`);
      cookie = `sid=${String(line).split(';')[0].slice(4)}`;
      assert.equal((await getMe(newClient(app, { cookie }))).user.email, email, '会话必须能取到当前用户');
    });

    // 重启进程（同库新实例）：会话必须仍在库内 ⇒ 同一 cookie 继续可用
    await withApp({ dbPath }, async (app) => {
      const res = await me(newClient(app, { cookie }));
      assert.equal(res.status, 200, `重启后同一会话 cookie 必须仍可用：${res.raw.slice(0, 200)}`);
      assert.equal(payload(res).user.email, email);
    });

    // 配置面：COOKIE_SECURE 打开时必须置 Secure（真机反代终结 TLS 的形态）
    const port = await freePort();
    await withServerProcess(
      {
        DB_PATH: dbPath,
        HOST: '127.0.0.1',
        PORT: String(port),
        SESSION_SECRET: 'ac12-session-secret-0123456789abcdef',
        COOKIE_SECURE: '1',
      },
      async (proc) => {
        assert.ok(await waitForTcp(port), '正向对照：服务必须能起在随机端口');
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: PW }),
        });
        assert.equal(res.status, 200, `登录必须 200，实际 ${res.status}`);
        const cookies = res.headers.getSetCookie();
        const line = cookies.find((c) => /^sid=/i.test(c));
        assert.ok(line, `必须下发会话 cookie：${JSON.stringify(cookies)}`);
        assert.ok(/Secure/i.test(line), `COOKIE_SECURE 打开时会话 cookie 必须带 Secure：${line}`);
        await proc.stop('SIGTERM', 4000);
      },
    );
  });
});

test('登录失败不辨（AC-13）', async () => {
  await withDbApp({}, async (app) => {
    const email = uniqueEmail('ac13');
    await registerOrFail(newClient(app), email, PW);

    const wrongPassword = await login(newClient(app), email, 'Pw-FEAT002-wrongpass');
    assertErrorShape(wrongPassword, { status: 401, code: 'INVALID_CREDENTIALS' });
    assert.equal(sidLine(wrongPassword), undefined, '登录失败不得下发会话 cookie');

    const unknownEmail = await login(newClient(app), uniqueEmail('ac13-ghost'), 'Pw-FEAT002-wrongpass');
    assertErrorShape(unknownEmail, { status: 401, code: 'INVALID_CREDENTIALS' });
    assert.equal(sidLine(unknownEmail), undefined, '登录失败不得下发会话 cookie');

    assert.equal(
      data(wrongPassword).message,
      data(unknownEmail).message,
      '「口令错」与「邮箱不存在」的 message 必须逐字相同（防枚举）',
    );
    // 正向对照：正确凭据必须 200 —— 防「一律 401」的假绿
    assert.equal((await login(newClient(app), email, PW)).status, 200, '正向对照：正确凭据必须登录成功');
  });
});

test('未登录拒下单（AC-14）', async () => {
  await withDbApp({}, async (app) => {
    const client = newClient(app);
    const target = await productAt(client, 0);
    const stockBefore = target.stock;
    assert.equal((await addItem(client, target.id, 1)).status, 201, '匿名车必须能加购（本用例的前置）');
    assert.equal(client.cookieValue('cartId') !== undefined, true, '匿名车必须下发 cartId cookie');

    const ordersBefore = countRows(app.dbPath, 'orders');

    assertErrorShape(await client.post('/api/v1/orders'), { status: 401, code: 'UNAUTHENTICATED' });
    assertErrorShape(await client.get('/api/v1/orders'), { status: 401, code: 'UNAUTHENTICATED' });
    assertErrorShape(await client.get('/api/v1/orders/SO-20261015-0001'), { status: 401, code: 'UNAUTHENTICATED' });

    assert.equal(countRows(app.dbPath, 'orders'), ordersBefore, '被拒的下单不得留下订单');
    const cart = await getCart(client);
    assert.equal(cart.items.length, 1, '被拒的下单不得清空匿名车');
    assert.equal((await productAt(client, 0)).stock, stockBefore, '被拒的下单不得改变库存');
  });
});

test('匿名车并入账号车（AC-15）', async () => {
  await withDbApp({}, async (app) => {
    const [x, y] = await listProducts(newClient(app));
    const emailA = uniqueEmail('ac15a');
    const emailB = uniqueEmail('ac15b');
    const emailC = uniqueEmail('ac15c');

    // 内点：匿名 2 + 账号 3 ⇒ 合并后 5；另一个商品保留 1
    const a = newClient(app);
    await registerOrFail(a, emailA, PW);
    assert.equal((await addItem(a, x.id, 3)).status, 201);
    assert.equal((await addItem(a, y.id, 1)).status, 201);
    assert.equal((await logout(a)).status, 200);
    const anonCartId = (await getCart(a)).cartId;
    assert.equal((await addItem(a, x.id, 2)).status, 201);
    assert.equal((await login(a, emailA, PW)).status, 200, '登录必须成功');
    const merged = await getCart(a);
    assert.equal(merged.items.length, 2, `合并后必须仍是两行：${JSON.stringify(itemsOf(merged))}`);
    const xRow = merged.items.find((i) => i.productName === x.name);
    const yRow = merged.items.find((i) => i.productName === y.name);
    assert.equal(xRow.quantity, 5, '同商品件数必须相加（2 + 3 = 5），不得覆盖');
    assert.equal(yRow.quantity, 1, '不同商品必须保留');
    assert.notEqual(merged.cartId, anonCartId, '登录后生效的车必须是账号车，不再是匿名车 id');

    // 作废：旧匿名 cartId 再请求只得到一个新的空匿名车
    const stale = newClient(app);
    const staleRes = await stale.get('/api/v1/cart', { cookieOverride: `cartId=${anonCartId}` });
    assert.equal(staleRes.status, 200, '旧匿名 cartId 必须按未登录处置（200），不得 4xx/5xx');
    const staleCart = payload(staleRes);
    assert.equal(staleCart.items.length, 0, '旧匿名 cartId 不得回放已并入的行');
    assert.notEqual(staleCart.cartId, anonCartId, '旧匿名 cartId 必须已作废，得到新车 id');

    // 上端点：匿名 2 + 账号 6 ⇒ 恰好 8，必须通过
    const b = newClient(app);
    await registerOrFail(b, emailB, PW);
    assert.equal((await addItem(b, x.id, 6)).status, 201);
    assert.equal((await logout(b)).status, 200);
    assert.equal((await addItem(b, x.id, 2)).status, 201);
    assert.equal((await login(b, emailB, PW)).status, 200, '合并后恰好 8 件必须通过');
    const atCap = await getCart(b);
    assert.equal(atCap.items.find((i) => i.productName === x.name).quantity, 8, '合并后上端点必须恰为 8');

    // 下端点：匿名车为空 ⇒ 合并即 no-op
    const c = newClient(app);
    await registerOrFail(c, emailC, PW);
    assert.equal((await addItem(c, x.id, 3)).status, 201);
    assert.equal((await logout(c)).status, 200);
    assert.equal((await login(c, emailC, PW)).status, 200, '空匿名车登录必须 no-op 成功');
    const noop = await getCart(c);
    assert.equal(noop.items.find((i) => i.productName === x.name).quantity, 3, '空匿名车合并不得改变账号车');
  });
});

test('退出回到匿名车（AC-16）', async () => {
  await withDbApp({}, async (app) => {
    const [x] = await listProducts(newClient(app));
    const email = uniqueEmail('ac16');
    const client = newClient(app);
    await registerOrFail(client, email, PW);
    assert.equal((await addItem(client, x.id, 1)).status, 201);
    assert.equal((await client.post('/api/v1/orders')).status, 201, '前置：账号需有 1 条订单');
    assert.equal((await logout(client)).status, 200);
    const anonIdBefore = (await getCart(client)).cartId;
    assert.equal((await addItem(client, x.id, 2)).status, 201, '前置：匿名车需含 2 件');
    assert.equal((await login(client, email, PW)).status, 200);
    const before = { cart: itemsOf(await getCart(client)), orders: (await getOrders(client)).map((o) => o.orderNo) };
    // 账号车在下单时已被清空（契约 §5.11④ 明文下单三步含「清车」同一事务）⇒ 合并 = 0 + 匿名 2 = 2
    assert.equal(before.cart[0].endsWith('x2'), true, `前置：并入后应为 2 件，实际 ${before.cart}`);

    const out = await logout(client);
    assert.equal(out.status, 200, `登出必须 200（幂等无害动作），实际 ${out.status}`);
    const sidOut = out.setCookies.find((line) => /^sid=/i.test(String(line)));
    assert.ok(sidOut, `登出必须清除会话 cookie：${JSON.stringify(out.setCookies)}`);
    assert.ok(
      /Max-Age=0/i.test(sidOut) || /Expires=Thu, 01 Jan 1970/i.test(sidOut),
      `登出必须把会话 cookie 置为过期：${sidOut}`,
    );

    const anon = await getCart(client);
    assert.equal(anon.items.length, 0, '登出后必须回到新的空匿名车');
    assert.notEqual(anon.cartId, anonIdBefore, '登出后的匿名车 id 必须与登录前那个不同');
    assert.equal(await client.get('/api/v1/orders').then((r) => r.status), 401, '登出后必须看不到账号订单');

    assert.equal((await login(client, email, PW)).status, 200, '重新登录必须成功');
    const after = { cart: itemsOf(await getCart(client)), orders: (await getOrders(client)).map((o) => o.orderNo) };
    assert.deepStrictEqual(after, before, '重新登录后车与订单必须与退出前逐项相等（退出不得清库）');
  });
});

test('我的订单归属（AC-17）', async () => {
  await withDbApp({}, async (app) => {
    const [x] = await listProducts(newClient(app));
    const a = newClient(app);
    const b = newClient(app);
    await registerOrFail(a, uniqueEmail('ac17a'), PW);
    await registerOrFail(b, uniqueEmail('ac17b'), PW);
    const aOrders = [];
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await addItem(a, x.id, 1)).status, 201);
      aOrders.push(payload(await a.post('/api/v1/orders')).orderNo);
    }
    assert.equal((await addItem(b, x.id, 1)).status, 201);
    const bOrder = payload(await b.post('/api/v1/orders')).orderNo;
    assert.equal(new Set([...aOrders, bOrder]).size, 3, '三单单号必须两两不同');

    const aList = (await getOrders(a)).map((o) => o.orderNo);
    const bList = (await getOrders(b)).map((o) => o.orderNo);
    assert.equal(aList.length, 2, 'A 的列表必须恰好 2 单');
    assert.equal(bList.length, 1, 'B 的列表必须恰好 1 单');
    assert.deepStrictEqual([...aList].sort(), [...aOrders].sort(), 'A 的列表必须正好是自己的两单');
    assert.deepStrictEqual(bList, [bOrder], 'B 的列表必须正好是自己那一单');
    assert.equal(aList.some((no) => bList.includes(no)), false, '两个列表的单号集合必须互斥');

    // 错位取样：B 用 A 的单号请求详情
    const cross = await b.get(`/api/v1/orders/${aOrders[0]}`);
    assertErrorShape(cross, { status: 404, code: 'NOT_FOUND' });
    // 正向对照：A 自己能查到
    assert.equal((await a.get(`/api/v1/orders/${aOrders[0]}`)).status, 200, 'A 必须能查自己的订单');
    assert.equal((await a.get(`/api/v1/orders/${aOrders[1]}`)).status, 200, 'A 必须能查自己另一单');
  });
});

test('越权返404（AC-19）', async () => {
  await withDbApp({}, async (app) => {
    const [x] = await listProducts(newClient(app));
    const a = newClient(app);
    const b = newClient(app);
    await registerOrFail(a, uniqueEmail('ac19a'), PW);
    await registerOrFail(b, uniqueEmail('ac19b'), PW);
    assert.equal((await addItem(a, x.id, 1)).status, 201);
    const nA = payload(await a.post('/api/v1/orders')).orderNo;
    const nX = 'SO-19990101-0001'; // 格式合法但从不存在

    const others = await b.get(`/api/v1/orders/${nA}`);
    const missing = await b.get(`/api/v1/orders/${nX}`);
    assertErrorShape(others, { status: 404, code: 'NOT_FOUND' });
    assertErrorShape(missing, { status: 404, code: 'NOT_FOUND' });
    assert.equal(others.status, 404, '越权必须 404（本项目不存在 403 面）');
    assert.equal(
      data(others).message,
      data(missing).message,
      '「他人订单」与「不存在订单」的 message 必须逐字相同（不暴露存在性）',
    );
    assert.equal(data(others).code, data(missing).code, '两者 code 必须相同');
    assert.equal(/无权|权限|forbidden/i.test(others.raw), false, `不得出现「无权」类文案：${others.raw.slice(0, 200)}`);

    const own = await a.get(`/api/v1/orders/${nA}`);
    assert.equal(own.status, 200, '正向对照：A 自己必须能查到该单（证明它确实存在且 B 被挡）');
    assert.equal(payload(own).orderNo, nA);
  });
});

test('会话畸形过期（E-01）', async () => {
  await withTempDb(async ({ dbPath }) => {
    let clock = T0;
    const now = () => clock;
    const email = uniqueEmail('e01');
    await withApp({ dbPath, now }, async (app) => {
      const client = newClient(app);
      await registerOrFail(client, email, PW);
      assert.equal((await me(client)).status, 200, '前置：刚注册的会话必须有效');

      // 空闲档：内点 29 分钟仍有效；越界 31 分钟失效
      clock = T0 + 29 * MIN;
      assert.equal((await me(client)).status, 200, '空闲 29 分钟仍必须有效（内点）');
      clock = T0 + 60 * MIN;
      assertErrorShape(await me(client), { status: 401, code: 'UNAUTHENTICATED' });

      // 绝对档：判定是 `expires_at > now` **且** `now - last_seen_at ≤ 30 分`（§4.2），两条规则必须解耦才能单独归因。
      // 本档在**空闲窗口内**每 29 分钟成功鉴权一次，把 last_seen_at 一路推到 7 天边界前
      // —— 这同时正向验证了 §4.2「last_seen_at 每次成功鉴权的请求刷新」。
      // 反例（原写法）：直接跳到 `base + 7d - 1min` 而不触碰，那时空闲实为 7 天 ≫ 30 分，
      // 按 §4.2 只能 401 ⇒ 断言 200 在数学上无解（**不是**实现缺口）。
      clock = T0 + 60 * MIN;
      assert.equal((await login(client, email, PW)).status, 200, '重新登录必须成功');
      const base = clock;
      for (let t = 29 * MIN; t <= 7 * DAY - 11 * MIN; t += 29 * MIN) {
        clock = base + t;
        assert.equal((await me(client)).status, 200, `绝对期内每 29 分钟鉴权必须有效（t=${t / MIN} 分）`);
      }
      // 边界内 10 分钟：空闲仅 7 分（上一次触碰落在 7d-17min）⇒ 有效性只可能来自「未越绝对上限」
      clock = base + 7 * DAY - 10 * MIN;
      assert.equal((await me(client)).status, 200, '绝对上限内 10 分钟（空闲 7 分 ≤ 30）必须有效');
      // 边界外 1 分钟：空闲仅 11 分 ≤ 30 ⇒ 这个 401 只可能由「越绝对上限」解释
      clock = base + 7 * DAY + MIN;
      assertErrorShape(await me(client), { status: 401, code: 'UNAUTHENTICATED' });

      // 伪造 / 未知 token：一律按未登录处置，绝不 5xx
      for (const bad of ['sid=deadbeef', 'sid=a.b.c', 'sid=00000000-0000-4000-8000-000000000000']) {
        const victim = newClient(app);
        const protectedRes = await victim.get('/api/v1/auth/me', { cookieOverride: bad });
        assert.equal(protectedRes.status, 401, `伪造会话 ${bad} 访问受保护面必须 401，实际 ${protectedRes.status}`);
        assert.equal(data(protectedRes).code, 'UNAUTHENTICATED');
        const cartRes = await victim.get('/api/v1/cart', { cookieOverride: bad });
        assert.equal(cartRes.status, 200, `伪造会话访问购物车面必须 200（按新匿名车），实际 ${cartRes.status}`);
        const cart = payload(cartRes);
        assert.equal(cart.items.length, 0, '伪造会话必须得到空匿名车');
        assert.ok(cart.cartId && cart.cartId.length > 0, '必须下发新的 cartId');
        assert.ok(
          cartRes.setCookies.some((line) => /^cartId=/i.test(String(line))),
          '购物车面必须下发新 cartId cookie',
        );
      }
    });
  });
});

test('账号字段非法（E-02）', async () => {
  await withDbApp({}, async (app) => {
    const cases = [
      [{ email: 'not-an-email', password: PW }, '邮箱格式非法'],
      [{ email: 'a@b', password: PW }, '邮箱缺顶级域'],
      [{ email: '@example.com', password: PW }, '邮箱缺本地部分'],
      [{ email: '', password: PW }, '邮箱空串'],
      [{ password: PW }, '缺 email 字段'],
      [{ email: uniqueEmail('e02'), password: 'short7!' }, '口令 7 位（下端点外）'],
      [{ email: uniqueEmail('e02'), password: `x`.repeat(129) }, '口令 129 位（上端点外）'],
      [{ email: uniqueEmail('e02'), password: '' }, '口令空串'],
      [{ email: uniqueEmail('e02'), password: 12345678 }, '口令非字符串'],
      [{ email: uniqueEmail('e02') }, '缺 password 字段'],
    ];
    for (const [body, label] of cases) {
      const res = await newClient(app).post('/api/v1/auth/register', body);
      assertErrorShape(res, { status: 400, code: 'INVALID_BODY' });
      assert.equal(
        /已注册|已存在|占用/.test(data(res).message),
        false,
        `${label}：入参错误不得泄露账号是否存在，实际 message=${data(res).message}`,
      );
    }

    // 端点必须可用（内点 32、两端点 8 与 128）
    for (const [password, label] of [
      ['x'.repeat(32), '内点 32 位'],
      ['x'.repeat(8), '端点 8 位'],
      ['x'.repeat(128), '端点 128 位'],
    ]) {
      const res = await register(newClient(app), uniqueEmail('e02ok'), password);
      assert.equal(res.status, 201, `${label} 口令必须可注册，实际 ${res.status}：${res.raw.slice(0, 160)}`);
    }

    // 已存在邮箱 + 非法口令：必须仍按入参错误处置（不得用 409 泄露存在性）
    const taken = uniqueEmail('e02taken');
    assert.equal((await register(newClient(app), taken, PW)).status, 201);
    const again = await register(newClient(app), taken, 'short7!');
    assert.equal(again.status, 400, `已存在邮箱 + 非法口令必须 400（入参错误优先），实际 ${again.status}`);
    assert.equal(data(again).code, 'INVALID_BODY');
  });
});

test('订单号不存在（E-03）', async () => {
  await withDbApp({}, async (app) => {
    const [x] = await listProducts(newClient(app));
    const a = newClient(app);
    const b = newClient(app);
    await registerOrFail(a, uniqueEmail('e03a'), PW);
    await registerOrFail(b, uniqueEmail('e03b'), PW);
    assert.equal((await addItem(a, x.id, 1)).status, 201);
    const nA = payload(await a.post('/api/v1/orders')).orderNo;

    const missing = await b.get('/api/v1/orders/SO-19990101-0001');
    const others = await b.get(`/api/v1/orders/${nA}`);
    assertErrorShape(missing, { status: 404, code: 'NOT_FOUND' });
    assert.equal(data(missing).message, data(others).message, '「不存在」与「他人订单」必须逐字同形');
    assert.equal(data(missing).code, data(others).code);

    // 形态非法的单号也不得 5xx / 不得 403
    for (const bad of ['NOPE', 'so-20261015-1', 'SO-20261015-', '../orders']) {
      const res = await b.get(`/api/v1/orders/${encodeURIComponent(bad)}`);
      assert.equal(res.status, 404, `非法形态单号 ${bad} 必须 404，实际 ${res.status}`);
      assert.equal(data(res).code, 'NOT_FOUND');
    }
    assert.equal((await a.get(`/api/v1/orders/${nA}`)).status, 200, '正向对照：单号确实存在');
  });
});

test('合并且越限（E-19）', async () => {
  await withDbApp({}, async (app) => {
    const [x] = await listProducts(newClient(app));
    const email = uniqueEmail('e19');
    const client = newClient(app);
    await registerOrFail(client, email, PW);
    assert.equal((await addItem(client, x.id, 7)).status, 201, '前置：账号车 7 件');
    assert.equal((await logout(client)).status, 200);
    assert.equal((await addItem(client, x.id, 2)).status, 201, '前置：匿名车 2 件');

    const res = await login(client, email, PW);
    assertErrorShape(res, { status: 409, code: 'QUANTITY_LIMIT_EXCEEDED' });
    assert.equal(sidLine(res), undefined, '合并失败时不得进入登录态');

    // 合并不发生：匿名车保持 2
    const anon = await getCart(client);
    assert.equal(anon.items.find((i) => i.productName === x.name).quantity, 2, '失败后匿名车必须保持并入前状态');
    assert.equal(anon.items.length, 1, '失败后匿名车不得有部分写入');

    // 清掉匿名车后再登录：账号车必须仍是 7（没有被失败的那次部分写入）
    assert.equal((await client.delete(`/api/v1/cart/items/${x.id}`)).status, 200, '删行必须 200');
    assert.equal((await getCart(client)).items.length, 0, '前置：匿名车必须已清空');
    assert.equal((await login(client, email, PW)).status, 200, '清空匿名车后登录必须成功');
    const accountCart = await getCart(client);
    assert.equal(
      accountCart.items.find((i) => i.productName === x.name).quantity,
      7,
      '账号车必须保持 7 件（失败合并没有部分写入）',
    );
  });
});
