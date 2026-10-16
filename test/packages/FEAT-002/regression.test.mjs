/**
 * 存量回归与无界面直连：五个功能面在新版仍然可用、被账号化影响的两面按新口径成立。
 *
 * 装置纪律：全链路只走 HTTP 直连（显式 cookie jar），不经任何界面动作；
 * 「重启后仍可查」用同一临时库起第二个实例来证明。
 *
 * @prd FEAT-002
 * @prdVersion 2
 * @status active
 * @case TC-FEAT-002-55
 * @case TC-FEAT-002-E13
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import {
  REPO_ROOT,
  addItem,
  assertErrorShape,
  getCart,
  getOrders,
  listProducts,
  login,
  logout,
  newClient,
  payload,
  productAt,
  readRepoFile,
  registerOrFail,
  uniqueEmail,
  withApp,
  withTempDb,
} from './helpers/harness.mjs';

const PW = 'Pw-FEAT002-abcdefgh';

test('存量五面回归（AC-55）', async () => {
  // ① 全量测试退出码 0 由主控 / CI 复跑承载（套内自跑会递归）；此处只断「不得静默跳过」
  const files = globSync('test/packages/FEAT-002/*.test.mjs', { cwd: REPO_ROOT });
  assert.ok(files.length > 0, '测试包目录必须有用例文件');
  for (const rel of files) {
    const text = readRepoFile(rel);
    for (const pattern of [/test\.skip\(/, /test\.todo\(/, /\btest\.only\(/, /describe\.skip\(/]) {
      assert.equal(pattern.test(text), false, `${rel} 不得出现跳过 / 独占写法（${pattern.source}），本包不静默跳过量程`);
    }
  }

  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const anon = newClient(app);
      const account = newClient(app);
      const email = uniqueEmail('ac55');
      const [first, second] = await listProducts(anon);

      // ② 五面端到端：列表 → 详情 → 加购 / 改件 / 删行 → 注册登录 → 下单 → 订单列表
      const list = await anon.get('/api/v1/products');
      assert.equal(list.status, 200, '面①商品列表必须 200');
      assert.equal(payload(list).length, 8, '面①商品列表必须返回 8 件种子商品');
      const detail = await anon.get(`/api/v1/products/${first.id}`);
      assert.equal(detail.status, 200, '面②商品详情必须 200');
      assert.equal(payload(detail).name, first.name, '面②详情必须命中同一商品（按名称核对）');

      assert.equal((await addItem(anon, first.id, 2)).status, 201, '面③加购必须 201');
      const patched = await anon.patch(`/api/v1/cart/items/${first.id}`, { quantity: 3 });
      assert.equal(patched.status, 200, '面③改件数必须 200');
      assert.equal(payload(patched).quantityTotal, 3, '面③改件数后件数必须为 3');
      assert.equal((await addItem(anon, second.id, 1)).status, 201, '面③再加一行必须 201');
      const removed = await anon.delete(`/api/v1/cart/items/${second.id}`);
      assert.equal(removed.status, 200, '面③删行必须 200');
      assert.equal(payload(removed).items.length, 1, '面③删行后必须只剩一行');

      // 账号化档：登录后匿名车并入账号车（新口径）。
      // 必须是**同一客户端**的两态：两个 newClient 的 cookie jar 互相独立，且注册**不**并入匿名车
      // （§5.5「合并只发生在登录」）⇒ 原写法把 3 件加在 anon 客户端上，账号车并入的其实是自己那辆 1 件的车。
      await registerOrFail(account, email, PW);
      assert.equal((await addItem(account, first.id, 3)).status, 201, '前置：账号车先有 3 件');
      assert.equal((await logout(account)).status, 200, '前置：登出后造一辆含件的匿名车');
      assert.equal((await addItem(account, first.id, 1)).status, 201, '前置：匿名车加 1 件');
      assert.equal((await login(account, email, PW)).status, 200, '面④登录必须 200');
      const merged = await getCart(account);
      assert.equal(merged.items.length, 1, '面③ 账号化口径：登录后并入同一行');
      assert.equal(merged.items[0].quantity, 4, '面③ 账号化口径：账号车 3 件 + 匿名 1 件**相加** = 4 件（相加不是覆盖）');

      const ordered = await account.post('/api/v1/orders');
      assert.equal(ordered.status, 201, '面⑤下单必须 201');
      const order = payload(ordered);
      assert.match(String(order.orderNo), /^SO-\d{8}-\d+$/, `订单号形态必须为 SO-<YYYYMMDD>-<seq>，实际 ${order.orderNo}`);
      assert.equal(order.status, 'paid', '面⑤下单即已支付（假支付）');
      assert.equal(order.totalCents, first.priceCents * 4, '面⑤订单金额必须按分精确合计');
      assert.equal((await getCart(account)).items.length, 0, '面⑤下单后购物车必须清空');
      const orders = await getOrders(account);
      assert.equal(orders.length, 1, '面⑤订单列表必须 1 单');
      assert.equal(orders[0].orderNo, order.orderNo, '面⑤订单列表必须含刚下的单');

      // ③ 订单归属（新口径）：他人不可见、越权 404
      const other = newClient(app);
      await registerOrFail(other, uniqueEmail('ac55b'), PW);
      assert.equal((await getOrders(other)).length, 0, '面⑤ 订单归属：他人列表必须为空');
      assertErrorShape(await other.get(`/api/v1/orders/${order.orderNo}`), { status: 404, code: 'NOT_FOUND' });
      assert.equal((await account.get(`/api/v1/orders/${order.orderNo}`)).status, 200, '面⑤ 正向对照：本人必须可查');
    });
  });
});

test('无界面直连可用（E-13）', async () => {
  await withTempDb(async ({ dbPath }) => {
    const email = uniqueEmail('e13');
    let orderNo;
    let cookie = '';
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const target = await productAt(client, 0);
      const registered = await client.post('/api/v1/auth/register', { email, password: PW });
      assert.equal(registered.status, 201, `注册必须 201，实际 ${registered.status}：${registered.raw.slice(0, 160)}`);
      cookie = client.cookieHeader();
      assert.equal((await client.post('/api/v1/auth/login', { email, password: PW })).status, 200, '登录必须 200');
      assert.equal((await client.post('/api/v1/cart/items', { productId: target.id, quantity: 2 })).status, 201, '加购必须 201');
      const cart = await getCart(client);
      assert.equal(cart.quantityTotal, 2, '购物车件数必须为 2');
      const ordered = await client.post('/api/v1/orders');
      assert.equal(ordered.status, 201, `下单必须 201，实际 ${ordered.status}：${ordered.raw.slice(0, 160)}`);
      orderNo = payload(ordered).orderNo;
      assert.equal((await client.get(`/api/v1/orders/${orderNo}`)).status, 200, '查单必须 200');
      assert.equal((await getOrders(client)).length, 1, '订单列表必须 1 单');
    });

    // 重启后（同库新实例 + 同一 cookie）订单仍可查 ⇒ 全链路无「只有点界面才能触发的隐藏动作」
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app, { cookie });
      const res = await client.get(`/api/v1/orders/${orderNo}`);
      assert.equal(res.status, 200, `重启后必须仍能按订单号查到该单，实际 ${res.status}：${res.raw.slice(0, 160)}`);
      assert.equal(payload(res).orderNo, orderNo, '重启后查到的必须是同一单号');
      assert.equal((await getOrders(client)).length, 1, '重启后订单列表必须仍为 1 单');
    });
  });
});
