#!/usr/bin/env bash
# FEAT-002 r5 · 重启存活 + 同日不重号 + 限流突发 + 部署文档 E7/E9 复看
set -u
cd "$(dirname "$0")/../.." || exit 99
ROOT=$(pwd); EV="$ROOT/reports/uat/evidence/FEAT-002-uat-r5"; TMP=$(mktemp -d /tmp/r5rest.XXXXXX)
B=http://127.0.0.1:3000; API=$B/api/v1
say(){ echo; echo "##### $* #####"; }
dbstat(){ f=$ROOT/data/shop.db; if [ -f "$f" ]; then echo "  库 $(wc -c < "$f" | tr -d ' ') 字节 sha256=$(shasum -a 256 "$f" | cut -c1-16) 附属=[$(ls "$ROOT/data" | grep -E 'shop.db-(wal|shm)' | tr '\n' ' ')]"; else echo "  库不存在"; fi; }

say "重启前状态"
dbstat
echo "  3000 监听 = $(lsof -nP -iTCP:3000 -sTCP:LISTEN | tail -1 | awk '{print $1,$2,$9}')"

say "停止旧实例（我本轮启的那个）"
OLD=$(lsof -nP -iTCP:3000 -sTCP:LISTEN | tail -1 | awk '{print $2}')
if [ -n "${OLD}" ]; then kill "${OLD}"; for i in 1 2 3 4 5 6 7 8 9 10; do sleep 0.5; lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null || break; done; fi
echo "  停止后 3000 监听行数 = $(lsof -nP -iTCP:3000 -sTCP:LISTEN | wc -l | tr -d ' ')"

say "按 PROJECT.md 起法重启（同一份库）"
( cd "$ROOT" && npm start > "$EV/r5-restart-server.log" 2>&1 & echo $! > "$TMP/newpid" )
for i in $(seq 1 40); do sleep 0.5; code=$(curl -s -o /dev/null -w '%{http_code}' $B/health || true); [ "$code" = "200" ] && break; done
echo "  新实例 pid=$(cat "$TMP/newpid") /health=$code"
echo "  启动行 = $(grep -o '"port":[0-9]*' "$EV/r5-restart-server.log" | tail -1)"
dbstat

say "U-02/U-14 重启后：老账号登录 + 老订单还在 + 再下一单不重号"
J="$TMP/j.txt"
curl -s -o /dev/null -c "$J" -b "$J" -H 'content-type: application/json' -d '{"email":"r5img+802464@example.com","password":"r5-pass-12345"}' "$API/auth/login"
echo "  登录后 /auth/me -> $(curl -s -b "$J" "$API/auth/me" | head -c 90)"
echo "  重启前那单是否还在 -> $(curl -s -b "$J" "$API/orders" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([o['orderNo'] for o in d])")"
echo "  商品条数 -> $(curl -s "$API/products?limit=200" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(len(d),'| P-002 库存',[p.get('stock') for p in d if p['name']=='陶瓷滤杯'][0])")"
curl -s -o /dev/null -c "$J" -b "$J" -H 'content-type: application/json' -d '{"productId":"P-008","quantity":1}' "$API/cart/items"
NEW=$(curl -s -b "$J" -X POST "$API/orders" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['orderNo'])" 2>/dev/null || echo "ERR")
echo "  重启后新单号 = $NEW （应 ≠ SO-20261016-12 且两单都在）"
echo "  订单列表 -> $(curl -s -b "$J" "$API/orders" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print([o['orderNo'] for o in d])")"

say "U-38 写接口限流（默认阈值下连发 40 次登录）"
codes=$(for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}\n' -H 'content-type: application/json' -d '{"email":"r5burst@example.com","password":"wrong-pass-123"}' "$API/auth/login"; done | sort | uniq -c | tr '\n' ' ')
echo "  40 连发状态码分布 = $codes"
echo "  带重试头的响应样例 = $(curl -s -D - -o /dev/null -H 'content-type: application/json' -d '{"email":"r5burst@example.com","password":"wrong-pass-123"}' "$API/auth/login" | grep -iE '^(HTTP/|retry-after)' | tr -d '\r' | tr '\n' ' ')"

say "U-45 部署文档是否仍写明 E7/E9 两个坑"
for pat in 'E7' 'E9' '卷名' 'wal' 'UTC'; do echo "  '$pat' 命中 = $(grep -c -- "$pat" docs/DEPLOY.md)"; done
grep -n 'E9' docs/DEPLOY.md | head -3 | sed 's/^/    /'

say "收尾：停掉实例、确认 3000 空闲、记录库状态"
PID2=$(lsof -nP -iTCP:3000 -sTCP:LISTEN | tail -1 | awk '{print $2}')
[ -n "${PID2}" ] && kill "${PID2}"
for i in 1 2 3 4 5 6 7 8 9 10; do sleep 0.5; lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null || break; done
echo "  收尾后 3000 监听行数 = $(lsof -nP -iTCP:3000 -sTCP:LISTEN | wc -l | tr -d ' ')"
dbstat
echo "  docker ps -a 非 yente 行数 = $(DOCKER_CONFIG=/tmp/dockercfg docker ps -a --format '{{.Names}}' 2>/dev/null | grep -vc yente || echo 0)"
echo "  80/443 监听 = $(lsof -nP -iTCP:80 -sTCP:LISTEN -iTCP:443 2>/dev/null | wc -l | tr -d ' ')"
