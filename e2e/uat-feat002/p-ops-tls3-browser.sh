#!/usr/bin/env bash
# FEAT-002 UAT · P-19 复验 阶段 B：把反代档案再起起来 → 真实浏览器打 https://localhost/ → 收尾 down -v
# 起服命令与 docs/DEPLOY.md 一致（--profile proxy up -d）；变量注入方式同阶段 A（shell 环境等价 deploy/.env，已声明）。
set -u
cd "$(dirname "$0")/../.." || exit 99
EV="reports/uat/evidence/FEAT-002-uat/ops"
export DOCKER_CONFIG=/tmp/dockercfg
export SESSION_SECRET="$(openssl rand -hex 32)"
export COOKIE_SECURE=1
export TRUST_PROXY=1
DC="docker compose -f deploy/docker-compose.yml"

echo "##### B1. $DC --profile proxy up -d #####"
$DC --profile proxy up -d > "$EV/p19b-up2.out" 2>&1; echo "   exit=$?"; tail -6 "$EV/p19b-up2.out" | sed 's/^/   /'
for i in $(seq 1 30); do
  A=$(docker inspect shop-app-1 --format '{{.State.Health.Status}}' 2>/dev/null)
  P=$(docker inspect shop-proxy-1 --format '{{.State.Health.Status}}' 2>/dev/null)
  [ "$A" = "healthy" ] && [ "$P" = "healthy" ] && break
  sleep 3
done
echo "   等待 $((i*3))s：app=$A proxy=$P"

echo; echo "##### B2. 真实浏览器访问 https://localhost/（见 p8-tls-browser.json / P19-*.png）#####"
node e2e/uat-feat002/p8-tls-browser.mjs > "$EV/p19b-browser.out" 2>&1; echo "   浏览器脚本 exit=$?"
grep -E '^== |^ \{|"title"|"cards"|"protocol"|"certInterstitial"|"imgs"|"tabbar"|"secure"|"name"' "$EV/p19b-browser.out" | head -40 | sed 's/^/   /'

echo; echo "##### B3. 收尾：down -v 与残留自查 #####"
$DC --profile proxy down -v > "$EV/p19b-down3.out" 2>&1; echo "   down -v exit=$?"
echo "   本项目容器: $(docker ps -a --filter 'label=com.docker.compose.project=shop' --format '{{.Names}}' | tr '\n' ' ')(空=0 残留)"
echo "   本项目卷:   $(docker volume ls --format '{{.Name}}' | grep -E '^shop_' | tr '\n' ' ')(空=0 残留)"
echo "   本项目网络: $(docker network ls --format '{{.Name}}' | grep -E '^shop_' | tr '\n' ' ')(空=0 残留)"
echo "   80/443/3000 监听数: $(lsof -nP -iTCP:80 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ') / $(lsof -nP -iTCP:443 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ') / $(lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
echo "   全部容器:"; docker ps -a --format '     {{.Names}} {{.Status}}'
