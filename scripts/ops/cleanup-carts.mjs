#!/usr/bin/env node
/**
 * 单次回收入口（**可选运维动作**，应用进程内不起定时器，启动时也不自动跑）。
 *
 * 清两类确定性的残留：
 *  - **已过期会话**：`expires_at` 已过，客户端再也换不到身份，留着只是占空间；
 *  - **长期没动过的匿名车**：`user_id IS NULL` 且「最后一次加购距今超过 N 天」——
 *    登录车的归属由账号决定，一律不动。
 *
 * 默认**只报告不删**（干跑）：先看清要删多少，确认后再加 `--apply`。
 * 用法：`node scripts/ops/cleanup-carts.mjs [--days=30] [--apply]`
 *
 * 环境变量：`DB_PATH`（默认 `./data/shop.db`）与 `BACKUP_DIR` 同一套口径。
 * 跑之前建议先 `node scripts/ops/backup.mjs` 打一份快照。
 */
import { existsSync } from 'node:fs';

import { openDatabase } from '../../server/src/db.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IDLE_DAYS = 30;

function log(level, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...extra })}\n`);
}

function idleDays() {
  const raw = process.argv.slice(2).find((arg) => arg.startsWith('--days='));
  if (!raw) return DEFAULT_IDLE_DAYS;
  const value = Number.parseInt(raw.slice('--days='.length), 10);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_IDLE_DAYS;
}

/** 匿名车的「最后一次动静」：有行就看最近一次加购，没有行就看建车时间。 */
const IDLE_ANON_CART_WHERE = `
  user_id IS NULL
  AND COALESCE((SELECT MAX(added_at) FROM cart_items i WHERE i.cart_id = carts.id), created_at) < ?`;

function main() {
  const apply = process.argv.slice(2).includes('--apply');
  const days = idleDays();
  const dbPath = process.env.DB_PATH ?? './data/shop.db';

  if (!existsSync(dbPath)) {
    log('warn', '库文件不存在，无需回收', { dbPath });
    return;
  }

  const db = openDatabase(dbPath);
  const now = Date.now();
  const idleCutoff = now - days * DAY_MS;
  try {
    const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at < ?').get(now).n;
    const carts = db.prepare(`SELECT COUNT(*) AS n FROM carts WHERE ${IDLE_ANON_CART_WHERE}`).get(idleCutoff).n;

    if (!apply) {
      log('info', '干跑：只报告不删（确认后加 --apply）', {
        dbPath,
        expiredSessions: sessions,
        idleAnonCarts: carts,
        idleDays: days,
      });
      return;
    }

    const removedSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes;
    const removedCarts = db.prepare(`DELETE FROM carts WHERE ${IDLE_ANON_CART_WHERE}`).run(idleCutoff).changes;
    log('info', '回收完成', {
      dbPath,
      removedSessions: Number(removedSessions),
      removedCarts: Number(removedCarts),
      idleDays: days,
    });
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  log('error', '回收失败', { reason: error && error.message ? error.message : String(error) });
  process.exitCode = 1;
}
