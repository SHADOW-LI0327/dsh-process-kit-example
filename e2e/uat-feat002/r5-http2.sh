#!/usr/bin/env bash
# FEAT-002 r5 · 补测：U-32（改动日志路径）· U-38 精确边界 · U-39 指纹缓存 · U-13 订单上限 · U-48 并发（需登录）
set -u
cd "$(dirname "$0")/../.." || exit 99
ROOT=$(pwd); EV="$ROOT/reports/uat/evidence/FEAT-002-uat-r5"; mkdir -p "$EV"
B=http://127.0.0.1:3000/api/v1; TMP=$(mktemp -d /tmp/r5http2.XXXXXX); TS=$(date +%s)
say(){ echo; echo "##### $* #####"; }

say "U-32 配置校验拒启（补齐日志落点）"
run_bad(){ name=$1; shift; ( cd "$TMP" && env "$@" node "$ROOT/server/src/index.mjs" > "$EV/ops-r5-u32-$name.log" 2>&1 ); rc=$?; echo "  $name rc=$rc 点名变量=[$(grep -oE 'HOST|PORT|DB_PATH|SESSION_SECRET' "$EV/ops-r5-u32-$name.log" | sort -u | tr '\n' ' ')] 库残留=[$(ls "$TMP" 2>/dev/null | grep -E 'u32|shop' | tr '\n' ' ')]"; }
run_bad host-bad HOST=1.2.3.4 PORT=3183 DB_PATH="$TMP/u32b.db"
run_bad port-abc PORT=abc DB_PATH="$TMP/u32c.db"
run_bad port-range PORT=70000 DB_PATH="$TMP/u32d.db"
run_bad db-unwritable PORT=3184 DB_PATH=/proc/nope/shop.db
run_bad secret-short PORT=3185 DB_PATH="$TMP/u32e.db" NODE_ENV=production SESSION_SECRET=short
run_bad secret-missing PORT=3186 DB_PATH="$TMP/u32f.db" NODE_ENV=production
echo "  HOST 非法日志尾部："; tail -3 "$EV/ops-r5-u32-host-bad.log" | sed 's/^/    /'
echo "  其余五组各自日志尾部："; for n in port-abc port-range db-unwritable secret-short secret-missing; do echo "    $n: $(tail -1 "$EV/ops-r5-u32-$n.log" | head -c 150)"; done
echo "  HOST 非法后 tmp 目录内容："; ls -l "$TMP" | sed 's/^/    /'

say "U-38 精确边界（131072 / 131073 字节）"
python3 - "$TMP" <<'PY'
import sys,os
d=sys.argv[1]
fixed=len('{"email":"')+len('@e.com","password":"r5-pass-12345"}')
for total in (131072,131073):
    n=total-fixed
    body='{"email":"'+'a'*n+'@e.com","password":"r5-pass-12345"}'
    assert len(body)==total,(total,len(body))
    open(os.path.join(d,f'b{total}.json'),'w').write(body)
PY
for t in 131072 131073; do sz=$(wc -c < "$TMP/b$t.json"); code=$(curl -s -o "$TMP/b$t.out" -w '%{http_code}' -H 'content-type: application/json' --data-binary "@$TMP/b$t.json" $B/auth/register); echo "  $t B -> $code $(head -c 70 "$TMP/b$t.out")"; done
echo "  0 B -> $(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '' $B/auth/register)（应 400）"

say "U-39 指纹资源缓存（带 ?v=）与不带 ?v 对照"
V=$(curl -s http://127.0.0.1:3000/ | grep -o 'P-002.jpg?v=[0-9a-f]*' | head -1)
echo "  首页里的指纹 = $V"
for p in "/assets/products/P-002.jpg?v=${V#*v=}" "/src/styles.css?v=abc123" "/src/main.mjs?v=abc123" "/assets/favicon.svg" "/favicon.ico"; do
  echo "  $p -> $(curl -s -o /dev/null -D - "http://127.0.0.1:3000$p" | grep -iE '^(HTTP/|cache-control|etag)' | tr -d '\r' | tr '\n' ' ')"
done
echo "  二次请求 /（带 If-None-Match）→ $(et=$(curl -s -D - -o /dev/null http://127.0.0.1:3000/ | grep -i '^etag' | tr -d '\r' | cut -d' ' -f2); curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $et" http://127.0.0.1:3000/)"

say "U-13 订单面分页上限（登录后）"
JA="$TMP/ja.txt"
curl -s -o /dev/null -c "$JA" -b "$JA" -H 'content-type: application/json' -d "{\"email\":\"r5pg+$TS@example.com\",\"password\":\"r5-pass-12345\"}" $B/auth/register
for q in "limit=1&offset=0" "limit=100&offset=0" "limit=101&offset=0" "limit=0&offset=0" "offset=-1"; do
  echo "  orders?$q -> $(curl -s -o "$TMP/po.json" -w '%{http_code}' -b "$JA" "$B/orders?$q") $(head -c 70 "$TMP/po.json")"
done

say "U-48 并发（两个已登录会话）"
J1="$TMP/j1.txt"; J2="$TMP/j2.txt"
curl -s -o /dev/null -c "$J1" -b "$J1" -H 'content-type: application/json' -d "{\"email\":\"r5race1+$TS@example.com\",\"password\":\"r5-pass-12345\"}" $B/auth/register
curl -s -o /dev/null -c "$J2" -b "$J2" -H 'content-type: application/json' -d "{\"email\":\"r5race2+$TS@example.com\",\"password\":\"r5-pass-12345\"}" $B/auth/register
PID=$(curl -s "$B/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];d.sort(key=lambda x:x.get('stock',99));print(d[0]['id'],d[0].get('stock',99))")
set -- $PID; LOW=$1; STK=$2; echo "  最低库存商品 = $LOW 现货 $STK"
curl -s -o /dev/null -c "$J1" -b "$J1" -H 'content-type: application/json' -d "{\"productId\":\"$LOW\",\"quantity\":1}" "$B/cart/items"
( curl -s -o "$TMP/c1.json" -w '%{http_code}' -b "$J1" -X POST "$B/orders" > "$TMP/c1.code" ) &
( curl -s -o "$TMP/c2.json" -w '%{http_code}' -b "$J1" -X POST "$B/orders" > "$TMP/c2.code" ) &
wait
echo "  同会话并发两单：A=$(cat "$TMP/c1.code") $(head -c 60 "$TMP/c1.json")"
echo "                  B=$(cat "$TMP/c2.code") $(head -c 60 "$TMP/c2.json")"
LEFT=$((STK-1))
if [ "$LEFT" -gt 0 ]; then
  curl -s -o /dev/null -c "$J1" -b "$J1" -H 'content-type: application/json' -d "{\"productId\":\"$LOW\",\"quantity\":$LEFT}" "$B/cart/items"
  curl -s -o /dev/null -w '  买空到 1 的单 -> %{http_code}\n' -b "$J1" -X POST "$B/orders"
fi
echo "  并发前现货 = $(curl -s "$B/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([x.get('stock',99) for x in d if x['id']=='$LOW'][0])")"
for j in "$J1" "$J2"; do curl -s -o /dev/null -c "$j" -b "$j" -H 'content-type: application/json' -d "{\"productId\":\"$LOW\",\"quantity\":1}" "$B/cart/items"; done
( curl -s -o "$TMP/r1.json" -w '%{http_code}' -b "$J1" -X POST "$B/orders" > "$TMP/r1.code" ) &
( curl -s -o "$TMP/r2.json" -w '%{http_code}' -b "$J2" -X POST "$B/orders" > "$TMP/r2.code" ) &
wait
echo "  抢购并发 A=$(cat "$TMP/r1.code") $(head -c 80 "$TMP/r1.json")"
echo "          B=$(cat "$TMP/r2.code") $(head -c 80 "$TMP/r2.json")"
echo "  并发后现货 = $(curl -s "$B/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([x.get('stock',99) for x in d if x['id']=='$LOW'][0])")"
echo "  两账号订单数：A=$(curl -s -b "$J1" $B/orders | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))") B=$(curl -s -b "$J2" $B/orders | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")"
