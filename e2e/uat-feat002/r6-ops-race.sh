#!/usr/bin/env bash
# FEAT-002 r6 · 第 4/5/6/7 条复看：启动失败零残留 + 预置库原样 + EADDRINUSE + 限流 + 现货1抢购
set -u
cd "$(dirname "$0")/../.." || exit 99
ROOT=$(pwd); EV="$ROOT/reports/uat/evidence/FEAT-002-uat-r6"; mkdir -p "$EV"
API=http://127.0.0.1:3000/api/v1; TS=$(date +%s)
say(){ echo; echo "##### $* #####"; }
triple(){ f=$1; if [ -f "$f" ]; then echo "$(wc -c < "$f" | tr -d ' ')B sha256=$(shasum -a 256 "$f" | cut -c1-24) mtime=$(stat -f %m "$f")"; else echo "缺失"; fi; }

say "第 4/7 条 · HOST=1.2.3.4 空目录零残留"
D1=$(mktemp -d /tmp/r6-host.XXXXXX)
( cd "$D1" && HOST=1.2.3.4 PORT=3183 DB_PATH="$D1/a.db" node "$ROOT/server/src/index.mjs" > "$EV/r6-host-空目录.log" 2>&1 )
echo "  rc=$? 目录内文件数=$(ls -A "$D1" | wc -l | tr -d ' ') 内容=[$(ls -A "$D1" | tr '\n' ' ')]"
echo "  日志尾部："; tail -3 "$EV/r6-host-空目录.log" | sed 's/^/    /'
echo "  日志里是否出现变量名 HOST = $(grep -c 'HOST' "$EV/r6-host-空目录.log")"

say "第 4 条 · 预置一个库后复跑，三重比对必须原样"
D2=$(mktemp -d /tmp/r6-preset.XXXXXX)
PORT=3184 DB_PATH="$D2/preset.db" node "$ROOT/server/src/index.mjs" > "$EV/r6-preset-建库.log" 2>&1 &
P=$!; sleep 3
echo "  预置库 health=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3184/health)"
kill $P; wait $P 2>/dev/null
echo "  预置库（清停机后）: $(triple "$D2/preset.db")"
echo "  预置目录内容: [$(ls -A "$D2" | tr '\n' ' ')]"
BEFORE_B=$(wc -c < "$D2/preset.db" | tr -d ' '); BEFORE_S=$(shasum -a 256 "$D2/preset.db" | cut -c1-24); BEFORE_M=$(stat -f %m "$D2/preset.db")
( cd "$D2" && HOST=1.2.3.4 PORT=3185 DB_PATH="$D2/preset.db" node "$ROOT/server/src/index.mjs" > "$EV/r6-host-预置库.log" 2>&1 )
echo "  复跑 rc=$? 目录内容=[$(ls -A "$D2" | tr '\n' ' ')]"
AFTER_B=$(wc -c < "$D2/preset.db" | tr -d ' '); AFTER_S=$(shasum -a 256 "$D2/preset.db" | cut -c1-24); AFTER_M=$(stat -f %m "$D2/preset.db")
echo "  预置库（复跑后）: $(triple "$D2/preset.db")"
if [ "$BEFORE_B" = "$AFTER_B" ] && [ "$BEFORE_S" = "$AFTER_S" ] && [ "$BEFORE_M" = "$AFTER_M" ]; then echo "  ✅ 字节/sha256/mtime 三重一致"; else echo "  ❌ 有差异：字节 $BEFORE_B→$AFTER_B / sha $BEFORE_S→$AFTER_S / mtime $BEFORE_M→$AFTER_M"; fi
echo "  复跑日志尾部："; tail -2 "$EV/r6-host-预置库.log" | sed 's/^/    /'

say "第 4 条 · EADDRINUSE 零残留"
D3=$(mktemp -d /tmp/r6-eaddr.XXXXXX)
PORT=3190 DB_PATH="$D3/keep.db" node "$ROOT/server/src/index.mjs" > "$EV/r6-eaddr-占用者.log" 2>&1 &
P3=$!; sleep 3
D4=$(mktemp -d /tmp/r6-eaddr2.XXXXXX)
( cd "$D4" && PORT=3190 DB_PATH="$D4/second.db" node "$ROOT/server/src/index.mjs" > "$EV/r6-eaddr-第二个.log" 2>&1 )
echo "  第二个 rc=$? 目录内文件数=$(ls -A "$D4" | wc -l | tr -d ' ') 内容=[$(ls -A "$D4" | tr '\n' ' ')]"
echo "  日志尾部："; tail -2 "$EV/r6-eaddr-第二个.log" | sed 's/^/    /'
echo "  占用者仍在 = $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3190/health)"
kill $P3; wait $P3 2>/dev/null

say "第 5 条 · RATE_LIMIT_MAX=5 限流真取证"
echo "  PROJECT.md §4 是否登记 RATE_LIMIT_MAX = $(grep -c 'RATE_LIMIT_MAX' docs/process/PROJECT.md)"
D5=$(mktemp -d /tmp/r6-rate.XXXXXX)
RATE_LIMIT_MAX=5 PORT=3191 DB_PATH="$D5/r.db" node "$ROOT/server/src/index.mjs" > "$EV/r6-rate.log" 2>&1 &
P5=$!; sleep 3
JR=/tmp/r6rate.txt; rm -f $JR
curl -s -o /dev/null -c $JR -b $JR http://127.0.0.1:3191/api/v1/cart
echo "  同一会话连发 6 次写请求（加购）："
for i in 1 2 3 4 5 6 7; do
  code=$(curl -s -o "$D5/resp$i.json" -D "$D5/h$i.txt" -w '%{http_code}' -c $JR -b $JR -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' http://127.0.0.1:3191/api/v1/cart/items)
  ra=$(grep -i '^retry-after' "$D5/h$i.txt" | tr -d '\r' | awk '{print $2}')
  echo "    第 $i 次 -> $code retry-after=[${ra}] body=$(head -c 90 "$D5/resp$i.json")"
done
echo "  读接口不受限：$(curl -s -o /dev/null -w '%{http_code}' -b $JR http://127.0.0.1:3191/api/v1/cart) / $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3191/api/v1/products?limit=200)"
echo "  另一个会话（新 cookie）是否也被限：$(curl -s -o /dev/null -w '%{http_code}' -c /tmp/r6rate2.txt -b /tmp/r6rate2.txt -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' http://127.0.0.1:3191/api/v1/cart/items)"
kill $P5; wait $P5 2>/dev/null

say "第 6 条 · 现货=1 两个已登录会话抢购（P-003 单品豆 250g）"
echo "  抢购前现货 = $(curl -s "$API/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([p.get('stock') for p in d if p['name']=='单品豆 250g'][0])")"
J1=/tmp/r6r1.txt; J2=/tmp/r6r2.txt; rm -f $J1 $J2
curl -s -o /dev/null -c $J1 -b $J1 -H 'content-type: application/json' -d "{\"email\":\"r6race1+$TS@example.com\",\"password\":\"r6-pass-12345\"}" $API/auth/register
curl -s -o /dev/null -c $J2 -b $J2 -H 'content-type: application/json' -d "{\"email\":\"r6race2+$TS@example.com\",\"password\":\"r6-pass-12345\"}" $API/auth/register
for j in $J1 $J2; do curl -s -o /dev/null -c $j -b $j -H 'content-type: application/json' -d '{"productId":"P-003","quantity":1}' $API/cart/items; done
echo "  两边各自的车：A=$(curl -s -b $J1 $API/cart | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['quantityTotal'])") 件 / B=$(curl -s -b $J2 $API/cart | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['quantityTotal'])") 件"
( curl -s -o "$EV/r6-race-A.json" -w '%{http_code}' -b $J1 -X POST $API/orders > "$EV/r6-race-A.code" ) &
( curl -s -o "$EV/r6-race-B.json" -w '%{http_code}' -b $J2 -X POST $API/orders > "$EV/r6-race-B.code" ) &
wait
echo "  A -> $(cat "$EV/r6-race-A.code") $(head -c 140 "$EV/r6-race-A.json")"
echo "  B -> $(cat "$EV/r6-race-B.code") $(head -c 140 "$EV/r6-race-B.json")"
echo "  抢购后现货 = $(curl -s "$API/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([p.get('stock') for p in d if p['name']=='单品豆 250g'][0])")"
python3 - "$EV" <<'PY'
import json,sys
ev=sys.argv[1]
res={}
for k in 'AB':
    code=open(f'{ev}/r6-race-{k}.code').read().strip()
    try: body=json.load(open(f'{ev}/r6-race-{k}.json'))
    except Exception as e: body={'parse_error':str(e)}
    res[k]=(code,body)
ok=[k for k in 'AB' if res[k][0]=='201']
fail=[k for k in 'AB' if res[k][0]!='201']
print('  成功者集合 =',sorted(ok),'失败者集合 =',sorted(fail))
print('  恰一人成功 =', len(ok)==1)
for k in fail:
    d=res[k][1].get('code'); m=res[k][1].get('message')
    print(f'  失败者 {k} 的 code/message = {d} / {m}')
lines={}
for k in ok:
    items=res[k][1]['data']['items']
    lines[k]=[(i['productName'],i['quantity']) for i in items]
print('  成功单的行集合 =',lines)
print('  成功单总行数 =',sum(len(v) for v in lines.values()),'（期望 1 行、1 件）')
PY
echo "  两账号订单数：A=$(curl -s -b $J1 $API/orders | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))") B=$(curl -s -b $J2 $API/orders | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")"
echo "  负库存检查（全 8 件）：$(curl -s "$API/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('最小库存 =',min(p.get('stock') for p in d),'| 有负值 =',any(p.get('stock')<0 for p in d))")"
