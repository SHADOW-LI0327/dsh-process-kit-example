/**
 * 隔离性：购物车按 cartId 归属，实例之间不共享内存态；重启后数据仍在
 * （后者由 FEAT-002 PRD §1.5 `S-1` 取代原「重启即重置」，测试侧改写授权见同表 `S-2`）。
 *
 * @prd FEAT-001
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-001-30
 * @case TC-FEAT-001-E09
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  data,
  getCart,
  getOrders,
  listProducts,
  newClient,
  startApp,
  withApp,
} from './helpers/app.mjs';

async function seedItems(app) {
  const { items } = await listProducts(newClient(app));
  return items;
}

const addItem = (client, productId, quantity) =>
  client.post('/api/v1/cart/items', { productId, quantity });

const namesOf = (cart) => cart.items.map((item) => item.productName);

test('重启后数据仍在（AC-30）', async () => {
  // 授权与取代范围（越权路径）：`FEAT-002` PRD §1.5 `S-1` 只取代原 `FEAT-001 AC-30` ②
  // （「重建后库存回到种子初值」→「**重启后数据仍在**」），测试侧改写见 `S-2`、台账侧见 `S-3`，
  // 批次顺序见 §7 `Q-21`（先改台账，再改测试）。
  // ① 的隔离语义**保留**：全新会话看不到他人购物车与订单；订单面在 FEAT-002 口径下按
  // 「未登录 ⇒ `401 UNAUTHENTICATED`」表达（`AC-02` + `AC-14`），不再是 FEAT-001 的「空列表」。
  const dir = mkdtempSync(join(tmpdir(), 'feat001-ac30-'));
  const dbPath = join(dir, 'shop.db');
  const email = 'ac30-s2@example.com';
  const password = 'Pw-AC30-s2-passphrase';
  const asUser = (client, sid) => ({
    get: (path) => client.get(path, { headers: { cookie: sid }, useJar: false }),
    post: (path, body) => client.post(path, body, { headers: { cookie: sid }, useJar: false }),
  });
  try {
    await withApp({ dbPath }, async (app) => {
      const a = newClient(app);
      const target = (await seedItems(app))[0];
      const initialStock = data(await a.get(`/api/v1/products/${target.id}`)).stock;

      const registered = await a.post('/api/v1/auth/register', { email, password });
      assert.equal(
        registered.status,
        201,
        `注册必须 201，实际 ${registered.status}：${registered.raw.slice(0, 160)}`,
      );
      const sidLine = [].concat(registered.headers['set-cookie'] ?? []).find((line) => /^sid=/.test(String(line)));
      assert.ok(sidLine, '注册必须下发会话 cookie（sid）');
      const sid = String(sidLine).split(';')[0];
      const session = asUser(a, sid);

      assert.equal((await session.post('/api/v1/cart/items', { productId: target.id, quantity: 2 })).status, 201);
      assert.equal((await session.post('/api/v1/orders')).status, 201);
      const cartBefore = data(await session.get('/api/v1/cart'));
      const ordersBefore = data(await session.get('/api/v1/orders'));
      const stockBefore = data(await session.get(`/api/v1/products/${target.id}`)).stock;
      assert.equal(ordersBefore.length, 1, '前置：下单必须建出 1 单');
      assert.notEqual(stockBefore, initialStock, '前置：下单必须已扣库存');

      // ① 同实例、全新客户端（新 cookie）：看不到别人的车与单（隔离语义保留）
      const fresh = newClient(app);
      assert.equal((await getCart(fresh)).cart.items.length, 0);
      assert.equal(
        (await fresh.get('/api/v1/orders')).status,
        401,
        '未登录查订单必须 401 UNAUTHENTICATED（FEAT-002 AC-02 / AC-14）',
      );

      // ② 同一库文件重建实例（模拟进程重启）：同一会话 cookie 必须拿回同一批数据
      const rebuilt = await startApp({ dbPath });
      try {
        const back = asUser(newClient(rebuilt), sid);
        const rowKeys = (items) => items.map((item) => `${item.productId}:${item.quantity}`).sort();
        assert.deepEqual(
          rowKeys(data(await back.get('/api/v1/cart')).items),
          rowKeys(cartBefore.items),
          '重启后购物车各行必须与重启前逐项相等',
        );
        const ordersAfter = data(await back.get('/api/v1/orders'));
        assert.equal(ordersAfter.length, ordersBefore.length, '重启后订单条数必须与重启前相等');
        assert.ok(
          ordersAfter.some((order) => order.orderNo === ordersBefore[0].orderNo),
          '重启后必须仍能按 orderNo 命中重启前的订单',
        );
        const stockAfter = data(await back.get(`/api/v1/products/${target.id}`)).stock;
        assert.equal(stockAfter, stockBefore, '重启后库存必须与重启前逐值相等');
        assert.notEqual(stockAfter, initialStock, '库存不得回到种子初值（S-1：本条期望与取代项相反）');
      } finally {
        await rebuilt.close();
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('跨客户端隔离（E-09）', async () => {
  await withApp(undefined, async (app) => {
    const a = newClient(app);
    const b = newClient(app);
    const [first, second] = await seedItems(app);

    assert.equal((await addItem(a, first.id, 1)).status, 201);
    const aTotalBefore = (await getCart(a)).cart.totalCents;
    assert.equal((await addItem(b, second.id, 2)).status, 201);

    const aCart = (await getCart(a)).cart;
    const bCart = (await getCart(b)).cart;
    assert.deepEqual(namesOf(aCart), [first.name], 'A 的车里只能有 A 加的货');
    assert.deepEqual(namesOf(bCart), [second.name], 'B 的车里只能有 B 加的货');
    assert.equal(aCart.totalCents, aTotalBefore, 'A 的总额不得受 B 的加购影响');
    assert.equal(
      namesOf(aCart).some((name) => namesOf(bCart).includes(name)),
      false,
      '两个客户端的行集合必须互斥',
    );
  });
});
