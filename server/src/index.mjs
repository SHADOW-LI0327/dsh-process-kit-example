/**
 * 真实进程入口：只做两件事 —— 建应用、监听端口。
 * 所有业务与路由都在 `createApp()` 里，便于测试注入种子 / 存储而不起常驻服务。
 */
import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.server.listen(port, '127.0.0.1', () => {
  const address = app.server.address();
  const actual = address && typeof address === 'object' ? address.port : port;
  process.stdout.write(`电商小铺已启动：http://127.0.0.1:${actual}/\n`);
});
