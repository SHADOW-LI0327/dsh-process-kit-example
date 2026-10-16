#!/usr/bin/env bash
# FEAT-002 UAT · §13 终次复验（E9 正身 / 假成功对照 / E8 复核 / 文档逐条可执行）
# 项目隔离：COMPOSE_PROJECT_NAME=uate7f（test 正并行用 feat002t；两边不删对方卷）
# 采集纪律：先「卷内 ls -l / test -f」+「纯字节 sha256」，最后才打开库读业务数据
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
mkdir -p "$EV"
export DOCKER_CONFIG=/tmp/dockercfg
export COMPOSE_PROJECT_NAME=uate7f
export SESSION_SECRET="$(openssl rand -hex 32)"
export COOKIE_SECURE=1
export TRUST_PROXY=1
DC="docker compose -f deploy/docker-compose.yml"
JAR="jar.txt"                       # 照抄文档第 4 步：curl -s -b jar.txt localhost:3000/...
JARP="$EV/e7f-$JAR"
API=http://localhost:3000
step() { echo; echo "##### $* #####"; }

# ── 纯字节指纹（不打开库）──────────────────────────────────────────────
fp() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readFileSync,existsSync,statSync} from "node:fs";
const h=p=>{const b=readFileSync(p);return {size:b.length,sha256:createHash("sha256").update(b).digest("hex")};};
const o={db:h("/data/shop.db")}; for (const s of ["-wal","-shm"]) { const p="/data/shop.db"+s; o[s]=existsSync(p)?{size:statSync(p).size}:null; }
console.log("FINGERPRINT "+JSON.stringify(o));' 2>/dev/null | grep -o 'FINGERPRINT {.*}' | sed 's/^FINGERPRINT //'; }
# ── 卷内清单 + test -f（不打开库；E9 的「前提取证」）──────────────────
volview() { $DC run --rm --no-deps --entrypoint sh app -c '
ls -l /data; ls -l /data/backups;
for f in /data/shop.db /data/shop.db-wal /data/shop.db-shm; do if [ -f "$f" ]; then echo "EXISTS $f"; else echo "ABSENT $f"; fi; done' 2>/dev/null | grep -E '^(total|-|d|EXISTS|ABSENT)'; }
snaps() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {createHash} from "node:crypto"; import {readdirSync,readFileSync} from "node:fs";
let n=[]; try{n=readdirSync("/data/backups").sort();}catch{}
console.log("SNAPS "+JSON.stringify(n.map(f=>{const b=readFileSync("/data/backups/"+f);return {name:f,size:b.length,sha256:createHash("sha256").update(b).digest("hex")};})));' 2>/dev/null | grep -o 'SNAPS \[.*\]' | sed 's/^SNAPS //'; }
# ── 打开库读业务数据（只在字节级取证之后调用）───────────────────────
logical() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
try { const db=new DatabaseSync("/data/shop.db"); const c=db.prepare("select count(*) c from orders").get();
  const r=db.prepare("select no from orders order by id").all();
  console.log("LOGICAL "+JSON.stringify({orders:c.c,nos:r.map(x=>x.no)})); } catch(e){ console.log("LOGICAL "+JSON.stringify({error:e.message})); }' 2>/dev/null | grep -o 'LOGICAL {.*}' | sed 's/^LOGICAL //'; }
snapcontent() { $DC run --rm --no-deps --entrypoint node app --input-type=module -e '
import {readdirSync} from "node:fs"; import {DatabaseSync} from "node:sqlite";
try { const out=[]; for (const f of readdirSync("/data/backups").sort()) { const db=new DatabaseSync("/data/backups/"+f);
  const c=db.prepare("select count(*) c from orders").get(); const r=db.prepare("select no from orders order by id").all();
  out.push({file:f,orders:c.c,nos:r.map(x=>x.no)}); db.close(); }
  console.log("SNAPCONTENT "+JSON.stringify(out)); } catch(e){ console.log("SNAPCONTENT "+JSON.stringify({error:e.message})); }' 2>/dev/null | grep -o 'SNAPCONTENT \[.*\]' | sed 's/^SNAPCONTENT //'; }
vols() { docker volume ls --format '{{.Name}}' | grep -E "uate7f|shop" | sort | tr '\n' ' '; }
heap() { for i in $(seq 1 25); do A=$(docker inspect "$($DC ps -q app)" --format '{{.State.Health.Status}}' 2>/dev/null); [ "$A" = "healthy" ] && break; sleep 3; done; echo "$A"; }
wait3000() { for i in $(seq 1 40); do N=$(lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' '); [ "$N" = "0" ] && return 0; echo "  ⏳ 3000 被他人占用（${N} 个监听者），等 3s…"; sleep 3; done; return 1; }
reg() { curl -s -o "$EV/e7f-reg-$1.json" -w "%{http_code}" -c "$JARP" -H 'content-type: application/json' -d "{\"email\":\"uat-e7f$1+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register"; }
addc() { curl -s -o "$EV/e7f-cart-$1.json" -w "%{http_code}" -b "$JARP" -c "$JARP" -H 'content-type: application/json' -d "$2" "$API/api/v1/cart/items"; }
ord() { curl -s -o "$EV/e7f-order-$1.json" -w "%{http_code}" -b "$JARP" -c "$JARP" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; }
olist() { curl -s -b "$JARP" -c "$JARP" "$API/api/v1/orders?limit=100" | grep -o '"orderNo":"[^"]*"' | cut -d'"' -f4 | tr '\n' ' '; }
no_of() { grep -o '"orderNo":"[^"]*"' "$1" | head -1 | cut -d'"' -f4; }

echo "项目名=${COMPOSE_PROJECT_NAME}；本脚本只操作该项目，不碰 test 的 feat002t"
echo "解析出的容器/卷名："
docker compose -f deploy/docker-compose.yml config --format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("  services:",Object.keys(j.services).join(","));console.log("  volumes :",Object.entries(j.volumes||{}).map(([k,v])=>k+"->"+v.name).join(", "));console.log("  networks:",Object.entries(j.networks||{}).map(([k,v])=>k+"->"+v.name).join(", "));});' 2>/dev/null || true

# ══════════════════════════════════════════════════════════════════════
step "0. 清场（只清我的项目）"
$DC down -v --remove-orphans > "$EV/e7f-00-down.out" 2>&1; echo "  down -v --remove-orphans rc=$?"
echo "  我的卷=[$(docker volume ls --format '{{.Name}}' | grep uate7f | tr '\n' ' ')]"
wait3000 && echo "  3000 空闲 ✓" || echo "  ⚠ 3000 一直被占"

# ══════════════════════════════════════════════════════════════════════
step "A1. 起服 → 第 1 单（= 快照时刻状态）"
wait3000; $DC up -d > "$EV/e7f-01-up1.out" 2>&1; echo "  up rc=$? app=$(heap)"
echo "  register=$(reg 1)"
echo "  add=$(addc 1 '{"productId":"P-001","quantity":1}')"
echo "  order#1=$(ord 1)"; O1=$(no_of "$EV/e7f-order-1.json"); echo "  order#1 no=${O1}"

step "A2. 文档第 1 步（停服）→ 第 3 步（起服，backup 先打快照）→ 快照时刻落盘"
$DC down > "$EV/e7f-02-down.out" 2>&1; echo "  第 1 步 down rc=$?"
wait3000; $DC up -d > "$EV/e7f-03-up2.out" 2>&1; echo "  第 3 步 up rc=$? app=$(heap)"
SJ=$(snaps); echo "  快照列表: ${SJ}"
SNAP=$(printf '%s' "$SJ" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
SNAP_SHA=$(printf '%s' "$SJ" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  SNAP=${SNAP} sha256=${SNAP_SHA}"
echo "  快照内容（打开快照文件）: $(snapcontent)"
V_BEFORE=$(vols); echo "  卷集合 V_before=[${V_BEFORE}]"

step "A3. 写第 2 单（比快照新）→ docker kill（SIGKILL）→ down"
echo "  add=$(addc 2 '{"productId":"P-002","quantity":1}')"
echo "  order#2=$(ord 2)"; O2=$(no_of "$EV/e7f-order-2.json"); echo "  order#2 no=${O2}"
$DC kill app > "$EV/e7f-04-kill.out" 2>&1; echo "  compose kill app rc=$?"
APPID=$($DC ps -q app); echo "  被杀容器状态: $(docker inspect "$APPID" --format '{{.State.Status}} exit={{.State.ExitCode}}')"
$DC down > "$EV/e7f-05-down2.out" 2>&1; echo "  第 1 步 down rc=$?"

step "A4. 【前置取证】卷内确实残留 shop.db-wal（不打开库）"
volview > "$EV/e7f-06-prvw.out" 2>&1; sed 's/^/    /' "$EV/e7f-06-prvw.out"
echo "  纯字节指纹: $(fp)"
WAL_PRE=$(grep -c '^EXISTS /data/shop.db-wal' "$EV/e7f-06-prvw.out")
echo "  ⇒ 前置条件（残留 WAL 存在）= $([ "$WAL_PRE" = "1" ] && echo '成立 ✓' || echo '不成立 ✗')"

step "A5. 逐字执行改后文档「第 2 步 · 用快照替换库」（SNAP 换成实际文件名）"
echo "  SNAP=${SNAP}"
echo "  docker compose -f deploy/docker-compose.yml run --rm --no-deps \\"
echo "    --entrypoint sh app -c \\"
echo "    \"rm -f /data/shop.db-wal /data/shop.db-shm && cp -pf /data/backups/\$SNAP /data/shop.db && ls -l /data/shop.db\""
$DC run --rm --no-deps --entrypoint sh app -c "rm -f /data/shop.db-wal /data/shop.db-shm && cp -pf /data/backups/${SNAP} /data/shop.db && ls -l /data/shop.db" > "$EV/e7f-07-rollback.out" 2>&1
echo "  rc=$?"; sed 's/^/    /' "$EV/e7f-07-rollback.out"

step "A6. 【回滚后·起服前取证】-wal/-shm 是否已消失 + 纯字节指纹"
volview > "$EV/e7f-08-postvw.out" 2>&1; sed 's/^/    /' "$EV/e7f-08-postvw.out"
FP_POST=$(fp); echo "  纯字节指纹: ${FP_POST}"
echo "  库 sha256=$(printf '%s' "$FP_POST" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4) / 快照 ${SNAP_SHA}"
echo "  ⇒ 与快照逐位相同 = $([ "$(printf '%s' "$FP_POST" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)" = "${SNAP_SHA}" ] && echo '是 ✓' || echo '否 ✗')"
WAL_POST=$(grep -c '^ABSENT /data/shop.db-wal' "$EV/e7f-08-postvw.out"); SHM_POST=$(grep -c '^ABSENT /data/shop.db-shm' "$EV/e7f-08-postvw.out")
echo "  ⇒ WAL 已消失 = $([ "${WAL_POST}" = "1" ] && echo '是 ✓' || echo '否 ✗')；SHM 已消失 = $([ "${SHM_POST}" = "1" ] && echo '是 ✓' || echo '否 ✗')"
echo "  （此处尚未打开库；下面是第一次打开）库级读数: $(logical)"

step "A7. 文档第 3 步起服 + 第 4 步验恢复（照抄，含 jar.txt 字面文件名）"
wait3000; $DC up -d > "$EV/e7f-09-up3.out" 2>&1; echo "  第 3 步 up rc=$? app=$(heap)"
curl -s -o "$EV/e7f-10-health.json" -w "  curl -s localhost:3000/health → %{http_code}\n" "$API/health"
echo "  文档第 4 步的发现命令（逐字）:"
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}' \
  "$($DC ps -q app)" > "$EV/e7f-11-mounts.out" 2>&1; echo "    rc=$?"; sed 's/^/    /' "$EV/e7f-11-mounts.out"
cd "$EV" && curl -s -b "$JAR" -c "$JAR" -o "e7f-12-orders-literal.txt" -w "  文档第 4 步 curl -s -b jar.txt localhost:3000/api/v1/orders → %{http_code}\n" "localhost:3000/api/v1/orders"; cd - > /dev/null
echo "    列表订单号: $(no_of_list=$(grep -o '"orderNo":"[^"]*"' "$EV/e7f-12-orders-literal.txt" | cut -d'"' -f4 | tr '\n' ' '); echo "$no_of_list")"
echo "    期望：只有 ${O1}（快照时刻那笔），${O2} 不复活"
echo "  起服后库级读数: $(logical)"

step "A8. E8 复核：同日再打一次快照 ⇒ 目录仍 1 个文件、内容变成后一次的状态"
echo "  add=$(addc 3 '{"productId":"P-003","quantity":1}')"
echo "  order#3=$(ord 3)"; O3=$(no_of "$EV/e7f-order-3.json"); echo "  order#3 no=${O3}"
$DC down > "$EV/e7f-13-down3.out" 2>&1; echo "  down rc=$?"
wait3000; $DC up -d > "$EV/e7f-14-up4.out" 2>&1; echo "  up（backup 再打一份）rc=$? app=$(heap)"
SJ2=$(snaps); echo "  快照列表(第二次): ${SJ2}"
echo "  文件数=$(printf '%s' "$SJ2" | grep -o '"name"' | wc -l | tr -d ' ')"
SNAP2_SHA=$(printf '%s' "$SJ2" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  sha256 第一次=${SNAP_SHA} / 第二次=${SNAP2_SHA} ⇒ $([ "${SNAP_SHA}" = "${SNAP2_SHA}" ] && echo '未变' || echo '已变（覆盖）')"
echo "  快照内容(第二次): $(snapcontent)"

step "A9. 卷集合前后逐字比对"
$DC down > "$EV/e7f-15-down4.out" 2>&1; echo "  down rc=$?"
V_AFTER=$(vols)
echo "  V_before=[${V_BEFORE}]"
echo "  V_after =[${V_AFTER}]"
[ "${V_BEFORE}" = "${V_AFTER}" ] && echo "  ⇒ 逐字相同 ✓（无垃圾卷）" || echo "  ⇒ 不同 ✗"

step "B1. 假成功对照（文档判据声明是否如实）：同样残留 WAL，但**省掉 rm** 只 cp"
$DC down -v --remove-orphans > "$EV/e7f-16-downclean.out" 2>&1; echo "  清场 rc=$?"
wait3000; $DC up -d > "$EV/e7f-17-up1.out" 2>&1; echo "  up rc=$? app=$(heap)"
echo "  register=$(reg b1)"; echo "  add=$(addc b1 '{"productId":"P-001","quantity":1}')"
echo "  order#1=$(ord b1)"; B1=$(no_of "$EV/e7f-order-b1.json"); echo "  order#1 no=${B1}"
$DC down > "$EV/e7f-18-down.out" 2>&1; wait3000; $DC up -d > "$EV/e7f-19-up2.out" 2>&1; echo "  快照轮 up rc=$? app=$(heap)"
SJB=$(snaps); SNAPB=$(printf '%s' "$SJB" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4); SNAPB_SHA=$(printf '%s' "$SJB" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  SNAP=${SNAPB} sha256=${SNAPB_SHA}；内容=$(snapcontent)"
echo "  add=$(addc b2 '{"productId":"P-002","quantity":1}')"; echo "  order#2=$(ord b2)"; B2=$(no_of "$EV/e7f-order-b2.json"); echo "  order#2 no=${B2}"
$DC kill app > "$EV/e7f-20-kill.out" 2>&1; echo "  kill rc=$?"; $DC down > "$EV/e7f-21-down.out" 2>&1; echo "  down rc=$?"
volview > "$EV/e7f-22-prvw.out" 2>&1; echo "  前置取证: $(grep -c '^EXISTS /data/shop.db-wal' "$EV/e7f-22-prvw.out") 个残留 WAL；指纹 $(fp)"
$DC run --rm --no-deps --entrypoint sh app -c "cp -pf /data/backups/${SNAPB} /data/shop.db && ls -l /data/shop.db" > "$EV/e7f-23-oldcp.out" 2>&1
echo "  只 cp（不做 rm）rc=$?"; sed 's/^/    /' "$EV/e7f-23-oldcp.out"
FPB=$(fp); echo "  指纹: ${FPB}"
echo "  库 sha256=$(printf '%s' "$FPB" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4) / 快照 ${SNAPB_SHA} ⇒ $([ "$(printf '%s' "$FPB" | grep -o '"sha256":"[^"]*"' | head -1 | cut -d'"' -f4)" = "${SNAPB_SHA}" ] && echo '逐位相同（假成功的指纹条件也满足）' || echo '不同')"
echo "  库级读数（第一次打开库，WAL 在此被回放/合并）: $(logical)"
wait3000; $DC up -d > "$EV/e7f-24-up3.out" 2>&1; echo "  起服 rc=$? app=$(heap)"
curl -s -o "$EV/e7f-25-health.json" -w "  /health → %{http_code}\n" "$API/health"
echo "  订单列表: $(olist)"
echo "  期望（若真回滚成功）: 只有 ${B1}；实际见上 ⇒ 假成功形态（rc=0 + 指纹相同 + 200，数据未回滚）"

step "C. 收尾：down -v --remove-orphans + 残留自查"
$DC down -v --remove-orphans > "$EV/e7f-26-downfinal.out" 2>&1; echo "  rc=$?"; tail -3 "$EV/e7f-26-downfinal.out" | sed 's/^/    /'
echo "  我的卷=[$(docker volume ls --format '{{.Name}}' | grep uate7f | tr '\n' ' ')]  我的网络=[$(docker network ls --format '{{.Name}}' | grep uate7f | tr '\n' ' ')]"
echo "  全机 shop*/feat* 卷=[$(docker volume ls --format '{{.Name}}' | grep -E 'shop|feat' | tr '\n' ' ')]（test 的卷我一个没动）"
for p in 3000 80 443; do echo "  端口 ${p} 监听数=$(lsof -nP -iTCP:${p} -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
echo "  全部容器:"; docker ps -a --format '    {{.Names}} {{.Status}} {{.Ports}}'
echo; echo "汇总 SNAP=${SNAP} O1=${O1} O2=${O2} O3=${O3} | 对照 SNAPB=${SNAPB} B1=${B1} B2=${B2}"
