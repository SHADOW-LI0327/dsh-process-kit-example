#!/usr/bin/env bash
# FEAT-002 UAT · P-19 复验：逐字照 docs/DEPLOY.md「需要 HTTPS 时启用反代档案」一节执行
# 【唯一替代说明】文档第 1 步要求先 `cp deploy/.env.example deploy/.env` 并改 COOKIE_SECURE/TRUST_PROXY=1；
# 写 deploy/** 不在 uat-agent 的可写路径（且派单明令不改 deploy/**），故用等价注入：
# 把 deploy/.env 会提供的三个变量放进 shell 环境（compose 插值优先取 shell 环境，已用 config 验证解析值随之变化）。
# 除此之外，命令与文档逐字一致（不含 -p、不含覆盖文件、不改端口）。
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
mkdir -p "$EV"
export DOCKER_CONFIG=/tmp/dockercfg
export SESSION_SECRET="$(openssl rand -hex 32)"
export COOKIE_SECURE=1
export TRUST_PROXY=1
DC="docker compose -f deploy/docker-compose.yml"
H=localhost

echo "##### 0. 前置：端口与容器基线（动手前）#####"
echo "-- 80/443/3000 监听（期望 0 0 0）:"; for p in 80 443 3000; do echo "   $p -> $(lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"; done
echo "-- 容器:"; docker ps --format '   {{.Names}} {{.Status}}'
echo "-- 等价注入的三个变量（= deploy/.env 将提供的值）: SESSION_SECRET=<32+ 随机串> COOKIE_SECURE=$COOKIE_SECURE TRUST_PROXY=$TRUST_PROXY"

echo; echo "##### 1. 文档命令①：$DC --profile proxy up -d #####"
$DC --profile proxy up -d > "$EV/p19b-up.out" 2>&1
RC=$?
echo "   exit=$RC"; tail -14 "$EV/p19b-up.out" | sed 's/^/   /'

echo; echo "##### 2. 文档命令②：$DC --profile proxy ps（app 与 proxy 都要 healthy）#####"
for i in $(seq 1 30); do
  A=$(docker inspect shop-app-1 --format '{{.State.Health.Status}}' 2>/dev/null)
  P=$(docker inspect shop-proxy-1 --format '{{.State.Health.Status}}' 2>/dev/null)
  [ "$A" = "healthy" ] && [ "$P" = "healthy" ] && break
  sleep 3
done
echo "   等待 $((i*3))s 后：app=$A proxy=$P"
$DC --profile proxy ps > "$EV/p19b-ps.out" 2>&1; echo "   ps exit=$?"; cat "$EV/p19b-ps.out" | sed 's/^/   /'
echo "-- 容器属性（只读根/非 root/端口）:"
docker inspect shop-proxy-1 --format '   proxy: User={{.Config.User}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} Health={{.State.Health.Status}}' 2>&1
docker port shop-proxy-1 2>&1 | sed 's/^/   proxy 端口: /'
docker port shop-app-1 2>&1 | sed 's/^/   app   端口: /'

echo; echo "##### 3. 文档命令③：curl -k -s -o /dev/null -w '%{http_code}\\n' https://localhost/health #####"
curl -k -s -o /dev/null -w '   status=%{http_code}\n' https://$H/health; echo "   curl exit=$?"
echo "##### 4. 文档命令④：curl -k -s https://localhost/health #####"
curl -k -s https://$H/health > "$EV/p19b-health.body"; echo "   curl exit=$?"; echo "   body=$(cat "$EV/p19b-health.body")"

echo; echo "##### 5. 真握手与证书（TLS 证据）#####"
echo | openssl s_client -connect $H:443 -servername $H 2>"$EV/p19b-sclient.err" | openssl x509 -noout -subject -issuer -dates 2>&1 | sed 's/^/   /'
echo "   s_client stderr: $(head -c 120 "$EV/p19b-sclient.err")"
echo "-- 不带 -k（验证书链信任，期望失败=内部 CA）:"
curl -s -o /dev/null -w '   status=%{http_code}\n' https://$H/health 2>"$EV/p19b-nok.err"; echo "   curl exit=$?；stderr=$(head -c 140 "$EV/p19b-nok.err")"
echo "-- HTTP(80) 是否被跳转到 HTTPS:"
curl -s -D - -o /dev/null http://$H/health 2>/dev/null | grep -iE '^(HTTP|location)' | sed 's/^/   /'

echo; echo "##### 6. 经反代下发的 cookie 属性（HTTPS 原点）#####"
echo "-- 经 https://localhost 注册一个账号，看 Set-Cookie（期望带 Secure）:"
curl -k -s -D - -o "$EV/p19b-reg.body" -X POST -H 'content-type: application/json' \
  -d '{"email":"uat-p19b@example.com","password":"uat-pass-12345"}' https://$H/api/v1/auth/register > "$EV/p19b-reg.headers"
echo "   status=$(head -1 "$EV/p19b-reg.headers" | tr -d '\r')"
grep -i '^set-cookie' "$EV/p19b-reg.headers" | sed 's/^/   /'
echo "-- 同账号经反代登录（期望 sid + cartId 均 Secure）:"
curl -k -s -D - -o /dev/null -X POST -H 'content-type: application/json' \
  -d '{"email":"uat-p19b@example.com","password":"uat-pass-12345"}' https://$H/api/v1/auth/login | grep -i '^set-cookie' | sed 's/^/   /'
echo "-- 首页经反代可取（200 + title）:"
curl -k -s -o "$EV/p19b-index.html" -w '   index status=%{http_code}\n' https://$H/
grep -o '<title>[^<]*' "$EV/p19b-index.html" | sed 's/^/   /'
echo "-- 经反代的安全响应头:"
curl -k -s -D - -o /dev/null https://$H/ | grep -iE '^(HTTP|strict-transport|x-content-type|x-frame|referrer|content-security)' | sed 's/^/   /'

echo; echo "##### 7. 反向确认：不带 --profile 默认 up 不得起 proxy、不得占 443 #####"
$DC --profile proxy down -v > "$EV/p19b-down1.out" 2>&1; echo "   带 profile down -v exit=$?"
echo "   down 后 443 监听数=$(lsof -nP -iTCP:443 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
$DC up -d > "$EV/p19b-up-default.out" 2>&1; echo "   默认 up -d exit=$?"
sleep 12
echo "   默认 up 后的容器:"; docker ps --format '   {{.Names}} {{.Status}}' | sort
echo "   是否存在 proxy 容器: $(docker ps -a --format '{{.Names}}' | grep -c 'shop-proxy' | tr -d ' ') 个"
echo "   443 监听数（期望 0）= $(lsof -nP -iTCP:443 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
echo "   80  监听数（期望 0）= $(lsof -nP -iTCP:80 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
echo "   3000 监听数（期望 1，仅 app）= $(lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
echo "   默认档案下 https 是否可用（期望失败）: $(curl -k -s -m 3 -o /dev/null -w '%{http_code}' https://$H/health 2>/dev/null || echo 失败)"

echo; echo "##### 8. 收尾：down -v + 残留自查 #####"
$DC down -v > "$EV/p19b-down2.out" 2>&1; echo "   down -v exit=$?"
echo "-- 本项目（compose 文件里 name: shop）容器/卷/网络残留:"
docker ps -a --filter 'label=com.docker.compose.project=shop' --format '   容器: {{.Names}} {{.Status}}'
docker volume ls --format '{{.Name}}' | grep -E '^shop_' | sed 's/^/   卷: /'
docker network ls --format '{{.Name}}' | grep -E '^shop_' | sed 's/^/   网络: /'
echo "   (以上无输出=0 残留)"
echo "-- 80/443/3000 监听数: $(lsof -nP -iTCP:80 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ') / $(lsof -nP -iTCP:443 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ') / $(lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
echo "-- 全部容器（期望只剩 yente-postgres）:"; docker ps -a --format '   {{.Names}} {{.Status}}'
