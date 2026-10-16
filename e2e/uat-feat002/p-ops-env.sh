#!/usr/bin/env bash
# FEAT-002 UAT · P-01~P-11 黑盒运维操作取证（照 docs/DEPLOY.md 起法，自起实例、采自己的 stdout）
# 全部命令与原始读数会打印到 stdout；调用方负责落盘到 reports/uat/evidence/**。
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
mkdir -p "$EV"
SECRET="$(openssl rand -hex 32)"
DATA="$(pwd)/$EV/data"
mkdir -p "$DATA"
H=127.0.0.1

start() { # start <tag> <port> <extra env...>
  local tag="$1"; local port="$2"; shift 2
  env "$@" NODE_ENV=production SESSION_SECRET="$SECRET" PORT="$port" node server/src/index.mjs > "$EV/$tag.log" 2>&1 &
  echo $!
}
probe() { # probe <port> <path>
  curl -s -o "$EV/curl.out" -w "%{http_code}" "http://$H:$1$2"; echo; cat "$EV/curl.out"; echo
}

echo "##### P-01 PORT 可配置 #####"
PID1=$(start p01 3101); sleep 1.6
echo "-- GET /health on 3101:"; probe 3101 /health
echo "-- listening sockets:"; lsof -nP -iTCP:3101 -sTCP:LISTEN | tail -n +1
echo "-- 自采 stdout/stderr 首两行:"; head -2 "$EV/p01.log"
kill -TERM "$PID1" 2>/dev/null; wait "$PID1" 2>/dev/null; echo "rc_after_TERM=$?"

echo; echo "##### P-02 HOST 可配置（默认 vs 0.0.0.0）#####"
PID2=$(start p02 3102); sleep 1.6
echo "-- 默认 HOST 的监听行:"; lsof -nP -iTCP:3102 -sTCP:LISTEN
kill -TERM "$PID2" 2>/dev/null; wait "$PID2" 2>/dev/null
PID2B=$(start p02b 3103 HOST=0.0.0.0); sleep 1.6
echo "-- HOST=0.0.0.0 的监听行:"; lsof -nP -iTCP:3103 -sTCP:LISTEN
echo "-- 从本机环回仍可访问:"; probe 3103 /health
kill -TERM "$PID2B" 2>/dev/null; wait "$PID2B" 2>/dev/null

echo; echo "##### P-03 非法配置启动即失败、点名变量 #####"
run_bad() { # run_bad <tag> <env assignments...>
  local tag="$1"; shift
  env "$@" node server/src/index.mjs > "$EV/$tag.log" 2>&1
  echo "  [$tag] exit=$? -- 最后两行:"; tail -2 "$EV/$tag.log" | sed 's/^/    /'
}
run_bad bad_nosecret NODE_ENV=production PORT=3104
run_bad bad_shortsecret NODE_ENV=production SESSION_SECRET=tooshort PORT=3104
run_bad bad_port NODE_ENV=production SESSION_SECRET="$SECRET" PORT=abc
run_bad bad_loglevel NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3104 LOG_LEVEL=verbose
run_bad bad_bodylimit NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3104 BODY_LIMIT_BYTES=-1
run_bad bad_ratelimit NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3104 RATE_LIMIT_MAX=0
run_bad bad_dbpath NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3104 DB_PATH=/nonexistent-dir/x/shop.db

echo; echo "##### P-04 优雅停机（SIGTERM / SIGINT）#####"
PID4=$(start p04 3105 DB_PATH="$DATA/p04.db"); sleep 1.8
echo "-- 停机前 /health:"; probe 3105 /health
kill -TERM "$PID4"; wait "$PID4"; echo "rc_SIGTERM=$?"
echo "-- 停机后端口是否释放（应无输出）:"; lsof -nP -iTCP:3105 -sTCP:LISTEN
echo "-- 停机日志尾部:"; tail -3 "$EV/p04.log" | sed 's/^/  /'
PID4B=$(start p04b 3106 DB_PATH="$DATA/p04b.db"); sleep 1.8
kill -INT "$PID4B"; wait "$PID4B"; echo "rc_SIGINT=$?"
echo "-- SIGINT 日志尾部:"; tail -3 "$EV/p04b.log" | sed 's/^/  /'

echo; echo "##### P-05 健康 / 就绪探针 #####"
PID5=$(start p05 3107 DB_PATH="$DATA/p05.db"); sleep 1.8
echo "-- /health 原始响应与状态码:"; curl -s -D "$EV/p05.headers" -o "$EV/p05.body" -w "status=%{http_code}\n" http://$H:3107/health; cat "$EV/p05.body"; echo
echo "-- 响应头:"; cat "$EV/p05.headers" | sed 's/^/  /'
echo "-- 库损坏后 /health 再探（把库文件换成目录，观察是否 503 且进程不死）:"
mv "$DATA/p05.db" "$DATA/p05.db.bak" 2>/dev/null; mkdir -p "$DATA/p05.db" 2>/dev/null
curl -s -o "$EV/p05b.body" -w "status=%{http_code}\n" http://$H:3107/health; cat "$EV/p05b.body"; echo
echo "-- 进程是否仍活着:"; lsof -nP -iTCP:3107 -sTCP:LISTEN || echo "(进程已退出)"
kill -TERM "$PID5" 2>/dev/null; wait "$PID5" 2>/dev/null
rmdir "$DATA/p05.db" 2>/dev/null; mv "$DATA/p05.db.bak" "$DATA/p05.db" 2>/dev/null
unset PID5

echo; echo "##### P-06 结构化请求日志（自采实例 stdout）#####"
PID6=$(start p06 3108 DB_PATH="$DATA/p06.db"); sleep 1.8
curl -s -o /dev/null http://$H:3108/; curl -s -o /dev/null http://$H:3108/api/v1/products; curl -s -o /dev/null -X POST -H 'content-type: application/json' -d '{"productId":"P-001"}' http://$H:3108/api/v1/cart/items
sleep 0.6; echo "-- 本实例 stdout 的请求日志行（我的进程自己打出来的）:"; grep -c '"' "$EV/p06.log" >/dev/null 2>&1
sed -n '1,12p' "$EV/p06.log" | sed 's/^/  /'
echo "-- 日志行数:"; wc -l < "$EV/p06.log"
echo "-- 含 request-id / 状态 / 耗时的行数:"
grep -cE '"req(uest)?[_-]?id"|"requestId"' "$EV/p06.log" 2>/dev/null || true
kill -TERM "$PID6" 2>/dev/null; wait "$PID6" 2>/dev/null

echo; echo "##### P-08 安全响应头 #####"
curl -s -D - -o /dev/null http://$H:3000/ | sed 's/^/  /'
curl -s -D - -o /dev/null http://$H:3000/api/v1/products | sed 's/^/  /'

echo; echo "##### P-09 请求体上限 #####"
PID9=$(start p09 3109 DB_PATH="$DATA/p09.db"); sleep 1.8
BIG=$(head -c 200000 /dev/zero | tr '\0' 'a')
echo "-- 发送 200000 字节 body:"
curl -s -o "$EV/p09.body" -w "status=%{http_code}\n" -X POST -H 'content-type: application/json' \
  --data-binary "{\"productId\":\"P-001\",\"pad\":\"$BIG\"}" http://$H:3109/api/v1/cart/items
cat "$EV/p09.body"; echo
echo "-- 小 body 对照:"; curl -s -o /dev/null -w "status=%{http_code}\n" -X POST -H 'content-type: application/json' -d '{"productId":"P-001"}' http://$H:3109/api/v1/cart/items

echo; echo "##### P-10 限流（自设 RATE_LIMIT_MAX=3）#####"
PID10=$(start p10 3110 DB_PATH="$DATA/p10.db" RATE_LIMIT_MAX=3 RATE_LIMIT_WINDOW_MS=60000); sleep 1.8
for i in 1 2 3 4 5; do
  code=$(curl -s -o "$EV/p10.$i.body" -w "%{http_code}" -X POST -H 'content-type: application/json' -d '{"productId":"P-001"}' http://$H:3110/api/v1/cart/items)
  echo "  第 $i 次写请求 status=$code body=$(cat "$EV/p10.$i.body")"
done
echo "-- 读请求是否也被限（不应被限）:"; curl -s -o /dev/null -w "GET /api/v1/products status=%{http_code}\n" http://$H:3110/api/v1/products
kill -TERM "$PID10" 2>/dev/null; wait "$PID10" 2>/dev/null
kill -TERM "$PID9" 2>/dev/null; wait "$PID9" 2>/dev/null

echo; echo "##### P-11 静态缓存策略 #####"
echo "-- HTML:"; curl -s -D - -o /dev/null http://$H:3000/ | grep -iE '^(HTTP|cache-control|etag|last-modified)' | sed 's/^/  /'
ASSET=$(curl -s http://$H:3000/ | grep -oE '/src/[a-z.]+\.mjs\?v=[a-f0-9]+' | head -1)
echo "-- 指纹脚本 $ASSET:"; curl -s -D - -o /dev/null "http://$H:3000$ASSET" | grep -iE '^(HTTP|cache-control|etag)' | sed 's/^/  /'
echo "-- 图片 /assets/products/P-001.svg:"; curl -s -D - -o /dev/null http://$H:3000/assets/products/P-001.svg | grep -iE '^(HTTP|cache-control|etag)' | sed 's/^/  /'
echo "-- HTML 协商缓存（带 If-None-Match 再取）:"
ET=$(curl -s -D - -o /dev/null http://$H:3000/ | grep -i '^etag' | tr -d '\r' | cut -d' ' -f2)
if [ -n "${ET:-}" ]; then curl -s -o /dev/null -w "  If-None-Match: $ET -> status=%{http_code}\n" -H "If-None-Match: $ET" http://$H:3000/; else echo "  (无 ETag)"; fi

echo; echo "##### P-07 进程兜底（未捕获异常 / 未处理拒绝）#####"
PID7=$(env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3111 DB_PATH="$DATA/p07.db" node --inspect=127.0.0.1:9331 server/src/index.mjs > "$EV/p07.log" 2>&1 & echo $!)
sleep 2.5
curl -s -o /dev/null -w "  起服后 /health status=%{http_code}\n" http://$H:3111/health
node -e '
const port=9331;
(async()=>{
 const list=await (await fetch("http://127.0.0.1:"+port+"/json/list")).json();
 const t=list.find(x=>x.type==="node");
 const ws=new WebSocket(t.webSocketDebuggerUrl);
 let id=0;const pend=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
 await new Promise(r=>ws.onopen=r);
 const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}));});
 const r=await send("Runtime.evaluate",{expression:"setTimeout(()=>{throw new Error(\"UAT-P07-uncaught-probe\")},0); 1",returnByValue:true});
 console.log("  inspector eval:",JSON.stringify(r.result&&r.result.result&&r.result.result.value));
 ws.close();
})().catch(e=>{console.log("  inspector 连接失败:",e.message)});
'
sleep 2
if kill -0 "$PID7" 2>/dev/null; then echo "  进程仍在 → 兜底未生效"; kill -TERM "$PID7"; wait "$PID7" 2>/dev/null; echo "  手动收尾 rc=$?"; else wait "$PID7" 2>/dev/null; echo "  进程已退出 rc=$?"; fi
echo "  实例日志尾部:"; tail -4 "$EV/p07.log" | sed 's/^/    /'

echo; echo "##### 收尾：残留监听自查 #####"
for p in 3101 3102 3103 3104 3105 3106 3107 3108 3109 3110 3111 9331; do lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | sed "s/^/  [$p] /"; done
echo "(以上无输出 = 无残留)"
