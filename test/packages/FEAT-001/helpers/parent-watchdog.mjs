/**
 * 父进程存活看门狗（**装置卫生件，不是产品代码**）。
 *
 * 为什么需要：`node --test` 的 runner 被**硬杀**（SIGKILL，例如 `job_kill`/超时/终端被关）时，
 * 信号不会传播给 worker，worker 里 `finally` 也就永远等不到执行 —— 于是一个「父已亡、cwd=本仓、
 * 持 127.0.0.1:<随机端口>」的孤儿进程会常驻监听（本仓实测残留形态，`PID 30005` 同类）。
 * 看门狗用 POSIX 的 reparent 语义兜住这一类：父退出后子进程的 `ppid` 会被改成 1（或被 launchd 收养），
 * 与装载时的初值一比即可判定「父已亡」，随即自杀。
 *
 * 两处装载：
 *  ① `harness.mjs` 顶层副作用 import —— 覆盖**测试 worker 自己**持 in-process 监听（`withApp`/`startApp`）的用例；
 *  ② `startServerProcess()` 以 `--import` 预加载 —— 覆盖 worker **spawn 的真服务子进程**。
 *
 * 安全边界：初值本就是 1（父已不在）时**不启用**，避免在 init 下误杀；定时器 `unref()`，
 * 绝不因为看门狗而拖住任何进程的退出。
 */
const initialPpid = process.ppid;

if (initialPpid > 1) {
  const timer = setInterval(() => {
    let parentAlive = true;
    if (process.ppid !== initialPpid) {
      parentAlive = false; // 被 reparent ⇒ 父已退出（SIGKILL 也能判到）
    } else {
      try {
        process.kill(initialPpid, 0);
      } catch {
        parentAlive = false;
      }
    }
    if (!parentAlive) process.exit(1);
  }, 400);
  timer.unref();
}
