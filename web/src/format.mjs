/**
 * 展示层格式化。
 *
 * 接口层只给整数分，元换算只发生在这一层：用整数取整 + 补零拼串，
 * 不做「先除再乘」的浮点往返，避免出现 129.00000001 这种长尾。
 */

/** 整数分 → `¥ 129.00`（不使用千分位分隔）。 */
export function money(cents) {
  const value = Number.isInteger(cents) ? cents : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const yuan = Math.trunc(abs / 100);
  const fen = String(abs % 100).padStart(2, '0');
  return `¥ ${sign}${yuan}.${fen}`;
}

/** 商品名首字：无图片素材，用字形当占位图标。 */
export function initial(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  return text === '' ? '?' : [...text][0];
}

/** 把任意值安全地插进 HTML 文本位。 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

const TILE_VARIANTS = ['accent', 'success', 'warn', 'danger'];

/** 首字色块的配色轮转：同屏多块时用不同语义档区分，不引入新色。 */
export function tileVariant(seed) {
  const text = String(seed ?? '');
  let sum = 0;
  for (const char of text) sum += char.codePointAt(0);
  return TILE_VARIANTS[sum % TILE_VARIANTS.length];
}
