/**
 * HTTP 层小工具：错误词表、统一响应形态、cookie 解析。
 *
 * 错误响应体固定为 `{ code, message }`：`code` 只取这里的封闭词表，
 * `message` 是对用户可读的中文整句（前端原样展示），**不得**出现堆栈或内部结构。
 */

/** 错误码封闭词表：新增错误码必须回流 PRD 裁定，不得在此就地发明。 */
export const ERROR_CODES = {
  INVALID_BODY: 400,
  INVALID_QUANTITY: 400,
  NOT_FOUND: 404,
  CART_EMPTY: 409,
  CART_FULL: 409,
  QUANTITY_LIMIT_EXCEEDED: 409,
  OUT_OF_STOCK: 409,
  INSUFFICIENT_STOCK: 409,
};

export const ERROR_MESSAGES = {
  INVALID_BODY: '请求格式不正确，请刷新页面后重试',
  INVALID_QUANTITY: '购买数量必须是 1 到 8 之间的整数',
  NOT_FOUND: '找不到该商品',
  CART_ROW_NOT_FOUND: '购物车里没有这件商品',
  CART_EMPTY: '购物车是空的，无法提交订单',
  CART_FULL: '购物车最多放 8 种商品，请先删除一件',
  QUANTITY_LIMIT_EXCEEDED: '已达上限：单件商品最多买 8 件',
  OUT_OF_STOCK: '该商品暂时缺货，无法加入购物车',
  INSUFFICIENT_STOCK: '库存不足，请调整购买件数',
};

/** 一次响应的中间表示：dispatch 只产出它，socket 与进程内 fetch 各自渲染。 */
export function json(status, payload, headers = {}) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(payload),
  };
}

export function ok(data, { status = 200, headers = {} } = {}) {
  return json(status, { data }, headers);
}

/** `messageKey` 缺省时取 `code` 同名文案（商品与购物车行的 NOT_FOUND 用不同 key 区分）。 */
export function fail(code, messageKey = code) {
  const status = ERROR_CODES[code];
  if (!status) throw new Error(`未登记的错误码：${code}`);
  return json(status, { code, message: ERROR_MESSAGES[messageKey] ?? ERROR_MESSAGES[code] });
}

export function notFoundJson() {
  return fail('NOT_FOUND');
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

/**
 * 匿名身份 cookie：HttpOnly 且 Path=/。它不是凭据，只回答「这辆车是谁的」，
 * 因此携带畸形值时不报错，只当作「新客户端」重新下发。
 */
export function cartCookie(cartId) {
  return `cartId=${cartId}; HttpOnly; Path=/; SameSite=Lax`;
}
