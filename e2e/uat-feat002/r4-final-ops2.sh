#!/usr/bin/env bash
# FEAT-002 UAT r4 · 收口补测 2：U-42 默认保留期（库存在）/ U-43 容器内五面 / U-44 一键起复看
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat"; OPS="$EV/ops"; mkdir -p "$OPS"
ROOT=$(pwd); H=127.0.0.1
D=$(mktemp -d /tmp/r4fin2.XXXXXX) || exit 98
SEC=$(openssl rand -hex 32)
export DOCKER_CONFIG=/tmp/dockercfg DOCKER_BUILDKIT=0 COMPOSE_PROJECT_NAME=uater4
DC="docker compose -f ${ROOT}/deploy/docker-compose.yml"
h() { echo; echo "##### $* #####"; }

h "U-42 备份默认保留期（先造一个有数据的库；不传 RETENTION 环境变量）"
env NODE_ENV=production SESSION_SECRET="$SEC" PORT=3165 DB_PATH="$D/fin.db" node server/src/index.mjs > "$OPS/r4-u42b-seed.log" 2>&1 &
P=$!; for i in $(seq 1 40); do curl -s -o /dev/null "http://$H:3165/health" && break; sleep 0.5; done
J="$D/j.txt"
curl -s -o /dev/null -c "$J" -H 'content-type: application/json' -d "{\"email\":\"r4u42+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "http://$H:3165/api/v1/auth/register"
curl -s -o /dev/null -b "$J" -c "$J" -H 'content-type: application/json' -d '{"productId":"P-006","quantity":1}' "http://$H:3165/api/v1/cart/items"
curl -s -o /dev/null -b "$J" -c "$J" -X POST -H 'content-type: application/json' -d '{}' "http://$H:3165/api/v1/orders"
kill -TERM $P; wait $P 2>/dev/null; echo "  造库完成：$(ls -l "$D/fin.db" | awk '{print $5" bytes"}')，停止 rc=$?"
BK="$D/bk"; mkdir -p "$BK"
python3 - "$BK" <<'PY'
import os,sys,time
bk=sys.argv[1]; now=time.time()
for name,days in (("shop-old-20d.db",20),("shop-old-13d.db",13),("shop-new-2d.db",2)):
    p=os.path.join(bk,name); open(p,"wb").write(b"x"); t=now-days*86400; os.utime(p,(t,t))
print("  造 20/13/2 天前三个假快照")
PY
env NODE_ENV=production SESSION_SECRET="$SEC" DB_PATH="$D/fin.db" BACKUP_DIR="$BK" node scripts/ops/backup.mjs > "$OPS/r4-u42b-default.out" 2>&1
echo "  备份（无 RETENTION 环境变量）rc=$? :: $(tail -1 "$OPS/r4-u42b-default.out")"
echo "  快照目录结果：$(ls -1 "$BK" | tr '\n' ' ')"
echo "  ⇒ 期望：20 天前被删、13/2 天前保留（即默认保留期在 13~20 天之间）"

h "U-43 容器内五面（容器内起服务 + node fetch；不占宿主端口）"
$DC run --rm --no-deps --entrypoint sh app -c 'node server/src/index.mjs > /tmp/app.log 2>&1 & sleep 3; node -e "
const base=\"http://127.0.0.1:3000\"; const jar=[];
const call=async(m,p,b)=>{try{const r=await fetch(base+p,{method:m,headers:{\"content-type\":\"application/json\",...(jar.length?{cookie:jar.join(\"; \")}:{})},body:b?JSON.stringify(b):undefined});
 const sc=r.headers.getSetCookie?r.headers.getSetCookie():[]; for(const c of sc) jar.push(c.split(\";\")[0]);
 let j=null; try{j=await r.json();}catch{} return {sc:r.status,d:j};}catch(e){return {err:e.message};}};
(async()=>{ const hl=await call(\"GET\",\"/health\"); console.log(\"health=\"+JSON.stringify(hl));
 const pr=await call(\"GET\",\"/api/v1/products\"); console.log(\"products=\"+(pr.d&&pr.d.data?pr.d.data.length:\"ERR\")+\" 件\");
 const rg=await call(\"POST\",\"/api/v1/auth/register\",{email:\"r4c\"+Date.now()+\"@example.com\",password:\"uat-pass-12345\"}); console.log(\"register=\"+JSON.stringify(rg));
 const ad=await call(\"POST\",\"/api/v1/cart/items\",{productId:\"P-002\",quantity:1}); console.log(\"add=\"+JSON.stringify(ad));
 const od=await call(\"POST\",\"/api/v1/orders\",{}); console.log(\"order=\"+JSON.stringify(od));
 const ls=await call(\"GET\",\"/api/v1/orders\"); console.log(\"orders=\"+JSON.stringify(ls.d));
 const html=await (await fetch(base+\"/\")).text(); console.log(\"page_has_brand=\"+html.includes(\"手冲小铺\"));
})();"; kill $!' > "$OPS/r4-u43b-incontainer.out" 2>&1
echo "  rc=$?"; grep -vE 'Creating|Created|Network' "$OPS/r4-u43b-incontainer.out" | sed 's/^/    /'

h "U-44 一键起复看（等健康 + 端口映射 + 容器内 /health + 五面）"
$DC up -d > "$OPS/r4-u44b-up.out" 2>&1; echo "  up -d rc=$?"
ST=none; for i in $(seq 1 45); do ST=$(docker inspect -f '{{.State.Health.Status}}' uater4-app-1 2>/dev/null || echo none); [ "$ST" = "healthy" ] && break; sleep 1; done
echo "  app 健康状态=${ST}（等待 ${i} 秒）"
echo "  backup 容器：$(docker ps -a --format '{{.Names}} {{.Status}}' | grep uater4 | tr '\n' ' ')"
echo "  端口映射（compose port）：$(docker compose -f "$ROOT/deploy/docker-compose.yml" port app 3000 2>&1 | tr '\n' ' ')"
echo "  宿主 3000 监听者："; lsof -nP -iTCP:3000 -sTCP:LISTEN | tail -n +2 | sed 's/^/    /'
echo "  容器内五面（exec）："
$DC exec -T app node -e "
const base=\"http://127.0.0.1:3000\"; const jar=[];
const call=async(m,p,b)=>{const r=await fetch(base+p,{method:m,headers:{\"content-type\":\"application/json\",...(jar.length?{cookie:jar.join(\"; \")}:{})},body:b?JSON.stringify(b):undefined});const sc=r.headers.getSetCookie?r.headers.getSetCookie():[];for(const c of sc) jar.push(c.split(\";\")[0]);let j=null;try{j=await r.json();}catch{} return {sc:r.status,d:j};};
(async()=>{console.log(\"    health=\"+JSON.stringify(await call(\"GET\",\"/health\")));
console.log(\"    products=\"+(await call(\"GET\",\"/api/v1/products\")).d.data.length+\" 件\");
console.log(\"    register=\"+JSON.stringify(await call(\"POST\",\"/api/v1/auth/register\",{email:\"r4e\"+Date.now()+\"@example.com\",password:\"uat-pass-12345\"})));
console.log(\"    add=\"+JSON.stringify(await call(\"POST\",\"/api/v1/cart/items\",{productId:\"P-003\",quantity:1})));
console.log(\"    order=\"+JSON.stringify(await call(\"POST\",\"/api/v1/orders\",{})));
console.log(\"    orders=\"+JSON.stringify((await call(\"GET\",\"/api/v1/orders\")).d));})();" 2>&1 | sed 's/^/  /'
$DC down -v --remove-orphans > "$OPS/r4-u44b-down.out" 2>&1; echo "  down -v rc=$?；残留容器/卷=$(docker ps -a --format '{{.Names}}' | grep -c uater4)/$(docker volume ls --format '{{.Name}}' | grep -c uater4)"
h "DONE"; docker ps -a --format '  {{.Names}} {{.Status}}'; echo "  托管 3000 = $(curl -s -o /dev/null -w '%{http_code}' http://$H:3000/health)"
