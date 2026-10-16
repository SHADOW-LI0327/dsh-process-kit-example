/**
 * 运行配置：环境变量 → 校验过的配置对象。
 *
 * 为什么把校验放在启动期而不是用到处 `||` 兜底：`PORT=abc`、口令密钥过短、库目录不可写
 * 这类错误若拖到第一个请求才爆，现场只剩一个 500，运维无从判断该改哪个变量。
 * 因此这里对每个变量单独校验，错误消息里**点名变量名**，进程直接非零退出。
 *
 * 为什么默认值集中在一张表：默认值同时也是部署文档与 `.env.example` 的变量清单，
 * 三处必须同源，散落在各处读代码会漂移。
 */
import { accessSync, constants, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 变量 → 默认值（`undefined` = 无默认，需按条件必填）。 */
export const CONFIG_DEFAULTS = Object.freeze({
  HOST: '127.0.0.1',
  PORT: '3000',
  DB_PATH: './data/shop.db',
  COOKIE_SECURE: '0',
  TRUST_PROXY: '0',
  LOG_LEVEL: 'info',
  BODY_LIMIT_BYTES: '131072',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_MAX: '60',
  BACKUP_DIR: './backups',
  BACKUP_RETENTION_DAYS: '14',
  NODE_ENV: 'development',
});

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const NODE_ENVS = ['development', 'production', 'test'];
/** 会话密钥最短长度：低于此长度时「密钥」的熵还不如 token 本身。 */
export const MIN_SESSION_SECRET_LENGTH = 32;

export class ConfigError extends Error {
  constructor(variable, detail) {
    super(`配置项 ${variable} 非法：${detail}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

const isIntegerText = (value) => /^-?\d+$/.test(String(value).trim());

function requireInteger(env, name) {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  if (!isIntegerText(raw)) throw new ConfigError(name, `必须是整数，实际 "${raw}"`);
  return Number(raw);
}

/**
 * 库目录可写性：不建库、不写探针文件，只做目录级检查。
 * `:memory:` 落不到磁盘，直接放行。
 */
function assertDbPathUsable(dbPath) {
  if (dbPath === ':memory:' || dbPath === '') return;
  const dir = dirname(resolve(dbPath));
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new ConfigError('DB_PATH', `父目录 ${dir} 不存在且无法创建：${err.message}`);
    }
  }
  if (!statSync(dir).isDirectory()) {
    throw new ConfigError('DB_PATH', `父路径 ${dir} 不是目录`);
  }
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new ConfigError('DB_PATH', `父目录 ${dir} 不可写`);
  }
}

/**
 * 组装配置。`overrides` 是测试注入缝：与 `process.env` 同形、同优先级之上。
 */
export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...(overrides ?? {}) };
  const pick = (name) => {
    const value = env[name];
    if (value === undefined || value === null || String(value).trim() === '') {
      return CONFIG_DEFAULTS[name];
    }
    return String(value).trim();
  };

  const nodeEnv = pick('NODE_ENV');
  if (!NODE_ENVS.includes(nodeEnv)) {
    throw new ConfigError('NODE_ENV', `必须是 ${NODE_ENVS.join(' / ')} 之一，实际 "${nodeEnv}"`);
  }

  const host = pick('HOST');
  if (host === undefined || host === '') throw new ConfigError('HOST', '不得为空');

  const port = env.PORT === undefined || String(env.PORT).trim() === '' ? Number(CONFIG_DEFAULTS.PORT) : requireInteger(env, 'PORT');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError('PORT', `必须是 0..65535 的整数，实际 "${env.PORT}"`);
  }

  const sessionSecretRaw = env.SESSION_SECRET;
  const sessionSecret = sessionSecretRaw === undefined ? undefined : String(sessionSecretRaw);
  if (sessionSecret !== undefined && sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new ConfigError('SESSION_SECRET', `长度必须 ≥ ${MIN_SESSION_SECRET_LENGTH}，实际 ${sessionSecret.length}`);
  }
  if (sessionSecret === undefined && nodeEnv === 'production') {
    throw new ConfigError('SESSION_SECRET', '生产环境必须显式提供会话密钥');
  }

  const dbPath = pick('DB_PATH');
  assertDbPathUsable(dbPath);

  for (const name of ['COOKIE_SECURE', 'TRUST_PROXY']) {
    const value = pick(name);
    if (value !== '0' && value !== '1') throw new ConfigError(name, `只接受 0 / 1，实际 "${value}"`);
  }

  const logLevel = pick('LOG_LEVEL');
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError('LOG_LEVEL', `必须是 ${LOG_LEVELS.join(' / ')} 之一，实际 "${logLevel}"`);
  }

  const positiveIntegers = {};
  for (const name of ['BODY_LIMIT_BYTES', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX']) {
    const value = env[name] === undefined ? Number(CONFIG_DEFAULTS[name]) : requireInteger(env, name);
    if (!Number.isInteger(value) || value <= 0) {
      throw new ConfigError(name, `必须是正整数，实际 "${env[name]}"`);
    }
    positiveIntegers[name] = value;
  }

  const retention = env.BACKUP_RETENTION_DAYS === undefined
    ? Number(CONFIG_DEFAULTS.BACKUP_RETENTION_DAYS)
    : requireInteger(env, 'BACKUP_RETENTION_DAYS');
  if (!Number.isInteger(retention) || retention < 0) {
    throw new ConfigError('BACKUP_RETENTION_DAYS', `必须是非负整数，实际 "${env.BACKUP_RETENTION_DAYS}"`);
  }

  return Object.freeze({
    nodeEnv,
    host,
    port,
    dbPath,
    sessionSecret,
    cookieSecure: pick('COOKIE_SECURE') === '1',
    trustProxy: pick('TRUST_PROXY') === '1',
    logLevel,
    bodyLimitBytes: positiveIntegers.BODY_LIMIT_BYTES,
    rateLimitWindowMs: positiveIntegers.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: positiveIntegers.RATE_LIMIT_MAX,
    backupDir: pick('BACKUP_DIR'),
    backupRetentionDays: retention,
  });
}
