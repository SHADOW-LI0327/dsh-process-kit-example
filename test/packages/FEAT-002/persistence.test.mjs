/**
 * 持久化 / 迁移 / 事务 / 并发 / 注入缝（数据集面）。
 *
 * 装置纪律：每个用例都在**本用例独立的临时库**上跑（`withTempDb` 给 `dbPath`），
 * 商品一律**按名称**定位，绝不写死主键；跨实例复用的只有「同一个临时库路径」。
 *
 * @prd FEAT-002
 * @prdVersion 2
 * @priority P0
 * @status active
 * @case TC-FEAT-002-01
 * @case TC-FEAT-002-02
 * @case TC-FEAT-002-03
 * @case TC-FEAT-002-04
 * @case TC-FEAT-002-05
 * @case TC-FEAT-002-06
 * @case TC-FEAT-002-07
 * @case TC-FEAT-002-56
 * @case TC-FEAT-002-E10
 * @case TC-FEAT-002-E11
 * @case TC-FEAT-002-E14
 * @case TC-FEAT-002-E15
 * @case TC-FEAT-002-E18
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { backup } from 'node:sqlite';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  addItem,
  data,
  dbOrderNoSeq,
  dbRows,
  dbSchemaVersion,
  dbTables,
  freePort,
  getCart,
  getOrders,
  isPortFree,
  listProducts,
  makeSeed,
  newClient,
  openDb,
  productAt,
  payload,
  productByName,
  registerOrFail,
  uniqueEmail,
  waitForTcp,
  withApp,
  withServerProcess,
  withTempDb,
} from './helpers/harness.mjs';

const PW = 'Pw-FEAT002-abcdefgh';

/** 账号会话：注册并返回 json。 */
const newAccount = (client, email) => registerOrFail(client, email, PW);

test('重启数据仍在（AC-01）', async () => {
  await withTempDb(async ({ dbPath }) => {
    const marker = {};
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const target = await productAt(client, 0);
      marker.name = target.name;
      marker.stockBefore = target.stock;
      await newAccount(client, uniqueEmail('ac01'));
      assert.equal((await addItem(client, target.id, 2)).status, 201);
      const ordered = await client.post('/api/v1/orders');
      assert.equal(ordered.status, 201, `下单必须 201：${ordered.raw.slice(0, 200)}`);
      const order = payload(ordered);
      marker.orderNo = order.orderNo;
      marker.totalCents = order.totalCents;
      // 下单后继续往车里放货，用来证明「购物车」也落了库。
      assert.equal((await addItem(client, target.id, 1)).status, 201);
      marker.cartQty = (await getCart(client)).quantityTotal;
      marker.stockAfter = (await productByName(client, target.name)).stock;
      marker.cookie = client.cookieHeader();
      assert.ok(marker.stockAfter < marker.stockBefore, '前置：下单必须真的扣了库存');
    });

    await withApp({ dbPath }, async (app) => {
      const revived = newClient(app, { cookie: marker.cookie });
      const orders = await getOrders(revived);
      assert.equal(orders.length, 1, '重启后订单条数必须仍是 1');
      assert.equal(orders[0].orderNo, marker.orderNo, '重启后订单号必须一致');
      assert.equal(orders[0].totalCents, marker.totalCents, '重启后订单金额必须一致');
      const cart = await getCart(revived);
      assert.equal(cart.quantityTotal, marker.cartQty, '重启后购物车件数必须一致');
      const stock = (await productByName(revived, marker.name)).stock;
      assert.equal(stock, marker.stockAfter, '重启后库存必须延续，而不是回到种子值');
      assert.notEqual(stock, marker.stockBefore, '库存不得被重置回种子初值');
    });
  });
});

test('隔离语义保留（AC-02）', async () => {
  await withTempDb(async ({ dbPath }) => {
    let orderNo;
    await withApp({ dbPath }, async (app) => {
      const a = newClient(app);
      const target = await productAt(a, 0);
      await newAccount(a, uniqueEmail('ac02a'));
      assert.equal((await addItem(a, target.id, 1)).status, 201);
      orderNo = payload(await a.post('/api/v1/orders')).orderNo;
    });

    await withApp({ dbPath }, async (app) => {
      const fresh = newClient(app);
      const cart = await getCart(fresh);
      assert.equal(cart.items.length, 0, '全新客户端（重启后）必须拿到空车');
      const orders = await fresh.get('/api/v1/orders');
      assert.equal(orders.status, 401, `未登录的订单列表必须 401：${orders.raw.slice(0, 160)}`);
      assert.equal(data(orders).code, 'UNAUTHENTICATED');

      const b = newClient(app);
      await getCart(b); // 下发 cookie 的匿名车
      const peek = await b.get(`/api/v1/orders/${orderNo}`);
      assert.equal(peek.status, 401, `仅持匿名 cookie 读他人订单必须 401：${peek.raw.slice(0, 160)}`);
      assert.equal(data(peek).code, 'UNAUTHENTICATED');
    });
  });
});

test('下单事务原子（AC-03）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const [first, second] = await listProducts(newClient(app));
      // 先把第二件商品的库存压到 3，再用一个「要 8 件」的车下单 ⇒ 必须在扣第一件之后失败。
      const drain = newClient(app);
      await newAccount(drain, uniqueEmail('ac03drain'));
      assert.equal((await addItem(drain, second.id, 5)).status, 201);
      assert.equal((await drain.post('/api/v1/orders')).status, 201);

      const buyer = newClient(app);
      await newAccount(buyer, uniqueEmail('ac03buyer'));
      assert.equal((await addItem(buyer, first.id, 1)).status, 201);
      assert.equal((await addItem(buyer, second.id, 8)).status, 201, '前置：车可含超过当前库存的件数，库存只在结算时校验');

      const before = {
        stock1: (await productByName(buyer, first.name)).stock,
        stock2: (await productByName(buyer, second.name)).stock,
        cart: (await getCart(buyer)).items.map((i) => `${i.productName}x${i.quantity}`),
        orders: (await getOrders(buyer)).length,
      };
      const res = await buyer.post('/api/v1/orders');
      assert.equal(res.status, 409, `库存不足必须 409，实际 ${res.status}：${res.raw.slice(0, 200)}`);
      assert.equal(data(res).code, 'INSUFFICIENT_STOCK');

      const after = {
        stock1: (await productByName(buyer, first.name)).stock,
        stock2: (await productByName(buyer, second.name)).stock,
        cart: (await getCart(buyer)).items.map((i) => `${i.productName}x${i.quantity}`),
        orders: (await getOrders(buyer)).length,
      };
      assert.deepStrictEqual(after, before, '下单失败必须整体回滚：库存、购物车、订单三者都不得有残留变化');
    });
  });
});

test('并发下单不超卖（AC-04）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const [forOne, forEight] = await listProducts(newClient(app));

      /** 构造「库存 = S，S+1 个账号各要 1 件并发下单」：S=1 与 S=8 两个构造各用一件独立商品。 */
      const raceAt = async (target, S) => {
        if (S < target.stock) {
          const drain = newClient(app);
          await newAccount(drain, uniqueEmail('ac04drain'));
          assert.equal((await addItem(drain, target.id, target.stock - S)).status, 201);
          assert.equal((await drain.post('/api/v1/orders')).status, 201);
          assert.equal(
            (await productByName(drain, target.name)).stock,
            S,
            `前置：库存必须被压到 ${S}`,
          );
        }
        const buyers = [];
        for (let i = 0; i < S + 1; i += 1) {
          const c = newClient(app);
          await newAccount(c, uniqueEmail('ac04buyer'));
          assert.equal((await addItem(c, target.id, 1)).status, 201);
          buyers.push(c);
        }
        const results = await Promise.all(buyers.map((c) => c.post('/api/v1/orders')));
        const codes = results.map((r) => r.status);
        const ok = codes.filter((s) => s === 201).length;
        const conflict = codes.filter((s) => s === 409).length;
        const stock = (await productByName(newClient(app), target.name)).stock;
        return { codes, ok, conflict, stock };
      };

      const one = await raceAt(forOne, 1);
      assert.equal(one.ok, 1, `S=1：只能成功 1 单，实际 ${one.ok}（状态码 ${one.codes.join(',')}）`);
      assert.equal(one.conflict, 1, `S=1：超出的一单必须 409，实际状态码 ${one.codes.join(',')}`);
      assert.equal(one.stock, 0, 'S=1：库存必须归零且不得为负');

      const eight = await raceAt(forEight, 8);
      assert.equal(eight.ok, 8, `S=8：必须恰好成功 8 单，实际 ${eight.ok}（状态码 ${eight.codes.join(',')}）`);
      assert.equal(eight.conflict, 1, `S=8：第 9 单必须 409，实际状态码 ${eight.codes.join(',')}`);
      assert.equal(eight.stock, 0, 'S=8：库存必须归零且不得为负');
    });
  });
});

test('落盘库可搬走（AC-05）', async () => {
  await withTempDb(async ({ dbPath, path }) => {
    const marker = {};
    const email = uniqueEmail('ac05');
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const target = await productAt(client, 0);
      await newAccount(client, email);
      assert.equal((await addItem(client, target.id, 3)).status, 201);
      const ordered = await client.post('/api/v1/orders');
      assert.equal(ordered.status, 201, `下单必须 201：${ordered.raw.slice(0, 160)}`);
      const order = payload(ordered);
      marker.orderNo = order.orderNo;
      marker.totalCents = order.totalCents;
      marker.stock = (await productByName(client, target.name)).stock;
      marker.name = target.name;
    });

    assert.ok(existsSync(dbPath), '实例必须在注入的 dbPath 上落盘');
    assert.ok(statSync(dbPath).size > 0, '落盘的库文件不得为空');
    const copy = path('moved.db');
    const src = openDb(dbPath);
    try {
      await backup(src, copy); // 一致的快照（WAL 下裸 cp 会漏数据）
    } finally {
      src.close();
    }

    await withApp({ dbPath: copy }, async (app) => {
      const client = newClient(app);
      const revived = await client.post('/api/v1/auth/login', { email, password: PW });
      assert.equal(revived.status, 200, `库拷走后必须仍能登录：${revived.raw.slice(0, 200)}`);
      const orders = await getOrders(client);
      assert.equal(orders.length, 1, '拷走的库里订单必须还在');
      assert.equal(orders[0].orderNo, marker.orderNo);
      assert.equal(orders[0].totalCents, marker.totalCents);
      assert.equal((await productByName(client, marker.name)).stock, marker.stock, '拷走的库里库存必须一致');
    });
  });
});

test('迁移播种幂等（AC-06）', async () => {
  await withTempDb(async ({ dbPath }) => {
    const counts = [];
    const versions = [];
    const names = [];
    for (let round = 0; round < 3; round += 1) {
      await withApp({ dbPath }, async (app) => {
        const items = await listProducts(newClient(app));
        counts.push(items.length);
        names.push(items.map((i) => i.name).sort().join('|'));
      });
      const db = openDb(dbPath);
      try {
        versions.push(dbSchemaVersion(db));
        assert.ok(dbTables(db).includes('schema_migrations'), '库内必须有 schema_migrations 表');
      } finally {
        db.close();
      }
    }
    assert.ok(counts[0] > 0, '首次迁移必须播种出商品');
    assert.deepStrictEqual(counts, [counts[0], counts[0], counts[0]], `重复启动不得重复播种，实际 ${counts.join(',')}`);
    assert.deepStrictEqual(names, [names[0], names[0], names[0]], '重复启动后商品名集合必须完全相同');
    assert.ok(versions.every((v) => Number.isInteger(v) && v >= 1), `迁移版本必须被记录，实际 ${versions.join(',')}`);
    assert.deepStrictEqual(versions, [versions[0], versions[0], versions[0]], '迁移版本必须单调收敛到最新，不得回退/漂移');
  });
});

test('注入缝与内存模式（AC-07）', async () => {
  const productionDb = join(REPO_ROOT, 'data', 'shop.db');
  const before = existsSync(productionDb) ? statSync(productionDb).mtimeMs : null;

  await withTempDb(async ({ dbPath }) => {
    // ① :memory: 形态：独立、功能完整、不落盘
    await withApp({ dbPath: ':memory:' }, async (app) => {
      const client = newClient(app);
      const target = await productAt(client, 0);
      await newAccount(client, uniqueEmail('ac07mem'));
      assert.equal((await addItem(client, target.id, 2)).status, 201);
      assert.equal((await client.post('/api/v1/orders')).status, 201);
      assert.equal((await getOrders(client)).length, 1);
    });

    // ② seed 注入形态：只校验字段合法性，条数任意
    await withApp({ seed: makeSeed(3), dbPath: ':memory:' }, async (app) => {
      const items = await listProducts(newClient(app));
      assert.equal(items.length, 3, '注入的长度为 3 的种子必须得到 3 件商品');
      assert.deepStrictEqual(
        items.map((i) => i.name),
        ['种子商品1', '种子商品2', '种子商品3'],
        '注入的种子必须原样可用',
      );
    });

    // ③ 两个注入实例互不共享：写进 A 的数据，B 看不见
    await withApp({ dbPath }, async (a) => {
      const target = await productAt(newClient(a), 0);
      assert.equal((await addItem(newClient(a), target.id, 1)).status, 201);
    });
    await withApp({ dbPath: ':memory:' }, async (b) => {
      const fresh = newClient(b);
      assert.equal((await getCart(fresh)).items.length, 0, '独立实例不得看到另一个实例写入的数据');
      assert.equal((await fresh.get('/api/v1/orders')).status, 401);
    });

    // ④ 生产库路径在测试期间不得被创建 / 修改
    const after = existsSync(productionDb) ? statSync(productionDb).mtimeMs : null;
    assert.strictEqual(after, before, `测试不得触碰生产库路径 ${productionDb}`);
  });
});

test('订单号重启不重号（AC-56）', async () => {
  await withTempDb(async ({ dbPath }) => {
    const clock = () => Date.parse('2026-10-15T08:30:00.000Z');
    const place = async (label) => {
      let out;
      await withApp({ dbPath, now: clock }, async (app) => {
        const client = newClient(app);
        const target = await productAt(client, 0);
        await newAccount(client, uniqueEmail(label));
        assert.equal((await addItem(client, target.id, 1)).status, 201);
        const res = await client.post('/api/v1/orders');
        assert.equal(res.status, 201, `下单必须 201：${res.raw.slice(0, 160)}`);
        out = payload(res).orderNo;
      });
      return out;
    };

    const first = await place('ac56a');
    const second = await place('ac56b');

    assert.match(first, /^SO-\d{8}-\d+$/, `订单号形态必须可解析日期与序号，实际 ${first}`);
    assert.match(second, /^SO-\d{8}-\d+$/, `订单号形态必须可解析日期与序号，实际 ${second}`);
    assert.notEqual(first, second, '同一天内跨重启的两单不得重号');
    const seqOf = (no) => Number(no.split('-')[2]);
    assert.ok(seqOf(second) > seqOf(first), `续号必须严格递增：${first} → ${second}`);

    const db = openDb(dbPath);
    try {
      const seq = dbOrderNoSeq(db);
      assert.ok(Array.isArray(seq) && seq.length >= 1, '库内必须有 order_no_seq 取号表');
      const today = seq.find((r) => String(r.day).replace(/-/g, '') === '20261015');
      assert.ok(today, `取号表必须按 UTC 日分桶（2026-10-15），实际 ${JSON.stringify(seq)}`);
      assert.equal(today.seq, 2, '跨重启续号：当日计数必须接着 1 继续到 2');
      const rows = dbRows(db, 'orders', 'id');
      assert.equal(rows.length, 2, '两单都必须落库');
      assert.equal(new Set(rows.map((r) => r.no)).size, 2, 'orders.no 不得重复');
      // 行为化的唯一约束判据：重复插入同一个单号必须报错（不是「索引存在」这种形态判据）
      const existing = rows[0];
      assert.throws(
        () => db.prepare('INSERT INTO orders (no) VALUES (?)').run(existing.no),
        /UNIQUE|constraint/i,
        'orders.no 必须具备唯一约束（重复插入必须失败）',
      );
    } finally {
      db.close();
    }
  });
});

test('重复提交下单（E-10）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const target = await productAt(client, 0);
      const stock0 = target.stock;
      await newAccount(client, uniqueEmail('e10'));
      assert.equal((await addItem(client, target.id, 2)).status, 201);

      const both = await Promise.all([client.post('/api/v1/orders'), client.post('/api/v1/orders')]);
      const oks = both.filter((r) => r.status === 201);
      const busies = both.filter((r) => r.status === 409);
      assert.equal(oks.length, 1, `同一辆车并发重复提交只能成功一次，实际状态码 ${both.map((r) => r.status).join(',')}`);
      assert.equal(busies.length, 1, '另一次必须 409');
      assert.equal(data(busies[0]).code, 'CART_EMPTY', '重复提交的空车必须报 CART_EMPTY');

      const third = await client.post('/api/v1/orders');
      assert.equal(third.status, 409, '已下单的车再次提交必须 409');
      assert.equal(data(third).code, 'CART_EMPTY');
      assert.equal((await getOrders(client)).length, 1, '重复提交不得造出第二张单');
      assert.equal((await productByName(client, target.name)).stock, stock0 - 2, '库存只能扣一次');
    });
  });
});

test('已登录空车下单（E-11）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      await newAccount(client, uniqueEmail('e11'));
      const res = await client.post('/api/v1/orders');
      assert.equal(res.status, 409, `空车下单必须 409，实际 ${res.status}：${res.raw.slice(0, 160)}`);
      assert.equal(data(res).code, 'CART_EMPTY');
      assert.equal((await getOrders(client)).length, 0, '失败的下单不得留下订单');
    });
  });
});

test('同会话并发下单（E-14）', async () => {
  await withTempDb(async ({ dbPath }) => {
    await withApp({ dbPath }, async (app) => {
      const client = newClient(app);
      const [a, b] = await listProducts(client);
      const before = { a: a.stock, b: b.stock };
      await newAccount(client, uniqueEmail('e14'));
      assert.equal((await addItem(client, a.id, 1)).status, 201);
      assert.equal((await addItem(client, b.id, 2)).status, 201);

      const results = await Promise.all([client.post('/api/v1/orders'), client.post('/api/v1/orders')]);
      const codes = results.map((r) => r.status);
      assert.ok(
        codes.every((s) => s === 201 || s === 409),
        `并发下单的结果只允许 201/409，实际 ${codes.join(',')}`,
      );
      assert.equal(codes.filter((s) => s === 201).length, 1, `同一个会话只能结算一次，实际 ${codes.join(',')}`);
      assert.equal(codes.filter((s) => s === 409).length, 1, `另一次必须 409，实际 ${codes.join(',')}`);
      const orders = await getOrders(client);
      assert.equal(orders.length, 1, '并发下单不得造出两张单');
      assert.equal((await productByName(client, a.name)).stock, before.a - 1, '第一件的扣减必须恰好一次');
      assert.equal((await productByName(client, b.name)).stock, before.b - 2, '第二件的扣减必须恰好一次');

      const db = openDb(dbPath);
      try {
        const seq = dbOrderNoSeq(db);
        assert.equal(seq[0].seq, 1, '并发下取号必须只取一次（不得空取号）');
      } finally {
        db.close();
      }
    });
  });
});

test('迁移中断可重入（E-15）', async () => {
  await withTempDb(async ({ dbPath }) => {
    // 构造「DDL 已落、版本未记」的半迁移态：只有 products 表、没有 schema_migrations、没有种子行。
    const db = openDb(dbPath);
    try {
      db.exec(
        'CREATE TABLE IF NOT EXISTS products (' +
          ' id TEXT PRIMARY KEY,' +
          ' name TEXT NOT NULL,' +
          " description TEXT NOT NULL DEFAULT ''," +
          ' price_cents INTEGER NOT NULL CHECK (price_cents >= 0),' +
          ' stock INTEGER NOT NULL CHECK (stock >= 0))',
      );
    } finally {
      db.close();
    }

    await withApp({ dbPath }, async (app) => {
      const items = await listProducts(newClient(app));
      assert.equal(items.length, 8, `半迁移态重启后必须补全到最新版本并播种 8 件，实际 ${items.length}`);
      assert.equal(new Set(items.map((i) => i.name)).size, 8, '补迁移不得产生重复商品行');
      const prods = await productByName(newClient(app), items[0].name);
      assert.ok(prods.priceCents > 0, '补迁移后的商品字段必须完整');
    });

    const after = openDb(dbPath);
    try {
      const version = dbSchemaVersion(after);
      assert.ok(Number.isInteger(version) && version >= 1, `半迁移态必须被补到有版本记录，实际 ${version}`);
    } finally {
      after.close();
    }

    // 再启动一次：不得重复播种（幂等）
    await withApp({ dbPath }, async (app) => {
      const items = await listProducts(newClient(app));
      assert.equal(items.length, 8, '补迁移后再启动不得重复播种');
    });
  });
});

test('版本超前拒启（E-18）', async () => {
  await withTempDb(async ({ dbPath }) => {
    // 前置①：先用被测实现迁移出一个真库
    await withApp({ dbPath }, async (app) => {
      await listProducts(newClient(app));
    });
    assert.ok(existsSync(dbPath), '前置未成立：实例没有在注入的 dbPath 上落库（迁移未实现）');

    // 前置②：把版本号抬到远超代码最新版本（按真实表结构复制其余列，避免猜 schema）
    const db = openDb(dbPath);
    try {
      assert.ok(dbTables(db).includes('schema_migrations'), '前置未成立：库内没有 schema_migrations 表');
      const cols = db
        .prepare("PRAGMA table_info('schema_migrations')")
        .all()
        .map((r) => ({ ...r }).name);
      const latest = db.prepare('SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
      assert.ok(latest, '前置未成立：schema_migrations 里没有版本记录');
      const row = { ...latest, version: 9999 };
      db.prepare(
        `INSERT INTO schema_migrations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ).run(...cols.map((c) => row[c]));
    } finally {
      db.close();
    }

    const port = await freePort();
    const port2 = await freePort();
    const env = {
      DB_PATH: dbPath,
      HOST: '127.0.0.1',
      PORT: String(port2),
      SESSION_SECRET: 'E18-session-secret-0123456789abcdef',
    };
    // 正向对照：同一套 env、正常库必须能起来 —— 否则「非零退出」分不清是版本超前还是环境问题
    await withServerProcess({ ...env, DB_PATH: ':memory:', PORT: String(port) }, async (proc) => {
      const up = await waitForTcp(port);
      assert.ok(up, `正向对照失败：正常库下服务必须在 ${port} 上监听（否则本用例的环境前提不成立）`);
      await proc.stop('SIGTERM', 4000);
    });

    await withServerProcess(env, async (proc) => {
      const result = await Promise.race([proc.exited, new Promise((r) => setTimeout(() => r(null), 8000))]);
      assert.ok(result !== null, '库版本超前时必须拒绝启动（进程不得继续常驻）');
      assert.notEqual(result.code, 0, `库版本超前必须非零退出，实际 code=${result.code} signal=${result.signal}`);
      const log = `${proc.stdout}${proc.stderr}`;
      assert.match(log, /版本/, `拒启日志必须点名「版本」问题，实际日志：${log.slice(-400)}`);
      assert.equal(await isPortFree(port2), true, '拒启后不得留下监听端口');
    });
  });
});
