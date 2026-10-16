#!/usr/bin/env bash
# FEAT-002 r5 · HTTP/运维面本轮重取证（U-13/31/32/33/34/35/37/38/39/48）
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat-r5"; mkdir -p "$EV"
B=http://127.0.0.1:3000/api/v1
TMP=$(mktemp -d /tmp/r5http.XXXXXX)
say(){ echo; echo "##### $* #####"; }

say "U-13 分页与越量程（活体实例）"
for q in "products?limit=200&offset=0" "products?limit=201&offset=0" "products?limit=0&offset=0" "products?offset=-1" "products?limit=abc" "orders?limit=100&offset=0" "orders?limit=101&offset=0"; do
  code=$(curl -s -o "$TMP/o.json" -w '%{http_code}' "$B/$q"); printf "  %-28s -> %s %s\n" "$q" "$code" "$(head -c 90 "$TMP/o.json")"
done
echo "  （orders 面需登录，未带罐时应 401）"

say "U-31 端口/监听地址可配"
PORT=3181 node server/src/index.mjs > "$EV/ops-r5-u31a.log" 2>&1 &
P1=$!; sleep 2
echo "  PORT=3181 -> $(lsof -nP -iTCP:3181 -sTCP:LISTEN | tail -1 | awk '{print $1,$9}') health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3181/health)"
kill $P1 2>/dev/null; wait $P1 2>/dev/null
HOST=0.0.0.0 PORT=3182 node server/src/index.mjs > "$EV/ops-r5-u31b.log" 2>&1 &
P2=$!; sleep 2
echo "  HOST=0.0.0.0 PORT=3182 -> $(lsof -nP -iTCP:3182 -sTCP:LISTEN | tail -1 | awk '{print $1,$9}') health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3182/health)"
kill $P2 2>/dev/null; wait $P2 2>/dev/null

say "U-32 配置校验拒启（含 HOST=1.2.3.4）"
run_bad(){ name=$1; shift; ( cd "$TMP" && env "$@" node "${ROOT}/server/src/index.mjs" > "$EV/ops-r5-u32-$name.log" 2>&1 ); echo "  $name rc=$? 点名变量=$(grep -oE 'HOST|PORT|DB_PATH|SESSION_SECRET' "$EV/ops-r5-u32-$name.log" | sort -u | tr '\n' ',')"; ls -l "$TMP" | grep -c 'db' | sed 's/^/    tmp 里 db 文件数=/'; }
ROOT=$(pwd)
run_bad host-bad HOST=1.2.3.4 PORT=3183 DB_PATH="$TMP/u32b.db"
run_bad port-abc PORT=abc DB_PATH="$TMP/u32c.db"
run_bad port-range PORT=70000 DB_PATH="$TMP/u32d.db"
run_bad db-unwritable PORT=3184 DB_PATH=/proc/nope/shop.db
run_bad secret-short PORT=3185 DB_PATH="$TMP/u32e.db" NODE_ENV=production SESSION_SECRET=short
run_bad secret-missing PORT=3186 DB_PATH="$TMP/u32f.db" NODE_ENV=production
echo "  HOST 非法那次的日志原文："; sed 's/^/    /' "$EV/ops-r5-u32-host-bad.log" | tail -4
echo "  HOST 非法那次留下的文件："; ls -l "$TMP" | grep u32b | sed 's/^/    /'

say "U-33 优雅停机（在途请求）"
PORT=3187 DB_PATH="$TMP/u33.db" node server/src/index.mjs > "$EV/ops-r5-u33.log" 2>&1 &
P3=$!; sleep 2
( curl -s -o "$EV/ops-r5-u33-inflight.body" -w '%{http_code}' -H 'content-type: application/json' -d '{"email":"r5slow@example.com","password":"r5-pass-12345","slow":true}' http://127.0.0.1:3187/api/v1/auth/register > "$EV/ops-r5-u33-inflight.status" ) &
C1=$!; sleep 1
kill -TERM $P3; wait $P3; RC=$?
wait $C1
echo "  在途请求状态=$(cat "$EV/ops-r5-u33-inflight.status") 体=$(head -c 70 "$EV/ops-r5-u33-inflight.body")"
echo "  进程 rc=$RC 端口释放=$(lsof -nP -iTCP:3187 -sTCP:LISTEN | wc -l | tr -d ' ') 日志尾部=$(tail -1 "$EV/ops-r5-u33.log" | head -c 120)"

say "U-34/U-37 健康端点与安全响应头（活体实例）"
echo "  /health = $(curl -s http://127.0.0.1:3000/health)"
curl -s -D "$EV/ops-r5-u37.headers" -o /dev/null http://127.0.0.1:3000/
grep -iE '^(content-security-policy|x-content-type-options|x-frame-options|referrer-policy|cache-control)' "$EV/ops-r5-u37.headers" | sed 's/^/    /'

say "U-38 请求体上限边界"
python3 -c "import sys;sys.stdout.write('{\"email\":\"'+'a'*131040+'@e.com\",\"password\":\"r5-pass-12345\"}')" > "$TMP/body131072.json"
python3 -c "import sys;sys.stdout.write('{\"email\":\"'+'a'*131041+'@e.com\",\"password\":\"r5-pass-12345\"}')" > "$TMP/body131073.json"
for f in body131072 body131073; do sz=$(wc -c < "$TMP/$f.json"); code=$(curl -s -o "$TMP/$f.out" -w '%{http_code}' -H 'content-type: application/json' --data-binary "@$TMP/$f.json" $B/auth/register); echo "  $f ($sz B) -> $code $(head -c 60 "$TMP/$f.out")"; done
echo "  0 B -> $(curl -s -o "$TMP/zero.out" -w '%{http_code}' -H 'content-type: application/json' -d '' $B/auth/register) $(head -c 60 "$TMP/zero.out")"

say "U-39 静态缓存与静态面收口"
for p in "/" "/src/styles.css" "/assets/products/P-002.jpg" "/assets/favicon.svg" "/favicon.ico" "/assets/products/P-999.jpg" "/server/src/app.mjs" "/index.html.bak"; do
  echo "  $p -> $(curl -s -o /dev/null -D - "http://127.0.0.1:3000$p" | grep -iE '^(HTTP/|cache-control|content-type)' | tr -d '\r' | tr '\n' ' ')"
done

say "U-35 日志字段与敏感值（用刚注册的账号口令检索）"
curl -s -o /dev/null -H 'content-type: application/json' -d '{"email":"r5log@example.com","password":"r5-secret-98765"}' $B/auth/register
grep -c '"requestId"' "$EV/r5-server.log" | sed 's/^/    requestId 行数=/'
for pat in 'r5-secret-98765' 'r5log@example.com'; do echo "    明文 '$pat' 命中=$(grep -c -- "$pat" "$EV/r5-server.log")"; done
echo "    单行 JSON 样例：$(grep '"path":"/health"' "$EV/r5-server.log" | tail -1 | head -c 200)"

say "U-48 并发（同会话并发两单 + 现货=1 抢购）"
J1="$TMP/j1.txt"; J2="$TMP/j2.txt"
for j in "$J1" "$J2"; do curl -s -o /dev/null -c "$j" -b "$j" "$B/cart"; done
PID=$(curl -s "$B/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];d.sort(key=lambda x:x.get('stock',99));print(d[0]['id'],d[0].get('stock',99))")
echo "  现存最低库存商品：$PID"
set -- $PID; LOW=$1; STK=$2
# 同会话并发两单（先让罐 1 有 1 件）
curl -s -o /dev/null -c "$J1" -b "$J1" -H 'content-type: application/json' -d "{\"productId\":\"$LOW\",\"quantity\":1}" "$B/cart/items"
( curl -s -o "$TMP/c1.json" -w '%{http_code}' -c "$J1" -b "$J1" -X POST "$B/orders" > "$TMP/c1.code" ) &
( curl -s -o "$TMP/c2.json" -w '%{http_code}' -c "$J1" -b "$J1" -X POST "$B/orders" > "$TMP/c2.code" ) &
wait
echo "  同会话并发：$(cat "$TMP/c1.code") $(head -c 60 "$TMP/c1.json") / $(cat "$TMP/c2.code") $(head -c 60 "$TMP/c2.json")"
# 现货=1 抢购：把库存买到 1
LEFT=$((STK-1))
if [ "$LEFT" -gt 0 ]; then
  curl -s -o /dev/null -c "$J1" -b "$J1" -H 'content-type: application/json' -d "{\"productId\":\"$LOW\",\"quantity\":$LEFT}" "$B/cart/items"
  curl -s -o /dev/null -c "$J1" -b "$J1" -X POST "$B/orders"
fi
echo "  抢购前库存=$(curl -s "$B/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([x.get('stock',99) for x in d if x['id']=='$LOW'][0])")"
for j in "$J1" "$J2"; do curl -s -o /dev/null -c "$j" -b "$j" -H 'content-type: application/json' -d "{\"productId\":\"$LOW\",\"quantity\":1}" "$B/cart/items"; done
( curl -s -o "$TMP/r1.json" -w '%{http_code}' -c "$J1" -b "$J1" -X POST "$B/orders" > "$TMP/r1.code" ) &
( curl -s -o "$TMP/r2.json" -w '%{http_code}' -c "$J2" -b "$J2" -X POST "$B/orders" > "$TMP/r2.code" ) &
wait
echo "  抢购并发：A=$(cat "$TMP/r1.code") $(head -c 70 "$TMP/r1.json")"
echo "            B=$(cat "$TMP/r2.code") $(head -c 70 "$TMP/r2.json")"
echo "  抢购后库存=$(curl -s "$B/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([x.get('stock',99) for x in d if x['id']=='$LOW'][0])")"
