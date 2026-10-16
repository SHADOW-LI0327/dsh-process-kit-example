#!/usr/bin/env bash
# FEAT-002 UAT r4 · U-48 真并发不超卖 / U-50 车量>现货下单边界 / U-35 结构化日志与口令不落日志与客户端中断
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat"; OPS="$EV/ops"; mkdir -p "$OPS"
H=127.0.0.1; D=$(mktemp -d /tmp/r4u48.XXXXXX) || exit 98
SEC=$(openssl rand -hex 32)
h() { echo; echo "##### $* #####"; }
start() { env NODE_ENV=production SESSION_SECRET="$SEC" PORT="$1" DB_PATH="$2" node server/src/index.mjs > "$3" 2>&1 & SPID=$!; for i in $(seq 1 40); do curl -s -o /dev/null "http://$H:$1/health" && return 0; sleep 0.5; done; return 1; }
stopit() { kill -TERM "$1" 2>/dev/null; wait "$1" 2>/dev/null; echo "  停止 rc=$?"; }

h "U-48① 两个不同会话背靠背抢最后 1 件"
start 3170 "$D/u48.db" "$OPS/r4-u48c.log"
JA="$D/a.txt"; JB="$D/b.txt"
curl -s -o /dev/null -c "$JA" -H 'content-type: application/json' -d "{\"email\":\"r4g48a+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "http://$H:3170/api/v1/auth/register"
curl -s -o /dev/null -c "$JB" -H 'content-type: application/json' -d "{\"email\":\"r4g48b+$(date +%s)@example.com\",\"password\":\"uat-pass-12345\"}" "http://$H:3170/api/v1/auth/register"
stock() { curl -s "http://$H:3170/api/v1/products" > "$OPS/r4-u48c-prod.json"; node -e 'const j=require("./reports/uat/evidence/FEAT-002-uat/ops/r4-u48c-prod.json");const p=j.data.find(x=>x.name==="手冲咖啡壶");process.stdout.write(String(p.stock));'; }
echo "  初始现货 手冲咖啡壶 = $(stock)"
curl -s -o /dev/null -b "$JA" -c "$JA" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":5}' "http://$H:3170/api/v1/cart/items"
curl -s -o "$OPS/r4-u48c-buy5.json" -b "$JA" -c "$JA" -X POST -H 'content-type: application/json' -d '{}' "http://$H:3170/api/v1/orders"
echo "  先买 5 件 -> $(head -c 120 "$OPS/r4-u48c-buy5.json")"
echo "  余量 = $(stock)（应为 1）"
curl -s -o /dev/null -b "$JA" -c "$JA" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "http://$H:3170/api/v1/cart/items"
curl -s -o /dev/null -b "$JB" -c "$JB" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":1}' "http://$H:3170/api/v1/cart/items"
python3 - "$OPS/r4-u48c-body.json" <<'PY'
import sys
open(sys.argv[1],'w').write('{"pad":"' + 'a'*30000 + '"}')
PY
curl -s -o "$OPS/r4-u48c-a.body" -w '%{http_code}' --limit-rate 5k -b "$JA" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48c-body.json" "http://$H:3170/api/v1/orders" > "$OPS/r4-u48c-a.code" 2>&1 &
CA=$!
sleep 0.5
curl -s -o "$OPS/r4-u48c-b.body" -w '%{http_code}' --limit-rate 5k -b "$JB" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48c-body.json" "http://$H:3170/api/v1/orders" > "$OPS/r4-u48c-b.code" 2>&1 &
CB=$!
wait "$CA"; wait "$CB"
echo "  会话 A -> $(cat "$OPS/r4-u48c-a.code") :: $(head -c 120 "$OPS/r4-u48c-a.body")"
echo "  会话 B -> $(cat "$OPS/r4-u48c-b.code") :: $(head -c 120 "$OPS/r4-u48c-b.body")"
echo "  并发后现货 = $(stock)（必须 0，绝不为负）"
echo "  A 单数=$(curl -s -b "$JA" "http://$H:3170/api/v1/orders" | grep -o '"orderNo"' | wc -l | tr -d ' ') / B 单数=$(curl -s -b "$JB" "http://$H:3170/api/v1/orders" | grep -o '"orderNo"' | wc -l | tr -d ' ')"
echo "  -- 日志里的并发两单状态码（产品自身结构化日志）："
grep -o '"path":"/api/v1/orders","status":[0-9]*' "$OPS/r4-u48c.log" | sort | uniq -c | sed 's/^/    /'

h "U-48② 同一会话 / 同一辆车背靠背两单"
curl -s -o /dev/null -b "$JA" -c "$JA" -H 'content-type: application/json' -d '{"productId":"P-006","quantity":1}' "http://$H:3170/api/v1/cart/items"
curl -s -o "$OPS/r4-u48c-s1.body" -w '%{http_code}' --limit-rate 5k -b "$JA" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48c-body.json" "http://$H:3170/api/v1/orders" > "$OPS/r4-u48c-s1.code" 2>&1 &
S1=$!
sleep 0.5
curl -s -o "$OPS/r4-u48c-s2.body" -w '%{http_code}' --limit-rate 5k -b "$JA" -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u48c-body.json" "http://$H:3170/api/v1/orders" > "$OPS/r4-u48c-s2.code" 2>&1 &
S2=$!
wait "$S1"; wait "$S2"
echo "  第 1 发 -> $(cat "$OPS/r4-u48c-s1.code") :: $(head -c 110 "$OPS/r4-u48c-s1.body")"
echo "  第 2 发 -> $(cat "$OPS/r4-u48c-s2.code") :: $(head -c 110 "$OPS/r4-u48c-s2.body")"
echo "  该会话单数=$(curl -s -b "$JA" "http://$H:3170/api/v1/orders" | grep -o '"orderNo"' | wc -l | tr -d ' ')"

h "U-35 结构化日志 / 口令不落日志 / 客户端中断"
PW="uat-pass-9f3a7c1d-UNIQUE-R4"
JX="$D/x.txt"
curl -s -o /dev/null -c "$JX" -H 'content-type: application/json' -d "{\"email\":\"r4log+$(date +%s)@example.com\",\"password\":\"$PW\"}" "http://$H:3170/api/v1/auth/register"
curl -s -o /dev/null -b "$JX" -c "$JX" -H 'content-type: application/json' -d "{\"email\":\"r4log-q+$(date +%s)@example.com\",\"password\":\"$PW\"}" "http://$H:3170/api/v1/auth/login"
curl -s -o /dev/null -b "$JX" -H 'content-type: application/json' -d '{"productId":"P-002","quantity":1}' "http://$H:3170/api/v1/cart/items"
echo "  -- 每请求一行 JSON（抽样 3 行）："; grep -c '^{' "$OPS/r4-u48c.log" | sed 's/^/    日志 JSON 行数=/'; tail -3 "$OPS/r4-u48c.log" | cut -c1-260 | sed 's/^/    /'
echo "  -- 日志里搜口令明文：$(grep -c "$PW" "$OPS/r4-u48c.log") 处（期望 0）"
echo "  -- 日志里搜 sid cookie 值：$(grep -o 'sid=[A-Za-z0-9_-]\{10,\}' "$OPS/r4-u48c.log" | wc -l | tr -d ' ') 处（期望 0）"
echo "  -- 日志里是否出现邮箱明文：$(grep -o 'r4log[^"]*@example.com' "$OPS/r4-u48c.log" | head -1 | sed 's/^/    /')"
echo "  -- 日志里形如口令哈希的长十六进制串个数：$(grep -oE '[a-f0-9]{32,}' "$OPS/r4-u48c.log" | grep -v -E '^[a-f0-9]{8}-' | wc -l | tr -d ' ')（期望 0；sessionId/order 等形态另计）"
echo "  -- 客户端中断：发一半就断（curl --max-time 0.4 上传 100KB）"
python3 - "$OPS/r4-u35-big.json" <<'PY'
import sys
open(sys.argv[1],'w').write('{"productId":"P-002","quantity":1,"pad":"' + 'a'*100000 + '"}')
PY
curl -s -o /dev/null --limit-rate 20k --max-time 0.5 -X POST -H 'content-type: application/json' --data-binary "@$OPS/r4-u35-big.json" "http://$H:3170/api/v1/cart/items"; echo "    curl rc=${?}（28=超时中断属预期）"
sleep 2
echo "    -- 中断后的日志尾部："; tail -2 "$OPS/r4-u48c.log" | cut -c1-260 | sed 's/^/      /'
echo "    -- 是否记为 warn + 中断标记：$(grep -o '"level":"[a-z]*"' "$OPS/r4-u48c.log" | tail -1) / $(grep -oE '"(aborted|client_abort|aborted_by_client)":[a-z]*|"(aborted|client_abort|aborted_by_client)"' "$OPS/r4-u48c.log" | tail -1)"
echo "    -- 中断那条的 status 字段：$(tail -1 "$OPS/r4-u48c.log" | grep -o '"status":[0-9]*')"
stopit "$SPID"

h "U-50 边界：车里有 8 件、现货只有 6 件 → 提交订单（真机用户路径，读数交人裁）"
JE="$D/e.txt"; E50="uat-r4h50+$(date +%s)@example.com"
curl -s -o /dev/null -c "$JE" -H 'content-type: application/json' -d "{\"email\":\"$E50\",\"password\":\"uat-pass-12345\"}" "http://$H:3000/api/v1/auth/register"
SHORT=$(curl -s "http://$H:3000/api/v1/products" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.data.filter(p=>p.stock<8).map(p=>p.name+":"+p.stock).join(" ")||"全部 8 件");})')
echo "  托管实例现货 <8 的商品：$SHORT"
curl -s -o "$OPS/r4-u50b-add.json" -b "$JE" -c "$JE" -H 'content-type: application/json' -d '{"productId":"P-007","quantity":8}' "http://$H:3000/api/v1/cart/items"
echo "  加保温杯 8 件 -> $(head -c 160 "$OPS/r4-u50b-add.json")"
curl -s -o "$OPS/r4-u50b-order.json" -w '%{http_code}' -b "$JE" -c "$JE" -X POST -H 'content-type: application/json' -d '{}' "http://$H:3000/api/v1/orders" > "$OPS/r4-u50b-order.code"
echo "  提交 -> $(cat "$OPS/r4-u50b-order.code") :: $(head -c 220 "$OPS/r4-u50b-order.json")"
AFTER=$(curl -s "http://$H:3000/api/v1/products" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const p=j.data.find(x=>x.name==="保温杯");console.log(p.stock);})')
echo "  提交后保温杯现货=${AFTER}（不得为负）"
echo "  该账号订单数=$(curl -s -b "$JE" "http://$H:3000/api/v1/orders" | grep -o '"orderNo"' | wc -l | tr -d ' ')"
h "DONE"
