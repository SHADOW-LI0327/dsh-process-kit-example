#!/usr/bin/env bash
# FEAT-002 UAT · P-12 迁移 / P-13 播种 / P-14 备份恢复 黑盒操作取证
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
mkdir -p "$EV"
SECRET="$(openssl rand -hex 32)"
D="$EV/data"; mkdir -p "$D"
H=127.0.0.1
PID=""

start() { env NODE_ENV=production SESSION_SECRET="$SECRET" PORT="$1" DB_PATH="$2" node server/src/index.mjs > "$3" 2>&1 & PID=$!; sleep 1.8; }
stop()  { kill -TERM "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; echo "  rc=$?"; }

echo "##### P-12/P-13 首次建库 + 幂等播种 #####"
DB="$D/p12.db"; rm -f "$DB"*
echo "-- 首次启动（库不存在）:"; start 3131 "$DB" "$EV/p12a.log"; echo "   /health=$(curl -s -o /dev/null -w '%{http_code}' http://$H:3131/health)"
P1=$(curl -s "http://$H:3131/api/v1/products" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len(d["data"]["items"]) if isinstance(d.get("data"),dict) and "items" in d["data"] else json.dumps(d)[:200])')
echo "   商品数=$(echo "$P1")"
echo "-- 库文件:"; ls -la "$DB" | sed 's/^/   /'
echo "-- 库结构（sqlite3 只读查看，运行时产物）:"; sqlite3 "$DB" ".tables" | sed 's/^/   /'
echo "-- schema_migrations 内容:"; sqlite3 "$DB" "select * from schema_migrations;" | sed 's/^/   /'
echo "-- 种子商品（按名称，不依赖主键）:"; sqlite3 "$DB" "select name,price_cents,stock from products order by rowid;" | sed 's/^/   /'
echo "-- 停机:"; stop
echo "-- 第二次启动（同库，验幂等播种）:"; start 3131 "$DB" "$EV/p12b.log"
P2=$(curl -s "http://$H:3131/api/v1/products" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len(d["data"]["items"]) if isinstance(d.get("data"),dict) and "items" in d["data"] else json.dumps(d)[:200])')
echo "   商品数=$(echo "$P2") （与首次相同 = 播种幂等）"
echo "   种子行数=$(sqlite3 "$DB" "select count(*) from products;")"
echo "-- 库结构是否仍自洽:"; sqlite3 "$DB" "pragma integrity_check;" | sed 's/^/   /'
echo "-- 停机:"; stop

echo; echo "##### P-12 迁移版本高于程序上限 → 拒绝启动 #####"
DB2="$D/p12hi.db"; cp "$DB" "$DB2"
sqlite3 "$DB2" "insert into schema_migrations(version,applied_at) values (999, 0);" 2>&1 | sed 's/^/   /'
sqlite3 "$DB2" "select * from schema_migrations;" | sed 's/^/   含: /'
env NODE_ENV=production SESSION_SECRET="$SECRET" PORT=3132 DB_PATH="$DB2" node server/src/index.mjs > "$EV/p12hi.log" 2>&1
echo "   启动退出码=$?"
tail -2 "$EV/p12hi.log" | sed 's/^/   /'

echo; echo "##### P-13/P-12 重启后数据仍在（持久化）#####"
DB3="$D/p13.db"; rm -f "$DB3"*
start 3133 "$DB3" "$EV/p13a.log"
curl -s -c "$EV/jar13.txt" -X POST -H 'content-type: application/json' -d '{"productId":"P-003","quantity":2}' http://$H:3133/api/v1/cart/items > "$EV/p13-add.json"; echo "   加购响应=$(cat "$EV/p13-add.json")"
echo "   匿名车=$(curl -s -b "$EV/jar13.txt" http://$H:3133/api/v1/cart | head -c 200)"
stop
echo "-- 重启同库:"
start 3133 "$DB3" "$EV/p13b.log"
echo "   重启后匿名车（应仍在）=$(curl -s -b "$EV/jar13.txt" http://$H:3133/api/v1/cart | head -c 200)"
echo "   商品数=$(curl -s http://$H:3133/api/v1/products | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len(d["data"]["items"]))')"
stop

echo; echo "##### P-14 备份（照 docs/DEPLOY.md 的命令）#####"
BK="$D/backups"; rm -rf "$BK"; mkdir -p "$BK"
DB4="$D/p14.db"; rm -f "$DB4"*
start 3134 "$DB4" "$EV/p14a.log"
curl -s -X POST -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' http://$H:3134/api/v1/cart/items > /dev/null
curl -s -c "$EV/jar14.txt" -X POST -H 'content-type: application/json' -d '{"email":"uat-bk@example.com","password":"uat-pass-12345"}' http://$H:3134/api/v1/auth/register > "$EV/p14-reg.json"
curl -s -b "$EV/jar14.txt" -X POST -H 'content-type: application/json' -d '{"productId":"P-004","quantity":1}' http://$H:3134/api/v1/cart/items > /dev/null
ORDER=$(curl -s -b "$EV/jar14.txt" -X POST -H 'content-type: application/json' -d '{}' http://$H:3134/api/v1/orders)
echo "   建单响应=$(echo "$ORDER" | head -c 200)"
ORDERNO=$(echo "$ORDER" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("data",{}).get("orderNo") or d.get("data",{}).get("order",{}).get("orderNo",""))' 2>/dev/null)
stop
echo "-- 备份命令: DB_PATH=$DB4 BACKUP_DIR=$BK BACKUP_RETENTION_DAYS=14 node scripts/ops/backup.mjs"
DB_PATH="$DB4" BACKUP_DIR="$BK" BACKUP_RETENTION_DAYS=14 node scripts/ops/backup.mjs > "$EV/p14-backup.out" 2>&1
echo "   退出码=$?"; cat "$EV/p14-backup.out" | sed 's/^/   /'
echo "   快照目录:"; ls -la "$BK" | sed 's/^/   /'
SNAP=$(ls "$BK"/shop-*.db 2>/dev/null | head -1)
echo "   快照文件=$SNAP"

echo "-- 保留期判定（造两个旧快照：30 天前 / 5 天前）:"
cp "$SNAP" "$BK/shop-20200101.db"; touch -t 202001010000 "$BK/shop-20200101.db"
cp "$SNAP" "$BK/shop-fresh.db";     touch -t "$(date -v-5d +%Y%m%d%H%M)" "$BK/shop-fresh.db"
DB_PATH="$DB4" BACKUP_DIR="$BK" BACKUP_RETENTION_DAYS=14 node scripts/ops/backup.mjs > "$EV/p14-retention.out" 2>&1
echo "   RETENTION=14 后目录:"; ls "$BK" | sed 's/^/     /'

echo "-- 备份失败路径（BACKUP_DIR 不可创建）:"
cp "$SNAP" "$BK/shop-keep.db"
DB_PATH="$DB4" BACKUP_DIR=/System/uat-no-such BACKUP_RETENTION_DAYS=14 node scripts/ops/backup.mjs > "$EV/p14-fail.out" 2>&1
echo "   退出码=$?"; tail -2 "$EV/p14-fail.out" | sed 's/^/   /'
echo "   既有快照是否仍在（失败不删）:"; ls "$BK" | sed 's/^/     /'

echo "-- 恢复演练：停服 → 用快照覆盖库 → 起服 → /health + 按 orderNo 查单"
DB5="$D/p14-restore.db"; cp "$SNAP" "$DB5"
start 3135 "$DB5" "$EV/p14-restore.log"
echo "   /health=$(curl -s -o /dev/null -w '%{http_code}' http://$H:3135/health)"
echo "   恢复后该账号订单列表=$(curl -s -b "$EV/jar14.txt" "http://$H:3135/api/v1/orders?limit=100" | head -c 300)"
if [ -n "${ORDERNO:-}" ]; then
  echo "   按 orderNo=$ORDERNO 查详情=$(curl -s -b "$EV/jar14.txt" "http://$H:3135/api/v1/orders/$ORDERNO" | head -c 300)"
fi
stop

echo; echo "##### 收尾自查 #####"
for p in 3131 3132 3133 3134 3135; do lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | sed "s/^/  [$p] /"; done; echo "(无输出 = 无残留)"
