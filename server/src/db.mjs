/**
 * 库的打开、迁移与播种。
 *
 * 三条纪律：
 *  ① **只改这一个 schema 源文件**，不做迁移框架：迁移是「有序数组 + 每条一个版本号」，
 *     已经发过的版本不得改写（线上库只会往前推，不会回头重放）。
 *  ② **迁移必须可重入**：DDL 一律 `IF NOT EXISTS`，版本记录与 DDL 在同一事务里提交 ⇒
 *     进程在「表已建、版本未记」处中断，重启后能从半迁移态补齐（而不是要求人工删库）。
 *  ③ **播种幂等且不覆盖库存**：商品是运行时可变行（下单扣库存），重复启动只允许
 *     补齐缺失行 / 同步名称与价格，**不得把库存打回种子初值**。
 */
import { DatabaseSync } from 'node:sqlite';

/** 代码已知的最新 schema 版本。 */
export const LATEST_VERSION = 1;

/** 有序迁移表。数组顺序即执行顺序，版本号必须严格递增。 */
export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        stock INTEGER NOT NULL CHECK (stock >= 0)
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

      CREATE TABLE IF NOT EXISTS carts (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_user ON carts (user_id) WHERE user_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS cart_items (
        cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity >= 0),
        added_at INTEGER NOT NULL,
        PRIMARY KEY (cart_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items (cart_id);

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        no TEXT NOT NULL UNIQUE,
        user_id TEXT REFERENCES users(id),
        status TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        paid_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, id DESC);

      CREATE TABLE IF NOT EXISTS order_items (
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        line_total_cents INTEGER NOT NULL,
        PRIMARY KEY (order_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

      CREATE TABLE IF NOT EXISTS order_no_seq (
        day TEXT PRIMARY KEY,
        seq INTEGER NOT NULL
      );
    `,
  },
]);

/** 库版本比代码新 —— 用旧代码去读新库会静默写坏数据，必须拒启。 */
export class SchemaVersionError extends Error {
  constructor(found, known) {
    super(`库 schema 版本 ${found} 高于本代码支持的版本 ${known}：请升级应用版本后再启动`);
    this.name = 'SchemaVersionError';
    this.found = found;
    this.known = known;
  }
}

/**
 * 打开库并设好连接级 PRAGMA。
 * `journal_mode` 与 `foreign_keys` 都是**连接级**设置，必须每条新连接重设。
 */
export function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/**
 * 把注入的商品集合同步进库。
 * `authoritative` = 该集合是这份库的**完整商品世界**（注入种子时）：多余的删掉、库存照抄；
 * 否则（默认种子）只补齐缺失行与名称/价格，**库存不动**。
 */
export function syncProducts(db, products, { authoritative, now = () => Date.now() }) {
  const ids = products.map((product) => product.id);
  const upsert = db.prepare(
    `INSERT INTO products (id, name, description, price_cents, stock)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       price_cents = excluded.price_cents${authoritative ? ', stock = excluded.stock' : ''}`,
  );
  const existing = new Set(db.prepare('SELECT id FROM products').all().map((row) => ({ ...row }).id));
  const keep = new Set(ids);
  const dropped = [...existing].filter((id) => !keep.has(id));

  if (dropped.length > 0) {
    // 商品行被购物车引用（外键），先清掉指向它们的车行再删商品：
    // 商品集合被整体替换时，指向已不存在商品的车行本来就是脏数据。
    const placeholders = dropped.map(() => '?').join(', ');
    db.prepare(`DELETE FROM cart_items WHERE product_id IN (${placeholders})`).run(...dropped);
    db.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...dropped);
  }

  for (const product of products) {
    upsert.run(product.id, product.name, product.description ?? '', product.priceCents, product.stock);
  }
  return { inserted: ids.filter((id) => !existing.has(id)).length, removed: dropped.length };
}

function readVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  const value = row ? { ...row }.version : null;
  return value === null || value === undefined ? 0 : Number(value);
}

/**
 * 迁移到最新版本并播种。返回实际应用的版本号，供启动日志与探针使用。
 * **每条迁移一个事务**：失败即回滚，库停在「上一版 + 无该版记录」的干净态。
 */
export function migrateAndSeed(db, products, { now = () => Date.now(), authoritative = false } = {}) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (' +
      ' version INTEGER PRIMARY KEY,' +
      ' applied_at INTEGER NOT NULL)',
  );

  const current = readVersion(db);
  if (current > LATEST_VERSION) throw new SchemaVersionError(current, LATEST_VERSION);

  let applied = current;
  for (const migration of MIGRATIONS) {
    if (migration.version <= applied) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        now(),
      );
      db.exec('COMMIT');
      applied = migration.version;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // 回滚失败（连接已坏）时保留原始错误更有利于排查。
      }
      throw err;
    }
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    syncProducts(db, products, { authoritative, now });
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 同上：原始错误优先。
    }
    throw err;
  }
  return applied;
}
