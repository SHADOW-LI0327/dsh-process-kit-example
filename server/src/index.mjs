/**
 * 进程入口：起服务、接管信号、兜住未捕获异常。
 *
 * 三件事都必须在这里做（而不是在 app.mjs 里）：
 *  ① **信号 → 优雅停机**：先停止接新连接，再等在途请求排空，最后关库；
 *     直接 `process.exit()` 会把正在写的事务留在 WAL 里（下次启动依赖恢复，风险更大）。
 *  ② **未捕获异常 / 未处理拒绝 → 记录 + 关库 + 非零退出**：静默存活比崩溃更危险 ——
 *     进程继续对外服务，但内部状态已经不可信。
 *  ③ **启动期配置错误 → 点名变量 + 非零退出**：这是一条「拒启」路径，
 *     必须先于 listen，绝不允许带病进入服务态。
 */
import { createApp } from './app.mjs';
import { createLogger } from './log.mjs';

const LEVELS = ['debug', 'info', 'warn', 'error'];

/** 配置可能本身就是坏的（例如 LOG_LEVEL 非法），所以启动日志自己兜一层默认级别。 */
function bootstrapLogger() {
  const level = LEVELS.includes(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'info';
  return createLogger({ level });
}

let app;
try {
  app = createApp();
} catch (err) {
  bootstrapLogger().error({
    outcome: 'startup_failed',
    variable: err && err.variable,
    message: err && err.message ? String(err.message) : String(err),
  });
  process.exit(1);
}

const logger = createLogger({ level: app.config.logLevel });
const server = app.server;

server.on('error', (err) => {
  logger.error({ outcome: 'listen_failed', message: String(err && err.message) });
  // 起不来就不该在盘上留半个库：回滚掉本次启动自己建的文件（预先存在的库/密钥不碰）。
  try {
    if (typeof app.rollbackStartup === 'function') app.rollbackStartup();
  } catch (rollbackError) {
    logger.warn({ outcome: 'rollback_failed', message: String(rollbackError && rollbackError.message) });
  }
  process.exit(1);
});

server.listen(app.config.port, app.config.host, () => {
  const address = server.address();
  logger.info({
    outcome: 'listening',
    host: app.config.host,
    port: address && typeof address === 'object' ? address.port : app.config.port,
    db: app.config.dbPath,
    schemaVersion: app.schemaVersion,
    version: app.version,
  });
});

let stopping = false;
function onSignal(signal) {
  if (stopping) {
    // 第二次信号 = 操作者已经不耐烦：不再等排空，直接掐断剩余连接。
    logger.warn({ outcome: 'shutdown_forced', signal, message: `再次收到 ${signal}，强制断开剩余连接` });
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    return;
  }
  stopping = true;
  app
    .shutdown(signal)
    .then(() => {
      // 不直接 process.exit：让 stdout 自然排空，退出码交给 Node 带出去。
      process.exitCode = 0;
      setTimeout(() => process.exit(0), 2500).unref?.();
    })
    .catch((err) => {
      logger.error({ outcome: 'shutdown_failed', signal, message: String(err && err.message) });
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 2500).unref?.();
    });
}

process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

/** 兜底退出：先写日志（写回调里再退，避免管道被截断），再关库，最后非零退出。 */
function fatal(outcome) {
  let handled = false;
  return (err) => {
    if (handled) return;
    handled = true;
    const message = err && err.message ? String(err.message) : String(err);
    const stack = err && err.stack ? String(err.stack) : undefined;
    logger.error({ outcome, message, stack });
    try {
      if (app.db && typeof app.db.close === 'function') app.db.close();
    } catch {
      // 关库失败不能挡住退出。
    }
    const bail = () => process.exit(1);
    try {
      process.stdout.write('', bail);
    } catch {
      bail();
    }
    setTimeout(bail, 400);
  };
}

process.on('uncaughtException', fatal('uncaught_exception'));
process.on('unhandledRejection', fatal('unhandled_rejection'));
