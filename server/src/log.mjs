/**
 * 结构化日志：一条记录一行 JSON，只写标准输出。
 *
 * 为什么不用 `console.log` + 字符串拼接：日志要能被机器读（容器里由采集器按行解析），
 * 所以字段是结构化的；`JSON.stringify` 会把消息里的换行转义，天然保证「一行一条」。
 *
 * 为什么时间字段用 `new Date(...).toISOString()` 而不是注入时钟的值：
 * 注入时钟（`options.now`）是**业务时间**（会话过期、订单号日期段），
 * 日志时间要的是**真实挂钟**，两者混用会让「按时间排查」失真。
 */
const LEVEL_ORDER = ['debug', 'info', 'warn', 'error'];

export function createLogger({ stream, level = 'info' } = {}) {
  const target = stream ?? process.stdout;
  const threshold = LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : 1;

  function emit(record) {
    const lvl = LEVEL_ORDER.includes(record.level) ? record.level : 'info';
    if (LEVEL_ORDER.indexOf(lvl) < threshold) return;
    const line = JSON.stringify({ time: new Date().toISOString(), ...record, level: lvl });
    try {
      target.write(`${line}\n`);
    } catch {
      // 日志流本身故障（管道关闭 / 磁盘满）不得把请求处理打死：丢弃该行即可。
    }
  }

  const at = (level_) => (fields = {}) => emit({ ...fields, level: level_ });
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (base) => {
      const bind = (level_) => (fields = {}) => emit({ ...base, ...fields, level: level_ });
      return { debug: bind('debug'), info: bind('info'), warn: bind('warn'), error: bind('error') };
    },
  };
}
