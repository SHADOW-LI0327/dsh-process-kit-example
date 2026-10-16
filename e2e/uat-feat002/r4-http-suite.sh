#!/usr/bin/env bash
# FEAT-002 UAT r4 · HTTP 面逐条取证（U-04~U-16 / U-34 / U-37 / U-38 / U-39 / U-46 门禁）
# 只打托管服务 http://127.0.0.1:3000；不改配置、不重启、不起容器。退出码禁管道。
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat"
mkdir -p "$EV"
API=http://127.0.0.1:3000
J="$EV/r4-http.jarenv"
rm -rf "$J"; mkdir -p "$J"
h() { echo; echo "##### $* #####"; }
code() { curl -s -o "$1" -w '%{http_code}' "${@:2}"; }

h "U-34 /health（不带 cookie，未登录）"
code "$EV/U-34-健康端点-01-body.json" "$API/health"; echo " <- code"
cat "$EV/U-34-健康端点-01-body.json"; echo
echo "-- 带伪造 sid："; code "$EV/U-34-健康端点-02-body.json" -H 'Cookie: sid=forged-for-u34' "$API/health"; echo " <- code"

h "U-37 安全响应头（页面 + API）"
curl -s -D "$EV/U-37-安全响应头-01-index.headers" -o /dev/null "$API/"; echo "index rc=$?"
curl -s -D "$EV/U-37-安全响应头-02-api.headers" -o /dev/null "$API/api/v1/products"; echo "api rc=$?"
grep -iE 'x-content-type-options|referrer-policy|x-frame-options|content-security-policy' "$EV/U-37-安全响应头-01-index.headers" | sed 's/^/  index: /'
grep -iE 'x-content-type-options|referrer-policy|x-frame-options|content-security-policy' "$EV/U-37-安全响应头-02-api.headers" | sed 's/^/  api: /'

h "U-04 注册即开会话 + 非法输入"
E1="uat-r4-a+$(date +%s)@example.com"
code "$EV/U-04-注册即开会话-01-register.json" -c "$J/a.txt" -H 'content-type: application/json' -d "{\"email\":\"$E1\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register"; echo " <- register code ($E1)"
code "$EV/U-04-注册即开会话-02-order.json" -b "$J/a.txt" -c "$J/a.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- 未重新登录直接下单 code"

h "U-40 复用：注册后先加购一件，供下单读库存/购物车"
code "$EV/r4-a-cart1.json" -b "$J/a.txt" -c "$J/a.txt" -H 'content-type: application/json' -d '{"productId":"P-003","quantity":1}' "$API/api/v1/cart/items"; echo " <- add code"
cat "$EV/r4-a-cart1.json"; echo

h "U-04b 四类非法注册（+ 缺字段 / 口令传数字）"
code "$EV/U-04-非法输入-01-email.json" -H 'content-type: application/json' -d '{"email":"abc","password":"uat-pass-12345"}' "$API/api/v1/auth/register"; echo " <- email=abc"
code "$EV/U-04-非法输入-02-pw7.json" -H 'content-type: application/json' -d '{"email":"uat-r4-x@example.com","password":"1234567"}' "$API/api/v1/auth/register"; echo " <- pw 7 位"
code "$EV/U-04-非法输入-03-pw129.json" -H 'content-type: application/json' -d "{\"email\":\"uat-r4-y@example.com\",\"password\":\"$(printf 'a%.0s' $(seq 1 129))\"}" "$API/api/v1/auth/register"; echo " <- pw 129 位"
code "$EV/U-04-非法输入-04-missing.json" -H 'content-type: application/json' -d '{"email":"uat-r4-z@example.com"}' "$API/api/v1/auth/register"; echo " <- 缺 password"
code "$EV/U-04-非法输入-05-numpw.json" -H 'content-type: application/json' -d '{"email":"uat-r4-w@example.com","password":12345678}' "$API/api/v1/auth/register"; echo " <- 口令传数字"
for f in "$EV"/U-04-非法输入-0*.json; do echo "  $f -> $(cat "$f")"; done

h "U-05 重复注册（同邮箱再来一次）"
code "$EV/U-05-重复注册-01.json" -H 'content-type: application/json' -d "{\"email\":\"$E1\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register"; echo " <- 重复注册 code"
cat "$EV/U-05-重复注册-01.json"; echo
code "$EV/U-05-重复注册-02-relogin.json" -c "$J/a2.txt" -H 'content-type: application/json' -d "{\"email\":\"$E1\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/login"; echo " <- 原账号重新登录 code"
code "$EV/U-05-重复注册-03-cart.json" -b "$J/a2.txt" "$API/api/v1/cart"; echo " <- 重新登录后购物车 code"
cat "$EV/U-05-重复注册-03-cart.json"; echo

h "U-06 登录会话 cookie 属性 + 伪造/缺失"
code "$EV/U-06-会话属性-01-login.json" -D "$EV/U-06-会话属性-01-login.headers" -c "$J/b.txt" -H 'content-type: application/json' -d "{\"email\":\"$E1\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/login"; echo " <- login code"
grep -i '^set-cookie' "$EV/U-06-会话属性-01-login.headers" | sed 's/^/  /'
echo "-- 伪造 sid（改一个字符）："
SID=$(grep -i '^set-cookie' "$EV/U-06-会话属性-01-login.headers" | grep -o 'sid=[^;]*' | head -1)
FORGED="${SID%?}X"
code "$EV/U-06-会话属性-02-forged-protected.json" -H "Cookie: $FORGED" "$API/api/v1/orders"; echo " <- 伪造 sid 访问受保护面 code"
cat "$EV/U-06-会话属性-02-forged-protected.json"; echo
code "$EV/U-06-会话属性-03-forged-cart.json" -D "$EV/U-06-会话属性-03-forged-cart.headers" -H "Cookie: $FORGED" "$API/api/v1/cart"; echo " <- 伪造 sid 访问购物车面 code"
cat "$EV/U-06-会话属性-03-forged-cart.json"; echo
grep -i '^set-cookie' "$EV/U-06-会话属性-03-forged-cart.headers" | sed 's/^/  新下发: /'
echo "-- 完全不带 cookie 访问受保护面/购物车面："
code "$EV/U-06-会话属性-04-none-protected.json" "$API/api/v1/orders"; echo " <- 无 cookie 受保护面 code"
code "$EV/U-06-会话属性-05-none-cart.json" "$API/api/v1/cart"; echo " <- 无 cookie 购物车面 code"

h "U-07 登录失败不辨（错口令 vs 未注册邮箱）"
code "$EV/U-07-登录失败不辨-01-wrongpw.json" -H 'content-type: application/json' -d "{\"email\":\"$E1\",\"password\":\"wrong-pass-9999\"}" "$API/api/v1/auth/login"; echo " <- 正确邮箱+错口令"
code "$EV/U-07-登录失败不辨-02-nouser.json" -H 'content-type: application/json' -d '{"email":"uat-r4-never@example.com","password":"whatever-12345"}' "$API/api/v1/auth/login"; echo " <- 未注册邮箱"
echo "  两次响应体："; echo "   1) $(cat "$EV/U-07-登录失败不辨-01-wrongpw.json")"; echo "   2) $(cat "$EV/U-07-登录失败不辨-02-nouser.json")"
echo "  逐字相同 = $([ "$(cat "$EV/U-07-登录失败不辨-01-wrongpw.json")" = "$(cat "$EV/U-07-登录失败不辨-02-nouser.json")" ] && echo 是 || echo 否)"

h "U-08 未登录拒下单（购物车不被清空）+ 已登录空车下单"
code "$EV/U-08-未登录拒下单-01-add.json" -b "$J/anon.txt" -c "$J/anon.txt" -H 'content-type: application/json' -d '{"productId":"P-006","quantity":1}' "$API/api/v1/cart/items"; echo " <- 匿名加购 code"
code "$EV/U-08-未登录拒下单-02-order.json" -b "$J/anon.txt" -c "$J/anon.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- 未登录下单 code"
cat "$EV/U-08-未登录拒下单-02-order.json"; echo
code "$EV/U-08-未登录拒下单-03-cart-after.json" -b "$J/anon.txt" "$API/api/v1/cart"; echo " <- 被拒后购物车（是否被清空）code"
cat "$EV/U-08-未登录拒下单-03-cart-after.json"; echo
code "$EV/U-08-空车下单-04-order.json" -b "$J/b.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- 已登录（空车）下单 code"
cat "$EV/U-08-空车下单-04-order.json"; echo
code "$EV/U-08-空车下单-05-cart.json" -b "$J/b.txt" "$API/api/v1/cart"; echo " <- 该账号购物车 code"

h "U-09 匿名车并入账号车 + 超限合并且拒绝"
E2="uat-r4-m+$(date +%s)@example.com"
code "$EV/U-09-并入-01-reg.json" -c "$J/m.txt" -H 'content-type: application/json' -d "{\"email\":\"$E2\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register" >/dev/null; echo "  register 完成"
code "$EV/U-09-并入-02-add1.json" -b "$J/m.txt" -c "$J/m.txt" -H 'content-type: application/json' -d '{"productId":"P-002","quantity":1}' "$API/api/v1/cart/items" >/dev/null
code "$EV/U-09-并入-03-add2.json" -b "$J/m.txt" -c "$J/m.txt" -H 'content-type: application/json' -d '{"productId":"P-004","quantity":1}' "$API/api/v1/cart/items" >/dev/null
code "$EV/U-09-并入-04-accountcart.json" -b "$J/m.txt" "$API/api/v1/cart"; echo " <- 账号车（2 件不同商品）code"
cat "$EV/U-09-并入-04-accountcart.json"; echo
echo "-- 构造匿名车 3 件同商品，然后登录并入："
E3="uat-r4-n+$(date +%s)@example.com"
code "$EV/r4-n-reg.json" -c "$J/n.txt" -H 'content-type: application/json' -d "{\"email\":\"$E3\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register" >/dev/null
code "$EV/r4-n-add.json" -b "$J/n.txt" -c "$J/n.txt" -H 'content-type: application/json' -d '{"productId":"P-003","quantity":6}' "$API/api/v1/cart/items" >/dev/null
echo "-- 另开匿名罐加同商品 3 件 → 登录到 n 账号（期望并入被拒，两边不变）："
code "$EV/U-09-超限-05-anonadd.json" -b "$J/o.txt" -c "$J/o.txt" -H 'content-type: application/json' -d '{"productId":"P-003","quantity":3}' "$API/api/v1/cart/items"; echo " <- 匿名加购 3 件 code"
ACOOK=$(grep -o 'cartId[[:space:]]*[^[:space:]]*' "$J/o.txt" | awk '{print $2}')
code "$EV/U-09-超限-06-login.json" -b "$J/o.txt" -c "$J/o.txt" -H 'content-type: application/json' -d "{\"email\":\"$E3\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/login"; echo " <- 登录（携匿名车）code"
cat "$EV/U-09-超限-06-login.json"; echo
code "$EV/U-09-超限-07-cart.json" -b "$J/o.txt" "$API/api/v1/cart"; echo " <- 登录后购物车 code"
cat "$EV/U-09-超限-07-cart.json"; echo
code "$EV/U-09-超限-08-ncart.json" -b "$J/n.txt" "$API/api/v1/cart"; echo " <- n 账号原车是否被动过 code"
cat "$EV/U-09-超限-08-ncart.json"; echo

h "U-10 退出回到匿名车"
code "$EV/U-10-退出-01-logout.json" -b "$J/a2.txt" -c "$J/a2.txt" -X POST "$API/api/v1/auth/logout"; echo " <- logout code"
code "$EV/U-10-退出-02-cart.json" -b "$J/a2.txt" -c "$J/a2.txt" "$API/api/v1/cart"; echo " <- 退出后购物车 code"
cat "$EV/U-10-退出-02-cart.json"; echo
code "$EV/U-10-退出-03-orders.json" -b "$J/a2.txt" -c "$J/a2.txt" "$API/api/v1/orders"; echo " <- 退出后订单面 code"
code "$EV/U-10-退出-04-relogin.json" -b "$J/a2.txt" -c "$J/a2.txt" -H 'content-type: application/json' -d "{\"email\":\"$E1\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/login" >/dev/null
code "$EV/U-10-退出-05-cart.json" -b "$J/a2.txt" "$API/api/v1/cart"; echo " <- 重新登录后购物车 code"
cat "$EV/U-10-退出-05-cart.json"; echo

h "U-11 我的订单归属与越权（A 下单 → B 手工请求 A 的单号 → 不存在的单号）"
code "$EV/U-11-越权-01-orderA.json" -b "$J/a.txt" -c "$J/a.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- A 下单 code"
ONO=$(grep -o '"orderNo":"[^"]*"' "$EV/U-11-越权-01-orderA.json" | head -1 | cut -d'"' -f4); echo "  A 的订单号=${ONO}"
E4="uat-r4-b+$(date +%s)@example.com"
code "$EV/U-11-越权-02-regB.json" -c "$J/b2.txt" -H 'content-type: application/json' -d "{\"email\":\"$E4\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register" >/dev/null
code "$EV/U-11-越权-03-listB.json" -b "$J/b2.txt" "$API/api/v1/orders"; echo " <- B 的订单列表 code"
cat "$EV/U-11-越权-03-listB.json"; echo
code "$EV/U-11-越权-04-otherorder.json" -b "$J/b2.txt" "$API/api/v1/orders/$ONO"; echo " <- B 请求 A 的订单 code"
cat "$EV/U-11-越权-04-otherorder.json"; echo
code "$EV/U-11-越权-05-nosuchorder.json" -b "$J/b2.txt" "$API/api/v1/orders/SO-19700101-999"; echo " <- 不存在的订单号 code"
cat "$EV/U-11-越权-05-nosuchorder.json"; echo
echo "  两者响应体逐字相同 = $([ "$(cat "$EV/U-11-越权-04-otherorder.json")" = "$(cat "$EV/U-11-越权-05-nosuchorder.json")" ] && echo 是 || echo 否)"

h "U-12 下单三件事（建单/扣库存/清车）+ 重复提交"
echo "  下单前库存读数（商品列表 API）："; curl -s "$API/api/v1/products" > "$EV/U-12-下单原子-01-stock-before.json"; node -e 'const j=require("./reports/uat/evidence/FEAT-002-uat/U-12-下单原子-01-stock-before.json");console.log("   "+j.data.map(p=>p.name+":"+p.stock).join(" "))'
code "$EV/U-12-下单原子-02-cart.json" -b "$J/b.txt" -X POST -H 'content-type: application/json' -d '{"productId":"P-007","quantity":2}' "$API/api/v1/cart/items" >/dev/null; echo "  加购 2 件完成"
code "$EV/U-12-下单原子-03-order1.json" -b "$J/b.txt" -c "$J/b.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- 第 1 次提交 code"
cat "$EV/U-12-下单原子-03-order1.json"; echo
code "$EV/U-12-下单原子-04-order2.json" -b "$J/b.txt" -c "$J/b.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- 立刻第 2 次提交 code"
cat "$EV/U-12-下单原子-04-order2.json"; echo
code "$EV/U-12-下单原子-05-cart.json" -b "$J/b.txt" "$API/api/v1/cart"; echo " <- 下单后购物车 code"
cat "$EV/U-12-下单原子-05-cart.json"; echo
code "$EV/U-12-下单原子-06-orders.json" -b "$J/b.txt" "$API/api/v1/orders"; echo " <- 订单列表 code"
echo "   订单数=$(grep -o '"orderNo"' "$EV/U-12-下单原子-06-orders.json" | wc -l | tr -d ' ')"
curl -s "$API/api/v1/products" > "$EV/U-12-下单原子-07-stock-after.json"; node -e 'const j=require("./reports/uat/evidence/FEAT-002-uat/U-12-下单原子-07-stock-after.json");console.log("   下单后库存："+j.data.map(p=>p.name+":"+p.stock).join(" "))'

h "U-13 分页与越量程"
for q in "limit=1&offset=0" "limit=100&offset=0" "limit=0" "limit=101" "offset=-1" "limit=abc"; do
  c=$(code "$EV/U-13-分页-$(echo "$q" | tr '=&' '__').json" "$API/api/v1/products?$q"); echo "  /products?$q -> $c : $(head -c 120 "$EV/U-13-分页-$(echo "$q" | tr '=&' '__').json")"
done
for q in "limit=1&offset=0" "limit=100&offset=0" "limit=0" "limit=101" "offset=-1"; do
  c=$(code "$EV/U-13-分页-orders-$(echo "$q" | tr '=&' '__').json" -b "$J/a.txt" "$API/api/v1/orders?$q"); echo "  /orders?$q -> $c : $(head -c 160 "$EV/U-13-分页-orders-$(echo "$q" | tr '=&' '__').json")"
done

h "U-15 无界面全链路（curl 独占，显式 jar）"
E5="uat-r4-c+$(date +%s)@example.com"
code "$EV/U-15-无界面全链路-01-register.json" -c "$J/c.txt" -H 'content-type: application/json' -d "{\"email\":\"$E5\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/register"; echo " <- 注册 code"
code "$EV/U-15-无界面全链路-02-login.json" -b "$J/c.txt" -c "$J/c.txt" -H 'content-type: application/json' -d "{\"email\":\"$E5\",\"password\":\"uat-pass-12345\"}" "$API/api/v1/auth/login"; echo " <- 登录 code"
code "$EV/U-15-无界面全链路-03-add.json" -b "$J/c.txt" -c "$J/c.txt" -H 'content-type: application/json' -d '{"productId":"P-008","quantity":1}' "$API/api/v1/cart/items"; echo " <- 加购 code"
code "$EV/U-15-无界面全链路-04-order.json" -b "$J/c.txt" -c "$J/c.txt" -X POST -H 'content-type: application/json' -d '{}' "$API/api/v1/orders"; echo " <- 下单 code"
ONO2=$(grep -o '"orderNo":"[^"]*"' "$EV/U-15-无界面全链路-04-order.json" | head -1 | cut -d'"' -f4); echo "  订单号=${ONO2}"
code "$EV/U-15-无界面全链路-05-get.json" -b "$J/c.txt" "$API/api/v1/orders/$ONO2"; echo " <- 查单 code"
cat "$EV/U-15-无界面全链路-05-get.json" | head -c 200; echo

h "U-16 错误响应形态统一（含静态白名单外）"
code "$EV/U-16-错误形态-01-noproduct.json" "$API/api/v1/products/SO-不存在"; echo " <- 不存在的商品"
code "$EV/U-16-错误形态-02-badjson.json" -X POST -H 'content-type: application/json' -d '{oops' "$API/api/v1/orders"; echo " <- 坏 JSON"
code "$EV/U-16-错误形态-03-badlimit.json" "$API/api/v1/products?limit=abc"; echo " <- 非法分页"
code "$EV/U-16-错误形态-04-unauth.json" "$API/api/v1/orders"; echo " <- 未登录访问订单"
code "$EV/U-16-错误形态-05-overqty.json" -b "$J/a.txt" -H 'content-type: application/json' -d '{"productId":"P-001","quantity":999}' "$API/api/v1/cart/items"; echo " <- 超限件数"
code "$EV/U-16-错误形态-06-serverpath.json" "$API/server/src/app.mjs"; echo " <- /server/src/app.mjs"
code "$EV/U-16-错误形态-07-foopng.json" "$API/foo.png"; echo " <- /foo.png"
code "$EV/U-16-错误形态-08-apinope.json" "$API/api/v1/nope"; echo " <- /api/v1/nope"
for f in "$EV"/U-16-错误形态-0*.json; do echo "  $(basename "$f") -> $(head -c 160 "$f")"; done
echo "  响应体里是否出现堆栈/路径特征（at / node_modules / /Users/）："
grep -lE 'at |node_modules|/Users/' "$EV"/U-16-错误形态-0*.json 2>/dev/null | sed 's/^/   命中: /' || echo "   无命中"

h "U-39 静态缓存与静态面收口"
curl -s -D "$EV/U-39-静态缓存-01-index.headers" -o /dev/null "$API/"; echo "index rc=$?"
ET=$(grep -i '^etag' "$EV/U-39-静态缓存-01-index.headers" | tr -d '\r' | awk '{print $2}')
echo "  index cache-control: $(grep -i '^cache-control' "$EV/U-39-静态缓存-01-index.headers" | tr -d '\r')"
curl -s -o /dev/null -w "  If-None-Match 复请求 -> %{http_code}\n" -H "If-None-Match: $ET" "$API/"
JS=$(curl -s "$API/" | grep -o '/assets/[^"]*\.js' | head -1); echo "  指纹脚本: $JS"
curl -s -D "$EV/U-39-静态缓存-02-asset.headers" -o /dev/null "$API$JS"; grep -i '^cache-control' "$EV/U-39-静态缓存-02-asset.headers" | sed 's/^/  asset: /'
for u in "/assets/../server/src/app.mjs" "/assets/%2e%2e/server/src/app.mjs" "/assets/%252e%252e/server/src/app.mjs" "/server/src/app.mjs" "/foo.png" "/api/v1/nope" "/assets/products/nope-不存在的图.jpg" "/favicon.ico"; do
  c=$(code "$EV/U-39-静态收口-$(echo "$u" | tr '/%.' '___').out" "$API$u"); echo "  $u -> $c : $(head -c 110 "$EV/U-39-静态收口-$(echo "$u" | tr '/%.' '___').out")"
done
echo "  favicon content-type: $(curl -s -o /dev/null -w '%{content_type}' "$API/favicon.ico")"

h "U-38 请求体上限（131072 / 200001 / 0 字节）"
python3 - "$EV" <<'PY'
import json,sys,os
p=sys.argv[1]
base={"productId":"P-001","quantity":1,"note":""}
s=json.dumps(base)
for tag,size in (("exact",131072),("over",131073),("zero",0)):
    if tag=="zero": b=""
    else:
        b=json.dumps({"productId":"P-001","quantity":1,"pad":"x"*(size-len(json.dumps({"productId":"P-001","quantity":1,"pad":""})))})
        b=b+" "*(size-len(b))
    open(os.path.join(p,f"r4-body-{tag}.json"),"w").write(b)
    print(f"  wrote {tag}: {len(b)} bytes")
PY
code "$EV/U-38-体积上限-01-exact.json" -b "$J/a.txt" -H 'content-type: application/json' --data-binary "@$EV/r4-body-exact.json" "$API/api/v1/cart/items"; echo " <- 恰 131072 code"
code "$EV/U-38-体积上限-02-over.json" -b "$J/a.txt" -H 'content-type: application/json' --data-binary "@$EV/r4-body-over.json" "$API/api/v1/cart/items"; echo " <- 131073 code"
code "$EV/U-38-体积上限-03-zero.json" -b "$J/a.txt" -H 'content-type: application/json' --data-binary "@$EV/r4-body-zero.json" "$API/api/v1/cart/items"; echo " <- 0 字节 code"
echo "  1) $(head -c 120 "$EV/U-38-体积上限-01-exact.json")"; echo "  2) $(head -c 120 "$EV/U-38-体积上限-02-over.json")"; echo "  3) $(head -c 120 "$EV/U-38-体积上限-03-zero.json")"

h "U-46 流程门禁（npm test 见 Script C，避免与托管服务抢 3000）"
node scripts/process/check-artifact-paths.mjs > "$EV/r4-gate-paths.out" 2>&1; echo "  落点门禁 rc=$? :: $(grep -E '无越界|越界' "$EV/r4-gate-paths.out" | tail -1)"
node scripts/process/check-rules.mjs > "$EV/r4-gate-rules.out" 2>&1; echo "  台账门禁 rc=$? :: $(tail -1 "$EV/r4-gate-rules.out")"

h "DONE"
echo "日志尾：$(date -u +%FT%TZ)"
