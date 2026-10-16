/**
 * 应用工厂：把配置、库、路由、日志、限流装成一个可 `listen` 的实例。
 *
 * 设计取舍：
 *  ① **工厂是同步的**：配置与种子非法时在**构造期**就抛，而不是等到第一个请求。
 *     启动期失败能给出「哪个变量错了」的日志并非零退出；请求期失败只能给 500。
 *  ② **一个请求 = 一段同步处理**：路由处理里没有 `await`，因此单个实例内的并发请求
 *     天然串行 —— 下单的「查库存 / 扣库存 / 写单」在 SQLite 事务里不可能交错，
 *     这正是「不超卖」最省事的实现方式（不需要额外的行锁或重试）。
 *  ③ **请求体先读完再进路由**：`durationMs` 从收到请求头开始计，因此包含了慢客户端
 *     上传体的时间；慢请求标记才有意义（否则「服务端慢」和「客户端慢」分不开）。
 */
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadConfig } from './config.mjs';
import { LATEST_VERSION, migrateAndSeed, openDatabase } from './db.mjs';
import { createLogger } from './log.mjs';
import { cartView, createStore, orderView, userView } from './store.mjs';
import { defaultSeed, normalizeSeed } from './seed.mjs';
import { serveStatic } from './static.mjs';
import {
  ERROR_MESSAGES,
  cartCookie,
  clearedCookie,
  fail,
  json,
  notFoundText,
  ok,
  readCookie,
  sessionCookie,
  withSecurityHeaders,
} from './http.mjs';

const API_PREFIX = '/api/v1';
const MAX_LINE_QUANTITY = 8;
const MAX_CART_LINES = 8;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const PRODUCT_LIMIT_DEFAULT = 200;
const PRODUCT_LIMIT_MAX = 200;
const ORDER_LIMIT_DEFAULT = 20;
const ORDER_LIMIT_MAX = 100;
const SLOW_REQUEST_MS = 500;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCRYPT_KEYLEN = 64;
const SHUTDOWN_GRACE_MS = 10_000;

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const APP_VERSION = readVersion();

/** 业务异常：带封闭词表里的 `code`，由最外层统一转成错误响应。 */
class ApiError extends Error {
  constructor(code, messageKey = code) {
    super(`${code}:${messageKey}`);
    this.name = 'ApiError';
    this.code = code;
    this.messageKey = messageKey;
  }
}

function raise(code, messageKey = code) {
  throw new ApiError(code, messageKey);
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 口令派生：scrypt + 每用户独立随机盐。
 * 存的是「盐 + 派生值」，比对用等时比较，避免按字节提前返回的时序侧信道。
 */
function derivePassword(password, salt) {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

function verifyPassword(password, row) {
  const expected = Buffer.from(String(row.password_hash), 'hex');
  const actual = Buffer.from(derivePassword(password, String(row.password_salt)), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const pad2 = (value) => String(value).padStart(2, '0');
/** 订单号里的日期段固定按 UTC 取：同一秒在不同时区的机器上必须得到同一天。 */
function orderDay(at) {
  const date = new Date(at);
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
}

/** 固定窗口限流：窗口内计数超过上限即拒，并给出还要等多久。 */
function createRateLimiter({ windowMs, max, now }) {
  const hits = new Map();
  return {
    check(key) {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => at - stamp < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        const retryAfterMs = Math.max(1, windowMs - (at - recent[0]));
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      recent.push(at);
      hits.set(key, recent);
      return { allowed: true };
    },
  };
}

export function createApp(options = {}) {
  // 注入缝优先级：显式 `dbPath` > `config` 覆盖 > 环境变量 > 默认值。
  // 库路径必须先落到 config 上再读：否则注入的临时库被静默忽略，实例会去写生产库。
  const configOverrides = { ...(options.config ?? {}) };
  if (options.dbPath !== undefined) configOverrides.DB_PATH = options.dbPath;
  const config = loadConfig(configOverrides);
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  // 种子校验先于任何 I/O：坏种子不该留下半个库文件。
  const seedProvided = options.seed !== undefined;
  const products = seedProvided ? normalizeSeed(options.seed) : defaultSeed();

  let store = options.store;
  let db = store ? store.db : undefined;
  if (!store) {
    db = openDatabase(config.dbPath);
    try {
      migrateAndSeed(db, products, { now, authoritative: seedProvided });
    } catch (err) {
      db.close();
      throw err;
    }
    store = createStore({ db, now });
  }

  const logger = options.logger ?? createLogger({ stream: options.logStream, level: config.logLevel });
  const limiter = createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax, now });
  const startedAt = now();
  const cookieOptions = { secure: config.cookieSecure };

  // ── 身份 ──────────────────────────────────────────────────────────────────

  /** 只读的身份判定：不建车、不刷新会话，纯粹回答「这是谁」。 */
  function resolveActor(headers) {
    const at = now();
    const sid = readCookie(headers.cookie, 'sid');
    if (sid) {
      const session = store.findSession(hashToken(sid));
      if (session && session.expires_at > at && session.last_seen_at + SESSION_IDLE_MS > at) {
        const user = store.findUserById(session.user_id);
        if (user) {
          store.touchSession(session.token_hash, at);
          return { kind: 'user', user };
        }
      }
      if (session) store.deleteSession(session.token_hash);
    }
    const cartId = readCookie(headers.cookie, 'cartId');
    if (cartId) {
      const cart = store.findCartById(cartId);
      if (cart && cart.user_id === null) return { kind: 'anon', cart };
    }
    return { kind: 'none' };
  }

  /** 未登录时给一辆车；已登录时给用户的车（不存在则惰性建）。 */
  function cartFor(actor, at) {
    if (actor.kind === 'user') {
      const existing = store.findCartByUser(actor.user.id);
      return existing ?? store.insertCart({ userId: actor.user.id, createdAt: at });
    }
    if (actor.kind === 'anon') return actor.cart;
    return store.insertCart({ createdAt: at });
  }

  /** 需要「一定有一辆车」的面（购物车）用它：新车的 id 要随响应下发，否则客户端下次找不到。 */
  function actorWithCart(actor, at) {
    if (actor.kind === 'user') return { actor, cookies: [] };
    if (actor.kind === 'anon') return { actor, cookies: [] };
    const cart = store.insertCart({ createdAt: at });
    return { actor: { kind: 'anon', cart }, cookies: [cartCookie(cart.id, cookieOptions)] };
  }

  /** 响应头里的 cookie 段：没有 cookie 时不要塞一个空数组，避免出现空的 Set-Cookie 行。 */
  function cookieHeaders(cookies) {
    return cookies && cookies.length > 0 ? { 'set-cookie': cookies } : {};
  }

  function requireUser(actor) {
    if (actor.kind !== 'user') raise('UNAUTHENTICATED');
    return actor.user;
  }

  function issueSession(userId, at) {
    const token = randomBytes(32).toString('base64url');
    store.insertSession({
      tokenHash: hashToken(token),
      userId,
      createdAt: at,
      expiresAt: at + SESSION_TTL_MS,
    });
    return token;
  }

  // ── 请求体 ────────────────────────────────────────────────────────────────

  function readJsonBody(request) {
    const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('application/json')) raise('INVALID_BODY');
    const raw = request.body;
    if (!raw || raw.length === 0) raise('INVALID_BODY');
    let parsed;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      raise('INVALID_BODY');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) raise('INVALID_BODY');
    return parsed;
  }

  function parseQuantity(value) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < 1 || value > MAX_LINE_QUANTITY) return null;
    return value;
  }

  function parsePagination(query, { fallback, max }) {
    const read = (name, defaultValue) => {
      const raw = query.get(name);
      if (raw === null) return defaultValue;
      if (!/^\d+$/.test(raw.trim())) return null;
      return Number(raw.trim());
    };
    const limit = read('limit', fallback);
    const offset = read('offset', 0);
    if (limit === null || offset === null) raise('INVALID_PAGINATION');
    if (limit < 1 || limit > max || offset < 0) raise('INVALID_PAGINATION');
    return { limit, offset };
  }

  // ── 路由 ──────────────────────────────────────────────────────────────────

  function routeProducts(request) {
    const { limit, offset } = parsePagination(request.query, {
      fallback: PRODUCT_LIMIT_DEFAULT,
      max: PRODUCT_LIMIT_MAX,
    });
    return ok(store.listProducts(limit, offset));
  }

  function routeProductDetail(request, id) {
    const product = store.getProduct(id);
    if (!product) raise('NOT_FOUND', 'PRODUCT_NOT_FOUND');
    return ok(product);
  }

  function routeRegister(request) {
    const body = readJsonBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) raise('INVALID_BODY');
    const password = body.password;
    if (
      typeof password !== 'string' ||
      password.length < PASSWORD_MIN_LENGTH ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      raise('INVALID_BODY');
    }
    if (store.findUserByEmail(email)) raise('EMAIL_TAKEN');

    const salt = randomBytes(16).toString('hex');
    const user = store.insertUser({
      id: randomUUID(),
      email,
      passwordHash: derivePassword(password, salt),
      passwordSalt: salt,
      createdAt: request.at,
    });
    const token = issueSession(user.id, request.at);
    return ok(
      { user: userView(user) },
      { status: 201, headers: { 'set-cookie': [sessionCookie(token, SESSION_TTL_SECONDS, cookieOptions)] } },
    );
  }

  function routeLogin(request) {
    const body = readJsonBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const row = email ? store.findUserByEmail(email) : undefined;
    // 口令错与邮箱不存在返回逐字相同的响应：否则这个端点就成了账号枚举器。
    if (!row || !password || !verifyPassword(password, row)) raise('INVALID_CREDENTIALS');

    const existing = request.actor.kind === 'anon' ? request.actor.cart : undefined;
    const userCartId = store.withTx(() => {
      const cart = cartFor(request.actor.kind === 'user' ? request.actor : { kind: 'user', user: row }, request.at);
      if (existing && existing.id !== cart.id) {
        const anonymousRows = store.cartItems(existing.id);
        const merged = anonymousRows.map((line) => {
          const current = store.cartRow(cart.id, line.product_id);
          const quantity = (current ? current.quantity : 0) + line.quantity;
          if (quantity > MAX_LINE_QUANTITY) raise('QUANTITY_LIMIT_EXCEEDED');
          return { productId: line.product_id, quantity };
        });
        for (const line of merged) {
          store.putCartItem({
            cartId: cart.id,
            productId: line.productId,
            quantity: line.quantity,
            addedAt: request.at,
          });
        }
        // 匿名车整体作废：旧 cartId 不再可寻址，客户端不会把已并入的行再加一次。
        store.deleteCart(existing.id);
      }
      return cart.id;
    });

    const token = issueSession(row.id, request.at);
    return ok(
      { user: userView(row) },
      {
        status: 200,
        headers: {
          'set-cookie': [
            sessionCookie(token, SESSION_TTL_SECONDS, cookieOptions),
            cartCookie(userCartId, cookieOptions),
          ],
        },
      },
    );
  }

  function routeLogout(request) {
    const sid = readCookie(request.headers.cookie, 'sid');
    if (sid) store.deleteSession(hashToken(sid));
    return ok(
      { ok: true },
      {
        headers: {
          // 连 cartId 一起清：账号车是服务端按用户寻址的，旧匿名标识留着只会指向已作废的车。
          'set-cookie': [
            clearedCookie('sid', cookieOptions),
            clearedCookie('cartId', cookieOptions),
          ],
        },
      },
    );
  }

  function routeMe(request) {
    return ok({ user: userView(requireUser(request.actor)) });
  }

  function routeGetCart(request) {
    const cart = cartFor(request.actor, request.at);
    return ok(cartView(cart, store.cartItems(cart.id)), { headers: cookieHeaders(request.cookies) });
  }

  function routeAddCartItem(request) {
    const body = readJsonBody(request);
    if (typeof body.productId !== 'string' || body.productId.trim() === '') raise('INVALID_BODY');
    if (!('quantity' in body)) raise('INVALID_BODY');
    const quantity = parseQuantity(body.quantity);
    if (quantity === null) raise('INVALID_QUANTITY');

    const product = store.getProduct(body.productId);
    if (!product) raise('NOT_FOUND', 'PRODUCT_NOT_FOUND');
    if (product.stock === 0) raise('OUT_OF_STOCK');

    const cart = cartFor(request.actor, request.at);
    const existing = store.cartRow(cart.id, product.id);
    const next = (existing ? existing.quantity : 0) + quantity;
    if (next > MAX_LINE_QUANTITY) raise('QUANTITY_LIMIT_EXCEEDED');
    if (!existing && store.countCartItems(cart.id) >= MAX_CART_LINES) raise('CART_FULL');

    store.putCartItem({ cartId: cart.id, productId: product.id, quantity: next, addedAt: request.at });
    return ok(cartView(cart, store.cartItems(cart.id)), { status: 201, headers: cookieHeaders(request.cookies) });
  }

  function routePatchCartItem(request, productId) {
    const body = readJsonBody(request);
    if (!('quantity' in body)) raise('INVALID_BODY');
    const quantity = parseQuantity(body.quantity);
    if (quantity === null) raise('INVALID_QUANTITY');

    const cart = cartFor(request.actor, request.at);
    const existing = store.cartRow(cart.id, productId);
    if (!existing) raise('NOT_FOUND', 'CART_ROW_NOT_FOUND');
    const product = store.getProduct(productId);
    if (!product) raise('NOT_FOUND', 'CART_ROW_NOT_FOUND');
    // 缺货判定只看「当前是否无货」：件数与库存的差额留到下单时按真实库存裁决，
    // 这样「库里只剩 1 件但我先放 5 件进车」不会在加购这一步就被拒。
    if (product.stock === 0) raise('OUT_OF_STOCK');

    store.putCartItem({ cartId: cart.id, productId, quantity, addedAt: existing.added_at });
    return ok(cartView(cart, store.cartItems(cart.id)), { headers: cookieHeaders(request.cookies) });
  }

  function routeDeleteCartItem(request, productId) {
    const cart = cartFor(request.actor, request.at);
    const existing = store.cartRow(cart.id, productId);
    if (!existing) raise('NOT_FOUND', 'CART_ROW_NOT_FOUND');
    store.deleteCartItem(cart.id, productId);
    return ok(cartView(cart, store.cartItems(cart.id)), { headers: cookieHeaders(request.cookies) });
  }

  function routeCreateOrder(request) {
    const user = requireUser(request.actor);
    const cart = cartFor(request.actor, request.at);
    const lines = store.cartItems(cart.id);
    if (lines.length === 0) raise('CART_EMPTY');

    const items = lines.map((line) => ({
      productId: line.product_id,
      productName: line.product_name,
      unitPriceCents: line.unit_price_cents,
      quantity: line.quantity,
      lineTotalCents: line.unit_price_cents * line.quantity,
    }));

    const orderId = store.withTx(() => {
      for (const item of items) {
        // 条件扣减：`changes === 0` 即库存不足。抛出去让整笔事务回滚，
        // 前面的扣减必须一起撤销 —— 否则会留下「扣了库存却没出单」的脏状态。
        if (store.decrementStock(item.productId, item.quantity) === 0) raise('INSUFFICIENT_STOCK');
      }
      const seq = store.nextOrderSeq(orderDay(request.at));
      const id = store.insertOrder({
        no: `SO-${orderDay(request.at)}-${seq}`,
        userId: user.id,
        status: 'paid',
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
        createdAt: request.at,
        paidAt: request.at,
        items,
      });
      for (const item of items) store.deleteCartItem(cart.id, item.productId);
      return id;
    });

    const order = store.findOrderById(orderId);
    return ok(orderView(order, store.orderItems(orderId)), { status: 201 });
  }

  function routeListOrders(request) {
    const user = requireUser(request.actor);
    const { limit, offset } = parsePagination(request.query, {
      fallback: ORDER_LIMIT_DEFAULT,
      max: ORDER_LIMIT_MAX,
    });
    const orders = store
      .listOrdersByUser(user.id, limit, offset)
      .map((order) => orderView(order, store.orderItems(order.id)));
    return ok(orders);
  }

  function routeOrderDetail(request, orderNo) {
    const user = requireUser(request.actor);
    const order = store.findOrderByNo(orderNo);
    // 他人订单一律 404 且与「不存在」逐字同形：不暴露订单号是否存在。
    if (!order || order.user_id !== user.id) raise('NOT_FOUND', 'ORDER_NOT_FOUND');
    return ok(orderView(order, store.orderItems(order.id)));
  }

  function routeHealth() {
    let dbOk = true;
    try {
      // 探针要探「迁移表还在不在」：只 `SELECT 1` 连不存在的库都能返回，
      // 库文件被搬走 / 表被删这类故障就探不出来。
      store.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
    } catch {
      dbOk = false;
    }
    return ok(
      {
        status: dbOk ? 'ok' : 'degraded',
        uptimeMs: Math.max(0, now() - startedAt),
        version: APP_VERSION,
        db: { ok: dbOk },
      },
      { status: dbOk ? 200 : 503 },
    );
  }

  function sessionKey(headers) {
    const sid = readCookie(headers.cookie, 'sid');
    if (sid) return `sid:${sid}`;
    const cartId = readCookie(headers.cookie, 'cartId');
    if (cartId) return `cart:${cartId}`;
    return 'anon';
  }

  function dispatchApi(request) {
    const rest = request.pathname.slice(API_PREFIX.length);
    const segments = rest.split('/').filter((part) => part !== '');
    const method = request.method;
    const head = segments[0];
    const second = segments[1];
    const third = segments[2];

    const isWrite = method !== 'GET' && method !== 'HEAD';
    if (isWrite) {
      const verdict = limiter.check(sessionKey(request.headers));
      if (!verdict.allowed) {
        return json(
          429,
          { code: 'RATE_LIMITED', message: ERROR_MESSAGES.RATE_LIMITED },
          { 'retry-after': String(verdict.retryAfterSeconds) },
        );
      }
    }

    let actor = resolveActor(request.headers);
    if (method === 'GET' && head === 'cart' && segments.length === 1) {
      const withCart = actorWithCart(actor, request.at);
      actor = withCart.actor;
      request = { ...request, actor, cookies: withCart.cookies };
      return routeGetCart(request);
    }
    if (isWrite) {
      const withCart = actorWithCart(actor, request.at);
      actor = withCart.actor;
      request = { ...request, actor, cookies: withCart.cookies };
    } else {
      request = { ...request, actor, cookies: [] };
    }

    if (method === 'GET' && head === 'products' && segments.length === 1) return routeProducts(request);
    if (method === 'GET' && head === 'products' && segments.length === 2) return routeProductDetail(request, second);

    if (head === 'auth') {
      if (method === 'POST' && second === 'register' && segments.length === 2) return routeRegister(request);
      if (method === 'POST' && second === 'login' && segments.length === 2) return routeLogin(request);
      if (method === 'POST' && second === 'logout' && segments.length === 2) return routeLogout(request);
      if (method === 'GET' && second === 'me' && segments.length === 2) return routeMe(request);
    }

    if (head === 'cart') {
      if (method === 'POST' && second === 'items' && segments.length === 2) return routeAddCartItem(request);
      if (segments.length === 3 && second === 'items') {
        if (method === 'PATCH') return routePatchCartItem(request, third);
        if (method === 'DELETE') return routeDeleteCartItem(request, third);
      }
    }

    if (head === 'orders') {
      if (method === 'POST' && segments.length === 1) return routeCreateOrder(request);
      if (method === 'GET' && segments.length === 1) return routeListOrders(request);
      if (method === 'GET' && segments.length === 2) return routeOrderDetail(request, second);
    }

    return fail('NOT_FOUND');
  }

  function dispatch(request) {
    const url = request.url ?? request.pathname ?? '/';
    let pathname = url;
    let search = '';
    try {
      const parsed = new URL(url, 'http://localhost');
      pathname = parsed.pathname;
      search = parsed.search;
    } catch {
      pathname = '/';
    }
    const finalize = (response) => ({ ...response, headers: withSecurityHeaders(response.headers ?? {}) });
    const query = new URLSearchParams(search);
    const at = typeof request.at === 'number' ? request.at : now();
    const headers = request.headers ?? {};
    const body =
      request.body === undefined || request.body === null
        ? Buffer.alloc(0)
        : Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.from(String(request.body), 'utf8');

    try {
      if (pathname === '/health') return finalize(routeHealth());
      const isApi = pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
      if (!isApi) {
        let products_ = [];
        try {
          products_ = store.listProducts(PRODUCT_LIMIT_MAX, 0);
        } catch {
          // 静态面宁可少一块内容也不许 5xx：目录读不出来就给空列表。
          products_ = [];
        }
        return finalize(serveStatic(pathname, { products: products_, search, headers }) ?? notFoundText());
      }
      return finalize(dispatchApi({
        method: (request.method ?? 'GET').toUpperCase(),
        pathname,
        query,
        headers,
        body,
        at,
        actor: { kind: 'none' },
        cookies: [],
      }));
    } catch (err) {
      if (err instanceof ApiError) return fail(err.code, err.messageKey);
      logger.error({
        requestId: request.requestId,
        level: 'error',
        outcome: 'internal_error',
        message: err && err.message ? String(err.message) : String(err),
        stack: err && err.stack ? String(err.stack) : undefined,
      });
      return fail('INTERNAL_ERROR');
    }
  }

  // ── 传输 ──────────────────────────────────────────────────────────────────

  function writeResponse(res, response, { head = false } = {}) {
    res.statusCode = response.status;
    // 安全头在**写出这一处**统一叠：静态面、健康检查、4xx/5xx 都不可能漏掉。
    for (const [name, value] of Object.entries(withSecurityHeaders(response.headers ?? {}))) {
      if (value === undefined) continue;
      res.setHeader(name, value);
    }
    const body = response.body ?? '';
    if (response.status === 304 || response.status === 204 || head) {
      res.removeHeader('content-length');
      res.end();
      return;
    }
    // 静态面里既有文本（HTML/JS/CSS）也有**二进制**（jpg 照片）：Buffer 原样送出，
    // 其余按 utf8 编码。绝不能对照片做一次 utf8 往返 —— 非法字节会被换成 U+FFFD，
    // 线上字节与盘上不再逐字节相等（裂图），且 content-length 会跟着膨胀。
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    res.setHeader('content-length', String(buffer.length));
    res.end(buffer);
  }

  const server = createServer((req, res) => {
    const startedNs = process.hrtime.bigint();
    const requestId = randomUUID();
    const method = (req.method ?? 'GET').toUpperCase();
    const url = req.url ?? '/';
    let pathname = url;
    try {
      pathname = new URL(url, 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }

    let settled = false;
    const chunks = [];
    let received = 0;

    const logLine = (status, level, extra = {}) => {
      const durationMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
      logger[level]({
        requestId,
        method,
        path: pathname,
        status,
        durationMs: Math.round(durationMs * 100) / 100,
        ...(durationMs >= SLOW_REQUEST_MS ? { slow: true } : {}),
        ...extra,
      });
    };

    const respond = (response) => {
      if (settled) return;
      settled = true;
      writeResponse(res, response, { head: method === 'HEAD' });
      if (response.status >= 500) logLine(response.status, 'error');
      else logLine(response.status, 'info');
    };

    // 客户端中断：写不回响应，也不该算服务端故障 —— 只记 warn + outcome，保证错误率指标不失真。
    const abort = () => {
      if (settled) return;
      settled = true;
      const durationMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
      logger.warn({
        requestId,
        method,
        path: pathname,
        status: 0,
        durationMs: Math.round(durationMs * 100) / 100,
        outcome: 'client_aborted',
      });
    };

    req.on('data', (chunk) => {
      if (settled) return;
      received += chunk.length;
      if (received > config.bodyLimitBytes) {
        chunks.length = 0;
        respond(fail('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      respond(
        dispatch({
          method,
          url,
          headers: req.headers,
          body: Buffer.concat(chunks),
          at: now(),
          requestId,
        }),
      );
    });

    req.on('aborted', abort);
    req.on('error', (err) => {
      const code = err && err.code;
      if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED') {
        abort();
        return;
      }
      if (!settled) {
        settled = true;
        logger.error({ requestId, method, path: pathname, status: 500, outcome: 'socket_error', message: String(err && err.message) });
        writeResponse(res, fail('INTERNAL_ERROR'), { head: method === 'HEAD' });
      }
    });
    res.on('close', () => {
      if (!res.writableEnded) abort();
    });
  });

  /** 进程内直调缝：把「一次请求」表达成一个纯函数，供探针与单测绕过 socket。 */
  async function fetch(url, init = {}) {
    const target = typeof url === 'string' ? url : url && url.url;
    const response = dispatch({
      method: (init.method ?? (typeof url === 'object' && url.method) ?? 'GET').toUpperCase(),
      url: target,
      headers: init.headers ?? (typeof url === 'object' ? url.headers : undefined) ?? {},
      body: init.body,
      at: now(),
      requestId: randomUUID(),
    });
    return {
      status: response.status,
      headers: new Map(Object.entries(withSecurityHeaders(response.headers ?? {}))),
      async text() {
        const body = response.body ?? '';
        return Buffer.isBuffer(body) ? body.toString('utf8') : body;
      },
      async json() {
        const body = response.body ?? 'null';
        return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : body);
      },
      async arrayBuffer() {
        // 照片是二进制：这条缝也要能原样取字节（文本面按 utf8 编码成字节）。
        const body = response.body ?? '';
        const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  }

  async function close() {
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
      server.close(() => resolve());
    });
    if (db && typeof db.close === 'function') db.close();
  }

  /** 停机流程：停止接新连接 → 等在途请求排空 → 关库；超时则强退（非 0）。 */
  async function shutdown(signal) {
    logger.info({ level: 'info', outcome: 'shutdown', signal, message: `收到 ${signal}，开始停机` });
    const force = setTimeout(() => {
      logger.warn({ level: 'warn', outcome: 'shutdown_timeout', signal, message: '在途请求超时，强制退出' });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref?.();
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
    clearTimeout(force);
    if (db && typeof db.close === 'function') {
      try {
        db.close();
      } catch {
        // 停机路径上的关库失败不值得再抛：进程已经在退出。
      }
    }
    logger.info({ level: 'info', outcome: 'shutdown_complete', signal, message: '停机完成' });
  }

  return {
    server,
    handle: server,
    db,
    dbPath: config.dbPath,
    store,
    config,
    version: APP_VERSION,
    schemaVersion: LATEST_VERSION,
    dispatch,
    fetch,
    shutdown,
    close,
  };
}
