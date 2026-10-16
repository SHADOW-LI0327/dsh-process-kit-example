/**
 * HTTP 层的公共件：错误词表、统一响应形态、cookie、安全响应头、ETag。
 *
 * 错误响应体固定 `{ code, message }`：`code` 只能取自这里的封闭词表，
 * `message` 是面向用户的中文整句（前端原样展示），**不得**出现堆栈或内部结构。
 */

/** 封闭词表：`code → HTTP 状态`。新增码必须回流需求裁定，不得就地发明。 */
export const ERROR_CODES = {
  INVALID_BODY: 400,
  INVALID_QUANTITY: 400,
  INVALID_PAGINATION: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  CART_EMPTY: 409,
  CART_FULL: 409,
  QUANTITY_LIMIT_EXCEEDED: 409,
  OUT_OF_STOCK: 409,
  INSUFFICIENT_STOCK: 409,
  EMAIL_TAKEN: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * 用户可见文案。同一 `code` 可以有多个 key（商品 / 购物车行 / 订单的「找不到」必须区分），
 * 因此 `fail(code, messageKey)` 允许指定 key，缺省即 `code` 同名。
 */
export const ERROR_MESSAGES = {
  INVALID_BODY: '请求格式不正确，请刷新页面后重试',
  INVALID_QUANTITY: '购买数量必须是 1 到 8 之间的整数',
  INVALID_PAGINATION: '分页参数不正确，请返回首页重试',
  UNAUTHENTICATED: '请先登录后再操作',
  INVALID_CREDENTIALS: '邮箱或密码不正确',
  NOT_FOUND: '找不到该商品',
  PRODUCT_NOT_FOUND: '找不到该商品',
  CART_ROW_NOT_FOUND: '购物车里没有这件商品',
  ORDER_NOT_FOUND: '找不到该订单',
  CART_EMPTY: '购物车是空的，无法提交订单',
  CART_FULL: '购物车最多放 8 种商品，请先删除一件',
  QUANTITY_LIMIT_EXCEEDED: '已达上限：单件商品最多买 8 件',
  OUT_OF_STOCK: '该商品暂时缺货，无法加入购物车',
  INSUFFICIENT_STOCK: '库存不足，请调整购买件数',
  EMAIL_TAKEN: '该邮箱已注册，请直接登录',
  PAYLOAD_TOO_LARGE: '请求内容过大，请减少提交内容后重试',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  INTERNAL_ERROR: '服务器内部错误，请稍后重试',
};

/** 安全响应头：**所有**响应（含 4xx / 5xx / 静态 / 健康检查）统一带，不按路径分叉。 */
export const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
});

/** 给任意响应头叠加安全头；调用方显式给的值优先（便于 304 之类不带 body 的响应）。 */
export function withSecurityHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

/** 一次响应的中间表示：dispatch 只产出它，socket 与进程内 fetch 各自渲染。 */
export function json(status, payload, headers = {}) {
  return {
    status,
    headers: withSecurityHeaders({ 'content-type': 'application/json; charset=utf-8', ...headers }),
    body: JSON.stringify(payload),
  };
}

export function text(status, body, headers = {}) {
  return {
    status,
    headers: withSecurityHeaders({ 'content-type': 'text/plain; charset=utf-8', ...headers }),
    body,
  };
}

export function ok(data, { status = 200, headers = {} } = {}) {
  return json(status, { data }, headers);
}

export function fail(code, messageKey = code) {
  const status = ERROR_CODES[code];
  if (!status) throw new Error(`未登记的错误码：${code}`);
  return json(status, { code, message: ERROR_MESSAGES[messageKey] ?? ERROR_MESSAGES[code] });
}

/** 静态面专用：白名单外一律纯文本 404，**不得**套用接口层的商品文案。 */
export function notFoundText() {
  return text(404, '404 Not Found');
}

/** 解析 Cookie 头里的单个键；不引入任何 cookie 库。 */
export function readCookie(headerValue, name) {
  if (typeof headerValue !== 'string' || headerValue === '') return undefined;
  for (const part of headerValue.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return undefined;
}

function cookieAttributes(maxAgeSeconds, secure) {
  const parts = ['HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  // `Secure` 只在配置显式打开时加：本机 HTTP 下带上它，浏览器会静默丢弃整个 cookie。
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookie(token, maxAgeSeconds, { secure = false } = {}) {
  return `sid=${token}; ${cookieAttributes(maxAgeSeconds, secure)}`;
}

/**
 * 匿名身份 cookie：它不是凭据，只回答「这辆车是谁的」，
 * 因此携带畸形值时不报错，只当作「新客户端」重新下发。
 */
export function cartCookie(cartId, { secure = false } = {}) {
  return `cartId=${cartId}; ${cookieAttributes(undefined, secure)}`;
}

/** 清 cookie：`Max-Age=0` + 空值；客户端 cookie jar 见到即删除该项。 */
export function clearedCookie(name, { secure = false } = {}) {
  return `${name}=; ${cookieAttributes(0, secure)}`;
}

/** 弱 ETag：由「字节数 + 内容指纹」拼成，够用于条件请求（不追求跨节点强一致）。 */
export function etagFor(text_, hash) {
  return `"${hash ?? 'v'}-${Buffer.byteLength(text_, 'utf8')}"`;
}
