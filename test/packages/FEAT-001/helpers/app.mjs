/**
 * 验收测试装置：把「可注入的应用工厂」包装成「随机端口的真 HTTP 取样客户端」。
 *
 * 为什么要这一层：判据要求真 HTTP 取样（同端口、cookie 回带、状态码），
 * 但绝不允许占用常驻端口 3000 —— 故一律 listen(0) 由内核分配端口，
 * 用完即关，实例之间不共享任何内存态。
 *
 * 为什么用动态 import：入口尚未落盘时，希望每条用例各自红在「入口不存在」，
 * 而不是整个文件在加载期整体崩掉 —— 前者能给出逐条归因，后者不能。
 */
import { request } from 'node:http';
import assert from 'node:assert/strict';

const APP_ENTRY = new URL('../../../../server/src/app.mjs', import.meta.url);

let cached;

/** 取应用工厂 createApp（进程内只解析一次）。 */
export function loadCreateApp() {
  if (!cached) {
    cached = import(APP_ENTRY.href).then((mod) => {
      if (typeof mod.createApp !== 'function') {
        const exported = Object.keys(mod).join(', ') || '（无导出）';
        throw new Error(`应用工厂入口没有导出 createApp，实际导出：${exported}`);
      }
      return mod.createApp;
    });
  }
  return cached;
}

/**
 * 从 handle 里取出可 listen 的 server。
 * 契约允许两种形状：handle 自身可 listen，或 handle.server 可 listen。
 */
function resolveServer(handle) {
  if (handle && typeof handle.listen === 'function') return handle;
  if (handle && handle.server && typeof handle.server.listen === 'function') return handle.server;
  const kind = handle === null ? 'null' : typeof handle;
  throw new Error(
    `createApp 的返回值（${kind}）既不可 listen，也不含可 listen 的 server —— 无法做真 HTTP 取样`,
  );
}

/** 起一个实例：listen(0) → 随机端口；close() 彻底关闭。 */
export async function startApp(options) {
  const createApp = await loadCreateApp();
  const handle = await (options === undefined ? createApp() : createApp(options));
  const server = resolveServer(handle);
  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : null;
  if (!port) throw new Error('实例已监听但取不到端口号，无法取样');
  if (port === 3000) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('实例监听在了常驻端口 3000 —— 测试禁止占用该端口');
  }
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        // 客户端保持长连接时 server.close() 会一直等到空闲连接超时；
        // 取样已全部结束，直接掐掉空闲连接，避免用例在收尾处假挂起。
        if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
        server.close(() => resolve());
      }),
  };
}

/** 建实例 → 跑一段 → 无论成败都关掉。 */
export async function withApp(options, fn) {
  const app = await startApp(options);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

function normalizeResponse(res, chunks, remotePort) {
  const raw = Buffer.concat(chunks).toString('utf8');
  let json;
  try {
    json = raw === '' ? undefined : JSON.parse(raw);
  } catch {
    json = undefined;
  }
  return { status: res.statusCode, headers: res.headers, raw, json, remotePort };
}

/**
 * 一个「自持 cookie」的客户端：显式 cookie jar（收 Set-Cookie → 回带 Cookie），
 * 不依赖浏览器存储，因此桌面与真机行为一致。
 */
export function newClient(app, { cookie: initialCookie = '' } = {}) {
  let cookie = initialCookie;

  async function send(method, path, opts = {}) {
    const { body, rawBody, contentType, headers = {}, useJar = true } = opts;
    const finalHeaders = { accept: 'application/json', ...headers };
    if (useJar && cookie) finalHeaders.cookie = cookie;
    let payload;
    if (rawBody !== undefined) payload = rawBody;
    else if (body !== undefined) payload = JSON.stringify(body);
    // 写操作一律带 JSON 请求头（含无请求体的下单），与契约的客户端约定一致；
    // 显式传 contentType: null 时才真的不带 —— 载荷校验用例需要这个反向形态。
    const isWrite = ['POST', 'PUT', 'PATCH'].includes(method);
    if ((payload !== undefined || isWrite) && contentType !== null) {
      finalHeaders['content-type'] = contentType ?? 'application/json';
    }
    const res = await new Promise((resolve, reject) => {
      const req = request(
        // agent: false ⇒ 每个请求一条短连接，取样完即释放，收尾不留长连接。
        { host: '127.0.0.1', port: app.port, method, path, headers: finalHeaders, agent: false },
        (response) => {
          const remotePort = response.socket ? response.socket.remotePort : undefined;
          const chunks = [];
          response.on('data', (c) => chunks.push(c));
          response.on('end', () => resolve(normalizeResponse(response, chunks, remotePort)));
        },
      );
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      for (const line of Array.isArray(setCookie) ? setCookie : [setCookie]) {
        const m = /(?:^|;\s*)cartId=([^;]*)/.exec(line);
        if (m) cookie = `cartId=${m[1]}`;
      }
    }
    return res;
  }

  return {
    get cookie() {
      return cookie;
    },
    get: (path, opts) => send('GET', path, opts),
    post: (path, body, opts) => send('POST', path, { ...opts, body }),
    patch: (path, body, opts) => send('PATCH', path, { ...opts, body }),
    del: (path, opts) => send('DELETE', path, opts),
    send,
  };
}

/** 从成功响应里取 data 载荷；形状不对时给出可定位的报错。 */
export function data(res) {
  if (!res.json || typeof res.json !== 'object') {
    throw new Error(`期望 JSON 响应体，实际 HTTP ${res.status}：${res.raw.slice(0, 200)}`);
  }
  if (!('data' in res.json)) {
    throw new Error(`成功响应缺少 data 包裹，实际字段：${Object.keys(res.json).join(', ')}`);
  }
  return res.json.data;
}

/** 按字段值定位集合成员；定位不到即报错（禁止把主键写进判据）。 */
export function findBy(items, key, value) {
  if (!Array.isArray(items)) throw new Error(`期望数组，实际 ${typeof items}`);
  const hit = items.find((item) => item && item[key] === value);
  if (!hit) {
    const seen = items.map((item) => JSON.stringify(item?.[key])).join(' / ');
    throw new Error(`在响应里按 ${key}=${JSON.stringify(value)} 定位不到目标；实有：${seen}`);
  }
  return hit;
}

/** 按商品名称定位（判据一律按名称，不依赖夹具主键）。 */
export function findByName(items, name) {
  return findBy(items, 'name', name);
}

/**
 * 取商品目录。默认要求「200 + 数组 + 非空」：后续一律按名称定位，目录读不出来时
 * 红因要落在这一句可读的前置断言上，而不是让调用方在 `items[0].id` 上抛 TypeError。
 * 注入空种子的用例（条数校验）显式传 `{ allowEmpty: true }`。
 */
export async function listProducts(client, { allowEmpty = false } = {}) {
  const res = await client.get('/api/v1/products');
  assert.equal(
    res.status,
    200,
    `GET /api/v1/products 期望 200，实际 ${res.status}：${res.raw.slice(0, 160)}`,
  );
  const items = data(res);
  assert.equal(Array.isArray(items), true, `商品列表期望数组，实际 ${typeof items}`);
  if (!allowEmpty) {
    assert.ok(
      items.length > 0,
      '商品列表为空：后续按名称定位商品无从进行（本用例若就是注入空种子，请显式传 { allowEmpty: true }）',
    );
  }
  return { res, items };
}

/** 用「名称」在商品列表里解析出 id —— 需要拼路径时的唯一合法渠道。 */
export async function resolveIdByName(client, name) {
  const { items } = await listProducts(client);
  return findByName(items, name).id;
}

export async function getCart(client) {
  const res = await client.get('/api/v1/cart');
  assert.equal(
    res.status,
    200,
    `GET /api/v1/cart 期望 200，实际 ${res.status}：${res.raw.slice(0, 160)}`,
  );
  return { res, cart: data(res) };
}

export async function getOrders(client) {
  const res = await client.get('/api/v1/orders');
  assert.equal(
    res.status,
    200,
    `GET /api/v1/orders 期望 200，实际 ${res.status}：${res.raw.slice(0, 160)}`,
  );
  const orders = data(res);
  assert.equal(Array.isArray(orders), true, `订单列表期望数组，实际 ${typeof orders}`);
  return { res, orders };
}

/** 构造注入用的独立种子（条数与字段值都由用例给定）。 */
export function makeSeed(count, { stock = 8, priceCents = 1000, namePrefix = '注入商品' } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      id: `${namePrefix === '注入商品' ? 'inj' : 'seed'}-${String(n).padStart(3, '0')}`,
      name: `${namePrefix} ${String(n).padStart(2, '0')}`,
      description: `${namePrefix}的描述文本 ${n}`,
      priceCents: priceCents + i,
      stock,
    };
  });
}

/** 把注入种子里第 n 件（1 起）按名称解析出 id。 */
export async function resolveInjectedId(client, namePrefix, n) {
  const name = `${namePrefix} ${String(n).padStart(2, '0')}`;
  return resolveIdByName(client, name);
}

export const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
export const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;
export const sumBy = (items, key) => items.reduce((acc, item) => acc + item[key], 0);

/** 千分位无关的「响应体不含内部实现特征」判定。 */
export const INTERNAL_LEAK_PATTERNS = [
  /"(stack|errno|syscall|code)?"\s*:\s*"[^"]*at\s+\/.*:\d+:\d+/,
  /\bat\s+\/[^\s"]+:\d+:\d+/,
  /\bstack\b/i,
  /\berrno\b/i,
  /\/Users\//,
  /\bserver\/src\b/,
  /\bnode_modules\b/,
];
