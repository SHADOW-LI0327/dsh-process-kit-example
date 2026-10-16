#!/usr/bin/env bash
# FEAT-002 UAT · E7 复验：照「改后」docs/DEPLOY.md 的回滚路径独立跑一遍
# 【唯一替代】deploy/.env 不存在且我无权写 deploy/**，故把该文件会提供的三个变量放进 shell 环境
#   （compose 插值优先取 shell 环境；等价性用 `docker compose config` 的解析值佐证）。
# 其余命令逐字照抄文档（含「数据在哪」的 docker inspect 发现命令）。
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
SNAPDIR="$EV/e7-snap"
mkdir -p "$EV" "$SNAPDIR"
export DOCKER_CONFIG=/tmp/dockercfg
export SESSION_SECRET="$(openssl rand -hex 32)"
export COOKIE_SECURE=1
export TRUST_PROXY=1
DC="docker compose -f deploy/docker-compose.yml"
JAR="$EV/e7-cookies.txt"; rm -f "$JAR"
EMAIL="uat-e7+$(date +%s)@example.com"
API=http://127.0.0.1:3000

fp() { # 文件级指纹：不打开库
  $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readFileSync,existsSync,statSync} from "node:fs";
const h=p=>{const b=readFileSync(p);return {size:b.length,sha256:createHash("sha256").update(b).digest("hex")};};
const o={db:h("/data/shop.db")};
for (const s of ["-wal","-shm"]) { const p="/data/shop.db"+s; o[s]=existsSync(p)?{size:statSync(p).size}:null; }
console.log("FINGERPRINT "+JSON.stringify(o));' 2>/dev/null | grep -o 'FINGERPRINT {.*}' | sed 's/^FINGERPRINT //'
}
logical() { # 逻辑状态：node:sqlite 打开库读订单（会正确合并 WAL）
  $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync("/data/shop.db");
const c=db.prepare("select count(*) c from orders").get();
const r=db.prepare("select order_no from orders order by rowid").all();
console.log("LOGICAL "+JSON.stringify({orders:c.c,orderNos:r.map(x=>x.order_no)}));' 2>/dev/null | grep -o 'LOGICAL {.*}' | sed 's/^LOGICAL //'
}
snaps() {
  $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readdirSync,readFileSync} from "node:fs";
const d="/data/backups"; let names=[]; try{names=readdirSync(d).sort();}catch{}
const out=names.map(n=>{const b=readFileSync(d+"/"+n);return {name:n,size:b.length,sha256:createHash("sha256").update(b).digest("hex")};});
console.log("SNAPS "+JSON.stringify(out));' 2>/dev/null | grep -o 'SNAPS \[.*\]' | sed 's/^SNAPS //'
}
vols() { docker volume ls --format '{{.Name}}' | grep -E 'shop' | sort | tr '\n' ' '; }
waitapp() { for i in $(seq 1 20); do A=$(docker inspect shop-app-1 --format '{{.State.Health.Status}}' 2>/dev/null); [ "$A" = "healthy" ] && break; sleep 3; done; echo "$A"; }
step() { echo; echo "##### $* #####"; }
order() { curl -s -o "$1" -w "%{http_code}" -b "$JAR" -c "$JAR" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; }

step "0. 起点：清场、端口与历史垃圾卷"
$DC down -v --remove-orphans > "$EV/e7-00-down.out" 2>&1; echo "  down -v --remove-orphans rc=$?"
for p in 80 443 3000; do echo "  端口 ${p} 监听数=$(lsof -nP -iTCP:${p} -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
docker volume rm shop-data > "$EV/e7-00-rmstray.out" 2>&1; echo "  清理历史垃圾卷 shop-data rc=$?"
V_BEFORE0=$(vols); echo "  起点卷集合=[${V_BEFORE0}]"
echo "  ── dev「不改 compose」理由的独立验证：换 -p 项目名，看宿主卷名是否跟着变 ──"
docker compose -p uate7a -f deploy/docker-compose.yml config 2>/dev/null | grep -E '^    name: ' | sed 's/^/    -p uate7a → /'
docker compose -p uate7b -f deploy/docker-compose.yml config 2>/dev/null | grep -E '^    name: ' | sed 's/^/    -p uate7b → /'

step "1. 文档起法：$DC up -d（首次无库 ⇒ backup 跳过）"
$DC up -d > "$EV/e7-01-up1.out" 2>&1; echo "  up rc=$?"; A=$(waitapp); echo "  app=$A"
echo "  状态A 文件指纹: $(fp)"
echo "  状态A 逻辑状态: $(logical)"
echo "  状态A 快照列表: $(snaps)"
echo "  状态A 卷集合: [$(vols)]"

step "2. 造「快照时刻」数据：注册 + 加购 + 下单（第 1 单 = 回滚后应保留）"
curl -s -o "$EV/e7-02-reg.json" -w "  register status=%{http_code}\n" -c "$JAR" -H 'content-type: application/json' -d "{\"email\":\"${EMAIL}\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register"
curl -s -o "$EV/e7-02-cart.json" -w "  add      status=%{http_code}\n" -b "$JAR" -c "$JAR" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "$API/api/v1/cart/items"
RC=$(order "$EV/e7-02-order1.json"); echo "  order#1  status=${RC}"
O1=$(grep -o '"orderNo":"[^"]*"' "$EV/e7-02-order1.json" | head -1 | cut -d'"' -f4); echo "  order#1 orderNo=${O1}"
echo "  状态B1 文件指纹: $(fp)"
echo "  状态B1 逻辑状态: $(logical)"

step "3. 停服 → 起服一次，让 backup 服务给「快照时刻」的库打快照"
$DC down > "$EV/e7-03-down.out" 2>&1; echo "  down rc=$?"
$DC up -d > "$EV/e7-04-up2.out" 2>&1; echo "  up rc=$?"; A=$(waitapp); echo "  app=$A"
SNAPS_JSON=$(snaps); echo "  快照列表: ${SNAPS_JSON}"
SNAP=$(printf '%s' "$SNAPS_JSON" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
SNAP_SHA=$(printf '%s' "$SNAPS_JSON" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  快照名 SNAP=${SNAP}"
echo "  快照 sha256=${SNAP_SHA}"
docker cp "shop-app-1:/data/backups/${SNAP}" "${SNAPDIR}/${SNAP}" > "$EV/e7-05-cp.out" 2>&1; echo "  快照拷到证据目录 rc=$?（供旧写法对照）"
echo "  起服后逻辑状态（应仍 1 单）: $(logical)"

step "4. 造「比快照新」的状态：再下一单（第 2 单 = 回滚后应消失）"
curl -s -o "$EV/e7-06-cart2.json" -w "  add      status=%{http_code}\n" -b "$JAR" -c "$JAR" -H 'content-type: application/json' -d '{"productId":"P-002","quantity":2}' "$API/api/v1/cart/items"
RC=$(order "$EV/e7-06-order2.json"); echo "  order#2  status=${RC}"
O2=$(grep -o '"orderNo":"[^"]*"' "$EV/e7-06-order2.json" | head -1 | cut -d'"' -f4); echo "  order#2 orderNo=${O2}"
echo "  状态B2 文件指纹: $(fp)"
echo "  状态B2 逻辑状态（应 2 单）: $(logical)"
$DC down > "$EV/e7-07-down2.out" 2>&1; echo "  停服（文档回滚第 1 步）rc=$?"
V_BEFORE=$(vols); echo "  停服后卷集合 V_before=[${V_BEFORE}]"
FP_BEFORE=$(fp); LOG_BEFORE=$(logical)
echo "  停服后文件指纹 B2: ${FP_BEFORE}"
echo "  停服后逻辑状态 B2: ${LOG_BEFORE}"

step "5. 对照实验：旧写法（硬编码宿主卷名 shop-data）—— 期望证明是静默空操作"
docker run --rm -v shop-data:/data -v "${SNAPDIR}:/backups:ro" alpine sh -c "cp -f /backups/${SNAP} /data/shop.db; ls -l /data/shop.db" > "$EV/e7-08-oldstyle.out" 2>&1
echo "  旧写法 rc=$?；输出: $(tr '\n' ' ' < "$EV/e7-08-oldstyle.out")"
echo "  旧写法后文件指纹: $(fp)"
echo "  旧写法后逻辑状态: $(logical)"
echo "  旧写法后卷集合: [$(vols)]   ← 多出来那个就是凭空产生的垃圾卷"
docker volume rm shop-data > "$EV/e7-09-rmstray.out" 2>&1; echo "  清掉垃圾卷 rc=$?；卷集合=[$(vols)]"

step "6. 正解：逐字照抄改后文档「回滚」第 2 步"
echo "  SNAP=${SNAP}"
echo "  docker compose -f deploy/docker-compose.yml run --rm --no-deps --entrypoint sh app -c \"cp -f /data/backups/\$SNAP /data/shop.db && chown node:node /data/shop.db && ls -l /data/shop.db\""
$DC run --rm --no-deps --entrypoint sh app -c "cp -f /data/backups/${SNAP} /data/shop.db && chown node:node /data/shop.db && ls -l /data/shop.db" > "$EV/e7-10-rollback.out" 2>&1
echo "  rc=$?"; sed 's/^/    /' "$EV/e7-10-rollback.out"
echo "  回滚后（起服前）文件指纹: $(fp)"
echo "  回滚后（起服前）逻辑状态: $(logical)"
$DC run --rm --no-deps --entrypoint sh app -c "sha256sum /data/shop.db /data/backups/${SNAP}" > "$EV/e7-11-cmp.out" 2>&1
echo "  同容器内逐位比对 rc=$?"; sed 's/^/    /' "$EV/e7-11-cmp.out"

step "7. 文档第 3/4 步：起服 + 验恢复（不只看 200）"
$DC up -d > "$EV/e7-12-up3.out" 2>&1; echo "  up rc=$?"; A=$(waitapp); echo "  app=$A"
curl -s -o "$EV/e7-13-health.json" -w "  GET /health status=%{http_code} body=" "$API/health"; head -c 90 "$EV/e7-13-health.json"; echo
echo "  「数据在哪」发现命令（逐字照抄）:"
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' \
  "$($DC ps -q app)" > "$EV/e7-14-mounts.out" 2>&1; echo "    rc=$?"; sed 's/^/    /' "$EV/e7-14-mounts.out"
curl -s -b "$JAR" -c "$JAR" -o "$EV/e7-15-orders.json" -w "  GET /api/v1/orders status=%{http_code}\n" "$API/api/v1/orders?limit=100"
echo "    列表订单号: $(grep -o '"orderNo":"[^"]*"' "$EV/e7-15-orders.json" | cut -d'"' -f4 | tr '\n' ' ')"
if [ "$(head -c 20 "$EV/e7-15-orders.json" | grep -c 401)" != "0" ]; then
  echo "    （会话失效，重新登录后再查）"
  curl -s -o /dev/null -c "$JAR" -H 'content-type: application/json' -d "{\"email\":\"${EMAIL}\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/login"
  curl -s -b "$JAR" -c "$JAR" -o "$EV/e7-15-orders.json" -w "    重登后 GET /orders status=%{http_code}\n" "$API/api/v1/orders?limit=100"
  echo "    列表订单号: $(grep -o '"orderNo":"[^"]*"' "$EV/e7-15-orders.json" | cut -d'"' -f4 | tr '\n' ' ')"
fi
echo "    期望：保留 orderNo=${O1}；消失 orderNo=${O2}"
echo "    回滚后逻辑状态: $(logical)"
echo "    起服后快照列表（文档说会再打一份回滚后的快照）: $(snaps)"

step "8. 卷集合前后逐字比对（验掉「凭空多出垃圾卷」）"
$DC down > "$EV/e7-16-down3.out" 2>&1; echo "  down rc=$?"
V_AFTER=$(vols); echo "  V_before=[${V_BEFORE}]"
echo "  V_after =[${V_AFTER}]"
if [ "${V_BEFORE}" = "${V_AFTER}" ]; then echo "  ⇒ 逐字相同 ✓"; else echo "  ⇒ 不同 ✗"; fi

step "9. 附加观察：同一天再起一次服，快照文件名相同是否会覆盖（回滚目标是否可长期保留）"
$DC up -d > "$EV/e7-17-up4.out" 2>&1; echo "  up rc=$?"; A=$(waitapp); echo "  app=$A"
curl -s -o "$EV/e7-18-cart3.json" -w "  add      status=%{http_code}\n" -b "$JAR" -c "$JAR" -H 'content-type: application/json' -d '{"productId":"P-003","quantity":1}' "$API/api/v1/cart/items"
RC=$(order "$EV/e7-18-order3.json"); echo "  order#3  status=${RC}"
O3=$(grep -o '"orderNo":"[^"]*"' "$EV/e7-18-order3.json" | head -1 | cut -d'"' -f4); echo "  order#3 orderNo=${O3}"
echo "  加单后逻辑状态: $(logical)"
$DC down > "$EV/e7-19-down4.out" 2>&1; echo "  停服 rc=$?"
$DC up -d > "$EV/e7-20-up5.out" 2>&1; echo "  再起服（backup 服务会再打一份快照）rc=$?"; A=$(waitapp); echo "  app=$A"
SNAPS2=$(snaps); echo "  快照列表（第二次）: ${SNAPS2}"
SNAP2_SHA=$(printf '%s' "$SNAPS2" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  第一次快照 sha256=${SNAP_SHA}"
echo "  第二次快照 sha256=${SNAP2_SHA}"
if [ "${SNAP_SHA}" = "${SNAP2_SHA}" ]; then echo "  ⇒ 快照内容未变（未覆盖）"; else echo "  ⇒ 同名快照已被新状态覆盖 ⇒ 同日更早那份快照不再存在"; fi

step "10. 收尾：$DC down -v --remove-orphans + 残留自查"
$DC down -v --remove-orphans > "$EV/e7-21-down-final.out" 2>&1; echo "  rc=$?"; tail -3 "$EV/e7-21-down-final.out" | sed 's/^/    /'
docker volume rm shop-data > "$EV/e7-22-rmstray.out" 2>&1; echo "  兜底清垃圾卷 rc=$?"
echo "  shop* 卷=[$(vols)]"
echo "  shop* 网络=[$(docker network ls --format '{{.Name}}' | grep -E 'shop' | tr '\n' ' ')]"
for p in 80 443 3000; do echo "  端口 ${p} 监听数=$(lsof -nP -iTCP:${p} -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
echo "  全部容器:"; docker ps -a --format '    {{.Names}} {{.Status}}'
echo; echo "EMAIL=${EMAIL} SNAP=${SNAP} O1=${O1} O2=${O2} O3=${O3}"
