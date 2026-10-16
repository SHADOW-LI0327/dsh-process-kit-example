/**
 * 库读写层：所有 SQL 都集中在这里，上层（app）只调方法、不拼 SQL。
 *
 * 为什么视图投影（`*View`）单独成函数：购物车行 / 订单行的对外字段是「快照 + 现算」两来源混合
 * （订单快照来自 order_items，购物车行的名称与单价现查 products），投影只写一遍才不会两处口径打架。
 *
 * 为什么 `withTx` 显式禁止嵌套：SQLite 不支持嵌套 `BEGIN`，一旦有人在事务里再开一个，
 * 得到的是运行期异常而不是「内层被合并」——与其让它随机爆，不如构造期就拒绝。
 */
import { randomUUID } from 'node:crypto';

/** 购物车视图：合计一律由行推导，避免「整车合计」与「行小计」两套口径。 */
export function cartView(cart, itemRows) {
  const items = itemRows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    unitPriceCents: row.unit_price_cents,
    quantity: row.quantity,
    lineTotalCents: row.unit_price_cents * row.quantity,
  }));
  return {
    cartId: cart.id,
    items,
    quantityTotal: items.reduce((sum, item) => sum + item.quantity, 0),
    totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
  };
}

/** 订单视图：行金额用下单时快照，**不再**回查商品表（改名 / 改价都不得漂移）。 */
export function orderView(order, itemRows) {
  const items = itemRows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    unitPriceCents: row.unit_price_cents,
    quantity: row.quantity,
    lineTotalCents: row.line_total_cents,
  }));
  return {
    orderNo: order.no,
    status: order.status,
    items,
    itemCount: order.item_count,
    totalCents: order.total_cents,
    createdAt: new Date(order.created_at).toISOString(),
    paidAt: new Date(order.paid_at).toISOString(),
  };
}

export function productView(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    stock: row.stock,
  };
}

export function userView(row) {
  return { id: row.id, email: row.email, createdAt: new Date(row.created_at).toISOString() };
}

export function createStore({ db, now = () => Date.now() } = {}) {
  if (!db) throw new TypeError('createStore 需要注入已打开的数据库连接');
  let depth = 0;

  /** 单条语句不需要事务；多表写必须显式包一层。 */
  function withTx(fn) {
    if (depth > 0) throw new Error('withTx 不得嵌套：多表写请复用最外层事务');
    db.exec('BEGIN IMMEDIATE');
    depth += 1;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // 回滚失败时保留原始错误，避免掩盖首个故障点。
      }
      throw err;
    } finally {
      depth -= 1;
    }
  }

  const one = (sql, ...params) => {
    const row = db.prepare(sql).get(...params);
    return row === undefined ? undefined : { ...row };
  };
  const many = (sql, ...params) => db.prepare(sql).all(...params).map((row) => ({ ...row }));
  const run = (sql, ...params) => db.prepare(sql).run(...params);

  return {
    db,
    now,
    withTx,

    // ── 商品 ──────────────────────────────────────────────────────────────
    listProducts: (limit, offset) =>
      many('SELECT * FROM products ORDER BY id ASC LIMIT ? OFFSET ?', limit, offset).map(productView),
    getProduct: (id) => {
      const row = one('SELECT * FROM products WHERE id = ?', id);
      return row ? productView(row) : undefined;
    },
    /** 条件扣减：`changes === 0` 才是「库存不够」的判据（不靠异常）。 */
    decrementStock: (id, quantity) =>
      run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', quantity, id, quantity).changes,

    // ── 账号 ──────────────────────────────────────────────────────────────
    findUserByEmail: (email) => one('SELECT * FROM users WHERE email = ?', email),
    findUserById: (id) => one('SELECT * FROM users WHERE id = ?', id),
    insertUser: ({ id, email, passwordHash, passwordSalt, createdAt }) => {
      run(
        'INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
        id,
        email,
        passwordHash,
        passwordSalt,
        createdAt,
      );
      return { id, email, created_at: createdAt };
    },

    // ── 会话 ──────────────────────────────────────────────────────────────
    insertSession: ({ tokenHash, userId, createdAt, expiresAt }) => {
      run(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
        tokenHash,
        userId,
        createdAt,
        expiresAt,
        createdAt,
      );
    },
    findSession: (tokenHash) => one('SELECT * FROM sessions WHERE token_hash = ?', tokenHash),
    touchSession: (tokenHash, at) => {
      run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', at, tokenHash);
    },
    deleteSession: (tokenHash) => {
      run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
    },

    // ── 购物车 ────────────────────────────────────────────────────────────
    findCartById: (id) => one('SELECT * FROM carts WHERE id = ?', id),
    findCartByUser: (userId) => one('SELECT * FROM carts WHERE user_id = ?', userId),
    insertCart: ({ id = randomUUID(), userId = null, createdAt = now() } = {}) => {
      run('INSERT INTO carts (id, user_id, created_at) VALUES (?, ?, ?)', id, userId, createdAt);
      return { id, user_id: userId, created_at: createdAt };
    },
    deleteCart: (id) => {
      run('DELETE FROM carts WHERE id = ?', id);
    },
    cartItems: (cartId) =>
      many(
        `SELECT ci.product_id, ci.quantity, ci.added_at,
                p.name AS product_name, p.price_cents AS unit_price_cents
           FROM cart_items ci
           JOIN products p ON p.id = ci.product_id
          WHERE ci.cart_id = ?
          ORDER BY ci.added_at ASC, ci.rowid ASC`,
        cartId,
      ),
    cartRow: (cartId, productId) => one('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?', cartId, productId),
    putCartItem: ({ cartId, productId, quantity, addedAt }) => {
      run(
        `INSERT INTO cart_items (cart_id, product_id, quantity, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity`,
        cartId,
        productId,
        quantity,
        addedAt,
      );
    },
    deleteCartItem: (cartId, productId) => {
      run('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?', cartId, productId);
    },
    countCartItems: (cartId) => {
      const row = one('SELECT COUNT(*) AS n FROM cart_items WHERE cart_id = ?', cartId);
      return row ? row.n : 0;
    },

    // ── 订单 ──────────────────────────────────────────────────────────────
    /** 事务内 UPSERT 取号：同一事务里连取必得连续序号，跨重启从库里的计数续。 */
    nextOrderSeq: (day) => {
      const row = one(
        `INSERT INTO order_no_seq (day, seq) VALUES (?, 1)
         ON CONFLICT(day) DO UPDATE SET seq = seq + 1
         RETURNING seq`,
        day,
      );
      return row.seq;
    },
    insertOrder: ({ no, userId, status, itemCount, totalCents, createdAt, paidAt, items }) => {
      const inserted = run(
        `INSERT INTO orders (no, user_id, status, item_count, total_cents, created_at, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        no,
        userId,
        status,
        itemCount,
        totalCents,
        createdAt,
        paidAt,
      );
      const orderId = Number(inserted.lastInsertRowid);
      const stmt = db.prepare(
        `INSERT INTO order_items
           (order_id, seq, product_id, product_name, unit_price_cents, quantity, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      items.forEach((item, index) => {
        stmt.run(orderId, index, item.productId, item.productName, item.unitPriceCents, item.quantity, item.lineTotalCents);
      });
      return orderId;
    },
    listOrdersByUser: (userId, limit, offset) =>
      many('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', userId, limit, offset),
    findOrderByNo: (no) => one('SELECT * FROM orders WHERE no = ?', no),
    findOrderById: (id) => one('SELECT * FROM orders WHERE id = ?', id),
    orderItems: (orderId) => many('SELECT * FROM order_items WHERE order_id = ? ORDER BY seq ASC', orderId),
  };
}
