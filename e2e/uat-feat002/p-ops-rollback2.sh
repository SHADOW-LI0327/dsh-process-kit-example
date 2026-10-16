#!/usr/bin/env bash
# FEAT-002 UAT · E7 复验（修正版）：修正 sqlite 列名(orders.no)与对照实验的绝对路径问题后重跑
# 【唯一替代】deploy/.env 无法由我创建（无 deploy/** 写权限），三个变量走 shell 环境注入（compose 插值优先 shell）。
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
SNAPDIR="$EV/e7-snap2"
mkdir -p "$EV" "$SNAPDIR"
export DOCKER_CONFIG=/tmp/dockercfg
export SESSION_SECRET="$(openssl rand -hex 32)"
export COOKIE_SECURE=1
export TRUST_PROXY=1
DC="docker compose -f deploy/docker-compose.yml"
JAR="$EV/e7b-cookies.txt"; rm -f "$JAR"
EMAIL="uat-e7b+$(date +%s)@example.com"
API=http://127.0.0.1:3000

JS_COMMON='import {DatabaseSync} from "node:sqlite";'
# 文件指纹（不打开库）
fp() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e "$JS_COMMON"'
import {createHash} from "node:crypto"; import {readFileSync,existsSync,statSync} from "node:fs";
const h=p=>{const b=readFileSync(p);return {size:b.length,sha256:createHash("sha256").update(b).digest("hex")};};
const o={db:h("/data/shop.db")};
for (const s of ["-wal","-shm"]) { const p="/data/shop.db"+s; o[s]=existsSync(p)?{size:statSync(p).size}:null; }
console.log("FINGERPRINT "+JSON.stringify(o));' 2>/dev/null | grep -o 'FINGERPRINT {.*}' | sed 's/^FINGERPRINT //'; }
# 逻辑状态（打开库读订单；失败不静默）
logical() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e "$JS_COMMON"'
try { const db=new DatabaseSync("/data/shop.db");
  const c=db.prepare("select count(*) c from orders").get();
  const r=db.prepare("select no from orders order by id").all();
  console.log("LOGICAL "+JSON.stringify({orders:c.c,nos:r.map(x=>x.no)}));
} catch(e) { console.log("LOGICAL "+JSON.stringify({error:e.message})); }' 2>/dev/null | grep -o 'LOGICAL {.*}' | sed 's/^LOGICAL //'; }
# 官方备份快照内容（直接打开快照文件读订单）
snapcontent() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e "$JS_COMMON"'
import {readdirSync} from "node:fs";
try { const n=readdirSync("/data/backups").sort(); const out=[];
  for (const f of n) { const db=new DatabaseSync("/data/backups/"+f); const c=db.prepare("select count(*) c from orders").get();
    const r=db.prepare("select no from orders order by id").all();
    out.push({file:f,orders:c.c,nos:r.map(x=>x.no)}); db.close(); }
  console.log("SNAPCONTENT "+JSON.stringify(out));
} catch(e) { console.log("SNAPCONTENT "+JSON.stringify({error:e.message})); }' 2>/dev/null | grep -o 'SNAPCONTENT \[.*\]' | sed 's/^SNAPCONTENT //'; }
snaps() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readdirSync,readFileSync} from "node:fs";
const d="/data/backups"; let n=[]; try{n=readdirSync(d).sort();}catch{}
console.log("SNAPS "+JSON.stringify(n.map(f=>{const b=readFileSync(d+"/"+f);return {name:f,size:b.length,sha256:createHash("sha256").update(b).digest("hex")};})));' 2>/dev/null | grep -o 'SNAPS \[.*\]' | sed 's/^SNAPS //'; }
vols() { docker volume ls --format '{{.Name}}' | grep -E 'shop' | sort | tr '\n' ' '; }
waitapp() { for i in $(seq 1 25); do A=$(docker inspect shop-app-1 --format '{{.State.Health.Status}}' 2>/dev/null); [ "$A" = "healthy" ] && break; sleep 3; done; echo "$A"; }
step() { echo; echo "##### $* #####"; }
ord() { curl -s -o "$1" -w "%{http_code}" -b "$JAR" -c "$JAR" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; }
addc() { curl -s -o "$1" -w "%{http_code}" -b "$JAR" -c "$JAR" -H 'content-type: application/json' -d "$2" "$API/api/v1/cart/items"; }

step "0. 清场与起点"
$DC down -v --remove-orphans > "$EV/e7b-00-down.out" 2>&1; echo "  down -v --remove-orphans rc=$?"
docker volume rm shop-data > "$EV/e7b-00-rm.out" 2>&1; echo "  历史垃圾卷清理 rc=$?（1=本来就没有）"
for p in 80 443 3000; do echo "  端口 ${p} 监听数=$(lsof -nP -iTCP:${p} -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
echo "  起点卷集合=[$(vols)]"

step "1. 起服 → 造「快照时刻」数据（第 1 单）"
$DC up -d > "$EV/e7b-01-up1.out" 2>&1; echo "  up rc=$? app=$(waitapp)"
curl -s -o "$EV/e7b-02-reg.json" -w "  register status=%{http_code}\n" -c "$JAR" -H 'content-type: application/json' -d "{\"email\":\"${EMAIL}\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register"
echo "  add status=$(addc "$EV/e7b-03-cart.json" '{"productId":"P-001","quantity":1}')"
echo "  order#1 status=$(ord "$EV/e7b-04-order1.json")"
O1=$(grep -o '"orderNo":"[^"]*"' "$EV/e7b-04-order1.json" | head -1 | cut -d'"' -f4); echo "  order#1 no=${O1}"
echo "  文件指纹: $(fp)"
echo "  逻辑状态(应为 1 单): $(logical)"

step "2. 停服→起服，让 backup 服务给「快照时刻」打快照，并读快照内容"
$DC down > "$EV/e7b-05-down.out" 2>&1; echo "  down rc=$?"
$DC up -d > "$EV/e7b-06-up2.out" 2>&1; echo "  up rc=$? app=$(waitapp)"
SJ=$(snaps); echo "  快照列表: ${SJ}"
SNAP=$(printf '%s' "$SJ" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
SNAP_SHA=$(printf '%s' "$SJ" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  SNAP=${SNAP} sha256=${SNAP_SHA}"
echo "  快照内容(应为 1 单): $(snapcontent)"
docker cp "shop-app-1:/data/backups/${SNAP}" "${SNAPDIR}/${SNAP}" > "$EV/e7b-07-cp.out" 2>&1; echo "  快照拷到证据目录 rc=$?"

step "3. 造「比快照新」的状态（第 2 单）→ 停服取基线"
echo "  add status=$(addc "$EV/e7b-08-cart2.json" '{"productId":"P-002","quantity":2}')"
echo "  order#2 status=$(ord "$EV/e7b-09-order2.json")"
O2=$(grep -o '"orderNo":"[^"]*"' "$EV/e7b-09-order2.json" | head -1 | cut -d'"' -f4); echo "  order#2 no=${O2}"
$DC down > "$EV/e7b-10-down2.out" 2>&1; echo "  down rc=$?"
FP_B2=$(fp); LOG_B2=$(logical); V_BEFORE=$(vols)
echo "  V_before=[${V_BEFORE}]"
echo "  停服后文件指纹 B2: ${FP_B2}"
echo "  停服后逻辑状态 B2(应为 2 单): ${LOG_B2}"

step "4. 对照实验：旧写法硬编码卷名 shop-data（绝对路径挂载快照目录）"
echo "  docker run --rm -v shop-data:/data -v \"\$PWD/${SNAPDIR}:/backups:ro\" alpine cp -f /backups/${SNAP} /data/shop.db"
docker run --rm -v shop-data:/data -v "${PWD}/${SNAPDIR}:/backups:ro" alpine sh -c "cp -f /backups/${SNAP} /data/shop.db; ls -l /data/shop.db" > "$EV/e7b-11-oldstyle.out" 2>&1
echo "  rc=$?；输出: $(tr '\n' ' ' < "$EV/e7b-11-oldstyle.out")"
echo "  旧写法后文件指纹: $(fp)"
echo "  旧写法后逻辑状态: $(logical)"
echo "  旧写法后卷集合: [$(vols)]  ← 多出的就是垃圾卷"
echo "  ⇒ 判据能否分辨：文件指纹是否与 B2 相同？ $([ "$(fp)" = "${FP_B2}" ] && echo 相同/操作未生效 || echo 不同)"
docker volume rm shop-data > "$EV/e7b-12-rm.out" 2>&1; echo "  清垃圾卷 rc=$?；卷集合=[$(vols)]"

step "5. 正解：逐字照抄改后文档「回滚」第 2 步"
$DC run --rm --no-deps --entrypoint sh app -c "cp -f /data/backups/${SNAP} /data/shop.db && chown node:node /data/shop.db && ls -l /data/shop.db" > "$EV/e7b-13-rollback.out" 2>&1
echo "  rc=$?"; sed 's/^/    /' "$EV/e7b-13-rollback.out"
FP_AFTER_ROLLBACK=$(fp); echo "  回滚后(起服前)文件指纹: ${FP_AFTER_ROLLBACK}"
FP_DB_SHA=$(printf '%s' "$FP_AFTER_ROLLBACK" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  库 sha256=${FP_DB_SHA} / 快照 sha256=${SNAP_SHA}"
[ "${FP_DB_SHA}" = "${SNAP_SHA}" ] && echo "  ⇒ 逐位相同 ✓（回滚后的库 == 快照文件）" || echo "  ⇒ 不同 ✗"
echo "  回滚后(起服前)逻辑状态(应为 1 单): $(logical)"
echo "  读完后再取一次文件指纹(确认读库未改动文件): $(fp)"

step "6. 文档第 3/4 步：起服 + 按 orderNo 验（不只看 200）"
$DC up -d > "$EV/e7b-14-up3.out" 2>&1; echo "  up rc=$? app=$(waitapp)"
curl -s -o "$EV/e7b-15-health.json" -w "  GET /health status=%{http_code}\n" "$API/health"
curl -s -b "$JAR" -c "$JAR" -o "$EV/e7b-16-orders.json" -w "  GET /api/v1/orders status=%{http_code}\n" "$API/api/v1/orders?limit=100"
echo "    订单列表: $(grep -o '"orderNo":"[^"]*"' "$EV/e7b-16-orders.json" | cut -d'"' -f4 | tr '\n' ' ')"
echo "    期望：保留 ${O1}（回滚后存在）／${O2}（回滚后应不存在）"
echo "    回滚后逻辑状态: $(logical)"
echo "    快照列表(文档说会再打一份回滚后的快照): $(snaps)"
echo "    快照内容: $(snapcontent)"

step "7. 卷集合前后逐字比对"
$DC down > "$EV/e7b-17-down3.out" 2>&1; echo "  down rc=$?"
V_AFTER=$(vols); echo "  V_before=[${V_BEFORE}]"; echo "  V_after =[${V_AFTER}]"
[ "${V_BEFORE}" = "${V_AFTER}" ] && echo "  ⇒ 逐字相同 ✓（无垃圾卷）" || echo "  ⇒ 不同 ✗"

step "8. 附加观察：同日第二次打快照是否覆盖（旧快照是否还在）"
$DC up -d > "$EV/e7b-18-up4.out" 2>&1; echo "  up rc=$? app=$(waitapp)"
echo "  add status=$(addc "$EV/e7b-19-cart3.json" '{"productId":"P-003","quantity":1}')"
echo "  order#3 status=$(ord "$EV/e7b-20-order3.json")"
O3=$(grep -o '"orderNo":"[^"]*"' "$EV/e7b-20-order3.json" | head -1 | cut -d'"' -f4); echo "  order#3 no=${O3}"
echo "  加单后逻辑状态: $(logical)"
$DC down > "$EV/e7b-21-down4.out" 2>&1; echo "  down rc=$?"
$DC up -d > "$EV/e7b-22-up5.out" 2>&1; echo "  up rc=$? app=$(waitapp)"
echo "  快照内容(第二次): $(snapcontent)"
SNAP2_SHA=$(snaps | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  快照 sha256 第一次=${SNAP_SHA} / 第二次=${SNAP2_SHA}"
[ "${SNAP_SHA}" = "${SNAP2_SHA}" ] && echo "  ⇒ 未覆盖" || echo "  ⇒ 同名快照被新状态覆盖：同日更早那份（1 单状态）已不在磁盘上"

step "9. 收尾 down -v --remove-orphans + 残留自查"
$DC down -v --remove-orphans > "$EV/e7b-23-down-final.out" 2>&1; echo "  rc=$?"; tail -3 "$EV/e7b-23-down-final.out" | sed 's/^/    /'
docker volume rm shop-data > "$EV/e7b-24-rm.out" 2>&1; echo "  兜底清垃圾卷 rc=$?（1=无）"
echo "  shop* 卷=[$(vols)]"
echo "  shop* 网络=[$(docker network ls --format '{{.Name}}' | grep -E 'shop' | tr '\n' ' ')]"
for p in 80 443 3000; do echo "  端口 ${p} 监听数=$(lsof -nP -iTCP:${p} -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
echo "  全部容器:"; docker ps -a --format '    {{.Names}} {{.Status}}'
echo; echo "汇总 EMAIL=${EMAIL} SNAP=${SNAP} O1=${O1} O2=${O2} O3=${O3}"
