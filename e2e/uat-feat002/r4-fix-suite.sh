#!/usr/bin/env bash
# FEAT-002 UAT r4 · 补测（U-08 空车下单 / U-11 越权逐字相同 / U-13 越量程精确计数 / U-39 指纹资源缓存 / U-46 npm test）
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat"; mkdir -p "$EV"
API=http://127.0.0.1:3000
J="$EV/r4b.jarenv"; rm -rf "$J"; mkdir -p "$J"
h() { echo; echo "##### $* #####"; }
code() { curl -s -o "$1" -w '%{http_code}' "${@:2}"; }

h "U-08② 已登录空车下单（全新账号，车确实为空）"
E="uat-r4b-e08+$(date +%s)@example.com"
code "$EV/U-08-空车下单-01-reg.json" -c "$J/e08.txt" -H 'content-type: application/json' -d "{\"email\":\"$E\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register" >/dev/null
code "$EV/U-08-空车下单-02-order.json" -b "$J/e08.txt" -c "$J/e08.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- 空车下单 code"
cat "$EV/U-08-空车下单-02-order.json"; echo
code "$EV/U-08-空车下单-03-cart.json" -b "$J/e08.txt" "$API/api/v1/cart"; echo " <- 被拒后购物车 code"
cat "$EV/U-08-空车下单-03-cart.json"; echo
code "$EV/U-08-空车下单-04-orders.json" -b "$J/e08.txt" "$API/api/v1/orders"; echo " <- 订单列表 code"
cat "$EV/U-08-空车下单-04-orders.json"; echo
echo "  两种提示可区分 = $([ "$(cat "$EV/U-08-未登录拒下单-02-order.json")" != "$(cat "$EV/U-08-空车下单-02-order.json")" ] && echo 是 || echo 否)"
echo "    未登录: $(cat "$EV/U-08-未登录拒下单-02-order.json")"
echo "    空车  : $(cat "$EV/U-08-空车下单-02-order.json")"

h "U-11 越权与不存在订单号（真实单号；两个响应必须逐字相同）"
EA="uat-r4b-a11+$(date +%s)@example.com"; EB="uat-r4b-b11+$(date +%s)@example.com"
code "$EV/U-11-越权-01-regA.json" -c "$J/A.txt" -H 'content-type: application/json' -d "{\"email\":\"$EA\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register" >/dev/null
code "$EV/U-11-越权-02-addA.json" -b "$J/A.txt" -c "$J/A.txt" -H 'content-type: application/json' -d '{"productId":"P-004","quantity":1}' "$API/api/v1/cart/items" >/dev/null
code "$EV/U-11-越权-03-orderA.json" -b "$J/A.txt" -c "$J/A.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- A 下单 code"
ONO=$(grep -o '"orderNo":"[^"]*"' "$EV/U-11-越权-03-orderA.json" | head -1 | cut -d'"' -f4); echo "  A 的订单号=$ONO"
code "$EV/U-11-越权-04-regB.json" -c "$J/B.txt" -H 'content-type: application/json' -d "{\"email\":\"$EB\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register" >/dev/null
code "$EV/U-11-越权-05-listA.json" -b "$J/A.txt" "$API/api/v1/orders"; echo " <- A 自己的订单列表 code（归属）"
code "$EV/U-11-越权-06-listB.json" -b "$J/B.txt" "$API/api/v1/orders"; echo " <- B 的订单列表 code（应只有 B 自己的 = 空）"
cat "$EV/U-11-越权-06-listB.json"; echo
code "$EV/U-11-越权-07-otherorder.json" -b "$J/B.txt" "$API/api/v1/orders/$ONO"; echo " <- B 请求 A 的单号 code"
cat "$EV/U-11-越权-07-otherorder.json"; echo
code "$EV/U-11-越权-08-nosuchorder.json" -b "$J/B.txt" "$API/api/v1/orders/SO-19700101-99999"; echo " <- 格式合法但不存在的单号 code"
cat "$EV/U-11-越权-08-nosuchorder.json"; echo
if cmp -s "$EV/U-11-越权-07-otherorder.json" "$EV/U-11-越权-08-nosuchorder.json"; then echo "  两者逐字相同 = 是"; else echo "  两者逐字相同 = 否"; fi

h "U-13 越量程精确计数（products limit=1/100/101/1000，orders 同）"
for q in "limit=1&offset=0" "limit=100&offset=0" "limit=101&offset=0" "limit=1000&offset=0" "limit=0&offset=0" "offset=-1"; do
  f="$EV/r4b-u13-products-$(echo "$q" | tr '=&' '__').json"; c=$(code "$f" "$API/api/v1/products?$q"); n=$(grep -o '"name"' "$f" | wc -l | tr -d ' ')
  echo "  /products?$q -> ${c}，返回 $n 条"
done
for q in "limit=1&offset=0" "limit=100&offset=0" "limit=101&offset=0" "limit=0&offset=0" "offset=-1"; do
  f="$EV/r4b-u13-orders-$(echo "$q" | tr '=&' '__').json"; c=$(code "$f" -b "$J/A.txt" "$API/api/v1/orders?$q"); n=$(grep -o '"orderNo"' "$f" | wc -l | tr -d ' ')
  echo "  /orders?$q -> ${c}，返回 $n 条 :: $(head -c 90 "$f")"
done
echo "  订单倒序：列表首单=$(grep -o '"orderNo":"[^"]*"' "$EV/r4b-u13-orders-limit_100_offset_0.json" | head -1)"

h "U-39 静态资源缓存（从 index HTML 里取真实资源 URL）"
curl -s "$API/" > "$EV/r4b-u39-index.html"; echo "  index 里引用的资源："
grep -oE '(src|href)="[^"]+"' "$EV/r4b-u39-index.html" | sort -u | sed 's/^/    /'
JS=$(grep -oE 'src="[^"]+\.js"' "$EV/r4b-u39-index.html" | head -1 | cut -d'"' -f2)
CSS=$(grep -oE 'href="[^"]+\.css"' "$EV/r4b-u39-index.html" | head -1 | cut -d'"' -f2)
IMG=$(grep -oE 'src="[^"]+\.jpg"' "$EV/r4b-u39-index.html" | head -1 | cut -d'"' -f2)
for pair in "js:$JS" "css:$CSS" "jpg:$IMG" "favicon:/favicon.ico" "index:/"; do
  tag="${pair%%:*}"; u="${pair#*:}"; [ -z "$u" ] && { echo "  $tag 未在 index 中出现，跳过"; continue; }
  code "$EV/r4b-u39-$tag.out" -D "$EV/r4b-u39-$tag.headers" -o /dev/null "$API$u"; echo "  $tag $u -> $(cat "$EV/r4b-u39-$tag.out")"
  grep -iE '^(cache-control|etag|content-type)' "$EV/r4b-u39-$tag.headers" | tr -d '\r' | sed 's/^/      /'
  ET=$(grep -i '^etag' "$EV/r4b-u39-$tag.headers" | tr -d '\r' | awk '{print $2}')
  if [ -n "$ET" ]; then echo "      If-None-Match 复请求 -> $(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ET" "$API$u")"; fi
done
echo "  静态白名单外 / 主图缺失补充："
for u in "/server/src/app.mjs" "/assets/products/P-009.jpg" "/assets/products/nope.jpg" "/index.html.bak"; do
  echo "    $u -> $(code "$EV/r4b-u39-extra-$(echo "$u" | tr '/.' '__').out" "$API$u") :: $(head -c 70 "$EV/r4b-u39-extra-$(echo "$u" | tr '/.' '__').out")"
done

h "U-46 第三项：npm test（照字面跑；托管实例占 3000 ⇒ 预期装置冲突）"
npm test > "$EV/r4b-npmtest.out" 2>&1; NRC=$?
echo "  npm test rc=$NRC"
echo "  输出尾部："; tail -12 "$EV/r4b-npmtest.out" | sed 's/^/    /'
echo "  是否出现端口占用/EADDRINUSE 字样：$(grep -icE 'EADDRINUSE|address already in use|端口' "$EV/r4b-npmtest.out")"
grep -nE 'EADDRINUSE|address already in use|pass [0-9]+|fail [0-9]+' "$EV/r4b-npmtest.out" | tail -6 | sed 's/^/    /'

h "DONE"
