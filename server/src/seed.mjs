/**
 * 种子商品：默认 8 条只读商品，以及注入种子的字段校验。
 *
 * 两级校验的边界是刻意划的：**条数不校验**（0/7/8/9/10 都要能用 —— 行数上限
 * 那个边界必须能靠注入 ≥9 条构造成立），只校验**字段形状**。把条数也当成拒绝
 * 口径，就会和「必须能注入 9 条」直接打架。
 */

/** 默认种子：名称 / 价格与原型图一致，库存统一 8 件（行件数上限同值）。 */
export const DEFAULT_SEED = [
  {
    id: 'P-001',
    name: '手冲咖啡壶',
    description: '玻璃壶身，300ml；手冲与冷萃两用，附滤纸 5 张。',
    priceCents: 12900,
    stock: 8,
  },
  {
    id: 'P-002',
    name: '陶瓷滤杯',
    description: 'V60 锥形，单人份；陶瓷保温性好，萃取更稳定。',
    priceCents: 6800,
    stock: 8,
  },
  {
    id: 'P-003',
    name: '单品豆 250g',
    description: '日晒处理，中浅烘；柑橘与红糖风味，到手即饮期。',
    priceCents: 8800,
    stock: 8,
  },
  {
    id: 'P-004',
    name: '手摇磨豆机',
    description: '不锈钢磨芯，可调档；细粉少，手冲与意式皆可。',
    priceCents: 39900,
    stock: 8,
  },
  {
    id: 'P-005',
    name: '电子秤',
    description: '0.1g 精度，带计时；可拆洗秤盘，适合手冲复刻。',
    priceCents: 15900,
    stock: 8,
  },
  {
    id: 'P-006',
    name: '滤纸 100 张',
    description: '无漂白，02 号；适配 V60 锥形滤杯，不易塌边。',
    priceCents: 2900,
    stock: 8,
  },
  {
    id: 'P-007',
    name: '保温杯',
    description: '316 内胆，350ml；密封圈可拆洗，冷热皆宜。',
    priceCents: 19900,
    stock: 8,
  },
  {
    id: 'P-008',
    name: '壶嘴清洁刷',
    description: '木质柄，细毛刷；清理壶嘴与滤杯缝隙用。',
    priceCents: 1900,
    stock: 8,
  },
];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * 取字段的展示名：库存取负、价格非整数分都属于「字段形状」不对，
 * 报错里点出字段名，调用方才知道该改哪一格。
 */
const FIELD_LABELS = {
  id: 'id',
  name: 'name',
  priceCents: 'priceCents',
  stock: 'stock',
};

function invalidField(field, index, reason) {
  const label = FIELD_LABELS[field] ?? field;
  return new TypeError(`种子商品字段非法：${label} ${reason}（第 ${index + 1} 条）`);
}

/** 校验单条种子商品，返回一份归一化副本（不保留外部对象的引用）。 */
export function normalizeProduct(product, index) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw new TypeError(`种子商品字段非法：第 ${index + 1} 条不是商品对象`);
  }
  if (!isNonEmptyString(product.id)) throw invalidField('id', index, '必须为非空字符串');
  if (!isNonEmptyString(product.name)) throw invalidField('name', index, '必须为非空字符串');
  if (!Number.isInteger(product.priceCents)) {
    throw invalidField('priceCents', index, '必须为整数分');
  }
  if (product.priceCents <= 0) throw invalidField('priceCents', index, '必须为正整数分');
  if (!Number.isInteger(product.stock)) throw invalidField('stock', index, '必须为整数件');
  if (product.stock < 0) throw invalidField('stock', index, '不得为负');

  return {
    id: product.id,
    name: product.name,
    description: typeof product.description === 'string' ? product.description : '',
    priceCents: product.priceCents,
    stock: product.stock,
  };
}

/** 校验注入种子：只校验字段，不校验条数。 */
export function normalizeSeed(seed) {
  if (!Array.isArray(seed)) {
    throw new TypeError('种子商品字段非法：seed 必须是数组');
  }
  return seed.map((product, index) => normalizeProduct(product, index));
}

/** 默认种子的一份深拷贝 —— 库存是可变字段，绝不能与模块级常量共享引用。 */
export function defaultSeed() {
  return normalizeSeed(DEFAULT_SEED);
}
