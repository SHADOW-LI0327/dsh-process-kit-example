#!/usr/bin/env bash
# FEAT-002 UAT · P-04 / P-07 / P-09 / P-10 复跑（修正取退出码方式：不用命令替换、直接 wait 子进程）
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
mkdir -p "$EV"
SECRET="$(openssl rand -hex 32)"
DATA="$(pwd)/$EV/data"; mkdir -p "$DATA"
H=127.0.0.1
PID=""

echo "##### P-04 优雅停机（退出码 + 在途请求）#####"
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3121 DB_PATH="$DATA/p04c.db" node server/src/index.mjs > "$EV/p04c.log" 2>&1 &
PID=$!
sleep 1.8
echo "-- 停机前 /health: $(curl -s -o /dev/null -w '%{http_code}' http://$H:3121/health)"
# 在途请求：以 ~20KB/s 上传 100KB 合法 body（约 5 秒），1.2 秒后发 SIGTERM
BODY="$EV/p04c-big.json"
python3 - "$BODY" <<'PY'
import sys
open(sys.argv[1],'w').write('{"productId":"P-001","quantity":1,"pad":"' + 'a'*100000 + '"}')
PY
curl -s -o "$EV/p04c-inflight.body" -w "status=%{http_code}" --limit-rate 20k -X POST -H 'content-type: application/json' \
  --data-binary @"$BODY" http://$H:3121/api/v1/cart/items > "$EV/p04c-inflight.status" 2>"$EV/p04c-inflight.err" &
CURLPID=$!
sleep 1.2
kill -TERM "$PID"
NEWCONN=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://$H:3121/health 2>/dev/null || echo "连接失败")
wait "$CURLPID"; CURLRC=$?
wait "$PID"; RC=$?
echo "-- SIGTERM 后立刻新建连接探测: ${NEWCONN:-空}"
echo "-- 在途 curl: rc=$CURLRC $(cat "$EV/p04c-inflight.status") 响应体=$(head -c 120 "$EV/p04c-inflight.body") stderr=$(head -c 120 "$EV/p04c-inflight.err")"
echo "-- 服务进程退出码 rc=$RC （0 = 优雅退出）"
echo "-- 停机日志尾部:"; tail -4 "$EV/p04c.log" | sed 's/^/  /'
echo "-- 端口是否释放:"; lsof -nP -iTCP:3121 -sTCP:LISTEN | tail -n +2 | sed 's/^/  /'; echo "  (无输出=已释放)"

echo; echo "##### P-07 进程兜底（未捕获异常 → 非零退出）#####"
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3122 DB_PATH="$DATA/p07b.db" node --inspect=127.0.0.1:9332 server/src/index.mjs > "$EV/p07b.log" 2>&1 &
PID=$!
sleep 2.5
echo "-- 起服后 /health: $(curl -s -o /dev/null -w '%{http_code}' http://$H:3122/health)"
node -e '
(async()=>{
 const list=await (await fetch("http://127.0.0.1:9332/json/list")).json();
 const t=list.find(x=>x.type==="node");
 const ws=new WebSocket(t.webSocketDebuggerUrl);
 let id=0;const pend=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
 await new Promise(r=>ws.onopen=r);
 const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
 await send("Runtime.evaluate",{expression:"setTimeout(()=>{throw new Error(\"UAT-P07b-uncaught-probe\")},0);1",returnByValue:true});
 ws.close();
})().catch(e=>console.log("  inspector 失败:",e.message));'
sleep 2
if kill -0 "$PID" 2>/dev/null; then echo "  进程仍在运行（兜底未生效）"; kill -TERM "$PID"; wait "$PID"; echo "  手动收尾 rc=$?"; else wait "$PID"; echo "  未捕获异常后 rc=$? （非 0 = 兜底生效）"; fi
echo "  日志尾部:"; tail -4 "$EV/p07b.log" | sed 's/^/    /'

echo; echo "##### P-07b 未处理拒绝 #####"
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3123 DB_PATH="$DATA/p07c.db" node --inspect=127.0.0.1:9333 server/src/index.mjs > "$EV/p07c.log" 2>&1 &
PID=$!
sleep 2.5
node -e '
(async()=>{
 const list=await (await fetch("http://127.0.0.1:9333/json/list")).json();
 const t=list.find(x=>x.type==="node");
 const ws=new WebSocket(t.webSocketDebuggerUrl);
 let id=0;const pend=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
 await new Promise(r=>ws.onopen=r);
 const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
 await send("Runtime.evaluate",{expression:"Promise.reject(new Error(\"UAT-P07c-unhandled-rejection\"));1",returnByValue:true});
 ws.close();
})().catch(e=>console.log("  inspector 失败:",e.message));'
sleep 2
if kill -0 "$PID" 2>/dev/null; then echo "  进程仍在运行（未处理拒绝未触发退出）"; kill -TERM "$PID"; wait "$PID"; echo "  手动收尾 rc=$?"; else wait "$PID"; echo "  未处理拒绝后 rc=$?"; fi
echo "  日志尾部:"; tail -4 "$EV/p07c.log" | sed 's/^/    /'

echo; echo "##### P-09 请求体上限（合法 body 对照）#####"
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3124 DB_PATH="$DATA/p09b.db" node server/src/index.mjs > "$EV/p09b.log" 2>&1 &
PID=$!; sleep 1.8
echo "-- 正常 body:"; curl -s -w " status=%{http_code}\n" -X POST -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' http://$H:3124/api/v1/cart/items
BIG=$(head -c 200000 /dev/zero | tr '\0' 'a')
echo "-- 200000 字节 body:"; curl -s -w " status=%{http_code}\n" -X POST -H 'content-type: application/json' --data-binary "{\"productId\":\"P-001\",\"quantity\":1,\"pad\":\"$BIG\"}" http://$H:3124/api/v1/cart/items
echo "-- 恰好 131072 字节 body（上限边界）:"
python3 - "$EV/p09b-edge.json" <<'PY'
import sys,json
payload={"productId":"P-001","quantity":1,"pad":""}
base=len(json.dumps(payload))
payload["pad"]="a"*(131072-base)
open(sys.argv[1],'w').write(json.dumps(payload))
PY
echo "   实际字节数: $(wc -c < "$EV/p09b-edge.json")"
curl -s -w " status=%{http_code}\n" -X POST -H 'content-type: application/json' --data-binary @"$EV/p09b-edge.json" http://$H:3124/api/v1/cart/items
kill -TERM "$PID"; wait "$PID"

echo; echo "##### P-10 限流（RATE_LIMIT_MAX=3，合法 body）#####"
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3125 DB_PATH="$DATA/p10b.db" RATE_LIMIT_MAX=3 RATE_LIMIT_WINDOW_MS=60000 node server/src/index.mjs > "$EV/p10b.log" 2>&1 &
PID=$!; sleep 1.8
for i in 1 2 3 4 5; do
  code=$(curl -s -o "$EV/p10b.$i.body" -w "%{http_code}" -X POST -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' http://$H:3125/api/v1/cart/items)
  echo "  第 $i 次写请求 status=$code body=$(head -c 90 "$EV/p10b.$i.body")"
done
echo "-- 读请求: $(curl -s -o /dev/null -w '%{http_code}' http://$H:3125/api/v1/products)"
echo "-- 响应头（第 4 次）是否带 Retry-After:"
curl -s -D - -o /dev/null -X POST -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' http://$H:3125/api/v1/cart/items | grep -iE '^(HTTP|retry-after|x-ratelimit)' | sed 's/^/  /'
kill -TERM "$PID"; wait "$PID"

echo; echo "##### 收尾自查 #####"
for p in 3121 3122 3123 3124 3125 9332 9333; do lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | sed "s/^/  [$p] /"; done; echo "(无输出 = 无残留)"
