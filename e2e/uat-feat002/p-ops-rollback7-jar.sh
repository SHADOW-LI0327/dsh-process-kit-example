#!/usr/bin/env bash
# FEAT-002 UAT · §13 补测：E9 崩溃路径的**用户口径**读数（文档第 4 步的 curl 照抄，jar 文件名就是 jar.txt）
# 项目隔离 COMPOSE_PROJECT_NAME=uate7f；采集顺序：卷内 ls/test -f → 纯字节 sha → 最后打开库/调 API
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
export DOCKER_CONFIG=/tmp/dockercfg
export COMPOSE_PROJECT_NAME=uate7f
export SESSION_SECRET="$(openssl rand -hex 32)"
export COOKIE_SECURE=1; export TRUST_PROXY=1
ROOT=$(pwd)
EVABS="${ROOT}/${EV}"
DC="docker compose -f ${ROOT}/deploy/docker-compose.yml"
API=http://localhost:3000
step() { echo; echo "##### $* #####"; }
fp() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readFileSync,existsSync,statSync} from "node:fs";
const h=p=>{const b=readFileSync(p);return {size:b.length,sha256:createHash("sha256").update(b).digest("hex")};};
const o={db:h("/data/shop.db")}; for (const s of ["-wal","-shm"]) { const p="/data/shop.db"+s; o[s]=existsSync(p)?{size:statSync(p).size}:null; }
console.log("FINGERPRINT "+JSON.stringify(o));' 2>/dev/null | grep -o 'FINGERPRINT {.*}' | sed 's/^FINGERPRINT //'; }
volview() { $DC run --rm --no-deps --entrypoint sh app -c '
for f in /data/shop.db /data/shop.db-wal /data/shop.db-shm; do if [ -f "$f" ]; then echo "EXISTS $f"; else echo "ABSENT $f"; fi; done; ls -l /data' 2>/dev/null | grep -E '^(EXISTS|ABSENT|total|-|d)'; }
snaps() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readdirSync,readFileSync} from "node:fs";
let n=[]; try{n=readdirSync("/data/backups").sort();}catch{}
console.log("SNAPS "+JSON.stringify(n.map(f=>{const b=readFileSync("/data/backups/"+f);return {name:f,sha256:createHash("sha256").update(b).digest("hex")};})));' 2>/dev/null | grep -o 'SNAPS \[.*\]' | sed 's/^SNAPS //'; }
logical() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
try { const db=new DatabaseSync("/data/shop.db"); const c=db.prepare("select count(*) c from orders").get();
  const r=db.prepare("select no from orders order by id").all();
  console.log("LOGICAL "+JSON.stringify({orders:c.c,nos:r.map(x=>x.no)})); } catch(e){ console.log("LOGICAL "+JSON.stringify({error:e.message})); }' 2>/dev/null | grep -o 'LOGICAL {.*}' | sed 's/^LOGICAL //'; }
heap() { for i in $(seq 1 25); do A=$(docker inspect "$($DC ps -q app)" --format '{{.State.Health.Status}}' 2>/dev/null); [ "$A" = "healthy" ] && break; sleep 3; done; echo "$A"; }
wait3000() { for i in $(seq 1 40); do N=$(lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' '); [ "$N" = "0" ] && return 0; echo "  ⏳ 等 3000 空闲…"; sleep 3; done; return 1; }

step "0. 清场（我的项目）"; $DC down -v --remove-orphans > "$EVABS/e7g-00.out" 2>&1; echo "  rc=$?"; wait3000
step "1. 起服 → 注册（cookie 罐就写进字面名 jar.txt）→ 第 1 单"
wait3000; $DC up -d > "$EVABS/e7g-01.out" 2>&1; echo "  up rc=$? app=$(heap)"
curl -s -o "$EVABS/e7g-reg.json" -w "  register=%{http_code}\n" -c "$EVABS/jar.txt" -H 'content-type: application/json' -d "{\"email\":\"uat-e7g+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register"
curl -s -o "$EVABS/e7g-cart.json" -w "  add=%{http_code}\n" -b "$EVABS/jar.txt" -c "$EVABS/jar.txt" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "$API/api/v1/cart/items"
curl -s -o "$EVABS/e7g-o1.json" -w "  order#1=%{http_code}\n" -b "$EVABS/jar.txt" -c "$EVABS/jar.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"
O1=$(grep -o '"orderNo":"[^"]*"' "$EVABS/e7g-o1.json" | head -1 | cut -d'"' -f4); echo "  order#1 no=${O1}"
step "2. 停服→起服产快照（= 快照时刻状态）"
$DC down > "$EVABS/e7g-02.out" 2>&1; wait3000; $DC up -d > "$EVABS/e7g-03.out" 2>&1; echo "  up rc=$? app=$(heap)"
SJ=$(snaps); SNAP=$(printf '%s' "$SJ" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4); SNAP_SHA=$(printf '%s' "$SJ" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  SNAP=${SNAP} sha256=${SNAP_SHA}"
step "3. 第 2 单 → SIGKILL → 停服"
curl -s -o "$EVABS/e7g-cart2.json" -w "  add=%{http_code}\n" -b "$EVABS/jar.txt" -c "$EVABS/jar.txt" -H 'content-type: application/json' -d '{"productId":"P-002","quantity":1}' "$API/api/v1/cart/items"
curl -s -o "$EVABS/e7g-o2.json" -w "  order#2=%{http_code}\n" -b "$EVABS/jar.txt" -c "$EVABS/jar.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"
O2=$(grep -o '"orderNo":"[^"]*"' "$EVABS/e7g-o2.json" | head -1 | cut -d'"' -f4); echo "  order#2 no=${O2}"
$DC kill app > "$EVABS/e7g-04-kill.out" 2>&1; echo "  compose kill app rc=$?（$(tr '\n' ' ' < "$EVABS/e7g-04-kill.out")）"
$DC down > "$EVABS/e7g-05-down.out" 2>&1; echo "  down rc=$?"
step "4. 【前置取证】卷内残留 -wal/-shm（不打开库）"
volview > "$EVABS/e7g-06-prvw.out" 2>&1; grep -E '^(EXISTS|ABSENT)' "$EVABS/e7g-06-prvw.out" | sed 's/^/    /'
echo "  纯字节指纹: $(fp)"
step "5. 逐字执行改后文档第 2 步"
$DC run --rm --no-deps --entrypoint sh app -c "rm -f /data/shop.db-wal /data/shop.db-shm && cp -pf /data/backups/${SNAP} /data/shop.db && ls -l /data/shop.db" > "$EVABS/e7g-07-rollback.out" 2>&1
echo "  rc=$?"; sed 's/^/    /' "$EVABS/e7g-07-rollback.out"
step "6. 【回滚后·起服前】-wal/-shm 消失 + 字节指纹逐位＝快照（仍未打开库）"
volview > "$EVABS/e7g-08-postvw.out" 2>&1; grep -E '^(EXISTS|ABSENT)' "$EVABS/e7g-08-postvw.out" | sed 's/^/    /'
FP=$(fp); echo "  纯字节指纹: ${FP}"
echo "  库 sha256=$(printf '%s' "$FP" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4) / 快照 ${SNAP_SHA}"
step "7. 起服 + 文档第 3/4 步（curl 逐字：jar.txt 就在当前目录）"
wait3000; $DC up -d > "$EVABS/e7g-09.out" 2>&1; echo "  up rc=$? app=$(heap)"
curl -s -o "$EVABS/e7g-health.json" -w "  curl -s localhost:3000/health → %{http_code}\n" "localhost:3000/health"
( cd "$EVABS" && curl -s -b jar.txt -c jar.txt -o e7g-orders-literal.json -w "  curl -s -b jar.txt localhost:3000/api/v1/orders → %{http_code}\n" "localhost:3000/api/v1/orders" )
echo "    原始 body: $(head -c 300 "$EVABS/e7g-orders-literal.json")"
echo "    订单号列表: $(grep -o '"orderNo":"[^"]*"' "$EVABS/e7g-orders-literal.json" | cut -d'"' -f4 | tr '\n' ' ')"
echo "    期望：只有 ${O1}（快照时刻那笔）；${O2} 不复活"
echo "    库级读数（最后才打开库）: $(logical)"
step "8. 收尾"
$DC down -v --remove-orphans > "$EVABS/e7g-10-final.out" 2>&1; echo "  down -v rc=$?"
echo "  我的卷=[$(docker volume ls --format '{{.Name}}' | grep uate7f | tr '\n' ' ')]"

for p in 3000 80 443; do echo "  端口 ${p} 监听数=$(lsof -nP -iTCP:${p} -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
docker ps -a --format '  容器 {{.Names}} {{.Status}}'
