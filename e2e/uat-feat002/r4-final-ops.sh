#!/usr/bin/env bash
# FEAT-002 UAT r4 · 收口补测（端面侧）：U-42 默认保留期 / U-43 容器内五面 / U-44 一键起健康 / U-48 真并发 / U-50 车量>库存下单边界
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat"; OPS="$EV/ops"; mkdir -p "$OPS"
ROOT=$(pwd); H=127.0.0.1
D=$(mktemp -d /tmp/r4fin.XXXXXX) || exit 98
SEC=$(openssl rand -hex 32)
export DOCKER_CONFIG=/tmp/dockercfg DOCKER_BUILDKIT=0 COMPOSE_PROJECT_NAME=uater4
DC="docker compose -f ${ROOT}/deploy/docker-compose.yml"
h() { echo; echo "##### $* #####"; }
start() { env NODE_ENV=production SESSION_SECRET="$SEC" PORT="$1" DB_PATH="$2" node server/src/index.mjs > "$3" 2>&1 & SPID=$!; for i in $(seq 1 40); do curl -s -o /dev/null "http://$H:$1/health" && return 0; sleep 0.5; done; return 1; }
stopit() { kill -TERM "$1" 2>/dev/null; wait "$1" 2>/dev/null; echo "  停止 rc=$?"; }

h "U-42 备份**默认**保留期（不传 BACKUP_RETENTION_DAYS）"
BK="$D/bk2"; mkdir -p "$BK"
python3 - "$BK" <<'PY'
import os,sys,time
bk=sys.argv[1]; now=time.time()
for name,days in (("old-20d.db",20),("old-13d.db",13),("new-2d.db",2)):
    p=os.path.join(bk,name); open(p,"wb").write(b"x"); t=now-days*86400; os.utime(p,(t,t))
print("  造 20/13/2 天前三个假快照")
PY
env NODE_ENV=production SESSION_SECRET="$SEC" DB_PATH="$D/fin.db" BACKUP_DIR="$BK" node scripts/ops/backup.mjs > "$OPS/r4-u42-default.out" 2>&1
echo "  备份（无 RETENTION 环境变量）rc=$? :: $(grep -o '"message":"[^"]*"' "$OPS/r4-u42-default.out" | tail -1)"
echo "  结果（期望删 20 天前、留 13/2 天前）：$(ls -1 "$BK" | tr '\n' ' ')"
echo "  脚本里出现的保留天数常量：$(grep -oE '1[0-9]' "$OPS/r4-u42-default.out" | head -3 | tr '\n' ' ')"

h "U-43 容器内五面（镜像无 curl，改用容器内 node fetch；不占端口）"
$DC run --rm --no-deps --entrypoint sh app -c 'node -e "
const base=\"http://127.0.0.1:3000\"; const jar=[];
const call=async(m,p,b)=>{const r=await fetch(base+p,{method:m,headers:{\"content-type\":\"application/json\",...(jar.length?{cookie:jar.join(\"; \")}:{})},body:b?JSON.stringify(b):undefined});
 const sc=r.headers.getSetCookie?r.headers.getSetCookie():[]; for(const c of sc) jar.push(c.split(\";\")[0]);
 let j=null; try{j=await r.json();}catch{} return {sc:r.status,d:j};};
(async()=>{ console.log(\"health=\"+JSON.stringify(await call(\"GET\",\"/health\")));
 console.log(\"products=\"+(await call(\"GET\",\"/api/v1/products\")).d.data.length+\" 件\");
 console.log(\"register=\"+JSON.stringify(await call(\"POST\",\"/api/v1/auth/register\",{email:\"r4c\"+Date.now()+\"@example.com\",password:\"uat-pass-12345\"})));
 console.log(\"add=\"+JSON.stringify(await call(\"POST\",\"/api/v1/cart/items\",{productId:\"P-002\",quantity:1})));
 console.log(\"order=\"+JSON.stringify(await call(\"POST\",\"/api/v1/orders\",{})));
 const l=await call(\"GET\",\"/api/v1/orders\"); console.log(\"orders=\"+JSON.stringify(l.d));
 console.log(\"page_html=\"+(await (await fetch(base+\"/\")).text()).includes(\"手冲小铺\"));
})();"' > "$OPS/r4-u43-incontainer2.out" 2>&1
echo "  rc=$?"; grep -vE 'Creating|Created|Network' "$OPS/r4-u43-incontainer2.out" | sed 's/^/    /'

h "U-44 一键起（等健康 + 容器内五面 + 端口映射读数）"
$DC up -d > "$OPS/r4-u44-up2.out" 2>&1; echo "  up -d rc=$?"
for i in $(seq 1 40); do ST=$(docker inspect -f '{{.State.Health.Status}}' uater4-app-1 2>/dev/null || echo none); [ "$ST" = "healthy" ] && break; sleep 1; done
echo "  app 健康状态=${ST}（等 ${i}s）"
echo "  端口映射：$(docker compose -f "$ROOT/deploy/docker-compose.yml" port app 3000 2>&1 | tr '\n' ' ')"
echo "  backup 容器：$(docker ps -a --format '{{.Names}} {{.Status}}' | grep uater4 | tr '\n' ' ')"
$DC exec -T app node -e 'fetch("http://127.0.0.1:3000/health").then(r=>r.json()).then(j=>console.log("  容器内 /health = "+JSON.stringify(j)))' 2>&1 | tail -2
echo "  宿主 127.0.0.1:3000 仍是托管实例（版本/启动时间与容器内不同即为双实例并存）："
echo "    宿主 = $(curl -s http://$H:3000/health)"
$DC down -v --remove-orphans > "$OPS/r4-u44-down2.out" 2>&1; echo "  down -v rc=$?；残留容器/卷=$(docker ps -a --format '{{.Names}}' | grep -c uater4)/$(docker volume ls --format '{{.Name}}' | grep -c uater4)"

h "U-48 真并发（先确认库存=1，再背靠背两单）"
start 3160 "$D/u48.db" "$OPS/r4-u48b.log"
JA="$D/a.txt"; JB="$D/b.txt"
curl -s -o /dev/null -c "$JA" -H 'content-type: application/json' -d "{\"email\":\"r4f48a+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "http://$H:3160/api/v1/auth/register"
curl -s -o /dev/null -c "$JB" -H 'content-type: application/json' -d "{\"email\":\"r4f48b+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "http://$H:3160/api/v1/auth/register"
stock() { curl -s "http://$H:3160/api/v1/products" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const p=j.data.find(x=>x.name==="手冲咖啡壶");console.log(p.stock);})'; }
echo "  初始库存=$(stock)"
curl -s -o "$OPS/r4-u48b-first.json" -b "$JA" -c "$JA" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":5}' "http://$H:3160/api/v1/cart/items" >/dev/null
curl -s -o "$OPS/r4-u48b-firstorder.json" -b "$JA" -c "$JA" -X POST -H 'content-type: application/json' -d '{}' "http://$H:3160/api/v1/orders"
echo "  第 1 单（买 5）：$(head -c 150 "$OPS/r4-u48b-firstorder.json")"
echo "  余量=$(stock)"
curl -s -o /dev/null -b "$JA" -c "$JA" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "http://$H:3160/api/v1/cart/items"
curl -s -o /dev/null -b "$JB" -c "$JB" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "http://$H:3160/api/v1/cart/items"
python3 - "$OPS/r4-u48b-body.json" <<'PY'
import sys
open(sys.argv[1],'w').write('{"pad":"' + 'a'*30000 + '"}')
PY
curl -s -o "$OPS/r4-u48b-a.body" -w '%{http_code}' --limit-rate 6k -b "$JA" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48b-body.json" "http://$H:3160/api/v1/orders" > "$OPS/r4-u48b-a.code" 2>&1 &
CA=$!
sleep 0.3
curl -s -o "$OPS/r4-u48b-b.body" -w '%{http_code}' --limit-rate 6k -b "$JB" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48b-body.json" "http://$H:3160/api/v1/orders" > "$OPS/r4-u48b-b.code" 2>&1 &
CB=$!
wait "$CA"; wait "$CB"
echo "  会话 A 下单 -> $(cat "$OPS/r4-u48b-a.code") :: $(head -c 130 "$OPS/r4-u48b-a.body")"
echo "  会话 B 下单 -> $(cat "$OPS/r4-u48b-b.code") :: $(head -c 130 "$OPS/r4-u48b-b.body")"
echo "  并发后库存=$(stock)（必须 0，绝不为负）"
echo "  A 单数=$(curl -s -b "$JA" "http://$H:3160/api/v1/orders" | grep -o '"orderNo"' | wc -l | tr -d ' ') / B 单数=$(curl -s -b "$JB" "http://$H:3160/api/v1/orders" | grep -o '"orderNo"' | wc -l | tr -d ' ')"
echo "  -- 同会话（同一辆车）并发两单 --"
curl -s -o /dev/null -b "$JA" -c "$JA" -H 'content-type: application/json' -d '{"productId":"P-006","quantity":1}' "http://$H:3160/api/v1/cart/items"
curl -s -o "$OPS/r4-u48b-s1.body" -w '%{http_code}' --limit-rate 6k -b "$JA" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48b-body.json" "http://$H:3160/api/v1/orders" > "$OPS/r4-u48b-s1.code" 2>&1 &
S1=$!
sleep 0.3
curl -s -o "$OPS/r4-u48b-s2.body" -w '%{http_code}' --limit-rate 6k -b "$JA" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48b-body.json" "http://$H:3160/api/v1/orders" > "$OPS/r4-u48b-s2.code" 2>&1 &
S2=$!
wait "$S1"; wait "$S2"
echo "  同会话第 1 发 -> $(cat "$OPS/r4-u48b-s1.code") :: $(head -c 110 "$OPS/r4-u48b-s1.body")"
echo "  同会话第 2 发 -> $(cat "$OPS/r4-u48b-s2.code") :: $(head -c 110 "$OPS/r4-u48b-s2.body")"
echo "  该会话单数=$(curl -s -b "$JA" "http://$H:3160/api/v1/orders" | grep -o '"orderNo"' | wc -l | tr -d ' ')"
stopit "$SPID"

h "U-50/E-11 边界：购物车件数（8）大于现货（<8）时下单会怎样（真机观察，交人裁）"
SHORT=$(curl -s "http://$H:3000/api/v1/products" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.data.filter(p=>p.stock<8).map(p=>p.name+":"+p.stock).join(" ")||"全部 8 件");})')
echo "  托管实例当前现货 <8 的商品：$SHORT"
JE="$D/e.txt"
E50="uat-r4b-e50+$(date +%s)@example.com"
curl -s -o /dev/null -c "$JE" -H 'content-type: application/json' -d "{\"email\":\"$E50\",\"password\":\"uat-pass-12345\"}" "http://$H:3000/api/v1/auth/register"
curl -s -o "$OPS/r4-u50-over.json" -b "$JE" -c "$JE" -H 'content-type: application/json' -d '{"productId":"P-007","quantity":8}' "http://$H:3000/api/v1/cart/items"
echo "  保温杯（现货 <8）加 8 件 -> $(head -c 150 "$OPS/r4-u50-over.json")"
curl -s -o "$OPS/r4-u50-order.json" -w '%{http_code}' -b "$JE" -c "$JE" -X POST -H 'content-type: application/json' -d '{}' "http://$H:3000/api/v1/orders" > "$OPS/r4-u50-order.code"
echo "  提交 -> $(cat "$OPS/r4-u50-order.code") :: $(head -c 200 "$OPS/r4-u50-order.json")"
AFTER=$(curl -s "http://$H:3000/api/v1/products" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const p=j.data.find(x=>x.name==="保温杯");console.log(p.stock);})')
echo "  提交后保温杯库存=$AFTER"

h "DONE"; docker ps -a --format '  {{.Names}} {{.Status}}'; echo "  托管 3000 = $(curl -s -o /dev/null -w '%{http_code}' http://$H:3000/health)"
