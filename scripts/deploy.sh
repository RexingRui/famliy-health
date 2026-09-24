#!/usr/bin/env bash
#
# One-command release on the server, modelled on crab's deploy.sh:
# checks → backup → fast-forward pull → build → replace → Caddy route → self-check,
# rolling back code and image when the self-check fails.
#
#   cd /opt/healthlog && ./scripts/deploy.sh
#   ssh <server> 'cd /opt/healthlog && ./scripts/deploy.sh'
#
# Environment:
#   BRANCH           branch to deploy (default main)
#   HEALTH_TIMEOUT   seconds to wait for /healthz (default 90)
#   SKIP_BACKUP=1    skip the pre-deploy backup (not recommended)
#   CADDY_CONTAINER   crab's Caddy container (default crab-caddy)
#   CADDY_ROUTES_DIR  host dir mounted into it at /etc/caddy/routes (default /opt/caddy-routes)
#
# Migrations only move forward. A rollback restores the old code and image but not the old
# schema; restore the pre-deploy dump in backup/db/ if a migration has to be undone.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BRANCH="${BRANCH:-main}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
CADDY_CONTAINER="${CADDY_CONTAINER:-crab-caddy}"
CADDY_ROUTES_DIR="${CADDY_ROUTES_DIR:-/opt/caddy-routes}"
ROLLBACK_IMAGE="healthlog:rollback"

log() { echo "[$(date "+%FT%T%z")] $*"; }
die() { echo "[$(date "+%FT%T%z")] ✗ $*" >&2; exit 1; }
env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }

# ---------- 0. checks ----------
[ -f docker-compose.yml ] || die "找不到 docker-compose.yml，请在项目目录执行"
[ -f .env ] || die "缺少 .env，见 deploy/DEPLOY.md"
[ -n "$(env_value PUBLIC_DOMAIN)" ] || die ".env 里没有 PUBLIC_DOMAIN（crab 的域名）"
BASE_PATH="$(env_value BASE_PATH)"; BASE_PATH="${BASE_PATH%/}"; BASE_PATH="${BASE_PATH:-/health}"
echo "$BASE_PATH" | grep -Eq '^(/[A-Za-z0-9][A-Za-z0-9._-]*)+$' || die "BASE_PATH 格式不对：$BASE_PATH"
# crab owns /api/*, /t* and /r* on the shared domain.
case "$BASE_PATH" in
    /api|/api/*|/t*|/r*) die "BASE_PATH=$BASE_PATH 会和 crab 的 /api、/t*、/r* 冲突，换一个前缀" ;;
esac
if [ -n "$(git status --porcelain)" ]; then
    git status --short | sed 's/^/    /' >&2
    die "工作区有未提交的改动。生产机上不要改代码，先处理干净再部署"
fi
[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || die "当前不在 $BRANCH 分支"
EDGE="$(env_value EDGE_NETWORK)"; EDGE="${EDGE:-crab-order_default}"
docker network inspect "$EDGE" >/dev/null 2>&1 || die "找不到网络 $EDGE：crab 是否在运行？（EDGE_NETWORK 可改）"

OLD_SHA="$(git rev-parse HEAD)"
log "当前版本 ${OLD_SHA:0:8}"

# ---------- 1. backup ----------
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
    log "跳过部署前备份（SKIP_BACKUP=1）"
elif [ -n "$(docker compose ps -q postgres 2>/dev/null)" ]; then
    ./scripts/backup.sh || die "备份失败，已中止部署"
else
    log "postgres 未运行，跳过备份（首次部署）"
fi

# ---------- 2. pull (fast-forward only) ----------
git fetch origin "$BRANCH" || die "git fetch 失败"
git merge --ff-only "origin/$BRANCH" || die "无法快进到 origin/$BRANCH"
NEW_SHA="$(git rev-parse HEAD)"
if [ "$NEW_SHA" != "$OLD_SHA" ]; then
    log "更新到 ${NEW_SHA:0:8}："
    git --no-pager log --oneline "$OLD_SHA..$NEW_SHA" | sed 's/^/    /'
fi

# ---------- 3. keep a rollback image, then build ----------
HAVE_ROLLBACK=0
if docker image inspect healthlog:latest >/dev/null 2>&1; then
    docker image tag healthlog:latest "$ROLLBACK_IMAGE"
    HAVE_ROLLBACK=1
fi
if ! docker compose build app; then
    git reset --hard "$OLD_SHA" >/dev/null
    die "构建失败，线上仍是旧版本，代码已退回 ${OLD_SHA:0:8}"
fi

# ---------- 4. replace ----------
docker compose up -d

# ---------- 5. Caddy route (imported inside crab's site block) ----------
if [ -d "$CADDY_ROUTES_DIR" ]; then
    rendered="$(sed "s#__BASE_PATH__#$BASE_PATH#g" deploy/caddy/healthlog.caddy)"
    target="$CADDY_ROUTES_DIR/healthlog.caddy"
    if ! [ -f "$target" ] || [ "$rendered" != "$(cat "$target")" ]; then
        printf '%s\n' "$rendered" > "$target"
        docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile \
            || die "Caddy 重载失败：docker logs $CADDY_CONTAINER 查看；路由文件在 $target"
        log "Caddy 路由已更新并重载（$BASE_PATH/）"
    fi
else
    log "⚠ 没有 $CADDY_ROUTES_DIR，跳过 Caddy 配置（见 deploy/DEPLOY.md 第 2 节）"
fi

# ---------- 6. self-check ----------
log "自检 /healthz（最多 ${HEALTH_TIMEOUT}s）..."
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    if docker compose exec -T app wget -qO- "http://127.0.0.1:8080$BASE_PATH/healthz" 2>/dev/null | grep -q '"status":"ok"'; then
        log "✓ 部署完成：${OLD_SHA:0:8} → ${NEW_SHA:0:8}"
        docker compose ps
        exit 0
    fi
    sleep 3
done

# ---------- 7. rollback ----------
echo "---------- 新版本最后 50 行日志 ----------" >&2
docker compose logs --tail=50 app >&2 || true
git reset --hard "$OLD_SHA" >/dev/null
if [ "$HAVE_ROLLBACK" = "1" ]; then
    docker image tag "$ROLLBACK_IMAGE" healthlog:latest
    docker compose up -d --force-recreate app
fi
die "自检未通过，已回滚到 ${OLD_SHA:0:8}"
