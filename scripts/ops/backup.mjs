#!/usr/bin/env node
/**
 * 单次备份入口（可被 cron / 宿主调度器直接调用，应用进程内不起定时器）。
 *
 * 口径：
 *  - 快照用 `node:sqlite` 的模块级 `backup()`（WAL 下裸 `cp` 会拿到不一致快照，禁止）。
 *  - 落点 `BACKUP_DIR`（默认 `./backups`）下的 `shop-<UTC 日>.db`。
 *  - 保留 `BACKUP_RETENTION_DAYS` 天（默认 14）：按**文件 mtime** 判定，`now - mtime > N 天` 即删。
 *  - 失败一律 `error` 级 JSON 日志 + 非零退出，且**不清删**既有备份（清理只在本次备份成功之后跑）。
 *
 * 环境变量：`DB_PATH` / `BACKUP_DIR` / `BACKUP_RETENTION_DAYS`。
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

function log(level, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...extra })}\n`);
}

function retentionDays() {
  const raw = Number.parseInt(process.env.BACKUP_RETENTION_DAYS ?? '', 10);
  return Number.isInteger(raw) && raw >= 0 ? raw : 14;
}

/** UTC 日戳：`2026-10-15` ⇒ `20261015`。 */
function dayStamp(at) {
  return at.toISOString().slice(0, 10).replace(/-/g, '');
}

function sweepExpired(backupDir, days, keepFile) {
  const cutoff = Date.now() - days * DAY_MS;
  const removed = [];
  for (const name of readdirSync(backupDir)) {
    if (!name.endsWith('.db')) continue;
    const full = join(backupDir, name);
    if (full === keepFile) continue;
    if (statSync(full).mtimeMs < cutoff) {
      rmSync(full);
      removed.push(name);
    }
  }
  if (removed.length > 0) log('info', '清理过期备份', { removed, retentionDays: days });
  return removed;
}

async function main() {
  const dbPath = process.env.DB_PATH ?? './data/shop.db';
  const backupDir = process.env.BACKUP_DIR ?? './backups';
  const days = retentionDays();

  if (!existsSync(dbPath)) {
    log('warn', '库文件不存在，跳过本次备份', { dbPath });
    return;
  }

  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `shop-${dayStamp(new Date())}.db`);

  const source = new DatabaseSync(dbPath, { readOnly: true });
  try {
    await backup(source, target);
  } finally {
    source.close();
  }

  const size = statSync(target).size;
  log('info', '备份完成', { dbPath, target, size, retentionDays: days });
  sweepExpired(backupDir, days, target);
}

main().catch((error) => {
  log('error', '备份失败', { reason: error && error.message ? error.message : String(error) });
  process.exitCode = 1;
});
