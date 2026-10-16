/**
 * 展示层格式化。
 *
 * 接口层只给整数分，元换算只发生在这一层：整数取整 + 补零拼串，
 * 不做「先除再乘」的浮点往返，避免出现 129.00000001 这种长尾。
 */

/** 整数分 → 两段式：货币符号与数字各自成节点，字号可分别定档。 */
export function yuanParts(cents) {
  const value = Number.isInteger(cents) ? cents : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const yuan = Math.trunc(abs / 100);
  const fen = String(abs % 100).padStart(2, '0');
  return { symbol: '¥', amount: `${sign}${yuan}.${fen}` };
}

/** 整数分 → 单串文本（`¥ 129.00`），用于无障碍标签与订单摘要。 */
export function money(cents) {
  const { symbol, amount } = yuanParts(cents);
  return `${symbol} ${amount}`;
}

/** 把 ISO 时间戳显示成 `MM-DD HH:mm`（本地时区），不可解析时原样返回。 */
export function shortTime(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return String(iso ?? '');
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 输入框里的件数：只接受正整数，其余回退成 `fallback`。 */
export function toQuantity(raw, fallback = 1) {
  const value = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** 纯文本转义：前端拼 HTML 串时唯一出口。 */
export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
