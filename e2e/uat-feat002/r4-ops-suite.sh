#!/usr/bin/env bash
# FEAT-002 UAT r4 · 端面/投产面（U-02 / U-14 / U-31~U-33 / U-36 / U-40~U-44 / U-48）
# 全部在**我自己的临时库 + 高位端口 + 我自己的 compose 项目（uater4）**上做；不碰托管实例的 3000。
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat"; OPS="$EV/ops"; mkdir -p "$OPS"
ROOT=$(pwd); H=127.0.0.1
D=$(mktemp -d /tmp/r4ops.XXXXXX) || exit 98
SEC=$(openssl rand -hex 32)
export DOCKER_CONFIG=/tmp/dockercfg
export DOCKER_BUILDKIT=0
export COMPOSE_PROJECT_NAME=uater4
DC="docker compose -f ${ROOT}/deploy/docker-compose.yml"
echo "临时库目录=$D  项目名=$COMPOSE_PROJECT_NAME  托管实例 3000 不动"
h() { echo; echo "##### $* #####"; }
start() { # port db log
  env NODE_ENV=production SESSION_SECRET="$SEC" PORT="$1" DB_PATH="$2" node server/src/index.mjs > "$3" 2>&1 &
  SPID=$!
  for i in $(seq 1 40); do curl -s -o /dev/null "http://$H:$1/health" && return 0; sleep 0.5; done
  return 1
}
stopit() { kill -TERM "$1" 2>/dev/null; wait "$1" 2>/dev/null; echo "  停止 rc=$?"; }

h "U-31 端口与监听地址可配（3141 仅环回 / 3142 全网卡）"
start 3141 "$D/u31.db" "$OPS/r4-u31a.log"; echo "  3141 start rc=$? /health=$(curl -s -o /dev/null -w '%{http_code}' http://$H:3141/health)"
lsof -nP -iTCP:3141 -sTCP:LISTEN | tail -n +2 | sed 's/^/  /'
stopit "$SPID"
env NODE_ENV=production SESSION_SECRET="$SEC" HOST=0.0.0.0 PORT=3142 DB_PATH="$D/u31b.db" node server/src/index.mjs > "$OPS/r4-u31b.log" 2>&1 &
P2=$!; sleep 3; echo "  3142 /health=$(curl -s -o /dev/null -w '%{http_code}' http://$H:3142/health)"
lsof -nP -iTCP:3142 -sTCP:LISTEN | tail -n +2 | sed 's/^/  /'
stopit "$P2"

h "U-32 配置校验拒启（每例：能否起 + 报错点名变量 + 是否建库）"
try_bad() { # label env...
  local label="$1"; shift
  env NODE_ENV=production SESSION_SECRET="$SEC" "$@" node server/src/index.mjs > "$OPS/r4-u32-$label.log" 2>&1 &
  local pid=$!; sleep 4
  if kill -0 "$pid" 2>/dev/null; then echo "  [$label] 进程仍在运行 ⇒ 未拒启 ✗"; kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; else wait "$pid" 2>/dev/null; echo "  [$label] 已退出 rc=$? :: $(head -c 200 "$OPS/r4-u32-$label.log" | tr '\n' ' ')"; fi
}
rm -f "$D/u32"*.db
try_bad port-abc PORT=abc DB_PATH="$D/u32a.db"
try_bad host-bad HOST=1.2.3.4 PORT=3143 DB_PATH="$D/u32b.db"
try_bad db-unwritable PORT=3144 DB_PATH=/System/nope/u32c.db
try_bad port-range PORT=99999 DB_PATH="$D/u32d.db"
try_bad secret-short PORT=3145 DB_PATH="$D/u32e.db" SESSION_SECRET=short
try_bad secret-missing PORT=3146 DB_PATH="$D/u32f.db" SESSION_SECRET=
echo "  被拒例是否留下半成品库：$(ls -l "$D" | grep -c 'u32' ) 个 u32* 文件"
echo "  3143~3146 是否被监听：$(lsof -nP -iTCP:3143,3144,3145,3146 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"

h "U-33 优雅停机（在途请求 + 新连接 + 退出码 + 端口释放）"
start 3147 "$D/u33.db" "$OPS/r4-u33.log"
python3 - "$OPS/r4-u33-big.json" <<'PY'
import sys
open(sys.argv[1],'w').write('{"productId":"P-001","quantity":1,"pad":"' + 'a'*100000 + '"}')
PY
curl -s -o "$OPS/r4-u33-inflight.body" -w "status=%{http_code}" --limit-rate 20k -X POST -H 'content-type: application/json' \
  --data-binary "@$OPS/r4-u33-big.json" "http://$H:3147/api/v1/cart/items" > "$OPS/r4-u33-inflight.status" 2>"$OPS/r4-u33-inflight.err" &
CP=$!
sleep 1.2
kill -TERM "$SPID"
NEW=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://$H:3147/health" 2>/dev/null || echo "连接失败")
wait "$CP"; CRC=$?
wait "$SPID"; RC=$?
echo "  SIGTERM 后立刻新连接探测: ${NEW}"
echo "  在途 curl: rc=$CRC $(cat "$OPS/r4-u33-inflight.status") body=$(head -c 100 "$OPS/r4-u33-inflight.body")"
echo "  服务进程退出码 rc=$RC （0=优雅）"
echo "  端口是否释放: $(lsof -nP -iTCP:3147 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ') 个监听"
echo "  日志尾 2 行（产品自身结构化日志）:"; tail -2 "$OPS/r4-u33.log" | cut -c1-220 | sed 's/^/    /'

h "U-36 进程兜底退出（注入未捕获异常 / 未处理拒绝，看退出码）"
for kind in uncaught rejection; do
  if [ "$kind" = "uncaught" ]; then P=3148; INS=3248; else P=3149; INS=3249; fi
  env NODE_ENV=production SESSION_SECRET="$SEC" PORT="$P" DB_PATH="$D/u36-$kind.db" node --inspect=127.0.0.1:"$INS" server/src/index.mjs > "$OPS/r4-u36-$kind.log" 2>&1 &
  IP=$!
  for i in $(seq 1 30); do curl -s -o /dev/null "http://$H:$P/health" && break; sleep 0.5; done
  node -e '
const kind=process.argv[1], ip=process.argv[2], expr=kind==="uncaught"
  ? "setTimeout(()=>{throw new Error(\"UAT-R4-uncaught-probe\")},0);1"
  : "Promise.reject(new Error(\"UAT-R4-unhandled-rejection\"));1";
(async()=>{ const v=await (await fetch("http://127.0.0.1:"+ip+"/json/list")).json();
 const ws=new WebSocket(v[0].webSocketDebuggerUrl); let id=0;
 const send=(m,p)=>new Promise(r=>{const i=++id;const f=e=>{const j=JSON.parse(e.data);if(j.id===i){ws.removeEventListener("message",f);r(j);}};ws.addEventListener("message",f);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
 await new Promise(r=>ws.onopen=r); await send("Runtime.evaluate",{expression:expr}); await new Promise(r=>setTimeout(r,1500)); ws.close(); })().catch(e=>console.log("inject-err",e.message));
' "$kind" "$INS" > "$OPS/r4-u36-$kind-inject.out" 2>&1
  echo "  [$kind] inject: $(cat "$OPS/r4-u36-$kind-inject.out")"
  wait "$IP"; RC=$?
  echo "  [$kind] 进程退出码 rc=$RC"
  echo "  [$kind] 日志关键行: $(grep -oE '\"(uncaught_exception|unhandled_rejection)\"' "$OPS/r4-u36-$kind.log" | head -1) / tail: $(tail -1 "$OPS/r4-u36-$kind.log" | cut -c1-160)"
  echo "  [$kind] 端口释放: $(lsof -nP -iTCP:$P -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ') 个监听"
done

h "U-40 迁移/播种幂等 + U-02 重启数据仍在 + U-14 订单号重启不重号"
start 3150 "$D/u40.db" "$OPS/r4-u40-1.log"; echo "  首启 /health=$(curl -s -o /dev/null -w '%{http_code}' http://$H:3150/health)"
curl -s "http://$H:3150/api/v1/products" > "$OPS/r4-u40-products1.json"; echo "  首启商品数=$(grep -o '\"name\"' "$OPS/r4-u40-products1.json" | wc -l | tr -d ' ')"
J="$D/u40.txt"
curl -s -o /dev/null -c "$J" -H 'content-type: application/json' -d "{\"email\":\"r4u40+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "http://$H:3150/api/v1/auth/register"
curl -s -o /dev/null -b "$J" -c "$J" -H 'content-type: application/json' -d '{"productId":"P-005","quantity":1}' "http://$H:3150/api/v1/cart/items"
ON1=$(curl -s -b "$J" -c "$J" -X POST -H 'content-type: application/json' -d '{}' "http://$H:3150/api/v1/orders" | grep -o '"orderNo":"[^"]*"' | cut -d'"' -f4)
echo "  重启前订单号=${ON1}"
stopit "$SPID"
start 3150 "$D/u40.db" "$OPS/r4-u40-2.log"; echo "  二次起 /health=$(curl -s -o /dev/null -w '%{http_code}' http://$H:3150/health)"
curl -s "http://$H:3150/api/v1/products" > "$OPS/r4-u40-products2.json"; echo "  二次起商品数=$(grep -o '\"name\"' "$OPS/r4-u40-products2.json" | wc -l | tr -d ' ')"
curl -s -b "$J" "http://$H:3150/api/v1/orders" > "$OPS/r4-u40-orders2.json"; echo "  重启后订单：$(grep -o '"orderNo":"[^"]*"' "$OPS/r4-u40-orders2.json" | cut -d'"' -f4 | tr '\n' ' ')"
curl -s -o /dev/null -b "$J" -c "$J" -H 'content-type: application/json' -d '{"productId":"P-006","quantity":1}' "http://$H:3150/api/v1/cart/items"
ON2=$(curl -s -b "$J" -c "$J" -X POST -H 'content-type: application/json' -d '{}' "http://$H:3150/api/v1/orders" | grep -o '"orderNo":"[^"]*"' | cut -d'"' -f4)
echo "  重启后新订单号=${ON2} ⇒ 与重启前不同 = $([ "$ON1" != "$ON2" ] && echo 是 || echo 否)"
stopit "$SPID"

h "U-41 落盘库可搬走（复制库文件后另起实例，数据仍在）"
cp "$D/u40.db" "$D/moved.db"
start 3151 "$D/moved.db" "$OPS/r4-u41.log"
curl -s -b "$J" "http://$H:3151/api/v1/orders" > "$OPS/r4-u41-orders.json"; echo "  搬走的库里的订单：$(grep -o '"orderNo":"[^"]*"' "$OPS/r4-u41-orders.json" | cut -d'"' -f4 | tr '\n' ' ')"
ONLIST_A=$(grep -o '"orderNo":"[^"]*"' "$OPS/r4-u40-orders2.json" | sort | tr '\n' ' ')
ONLIST_B=$(grep -o '"orderNo":"[^"]*"' "$OPS/r4-u41-orders.json" | sort | tr '\n' ' ')
if [ "$ONLIST_A" = "$ONLIST_B" ]; then echo "  两端订单列表一致 = 是"; else echo "  两端订单列表一致 = 否（搬走前又下过一单，差异预期） A=[$ONLIST_A] B=[$ONLIST_B]"; fi
stopit "$SPID"

h "U-42 备份与保留期（备份一次 / 保留期删旧 / 失败可观测 / 快照是独立库）"
BK="$D/bk"; mkdir -p "$BK"
DB_PATH="$D/u40.db" BACKUP_DIR="$BK" BACKUP_RETENTION_DAYS=14 node scripts/ops/backup.mjs > "$OPS/r4-u42-backup.out" 2>&1; echo "  备份 rc=$? :: $(head -c 240 "$OPS/r4-u42-backup.out")"
ls -l "$BK" | sed 's/^/  /'
python3 - "$BK" <<'PY'
import os,sys,time
bk=sys.argv[1]
now=time.time()
for name,days in (("old-30d.db",30),("mid-5d.db",5),("new-1d.db",1)):
    p=os.path.join(bk,name); open(p,"wb").write(b"x")
    t=now-days*86400; os.utime(p,(t,t))
print("  造了 3 个假快照（30/5/1 天前）")
PY
DB_PATH="$D/u40.db" BACKUP_DIR="$BK" BACKUP_RETENTION_DAYS=14 node scripts/ops/backup.mjs > "$OPS/r4-u42-backup2.out" 2>&1; echo "  二次备份 rc=$? :: $(head -c 240 "$OPS/r4-u42-backup2.out")"
echo "  保留期结果（应删 30 天前、留 5/1 天前）：$(ls -1 "$BK" | tr '\n' ' ')"
DB_PATH="$D/u40.db" BACKUP_DIR=/System/nope BACKUP_RETENTION_DAYS=14 node scripts/ops/backup.mjs > "$OPS/r4-u42-fail.out" 2>&1; echo "  失败路径 rc=$? :: $(head -c 240 "$OPS/r4-u42-fail.out")"
echo "  失败后既有快照是否被删：$(ls -1 "$BK" | tr '\n' ' ')"
node -e '
const {DatabaseSync}=require("node:sqlite");const fs=require("fs");const bk=process.argv[1];
const f=fs.readdirSync(bk).find(x=>/^shop-.*\.db$/.test(x));const db=new DatabaseSync(bk+"/"+f);
const c=db.prepare("select count(*) c from orders").get();console.log("  快照 "+f+" 独立可开：orders="+c.c);' "$BK" 2>&1 | sed 's/^/  /'

h "U-48 并发不超卖（把库存买到 1 → 两会话同时下单 → 恰好 1 单成功）"
start 3152 "$D/u48.db" "$OPS/r4-u48.log"
JA="$D/u48-a.txt"; JB="$D/u48-b.txt"
curl -s -o /dev/null -c "$JA" -H 'content-type: application/json' -d "{\"email\":\"r4u48a+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "http://$H:3152/api/v1/auth/register"
curl -s -o /dev/null -c "$JB" -H 'content-type: application/json' -d "{\"email\":\"r4u48b+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "http://$H:3152/api/v1/auth/register"
curl -s -o /dev/null -b "$JA" -c "$JA" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":5}' "http://$H:3152/api/v1/cart/items"
echo "  先买掉 5 件 → $(curl -s -b "$JA" -c "$JA" -X POST -H 'content-type: application/json' -d '{}' "http://$H:3152/api/v1/orders" | head -c 80)"
echo "  余量：$(curl -s "http://$H:3152/api/v1/products" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const p=j.data.find(x=>x.name==="手冲咖啡壶");console.log(p.name+" stock="+p.stock);})')"
curl -s -o /dev/null -b "$JA" -c "$JA" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "http://$H:3152/api/v1/cart/items"
curl -s -o /dev/null -b "$JB" -c "$JB" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "http://$H:3152/api/v1/cart/items"
python3 - "$OPS/r4-u48-race-body.json" <<'PY'
import sys
open(sys.argv[1],'w').write('{"pad":"' + 'a'*20000 + '"}')
PY
curl -s -o "$OPS/r4-u48-a.body" -w "A=%{http_code}" --limit-rate 8k -b "$JA" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48-race-body.json" "http://$H:3152/api/v1/orders" > "$OPS/r4-u48-a.code" 2>&1 &
CA=$!
curl -s -o "$OPS/r4-u48-b.body" -w "B=%{http_code}" --limit-rate 8k -b "$JB" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48-race-body.json" "http://$H:3152/api/v1/orders" > "$OPS/r4-u48-b.code" 2>&1 &
CB=$!
wait "$CA"; echo "  会话 A: $(cat "$OPS/r4-u48-a.code") body=$(head -c 110 "$OPS/r4-u48-a.body")"
wait "$CB"; echo "  会话 B: $(cat "$OPS/r4-u48-b.code") body=$(head -c 110 "$OPS/r4-u48-b.body")"
curl -s "http://$H:3152/api/v1/products" > "$OPS/r4-u48-products.json"
node -e 'const j=require("./reports/uat/evidence/FEAT-002-uat/ops/r4-u48-products.json");const p=j.data.find(x=>x.name==="手冲咖啡壶");console.log("  并发下单后 "+p.name+" stock="+p.stock+"（不得为负）");'
echo "  A 订单：$(curl -s -b "$JA" "http://$H:3152/api/v1/orders" | grep -o '"orderNo":"[^"]*"' | wc -l | tr -d ' ') 单 / B 订单：$(curl -s -b "$JB" "http://$H:3152/api/v1/orders" | grep -o '"orderNo":"[^"]*"' | wc -l | tr -d ' ') 单"
stopit "$SPID"

h "U-43 容器化非 root / 只读根 / 卷可写 / 容器内五面（docker compose run，不占端口）"
$DC run --rm --no-deps --entrypoint id app > "$OPS/r4-u43-id.out" 2>&1; echo "  id rc=$? :: $(tr '\n' ' ' < "$OPS/r4-u43-id.out")"
$DC run --rm --no-deps --entrypoint sh app -c 'touch /probe-r4 && echo WROTE-ROOT || echo ROOT-READONLY' > "$OPS/r4-u43-root.out" 2>&1; echo "  根可写? rc=$? :: $(tr '\n' ' ' < "$OPS/r4-u43-root.out")"
$DC run --rm --no-deps --entrypoint sh app -c 'ls -ld /data; touch /data/probe-r4 && echo DATA-WRITABLE && rm -f /data/probe-r4' > "$OPS/r4-u43-data.out" 2>&1; echo "  卷可写? rc=$? :: $(tr '\n' ' ' < "$OPS/r4-u43-data.out")"
$DC run --rm --no-deps --entrypoint sh app -c 'node server/src/index.mjs > /tmp/app.log 2>&1 & APP=$!; sleep 3; echo health=$(curl -s -o /dev/null -w "%{http_code}" localhost:3000/health); echo reg=$(curl -s -o /dev/null -w "%{http_code}" -c /tmp/j -H "content-type: application/json" -d "{\"email\":\"r4c+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" localhost:3000/api/v1/auth/register); echo add=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/j -c /tmp/j -H "content-type: application/json" -d "{\"productId\":\"P-002\",\"quantity\":1}" localhost:3000/api/v1/cart/items); echo order=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/j -c /tmp/j -X POST -H "content-type: application/json" -d "{}" localhost:3000/api/v1/orders); echo list=$(curl -s -b /tmp/j localhost:3000/api/v1/orders | head -c 60); kill $APP 2>/dev/null' > "$OPS/r4-u43-incontainer.out" 2>&1; echo "  容器内五面 rc=$?"; sed 's/^/    /' "$OPS/r4-u43-incontainer.out"

h "U-44 单机编排一键起（托管实例占 3000 ⇒ 预期端口冲突）"
$DC up -d > "$OPS/r4-u44-up.out" 2>&1; echo "  up -d rc=$?"; tail -4 "$OPS/r4-u44-up.out" | sed 's/^/    /'
echo "  我项目容器：$(docker ps -a --format '{{.Names}} {{.Status}}' | grep uater4 | tr '\n' ' ')"
$DC down -v --remove-orphans > "$OPS/r4-u44-down.out" 2>&1; echo "  down -v rc=$?"
echo "  清理后我项目容器/卷：$(docker ps -a --format '{{.Names}}' | grep -c uater4) / $(docker volume ls --format '{{.Name}}' | grep -c uater4)"

h "DONE 收尾"
echo "  我项目卷=[$(docker volume ls --format '{{.Name}}' | grep uater4 | tr '\n' ' ')]"
echo "  容器："; docker ps -a --format '    {{.Names}} {{.Status}}'
for p in 3141 3142 3147 3148 3149 3150 3151 3152; do echo "  端口 $p 监听=$(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
echo "  托管 3000 仍在：$(curl -s -o /dev/null -w '%{http_code}' http://$H:3000/health)"
