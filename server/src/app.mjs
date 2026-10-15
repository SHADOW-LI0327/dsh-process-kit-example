/**
 * 应用工厂：`createApp(options)` → 一个**可被监听**、也可**直接注入请求**的实例。
 *
 * 为什么必须是工厂而不是单例：无货商品、9 行以上购物车、注入非法字段、重建即重置
 * 这几条边界，只有在「能注入种子 + 能隔离存储 + 能起第二个实例」的前提下才构造得出来。
 *
 * 为什么路由是同步的 `dispatch`：下单要读库存、扣库存、清车、写订单四件事，
 * 中间一旦让出事件循环，两个并发下单就可能双双通过库存校验（超卖）。
 * 把「读 body」留在 socket 适配层、让 dispatch 全程同步，这段临界区天然不可分割。
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { defaultSeed, normalizeSeed } from './seed.mjs';
import {
  cartView,
  createCart,
  createStore,
  findProduct,
  getCart,
  nextOrderNo,
  ordersOf,
  rowView,
} from './store.mjs';
import { cartCookie, fail, notFoundJson, ok, readCookie } from './http.mjs';
import { serveStatic } from './static.mjs';

const API_PREFIX = '/api/v1';
const MAX_LINE_QUANTITY = 8;
const MAX_CART_LINES = 8;

function parseJsonBody(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** 件数校验：必须是 [1, 8] 的整数。字符串 / 小数 / 越界都归 INVALID_QUANTITY。 */
function isValidQuantity(quantity) {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_LINE_QUANTITY;
}

/**
 * 写请求的媒体类型白名单：只认 `application/json`（`; charset=…` 之类的参数照收）。
 * 不能只靠「JSON.parse 能过」当判据 —— 缺头时任何文本都会被当 JSON 试一遍并放行。
 */
function isJsonContentType(value) {
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== 'string') return false;
  return header.split(';')[0].trim().toLowerCase() === 'application/json';
}

/**
 * 解路径参数：畸形百分号编码（如 `%E0%A4%A`）会让 decodeURIComponent 抛出 URIError。
 * 解不出来就按「没有这个资源」处理（原样返回 ⇒ 查不到 ⇒ 404），而不是打死进程。
 */
function decodePathParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createApp(options = {}) {
  const products = options.seed === undefined ? defaultSeed() : normalizeSeed(options.seed);
  const store = createStore(products, options.store);

  /** 取当前请求的购物车；cookie 缺失 / 畸形 / 已失效一律当作新客户端，另发一辆车。 */
  function resolveCart(headers) {
    const cookieId = readCookie(headers.cookie, 'cartId');
    const existing = getCart(store, cookieId);
    if (existing) return { cart: existing, headers: {} };
    const cart = createCart(store, randomUUID());
    return { cart, headers: { 'set-cookie': cartCookie(cart.cartId) } };
  }

  function listProducts() {
    return ok(store.products);
  }

  function productDetail(id) {
    const product = findProduct(store, id);
    return product ? ok(product) : fail('NOT_FOUND');
  }

  function getCartResponse(headers) {
    const { cart, headers: cookieHeaders } = resolveCart(headers);
    return ok(cartView(cart), { headers: cookieHeaders });
  }

  function addCartItem(request) {
    const parsed = parseJsonBody(request.body);
    if (!parsed.ok) return fail('INVALID_BODY');
    const { productId, quantity } = parsed.value;
    if (typeof productId !== 'string' || productId.trim() === '') return fail('INVALID_BODY');
    if (quantity === undefined) return fail('INVALID_BODY');
    if (!isValidQuantity(quantity)) return fail('INVALID_QUANTITY');

    const product = findProduct(store, productId);
    if (!product) return fail('NOT_FOUND');
    if (product.stock === 0) return fail('OUT_OF_STOCK');

    const { cart, headers: cookieHeaders } = resolveCart(request.headers);
    const row = cart.items.find((item) => item.productId === productId);
    // 入参本身越量程（上面）与「累加后越上限」（这里）是两条路径，不能用同一个码。
    if (row) {
      if (row.quantity + quantity > MAX_LINE_QUANTITY) return fail('QUANTITY_LIMIT_EXCEEDED');
      row.quantity += quantity;
    } else {
      if (cart.items.length >= MAX_CART_LINES) return fail('CART_FULL');
      cart.items.push({
        productId: product.id,
        productName: product.name,
        unitPriceCents: product.priceCents,
        quantity,
      });
    }
    return ok(cartView(cart), { status: 201, headers: cookieHeaders });
  }

  function updateCartItem(request, productId) {
    const parsed = parseJsonBody(request.body);
    if (!parsed.ok) return fail('INVALID_BODY');
    const { quantity } = parsed.value;
    if (quantity === undefined) return fail('INVALID_BODY');
    if (!isValidQuantity(quantity)) return fail('INVALID_QUANTITY');

    const { cart, headers: cookieHeaders } = resolveCart(request.headers);
    const row = cart.items.find((item) => item.productId === productId);
    if (!row) return fail('NOT_FOUND', 'CART_ROW_NOT_FOUND');
    const product = findProduct(store, productId);
    const stock = product ? product.stock : 0;
    if (quantity > stock) return fail('OUT_OF_STOCK');
    row.quantity = quantity;
    return ok(cartView(cart), { headers: cookieHeaders });
  }

  function deleteCartItem(request, productId) {
    const { cart, headers: cookieHeaders } = resolveCart(request.headers);
    const index = cart.items.findIndex((item) => item.productId === productId);
    if (index === -1) return fail('NOT_FOUND', 'CART_ROW_NOT_FOUND');
    cart.items.splice(index, 1);
    return ok(cartView(cart), { headers: cookieHeaders });
  }

  function createOrder(request) {
    const { cart, headers: cookieHeaders } = resolveCart(request.headers);
    if (cart.items.length === 0) return fail('CART_EMPTY');

    // 先整体校验再整体落账：任何一件买不起都不许产生部分写入。
    for (const row of cart.items) {
      const product = findProduct(store, row.productId);
      if (!product || row.quantity > product.stock) return fail('INSUFFICIENT_STOCK');
    }

    const now = new Date().toISOString();
    const items = cart.items.map(rowView);
    const order = {
      orderNo: nextOrderNo(store),
      status: 'paid',
      items,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
      createdAt: now,
      paidAt: now,
    };

    for (const row of cart.items) {
      const product = findProduct(store, row.productId);
      product.stock -= row.quantity;
    }
    cart.items = [];
    const list = ordersOf(store, cart.cartId);
    list.push(order);
    store.orders.set(cart.cartId, list);

    return ok(order, { status: 201, headers: cookieHeaders });
  }

  function listOrders(request) {
    const cookieId = readCookie(request.headers.cookie, 'cartId');
    // 列表按时间倒序：不依赖毫秒时间戳排序（同毫秒会退化成不稳定序），直接用入列顺序取反。
    return ok(ordersOf(store, cookieId).slice().reverse());
  }

  /** 同步路由：给定请求中间表示，返回响应中间表示。 */
  function dispatch(request) {
    let url;
    try {
      url = new URL(request.url ?? '/', 'http://127.0.0.1');
    } catch {
      return notFoundJson();
    }
    const pathname = url.pathname;
    const method = (request.method ?? 'GET').toUpperCase();

    if (pathname.startsWith(API_PREFIX)) {
      const rest = pathname.slice(API_PREFIX.length);
      // 带体的写端点先过媒体类型白名单，再看 body：顺序反了会让「缺头 + 坏 body」
      // 与「缺头 + 合法 body」被同一句 JSON 解析失败掩盖，缺头这一档就永久免检。
      // 无体的写（如 POST /orders，载荷取自购物车）不在此列，仍由业务校验裁决。
      if (request.body !== undefined && !isJsonContentType(request.headers['content-type'])) {
        return fail('INVALID_BODY');
      }
      if (rest === '/products' && method === 'GET') return listProducts();
      if (rest === '/cart' && method === 'GET') return getCartResponse(request.headers);
      if (rest === '/cart/items' && method === 'POST') return addCartItem(request);
      if (rest === '/orders' && method === 'GET') return listOrders(request);
      if (rest === '/orders' && method === 'POST') return createOrder(request);

      const cartItemMatch = /^\/cart\/items\/([^/]+)$/.exec(rest);
      if (cartItemMatch) {
        const productId = decodePathParam(cartItemMatch[1]);
        if (method === 'PATCH') return updateCartItem(request, productId);
        if (method === 'DELETE') return deleteCartItem(request, productId);
      }
      const productMatch = /^\/products\/([^/]+)$/.exec(rest);
      if (productMatch && method === 'GET') {
        return productDetail(decodePathParam(productMatch[1]));
      }
      // /api 面不做静态回退：未知端点 / 未知方法一律 404，且不得 5xx。
      return notFoundJson();
    }

    if (method === 'GET' || method === 'HEAD') {
      const served = serveStatic(pathname, { products: store.products });
      if (served) return served;
    }
    return notFoundJson();
  }

  /**
   * 最后兜底：dispatch 对已枚举的输入是全函数，走到这里说明有未预期的缺陷。
   * 此时仍必须满足两条硬约束 —— **不得 5xx**、**不得把堆栈或内部结构放进响应体**，
   * 故只回词表内的 404，并把真实错误写到 stderr 供排查（日志不进响应）。
   */
  function safeDispatch(request) {
    try {
      return dispatch(request);
    } catch (error) {
      process.stderr.write(`[unexpected] ${error && error.stack ? error.stack : error}\n`);
      return notFoundJson();
    }
  }

  const requestHandler = (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', () => {
      if (!res.headersSent) {
        const failure = fail('INVALID_BODY');
        res.writeHead(failure.status, failure.headers);
      }
      res.end();
    });
    req.on('end', () => {
      const response = safeDispatch({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : undefined,
      });
      res.writeHead(response.status, response.headers);
      // HEAD 只回头部：把 body 一起写回不符合 HTTP 语义。
      res.end(req.method === 'HEAD' ? undefined : response.body);
    });
  };

  const server = createServer(requestHandler);

  return {
    server,
    /** 直接注入请求的入口：传 node 的 (req, res) 即可，无需占用端口。 */
    handle: requestHandler,
    /** 进程内请求：给不方便起端口的调用方用，语义与 HTTP 面一致。 */
    fetch: async (input, init = {}) => {
      const url = new URL(String(input), 'http://127.0.0.1');
      const response = safeDispatch({
        method: init.method ?? 'GET',
        url: url.pathname + url.search,
        headers: init.headers ?? {},
        body: init.body,
      });
      return {
        status: response.status,
        headers: response.headers,
        text: async () => response.body,
        json: async () => JSON.parse(response.body),
      };
    },
    dispatch,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
