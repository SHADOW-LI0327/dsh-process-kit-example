/**
 * FEAT-002 验收测试装置。
 *
 * 三件能力：
 *  ① 注入式应用工厂 → 随机端口真 HTTP 取样（`listen(0)`，绝不占常驻 3000）；
 *  ② 子进程运维面取样（真信号 / 真退出码 / 真 stdout 日志流）；
 *  ③ 临时库 + SQLite 结构探针 + 前端产物（HTML / CSS / 模块文本）取样。
 *
 * 纪律（写这套装置时踩过的坑都固化在这里）：
 *  - `startApp` **强制**要求注入 `dbPath`/`seed`/`store` 之一 —— 生产库路径不得被测试触碰。
 *  - `node:sqlite` 的行对象是 null 原型：一律 `{...row}` 后再比，绝不直接 deepStrictEqual。
 *  - `run()` 的 `changes` 才是防超卖判据；`PRAGMA ...=ON` 的 `.get()` 是 undefined（校验要另取）。
 *  - 退出码一律子进程直接读 —— 不经管道，避免读到管道末端的 0。
 *  - 断言与 SQLite 版本无关；不断言 stderr 上是否存在实验特性告警（宿主有、容器没有）。
 *
 * @prd FEAT-002
 * @prdVersion 3
 */
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
// 装置卫生：本进程（测试 worker）一旦被 reparent（runner 被硬杀/SIGTERM）即清理并退出 ——
// 否则 worker 自己持的 in-process 监听（withApp/startApp）会变成常驻孤儿的随机端口（实测残留形态）。
import './parent-watchdog.mjs';

/** 本 worker spawn 过、尚未确认退出的服务子进程：退出/被信号杀时兜底回收，防孤儿常驻监听。 */
const LIVE_CHILDREN = new Set();
function reapLiveChildren() {
  for (const child of LIVE_CHILDREN) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
  LIVE_CHILDREN.clear();
}
process.on('exit', reapLiveChildren);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  const handler = () => {
    reapLiveChildren();
    process.off(signal, handler);
    process.kill(process.pid, signal); // 清理完再按默认语义退出（不吞信号、不改退出码）
  };
  process.on(signal, handler);
}

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const APP_ENTRY_URL = new URL('../../../../server/src/app.mjs', import.meta.url);
export const SERVER_ENTRY = 'server/src/index.mjs';

/** 契约六的封闭错误码词表（15 码）；测试只允许出现词表内码。 */
export const ERROR_CODES = Object.freeze([
  'INVALID_BODY',
  'INVALID_QUANTITY',
  'INVALID_PAGINATION',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'CART_EMPTY',
  'CART_FULL',
  'QUANTITY_LIMIT_EXCEEDED',
  'OUT_OF_STOCK',
  'INSUFFICIENT_STOCK',
  'EMAIL_TAKEN',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

/** 安全响应头：所有响应（含 4xx/5xx/静态/health）都必须带。 */
export const SECURITY_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'";

/** 响应体不得出现的内部实现特征（堆栈 / errno / 绝对路径 / 内部模块路径）。 */
export const INTERNAL_LEAK_PATTERNS = Object.freeze([
  /\bat\s+\/[^\s"]+:\d+:\d+/,
  /\bstack\b/i,
  /\berrno\b/i,
  /\bsyscall\b/i,
  /\/Users\//,
  /\bserver\/src\b/,
  /\bnode_modules\b/,
]);

// ── ① 应用工厂与真 HTTP 取样 ────────────────────────────────────────────────

let cachedCreateApp;

export function loadCreateApp() {
  if (!cachedCreateApp) {
    cachedCreateApp = import(APP_ENTRY_URL.href).then((mod) => {
      if (typeof mod.createApp !== 'function') {
        const exported = Object.keys(mod).join(', ') || '（无导出）';
        throw new Error(`应用工厂入口没有导出 createApp，实际导出：${exported}`);
      }
      return mod.createApp;
    });
  }
  return cachedCreateApp;
}

function resolveServer(handle) {
  if (handle && typeof handle.listen === 'function') return handle;
  if (handle && handle.server && typeof handle.server.listen === 'function') return handle.server;
  const kind = handle === null ? 'null' : typeof handle;
  throw new Error(
    `createApp 的返回值（${kind}）既不可 listen，也不含可 listen 的 server —— 无法做真 HTTP 取样`,
  );
}

/**
 * 起一个实例：listen(0) → 随机端口。
 * **强制注入**：`dbPath` / `seed` / `store` 至少给一个，否则拒绝启动 —— 防测试误触生产库。
 */
export async function startApp(options) {
  if (!options || !('dbPath' in options || 'seed' in options || 'store' in options)) {
    throw new Error(
      'startApp 必须注入 dbPath（或 seed / store）：测试一律用独立临时库，禁止触碰生产库文件',
    );
  }
  const createApp = await loadCreateApp();
  const handle = await createApp(options);
  const server = resolveServer(handle);
  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : null;
  if (!port) throw new Error('实例已监听但取不到端口号，无法取样');
  if (port === 3000) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('实例监听在了常驻端口 3000 —— 测试禁止占用该端口');
  }
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    handle,
    dbPath: options.dbPath,
    close: () =>
      new Promise((resolve) => {
        // 客户端保持长连接时 server.close() 会等到空闲连接超时；取样已结束，直接掐掉。
        if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
        server.close(() => resolve());
      }),
  };
}

export async function withApp(options, fn) {
  const app = await startApp(options);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

/** 临时目录 + 独立库路径；用例结束即整目录删除（清理谓词绑在本用例的目录上）。 */
export async function withTempDb(fn, tag = 'feat002') {
  const dir = mkdtempSync(join(tmpdir(), `${tag}-`));
  const dbPath = join(dir, 'shop.db');
  const path = (name) => join(dir, name);
  try {
    return await fn({ dir, dbPath, path });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 每例独立临时库 + 每例独立实例（默认组合）。 */
export async function withDbApp(options, fn, tag) {
  return withTempDb(
    ({ dir, dbPath, path }) => withApp({ ...options, dbPath }, (app) => fn(app, { dir, dbPath, path })),
    tag,
  );
}

function updateJar(jar, setCookieLines) {
  for (const line of setCookieLines) {
    const pair = String(line).split(';')[0] || '';
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = /max-age\s*=\s*0/i.test(String(line)) || /expires\s*=\s*thu,\s*01\s*jan\s*1970/i.test(String(line));
    if (!name) continue;
    if (expired || value === '') jar.delete(name);
    else jar.set(name, value);
  }
}

/** 自持 cookie jar 的客户端（收 Set-Cookie → 回带 Cookie；支持 sid 与 cartId 并存/清除）。 */
export function newClient(app, { cookie = '' } = {}) {
  const jar = new Map();
  if (cookie) {
    for (const part of cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }

  async function send(method, path, opts = {}) {
    const { body, rawBody, contentType, headers = {}, useJar = true, cookieOverride } = opts;
    const finalHeaders = { accept: 'application/json', ...headers };
    if (cookieOverride !== undefined) finalHeaders.cookie = cookieOverride;
    else if (useJar && jar.size > 0) {
      finalHeaders.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    let payload;
    if (rawBody !== undefined) payload = rawBody;
    else if (body !== undefined) payload = JSON.stringify(body);
    const isWrite = ['POST', 'PUT', 'PATCH'].includes(method);
    if ((payload !== undefined || isWrite) && contentType !== null) {
      finalHeaders['content-type'] = contentType ?? 'application/json';
    }
    const res = await new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: app.port, method, path, headers: finalHeaders, agent: false },
        (response) => {
          const chunks = [];
          response.on('data', (c) => chunks.push(c));
          response.on('end', () => resolve({ response, chunks }));
        },
      );
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
    const raw = Buffer.concat(res.chunks).toString('utf8');
    let json;
    try {
      json = raw === '' ? undefined : JSON.parse(raw);
    } catch {
      json = undefined;
    }
    const setCookies = res.response.headers['set-cookie'] ?? [];
    updateJar(jar, setCookies);
    return {
      status: res.response.statusCode,
      headers: res.response.headers,
      setCookies,
      raw,
      json,
      remotePort: res.response.socket ? res.response.socket.remotePort : undefined,
    };
  }

  return {
    app,
    jar,
    send,
    get: (path, opts) => send('GET', path, opts),
    post: (path, body, opts) => send('POST', path, { ...opts, body }),
    patch: (path, body, opts) => send('PATCH', path, { ...opts, body }),
    delete: (path, opts) => send('DELETE', path, opts),
    cookieValue: (name) => jar.get(name),
    cookieHeader: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

/**
 * 原样发送请求目标的 GET（不经任何客户端归一化），用于路径穿越 / 白名单用例：
 * `node:http` 客户端可能改写 `..`，而穿透防护必须按**线上真实请求目标**判。
 */
export async function rawGet(port, requestTarget, { headers = {}, method = 'GET' } = {}) {
  const socket = connect({ host: '127.0.0.1', port });
  let raw = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('data', (d) => {
      raw = Buffer.concat([raw, d]);
    });
    socket.on('connect', () => {
      const lines = [`${method} ${requestTarget} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Connection: close'];
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    socket.on('end', () => {
      const text = raw.toString('utf8');
      const split = text.indexOf('\r\n\r\n');
      const head = split >= 0 ? text.slice(0, split) : text;
      const body = split >= 0 ? text.slice(split + 4) : '';
      const status = Number((head.match(/^HTTP\/1\.[01]\s+(\d{3})/) ?? [])[1] ?? 0);
      const parsed = {};
      for (const line of head.split('\r\n').slice(1)) {
        const idx = line.indexOf(':');
        if (idx > 0) parsed[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }
      resolve({ status, headers: parsed, body, raw: text });
    });
  });
}

/**
 * 同 `rawGet`，但**保留线上原始字节**（不做 utf8 解码）。
 * 二进制素材（主图 .jpg）的「真的原样送出」只能按字节判：utf8 解码会把坏字节静默换成 U+FFFD，
 * 文本长度看着还对，坏字节却看不见了。
 */
export async function rawGetBytes(port, requestTarget, { headers = {}, method = 'GET' } = {}) {
  const socket = connect({ host: '127.0.0.1', port });
  let raw = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('data', (d) => {
      raw = Buffer.concat([raw, d]);
    });
    socket.on('connect', () => {
      const lines = [`${method} ${requestTarget} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Connection: close'];
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    socket.on('end', () => {
      const split = raw.indexOf('\r\n\r\n');
      const head = (split >= 0 ? raw.subarray(0, split) : raw).toString('utf8');
      let body = split >= 0 ? raw.subarray(split + 4) : Buffer.alloc(0);
      const status = Number((head.match(/^HTTP\/1\.[01]\s+(\d{3})/) ?? [])[1] ?? 0);
      const parsed = {};
      for (const line of head.split('\r\n').slice(1)) {
        const idx = line.indexOf(':');
        if (idx > 0) parsed[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }
      if (/chunked/i.test(parsed['transfer-encoding'] ?? '')) {
        const out = [];
        let pos = 0;
        while (pos < body.length) {
          const nl = body.indexOf('\r\n', pos);
          if (nl < 0) break;
          const size = parseInt(body.subarray(pos, nl).toString('ascii'), 16);
          if (!Number.isFinite(size) || size === 0) break;
          out.push(body.subarray(nl + 2, nl + 2 + size));
          pos = nl + 2 + size + 2;
        }
        body = Buffer.concat(out);
      }
      resolve({ status, headers: parsed, body });
    });
  });
}

/** 建立一条请求后立刻掐断连接（客户端中断场景）。 */
export function abortMidRequest(app, { method = 'POST', path = '/api/v1/auth/login', headers = {}, partialBody = '{"email":"' } = {}) {
  return new Promise((resolve) => {
    const req = request(
      { host: '127.0.0.1', port: app.port, method, path, headers: { 'content-type': 'application/json', ...headers }, agent: false },
      () => {},
    );
    req.on('error', () => {});
    req.write(partialBody);
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 30);
  });
}

// ── ② 子进程运维面取样 ─────────────────────────────────────────────────────

/** 取一个空闲端口（先 listen(0) 再关）。 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** 真 HTTP 端口探测：返回首个成功响应，超时返回 null。 */
export async function waitForHttp(port, path = '/health', { timeoutMs = 8000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'GET' });
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  void lastErr;
  return null;
}

/** TCP 层可连（不判 HTTP 语义）。 */
export async function waitForTcp(port, { timeoutMs = 8000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.on('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(true);
    });
  });
}

/** 起真服务子进程（运维面判据专用）；退出码由 `exited` 直接给出，不走管道。 */
export function startServerProcess(env, { args = [SERVER_ENTRY], clean = false } = {}) {
  const base = clean ? { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR } : process.env;
  // `--import` 给子进程装同一只看门狗：worker 被硬杀时子进程随父自杀，不留常驻监听孤儿。
  const watchdog = new URL('./parent-watchdog.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--import', watchdog, ...args], {
    cwd: REPO_ROOT,
    env: { ...base, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  LIVE_CHILDREN.add(child);
  child.on('exit', () => LIVE_CHILDREN.delete(child));
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    pid: child.pid,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    exited,
    async stop(signal = 'SIGTERM', timeoutMs = 8000) {
      if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
      child.kill(signal);
      const result = await Promise.race([
        exited,
        new Promise((r) => setTimeout(() => r(null), timeoutMs)),
      ]);
      if (result === null) {
        child.kill('SIGKILL');
        return exited;
      }
      return result;
    },
  };
}

/** 子进程装置的安全网：无论成败都确保进程不再存活。 */
export async function withServerProcess(env, fn, opts) {
  const proc = startServerProcess(env, opts);
  try {
    return await fn(proc);
  } finally {
    await proc.stop('SIGKILL', 4000);
  }
}

/** 把子进程 stdout 逐行解析成结构化日志对象（非 JSON 行返回 null）。 */
export function parseLogLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // 非 JSON 行（如启动期告警）不计入结构化日志。
    }
  }
  return out;
}

/** 该进程当前 LISTEN 的 TCP 端口（lsof；不可用时返回 null）。 */
export function listeningPorts(pid) {
  try {
    const out = execFileSync('lsof', ['-p', String(pid), '-a', '-iTCP', '-sTCP:LISTEN', '-P', '-n'], {
      encoding: 'utf8',
    });
    const ports = new Set();
    for (const line of out.split('\n').slice(1)) {
      const m = line.match(/:(\d+)\s*\(LISTEN\)/);
      if (m) ports.add(Number(m[1]));
    }
    return [...ports];
  } catch {
    return null;
  }
}

/** 本机第一个非回环 IPv4（无可用网卡时返回 null）。 */
export function nonLoopbackIPv4() {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

/**
 * 打开一条「体未发完」的 chunked 请求：连接一直挂在服务端，用于构造
 * 「停机时确有在途连接」与「慢请求」两个确定性场景（不靠 sleep 抢时序）。
 */
export function openChunkedRequest({ port, method = 'POST', path, headers = {} } = {}) {
  const socket = connect({ host: '127.0.0.1', port });
  let raw = '';
  const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('data', (d) => {
      raw += d.toString();
    });
    socket.on('connect', () => {
      socket.write(
        [
          `${method} ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Transfer-Encoding: chunked',
          'Content-Type: application/json',
          'Accept: application/json',
          ...extra,
          '',
          '',
        ].join('\r\n'),
      );
      resolve({
        socket,
        raw: () => raw,
        finish: () => socket.write('0\r\n\r\n'),
        destroy: () => socket.destroy(),
        waitForEnd: (timeoutMs = 8000) =>
          new Promise((res) => {
            const timer = setTimeout(() => res(raw), timeoutMs);
            const done = () => {
              clearTimeout(timer);
              res(raw);
            };
            socket.on('end', done);
            socket.on('close', done);
          }),
      });
    });
  });
}

/** 从原始 HTTP 响应文本里取状态码（连接被持有/分块时 fetch 不适用）。 */
export function statusOfRaw(raw) {
  const m = String(raw).match(/^HTTP\/1\.[01]\s+(\d{3})/);
  return m ? Number(m[1]) : null;
}

/** 可注入的日志流（契约可测性缝 `logStream`）。 */export function makeLogSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return {
    stream,
    text: () => chunks.join(''),
    lines: () => parseLogLines(chunks.join('')),
  };
}

/** 注入式故障库：把已迁移好的库里的表删掉，制造确定性「库不可读」。 */
export function breakSchema(dbPath, what = 'products') {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`DROP TABLE IF EXISTS ${what}`);
  } finally {
    db.close();
  }
}

// ── ③ 临时库 / SQLite 探针 / 前端产物取样 ───────────────────────────────────

export function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

export function dbTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => ({ ...row }).name);
}

export function dbIndexes(db, table) {
  return db
    .prepare(`PRAGMA index_list('${table}')`)
    .all()
    .map((row) => ({ ...row }));
}

export function dbSchemaVersion(db) {
  if (!dbTables(db).includes('schema_migrations')) return null;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return row ? { ...row }.v : null;
}

export function dbOrderNoSeq(db) {
  if (!dbTables(db).includes('order_no_seq')) return null;
  return db
    .prepare('SELECT day, seq FROM order_no_seq ORDER BY day')
    .all()
    .map((row) => ({ ...row }));
}

/** 逐行读某个表的全部行（null 原型 → 展开成普通对象）。 */
export function dbRows(db, table, orderBy = '') {
  const sql = `SELECT * FROM ${table}${orderBy ? ` ORDER BY ${orderBy}` : ''}`;
  return db.prepare(sql).all().map((row) => ({ ...row }));
}

/** 数一个表的行数；表不存在时给出「迁移未落库」的明确判据（而不是抛 no such table）。 */
export function countRows(dbPath, table) {
  const db = openDb(dbPath);
  try {
    const tables = dbTables(db);
    assert.ok(
      tables.includes(table),
      `库内必须存在 ${table} 表（迁移未落库 / 未建 schema），实际表：${tables.join('、') || '（无表）'}`,
    );
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    return { ...row }.n;
  } finally {
    db.close();
  }
}

export function data(res) {
  assert.ok(res.json && typeof res.json === 'object', `响应体必须是 JSON 对象，实际：${res.raw.slice(0, 200)}`);
  return res.json;
}

/** 成功响应的载荷：顶层固定 `{ data: ... }`（与错误响应 `{code,message}` 互斥）。 */
export function payload(res) {
  const body = data(res);
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'data'),
    `成功响应顶层必须是 { data: ... }，实际键：${Object.keys(body).join(',')}（${res.raw.slice(0, 200)}）`,
  );
  return body.data;
}

export async function getHtml(app, path = '/') {
  const res = await newClient(app).get(path);
  assert.equal(res.status, 200, `${path} 必须 200（首帧 HTML 可取），实际 ${res.status}`);
  assert.ok(String(res.headers['content-type']).includes('text/html'), `content-type 必须 text/html，实际 ${res.headers['content-type']}`);
  return { res, raw: res.raw, dom: new JSDOM(res.raw) };
}

/** 取「页面实际会加载的样式文本」：外链样式表 + 内联 <style>（不写死文件名）。 */
export async function getStyleText(app, path = '/') {
  const { res, raw, dom } = await getHtml(app, path);
  const client = newClient(app);
  const parts = [raw];
  for (const link of dom.window.document.querySelectorAll('link[rel="stylesheet"][href]')) {
    const href = link.getAttribute('href');
    const url = new URL(href, `http://127.0.0.1:${app.port}/`);
    if (url.port !== String(app.port)) continue;
    const asset = await client.get(url.pathname + url.search);
    if (asset.status === 200) parts.push(asset.raw);
  }
  return { html: res, css: parts.join('\n'), text: parts.join('\n').toLowerCase() };
}

/** 取页面实际会加载的模块源码文本（沿静态 import 递归，最多 40 个模块）。 */
export async function getModuleText(app, path = '/') {
  const { dom } = await getHtml(app, path);
  const client = newClient(app);
  const seen = new Set();
  const texts = [];
  const queue = [];
  for (const s of dom.window.document.querySelectorAll('script[type="module"][src]')) queue.push(s.getAttribute('src'));
  while (queue.length > 0 && seen.size < 40) {
    const href = queue.shift();
    const url = new URL(href, `http://127.0.0.1:${app.port}/`);
    if (url.port !== String(app.port)) continue;
    const key = url.pathname + url.search;
    if (seen.has(key)) continue;
    seen.add(key);
    const asset = await client.get(key);
    if (asset.status !== 200) continue;
    texts.push(asset.raw);
    for (const m of asset.raw.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      queue.push(new URL(m[1], url).pathname);
    }
  }
  return { text: texts.join('\n'), modules: [...seen], js: texts.join('\n') };
}

// ── 业务取数（一律按名称定位商品，禁写死主键） ──────────────────────────────

export async function listProducts(client, path = '/api/v1/products') {
  const res = await client.get(path);
  assert.equal(res.status, 200, `商品列表必须 200，实际 ${res.status}：${res.raw.slice(0, 200)}`);
  const items = payload(res);
  assert.ok(Array.isArray(items), `商品列表必须是 { data: Product[] }：${res.raw.slice(0, 200)}`);
  return items;
}

export async function productByName(client, name) {
  const items = await listProducts(client);
  const hit = items.find((item) => item.name === name);
  assert.ok(hit, `种子商品必须含「${name}」，实际有：${items.map((i) => i.name).join('、')}`);
  return hit;
}

export async function productAt(client, index = 0) {
  const items = await listProducts(client);
  assert.ok(items.length > index, `商品列表至少要有 ${index + 1} 件，实际 ${items.length}`);
  return items[index];
}

export const addItem = (client, productId, quantity) =>
  client.post('/api/v1/cart/items', { productId, quantity });

export const getCart = async (client) => payload(await client.get('/api/v1/cart'));
export const getOrders = async (client) => {
  const orders = payload(await client.get('/api/v1/orders'));
  assert.ok(Array.isArray(orders), '订单列表必须是 { data: Order[] }');
  return orders;
};
export const getOrder = async (client, orderNo) => client.get(`/api/v1/orders/${orderNo}`);
export const getMe = async (client) => payload(await client.get('/api/v1/auth/me'));

export const register = (client, email, password) =>
  client.post('/api/v1/auth/register', { email, password });
export const login = (client, email, password) =>
  client.post('/api/v1/auth/login', { email, password });
export const logout = (client) => client.post('/api/v1/auth/logout');
export const me = (client) => client.get('/api/v1/auth/me');

/** 注册并返回账号（失败即断言失败，避免后续用例在「没登录」的假前提上跑）。 */
export async function registerOrFail(client, email, password) {
  const res = await register(client, email, password);
  assert.equal(res.status, 201, `注册必须 201，实际 ${res.status}：${res.raw.slice(0, 200)}`);
  const body = payload(res);
  assert.ok(body && typeof body.user === 'object', '注册响应必须是 { data: { user } }');
  return body.user;
}

let emailSeq = 0;
export function uniqueEmail(prefix = 'buyer') {
  emailSeq += 1;
  const stamp = `${Date.now().toString(36)}${emailSeq.toString(36)}`;
  return `${prefix}-${stamp}@example.com`;
}

/** 合法种子：条数任意、只校验字段合法性（名称可注入前缀，便于按名称定位）。 */
export function makeSeed(count = 8, { prefix = '种子商品' } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `S-${String(i + 1).padStart(3, '0')}`,
    name: `${prefix}${i + 1}`,
    priceCents: 100 * (i + 1) + 99,
    stock: 8,
  }));
}

// ── 断言小组件 ─────────────────────────────────────────────────────────────

export function assertErrorShape(res, { status, code }) {
  assert.equal(res.status, status, `状态码必须 ${status}，实际 ${res.status}：${res.raw.slice(0, 200)}`);
  const body = data(res);
  assert.equal(typeof body.code, 'string', `错误响应必须含字符串 code：${res.raw.slice(0, 200)}`);
  assert.ok(ERROR_CODES.includes(body.code), `code 必须落在封闭词表内，实际 ${body.code}`);
  if (code !== undefined) assert.equal(body.code, code, `code 必须为 ${code}，实际 ${body.code}`);
  assert.equal(typeof body.message, 'string', '错误响应必须含字符串 message');
  assert.ok(body.message.length > 0, '错误 message 不得为空串');
  assert.equal('stack' in body, false, '错误响应不得含 stack');
  for (const pattern of INTERNAL_LEAK_PATTERNS) {
    assert.equal(pattern.test(res.raw), false, `错误响应体命中内部实现特征 ${pattern}：${res.raw.slice(0, 300)}`);
  }
  return body;
}

export function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

/** 读仓库内文本文件；缺失时给出「交付物缺失」的明确判据。 */
export function repoText(relPath) {
  assert.ok(repoFileExists(relPath), `交付物缺失：${relPath}`);
  return readRepoFile(relPath);
}

export function repoFileExists(relPath) {
  return existsSync(join(REPO_ROOT, relPath));
}

/** 资源文件的内容指纹（`AC-31` v3 口径：文件**字节**的 `sha256` 前 10 位 hex，小写）。 */
export function contentFingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

/**
 * 递归解析 JPEG 段结构，走**完整文件**（`AC-48` ③ v3：由「头部自证」升级为「结构化完整性」）。
 *
 * 判据句（PRD `AC-48` ③）：从 `SOI`（`FF D8`）起逐段读 2 字节大端段长（必须 ≥ 2 且落在文件剩余长度内）并跳过该段；
 * 必须出现 `SOF`（`FFC0`~`FFCF`，排除 `C4`/`C8`/`CC`；基线 `C0` 与渐进 `C2` 都要覆盖）；`SOS` 之后必须有**非空熵数据**；
 * 文件必须以 `EOI`（`FF D9`）结束且解析一致走到文件尾。
 *
 * ⚠ 明确边界（PRD 明写，不得越界承诺）：本函数只保证**结构完整**；「能否被真实解码器解出图像」属**人工 / 真机判断**。
 * ⚠ 为什么必须走完整文件：32 字节量级的伪 JPEG（`SOI` + 合法 `SOF0` 400×400 + `SOS` + `EOI`、**熵数据为空**）
 *   能骗过「magic bytes + 头部 `SOF` 自证」而不被解出任何图像（logic-review 反例，已固化为回归断言）。
 *
 * @returns {{ok: true, sof: {marker:number,bits:number,height:number,width:number}, entropyBytes:number, eoiAt:number}
 *          | {ok: false, reason: string}}
 */
export function jpegStructure(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { ok: false, reason: '缺少 SOI（FF D8）' };
  let pos = 2;
  let sof = null;
  for (;;) {
    if (pos + 1 >= buf.length) {
      return { ok: false, reason: `走到文件尾仍未见到 SOS（已解析到偏移 ${pos}/${buf.length}）` };
    }
    if (buf[pos] !== 0xff) {
      return { ok: false, reason: `段边界处不是标记（偏移 ${pos} 的字节 = 0x${buf[pos].toString(16)}）` };
    }
    let marker = buf[pos + 1];
    while (marker === 0xff) {
      // `FF FF …` 填充字节：跳过
      pos += 1;
      marker = buf[pos + 1];
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // 独立标记（TEM / RSTn）：无段长
      pos += 2;
      continue;
    }
    if (marker === 0xd9) return { ok: false, reason: `SOS 之前就出现 EOI（偏移 ${pos}）—— 没有图像数据` };
    if (pos + 3 >= buf.length) return { ok: false, reason: `段长字段越界（偏移 ${pos}，文件长 ${buf.length}）` };
    const length = buf.readUInt16BE(pos + 2);
    if (length < 2) {
      return { ok: false, reason: `段长必须 ≥ 2，实际 ${length}（偏移 ${pos}，标记 0x${marker.toString(16)}）` };
    }
    if (pos + 2 + length > buf.length) {
      return {
        ok: false,
        reason: `段长越界：偏移 ${pos} + 2 + ${length} = ${pos + 2 + length} > 文件长 ${buf.length}（标记 0x${marker.toString(16)}）`,
      };
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && sof === null) {
      if (length < 8) return { ok: false, reason: `SOF 段长过短（${length}），读不出宽高` };
      sof = {
        marker,
        bits: buf[pos + 4],
        height: buf.readUInt16BE(pos + 5),
        width: buf.readUInt16BE(pos + 7),
      };
    }
    if (marker === 0xda) {
      // SOS：紧邻段头之后、EOI 之前必须有非空熵编码数据；文件必须以 EOI 结束（= 解析一致走到文件尾）
      const scanStart = pos + 2 + length;
      const tail = buf.subarray(buf.length - 2);
      if (tail[0] !== 0xff || tail[1] !== 0xd9) {
        return { ok: false, reason: `文件未以 EOI（FF D9）结束，最后 2 字节 = ${[...tail].map((b) => b.toString(16).padStart(2, '0')).join(' ')}` };
      }
      const entropyBytes = buf.length - 2 - scanStart;
      if (entropyBytes <= 0) {
        return { ok: false, reason: `SOS 之后没有熵编码数据（空扫描：${entropyBytes} 字节）—— 头部自证合法但解不出图像` };
      }
      return { ok: true, sof, entropyBytes, eoiAt: buf.length - 2 };
    }
    pos += 2 + length;
  }
}

