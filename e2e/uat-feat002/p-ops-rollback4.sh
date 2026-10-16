#!/usr/bin/env bash
# FEAT-002 UAT · E7 附加复验（严格观察者纪律）：残留非空 WAL 时照文档回滚
# 关键：中途只用「纯字节指纹」(readFileSync+sha256)，绝不用 node:sqlite 打开库
#       —— 上一轮我用 sqlite 读了一次，它把 WAL checkpoint 掉并删了 -wal/-shm，等于把被测状态改掉了。
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
export DOCKER_CONFIG=/tmp/dockercfg
export SESSION_SECRET="$(openssl rand -hex 32)"
export COOKIE_SECURE=1; export TRUST_PROXY=1
DC="docker compose -f deploy/docker-compose.yml"
JAR="$EV/e7d-cookies.txt"; rm -f "$JAR"
EMAIL="uat-e7d+$(date +%s)@example.com"; API=http://127.0.0.1:3000
fp() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readFileSync,existsSync,statSync} from "node:fs";
const h=p=>{const b=readFileSync(p);return {size:b.length,sha256:createHash("sha256").update(b).digest("hex")};};
const o={db:h("/data/shop.db")}; for (const s of ["-wal","-shm"]) { const p="/data/shop.db"+s; o[s]=existsSync(p)?{size:statSync(p).size}:null; }
console.log("FINGERPRINT "+JSON.stringify(o));' 2>/dev/null | grep -o 'FINGERPRINT {.*}' | sed 's/^FINGERPRINT //'; }
snaps() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readdirSync,readFileSync} from "node:fs";
let n=[]; try{n=readdirSync("/data/backups").sort();}catch{}
console.log("SNAPS "+JSON.stringify(n.map(f=>{const b=readFileSync("/data/backups/"+f);return {name:f,size:b.length,sha256:createHash("sha256").update(b).digest("hex")};})));' 2>/dev/null | grep -o 'SNAPS \[.*\]' | sed 's/^SNAPS //'; }
logical() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
try { const db=new DatabaseSync("/data/shop.db"); const c=db.prepare("select count(*) c from orders").get();
  const r=db.prepare("select no from orders order by id").all();
  console.log("LOGICAL "+JSON.stringify({orders:c.c,nos:r.map(x=>x.no)})); } catch(e){ console.log("LOGICAL "+JSON.stringify({error:e.message})); }' 2>/dev/null | grep -o 'LOGICAL {.*}' | sed 's/^LOGICAL //'; }
waitapp() { for i in $(seq 1 25); do A=$(docker inspect shop-app-1 --format '{{.State.Health.Status}}' 2>/dev/null); [ "$A" = "healthy" ] && break; sleep 3; done; echo "$A"; }
step() { echo; echo "##### $* #####"; }
ord() { curl -s -o "$1" -w "%{http_code}" -b "$JAR" -c "$JAR" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; }

step "0. 清场"; $DC down -v --remove-orphans > "$EV/e7d-00.out" 2>&1; echo "  rc=$?"
step "1. 起服 + 第 1 单"
$DC up -d > "$EV/e7d-01.out" 2>&1; echo "  up rc=$? app=$(waitapp)"
curl -s -o /dev/null -w "  register=%{http_code}\n" -c "$JAR" -H 'content-type: application/json' -d "{\"email\":\"${EMAIL}\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register"
curl -s -o /dev/null -w "  add=%{http_code}\n" -b "$JAR" -c "$JAR" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "$API/api/v1/cart/items"
echo "  order#1 status=$(ord "$EV/e7d-02-order1.json")"; O1=$(grep -o '"orderNo":"[^"]*"' "$EV/e7d-02-order1.json" | head -1 | cut -d'"' -f4); echo "  no=${O1}"
step "2. 正常停服→起服产生快照（此时只用纯字节指纹，不打开库）"
$DC down > "$EV/e7d-03-down.out" 2>&1; $DC up -d > "$EV/e7d-04-up2.out" 2>&1; echo "  up rc=$? app=$(waitapp)"
SJ=$(snaps); SNAP=$(printf '%s' "$SJ" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4); SNAP_SHA=$(printf '%s' "$SJ" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  SNAP=${SNAP} sha256=${SNAP_SHA}"
step "3. 第 2 单 → SIGKILL（制造残留 WAL）→ down → 只取字节指纹"
curl -s -o /dev/null -w "  add=%{http_code}\n" -b "$JAR" -c "$JAR" -H 'content-type: application/json' -d '{"productId":"P-002","quantity":1}' "$API/api/v1/cart/items"
echo "  order#2 status=$(ord "$EV/e7d-05-order2.json")"; O2=$(grep -o '"orderNo":"[^"]*"' "$EV/e7d-05-order2.json" | head -1 | cut -d'"' -f4); echo "  no=${O2}"
echo "  强杀前（HTTP 口径）订单数=$(curl -s -b "$JAR" -c "$JAR" "$API/api/v1/orders?limit=100" | grep -o '"orderNo"' | wc -l | tr -d ' ')"
docker kill shop-app-1 > "$EV/e7d-06-kill.out" 2>&1; echo "  docker kill rc=$?"
$DC down > "$EV/e7d-07-down.out" 2>&1; echo "  down rc=$?"
FP_STALE=$(fp); echo "  强杀后停服字节指纹（关键：-wal 应非 0）: ${FP_STALE}"
step "4. 照文档回滚第 2 步（逐字，中途不打开库）"
$DC run --rm --no-deps --entrypoint sh app -c "cp -f /data/backups/${SNAP} /data/shop.db && chown node:node /data/shop.db && ls -l /data/shop.db" > "$EV/e7d-08-rollback.out" 2>&1
echo "  rc=$?"; sed 's/^/    /' "$EV/e7d-08-rollback.out"
FP_R=$(fp); echo "  回滚后字节指纹: ${FP_R}"
echo "  库 sha256=$(printf '%s' "$FP_R" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4) / 快照 ${SNAP_SHA}"
echo "  起服前逻辑状态（这一步本身会 checkpoint，故放在最后）: $(logical)"
step "5. 起服验（用户口径：不只看 200）"
$DC up -d > "$EV/e7d-09-up3.out" 2>&1; echo "  up rc=$? app=$(waitapp)"
curl -s -o "$EV/e7d-10-health.json" -w "  /health=%{http_code}\n" "$API/health"
curl -s -b "$JAR" -c "$JAR" -o "$EV/e7d-11-orders.json" -w "  /orders=%{http_code}\n" "$API/api/v1/orders?limit=100"
echo "  订单列表: $(grep -o '"orderNo":"[^"]*"' "$EV/e7d-11-orders.json" | cut -d'"' -f4 | tr '\n' ' ')"
echo "  期望保留 ${O1} / 消失 ${O2}"
echo "  起服后逻辑状态: $(logical)"
step "6. 收尾"
$DC down -v --remove-orphans > "$EV/e7d-12-final.out" 2>&1; echo "  down rc=$?"
docker volume rm shop-data > /dev/null 2>&1; echo "  垃圾卷清理 rc=$?（1=无）"
echo "  shop* 卷=[$(docker volume ls --format '{{.Name}}' | grep -E shop | tr '\n' ' ')]"
echo "  shop* 网络=[$(docker network ls --format '{{.Name}}' | grep -E shop | tr '\n' ' ')]"
for p in 80 443 3000; do echo "  端口 ${p} 监听数=$(lsof -nP -iTCP:${p} -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
docker ps -a --format '  容器 {{.Names}} {{.Status}}'
