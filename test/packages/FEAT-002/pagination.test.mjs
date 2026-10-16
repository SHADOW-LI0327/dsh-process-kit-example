/**
 * 分页面：商品列表与订单列表的可选分页、量程拒绝、顺序稳定性、索引支撑。
 *
 * 装置纪律：每例独立临时库；商品一律按名称/列表自身稳定顺序定位，不写死主键；
 * 1000 件量级用注入种子构造（不落生产库）。
 *
 * @prd FEAT-002
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-002-08
 * @case TC-FEAT-002-09
 * @case TC-FEAT-002-E09
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem,
  data,
  dbIndexes,
  listProducts,
  makeSeed,
  newClient,
  openDb,
  payload,
  productAt,
  registerOrFail,
  uniqueEmail,
  withApp,
  withTempDb,
} from './helpers/harness.mjs';

const PW = 'Pw-FEAT002-abcdefgh';

/** 连翻 5 页取全表：以「列表自身稳定顺序」为参照系（不依赖主键字面值）。 */
async function fullOrderedIds(client, total, page = 200) {
  const ids = [];
  for (let offset = 0; offset < total; offset += page) {
    const res = await client.get(`/api/v1/products?limit=${page}&offset=${offset}`);
    assert.equal(res.status, 200, `翻页必须 200，实际 ${res.status}：${res.raw.slice(0, 160)}`);
    const items = payload(res);
    ids.push(...items.map((i) => i.id));
  }
  return ids;
}

test('商品分页可选（AC-08）', async () => {
  // ① 默认种子：不带参数必须恰好 8 件（沿用存量语义）
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const plain = await client.get('/api/v1/products');
      assert.equal(plain.status, 200);
      assert.equal(payload(plain).length, 8, '不带参数时必须返回全部 8 件种子商品');
      assert.equal((await listProducts(client, '/api/v1/products?limit=50')).length, 8, '内点 limit=50 必须通过');
      assert.equal((await listProducts(client, '/api/v1/products?limit=1')).length, 1, '端点 limit=1 必须返回 1 件');
      assert.equal((await listProducts(client, '/api/v1/products?limit=200')).length, 8, '端点 limit=200 必须通过（8 < 200）');
      assert.equal((await listProducts(client, '/api/v1/products?offset=0')).length, 8, 'offset 下界 0 必须通过');
    });
  });

  // ② 1000 件注入种子：越量程拒、offset 越界取尾页
  await withApp({ seed: makeSeed(1000), dbPath: ':memory:' }, async (app) => {
    const client = newClient(app);
    assert.equal((await listProducts(client, '/api/v1/products?limit=200')).length, 200, 'limit=200 必须返回 200 件');
    const all = await fullOrderedIds(client, 1000);
    assert.equal(all.length, 1000, '注入 1000 件种子后必须能翻出 1000 件');
    assert.equal(new Set(all).size, 1000, '翻页不得重复或漏件');
    const tail = await client.get('/api/v1/products?limit=200&offset=800');
    assert.equal(tail.status, 200, `offset=800 必须 200（不得 400），实际 ${tail.status}：${tail.raw.slice(0, 160)}`);
    const tailItems = payload(tail);
    assert.equal(tailItems.length, 200, 'offset=800 必须返回 200 件（第 801..1000 件）');
    assert.equal(tailItems[0].id, all[800], 'offset=800 的首件必须是整表顺序里的第 801 件');
    assert.deepStrictEqual(tailItems.map((i) => i.id), all.slice(800), '尾页必须与整表顺序的尾部逐件相同');
  });
});

test('订单分页倒序（AC-09）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const a = newClient(app);
      // 25 单必须**轮转多件商品**：单件库存（种子暂定 8）会被同一件商品的连续下单买空，
      // 那是构造缺陷而不是被测行为（实测第 9 次加购就会撞 OUT_OF_STOCK）。
      const catalog = await listProducts(a);
      assert.ok(catalog.length >= 2, '前置：本用例需要多件商品轮转下单，避免单件库存被 25 单买空');
      await registerOrFail(a, uniqueEmail('ac09a'), PW);
      for (let i = 0; i < 25; i += 1) {
        const item = catalog[i % catalog.length];
        assert.equal((await addItem(a, item.id, 1)).status, 201, `第 ${i + 1} 次加购必须成功`);
        const res = await a.post('/api/v1/orders');
        assert.equal(res.status, 201, `第 ${i + 1} 次下单必须成功：${res.raw.slice(0, 160)}`);
      }

      const plain = await a.get('/api/v1/orders');
      assert.equal(plain.status, 200);
      const all = payload(plain);
      assert.equal(all.length, 20, '不带参数时必须按默认上限 20 返回（25 > 20）');

      const five = payload(await a.get('/api/v1/orders?limit=50'));
      assert.equal(five.length, 25, '内点 limit=50 必须返回全部 25 单');
      assert.equal(new Set(all.map((o) => o.orderNo)).size, 20, '默认页内不得有重复单号');
      assert.equal(all[0].orderNo, five[0].orderNo, '默认页首单必须是最晚创建的一单（倒序）');
      // 契约 §五 明文「`created_at DESC`，同毫秒用 `id DESC` 兜底稳定性」⇒ 全表顺序确定，
      // 默认页必须是全表倒序的**同序前缀**（原写法拿 all[0] 去比 five[24]，与上一句自相矛盾）。
      assert.deepStrictEqual(
        all.map((o) => o.orderNo),
        five.slice(0, 20).map((o) => o.orderNo),
        '默认页必须与全表倒序的同序前 20 单逐单相同',
      );
      // 顺序判据用「相对先后」表达，不锁时间戳精度
      for (let i = 1; i < five.length; i += 1) {
        assert.ok(
          Date.parse(five[i - 1].createdAt) >= Date.parse(five[i].createdAt),
          `第 ${i} 单必须不早于第 ${i + 1} 单（倒序）`,
        );
      }
      assert.equal(Date.parse(all[0].createdAt) > 0, true, 'createdAt 必须可被 Date.parse 解析');

      assert.equal(payload(await a.get('/api/v1/orders?limit=1')).length, 1, '端点 limit=1 必须返回 1 单');
      assert.equal(payload(await a.get('/api/v1/orders?limit=100')).length, 25, '端点 limit=100 必须通过（25 < 100）');

      const page = payload(await a.get('/api/v1/orders?offset=20&limit=5'));
      assert.equal(page.length, 5, 'offset=20&limit=5 必须返回 5 单');
      const firstTwenty = new Set(five.slice(0, 20).map((o) => o.orderNo));
      assert.equal(page.some((o) => firstTwenty.has(o.orderNo)), false, 'offset=20 的页不得包含前 20 单');
      assert.deepStrictEqual(
        page.map((o) => o.orderNo),
        five.slice(20).map((o) => o.orderNo),
        'offset=20 必须正好取整表顺序的第 21..25 单',
      );

      const b = newClient(app);
      const itemB = catalog[1];
      await registerOrFail(b, uniqueEmail('ac09b'), PW);
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await addItem(b, itemB.id, 1)).status, 201);
        assert.equal((await b.post('/api/v1/orders')).status, 201);
      }
      const bOrders = payload(await b.get('/api/v1/orders'));
      assert.equal(bOrders.length, 3, 'B 只能看到自己的 3 单');
      assert.equal(
        bOrders.some((o) => five.some((x) => x.orderNo === o.orderNo)),
        false,
        '两个账号的订单集合必须互斥',
      );

      // 结构性支撑：orders 上必须有以 user_id 打头的索引
      const db = openDb(dbPath);
      try {
        const indexes = dbIndexes(db, 'orders');
        assert.ok(indexes.length > 0, 'orders 必须至少有一个索引');
        const leading = indexes.map((idx) => {
          const cols = db
            .prepare(`PRAGMA index_info('${idx.name}')`)
            .all()
            .map((r) => ({ ...r }));
          cols.sort((x, y) => x.seqno - y.seqno);
          return cols.map((c) => c.name).join(',');
        });
        assert.ok(
          leading.some((cols) => cols.startsWith('user_id')),
          `orders 必须有以 user_id 打头的索引（支撑「我的订单」查询），实际：${leading.join(' | ')}`,
        );
      } finally {
        db.close();
      }
    });
  });
});

test('分页越量程（E-09）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const cases = [
        ['/api/v1/products?limit=0', 'limit=0'],
        ['/api/v1/products?limit=-1', 'limit=-1'],
        ['/api/v1/products?limit=201', 'limit=201'],
        ['/api/v1/products?offset=-1', 'offset=-1'],
        ['/api/v1/products?limit=1.5', 'limit=1.5'],
        ['/api/v1/products?limit=abc', 'limit=abc'],
      ];
      for (const [path, label] of cases) {
        const res = await client.get(path);
        assert.equal(res.status, 400, `${label} 必须 400，实际 ${res.status}：${res.raw.slice(0, 160)}`);
        assert.equal(data(res).code, 'INVALID_PAGINATION', `${label} 的 code 必须是 INVALID_PAGINATION`);
      }

      const owner = newClient(app);
      await registerOrFail(owner, uniqueEmail('e09'), PW);
      const orderCases = [
        ['/api/v1/orders?limit=0', '订单 limit=0'],
        ['/api/v1/orders?limit=-1', '订单 limit=-1'],
        ['/api/v1/orders?limit=101', '订单 limit=101'],
        ['/api/v1/orders?offset=-1', '订单 offset=-1'],
      ];
      for (const [path, label] of orderCases) {
        const res = await owner.get(path);
        assert.equal(res.status, 400, `${label} 必须 400，实际 ${res.status}：${res.raw.slice(0, 160)}`);
        assert.equal(data(res).code, 'INVALID_PAGINATION', `${label} 的 code 必须是 INVALID_PAGINATION`);
      }

      // 越量程（offset 大于总量）不是错误：返回空集
      assert.equal(payload(await client.get('/api/v1/products?offset=9999')).length, 0, 'offset 超出总量必须返回空集而非 400');
      assert.equal(payload(await owner.get('/api/v1/orders?offset=9999')).length, 0, '订单 offset 超出总量必须返回空集而非 400');
      // 未知查询参数一律忽略（便于前端带无关参数）
      assert.equal((await client.get('/api/v1/products?nonsense=1')).status, 200, '未知查询参数必须被忽略');
      // 阳性对照：合法边界仍然可用，证明上面拒绝的是「越量程」而不是「整个分页不可用」
      assert.equal((await productAt(client, 0)).name.length > 0, true);
      assert.equal((await client.get('/api/v1/products?limit=1&offset=0')).status, 200);
    });
  });
});
