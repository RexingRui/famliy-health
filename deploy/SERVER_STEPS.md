# 服务器操作清单：上线 healthlog + 独立网关

本次在服务器上要做的全部操作，按顺序执行。做完后：

- 服务器上多一个**独立网关** `/opt/gateway`（一个 Caddy），它是唯一监听 80/443 的进程，按路径分发：
  crab 的 `/api/*`、`/t*`、`/r*` → crab；`/health/*` → healthlog。
- crab 和 healthlog 都只把端口绑在 `127.0.0.1` 上，互相不知道对方，**两个仓库都不需要为对方改代码**。
- healthlog 的访问地址：`https://<crab 的域名>/health/`。

**crab 需要重新部署吗？不需要。** crab 的代码、镜像、`.env` 都不动，crab-api 容器一直在跑。
唯一的变化是停掉 crab 自带的 Caddy 容器（`proxy` profile），由网关接管 80/443。
这正是 crab 部署文档里支持的「方案 B：宿主机上已经有反代」。切换时 crab 会中断几十秒（网关签证书），目前没有用户，可以忽略。

预计耗时：40～60 分钟，大头是首次构建 healthlog 镜像和拉取 Gotenberg 镜像（约 1.5 GB）。

---

## 0. 前置条件（在本地确认）

- [ ] 本次改动已经合并到 healthlog 的 `main` 分支（`deploy.sh` 只部署 `main`）。
- [ ] 能 SSH 到服务器，且当前用户能执行 `docker`（crab 部署时已经配好）。

## 1. 检查现状（只读，不改任何东西）

以下所有命令在**同一个 SSH 会话**里执行，后面会用到这一步设置的 `$D`（crab 的域名）。

```bash
docker version --format '{{.Server.Version}}' && docker compose version --short
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
#   预期：crab-api（127.0.0.1:8080->8080）和 crab-caddy（0.0.0.0:80,443）在运行

sudo ss -lntp | grep -E ':(80|443|8080|8081|2019) '
#   预期：80/443 是 crab-caddy 的 docker-proxy，8080 只绑 127.0.0.1，8081 和 2019 没人用

D=$(grep -E '^CRAB_DOMAIN=' /opt/crab-order/.env | tail -n1 | cut -d= -f2-); echo "域名：$D"
dig +short A "$D"; dig +short AAAA "$D"
#   预期：A 记录是本机公网 IP；AAAA 没有输出（有的话先去 DNSPod 删掉）

ls /opt/crab-order/web/track/index.html /opt/crab-order/web/register/index.html
free -h && df -h /
#   预期：可用内存 2G 以上，磁盘剩余 5G 以上
```

## 2. 部署 healthlog（此时还不对外，不影响 crab）

### 2.1 拉代码

```bash
sudo mkdir -p /opt/healthlog && sudo chown "$USER" /opt/healthlog
git clone https://github.com/RexingRui/famliy-health.git /opt/healthlog
cd /opt/healthlog && git log --oneline -1
```

> 仓库如果是私有的，按 crab 的做法配一个**只读部署密钥**（`ssh-keygen -t ed25519 -f ~/.ssh/healthlog_deploy`，
> 公钥填到 GitHub 仓库 Settings → Deploy keys，不勾写权限），再用 `git@github.com:RexingRui/famliy-health.git` 克隆。
> 注意 `~/.ssh/config` 里 crab 已经给 `github.com` 配了密钥，要给这个仓库另起一个 Host 别名。

### 2.2 写配置

```bash
cd /opt/healthlog
cp .env.example .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^PRINT_TOKEN_SECRET=.*|PRINT_TOKEN_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^PUBLIC_DOMAIN=.*|PUBLIC_DOMAIN=$D|" .env
grep -nE '^(PUBLIC_DOMAIN|BASE_PATH|POSTGRES_PASSWORD|PRINT_TOKEN_SECRET)=' .env
#   预期：PUBLIC_DOMAIN 是 crab 的域名；BASE_PATH 为空（生产默认 /health）；两个密钥都有值
```

`.env` 上半部分的开发配置（`DATABASE_URL`、`GOTENBERG_URL` 等）在服务器上不起作用，docker compose 会用自己的值覆盖，不用改。

### 2.3 建数据目录

```bash
mkdir -p data/storage data/postgres backup
sudo chown -R 10001:10001 data/storage      # 容器里的应用用户是 uid 10001
```

### 2.4 构建并启动

```bash
./scripts/deploy.sh
#   首次会：跳过备份（还没有数据库）→ 构建镜像（几分钟）→ 启动 app/postgres/gotenberg → 自检
#   预期最后一行：✓ 部署完成

docker compose ps                          # 三个容器都是 running，app 是 healthy
curl -s localhost:8081/health/healthz      # {"checks":{"database":"ok","gotenberg":"ok"},"status":"ok"}
```

构建失败多半是网络：Go 依赖走 goproxy.cn、npm 走 npmmirror、apk 走 mirrors.tencent.com、镜像走腾讯云镜像源，
都在 `.env` / `docker-compose.yml` 里可改。重跑 `./scripts/deploy.sh` 即可。

### 2.5 创建登录账号

```bash
docker compose exec app healthlog user create --username <你的用户名>
#   交互输入两次密码（至少 8 位）；预期输出 created account "..."
```

## 3. 准备网关（先写文件、校验，不启动）

```bash
sudo mkdir -p /opt/gateway && sudo chown "$USER" /opt/gateway
cd /opt/gateway
echo "SITE_DOMAIN=$D" > .env
```

写入 `/opt/gateway/docker-compose.yml`：

```bash
cat > /opt/gateway/docker-compose.yml <<'YAML'
# 服务器共享网关。用 host 网络直接连各应用绑在 127.0.0.1 上的端口，
# 不需要加入任何应用的 Docker 网络。
name: gateway

services:
  caddy:
    image: caddy:2-alpine
    container_name: gateway-caddy
    restart: unless-stopped
    network_mode: host
    environment:
      SITE_DOMAIN: ${SITE_DOMAIN:?在 .env 里填 SITE_DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      # crab 的两个静态页面，只读
      - /opt/crab-order/web/track:/srv/crab/track:ro
      - /opt/crab-order/web/register:/srv/crab/register:ro
      # 证书在这里，别 down -v
      - caddy-data:/data
      - caddy-config:/config
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  caddy-data:
  caddy-config:
YAML
```

写入 `/opt/gateway/Caddyfile`：

```bash
cat > /opt/gateway/Caddyfile <<'CADDY'
# 服务器共享网关：唯一监听 80/443 的进程，按路径把同一个域名分给各个应用。
# 各应用只把端口绑在 127.0.0.1 上，互相不知道对方；新增应用只改这个文件。
{
	# 只宣告 HTTP/1.1 + HTTP/2。云防火墙默认不放通 UDP 443，宣告 h3 会让 Safari 连不上。
	servers {
		protocols h1 h2
	}
}

{$SITE_DOMAIN} {
	encode zstd gzip

	# ---------- crab（/opt/crab-order，api 绑在 127.0.0.1:8080） ----------
	handle /api/* {
		reverse_proxy 127.0.0.1:8080
	}

	# 买家免登录查单页：/t?no=xxx 也要命中，所以用 /t* 并重写
	handle /t* {
		header X-Robots-Tag noindex
		rewrite * /index.html
		file_server {
			root /srv/crab/track
		}
	}

	# 买家自助登记页：/r?t=xxx
	handle /r* {
		header X-Robots-Tag noindex
		rewrite * /index.html
		file_server {
			root /srv/crab/register
		}
	}

	# ---------- healthlog（/opt/healthlog，app 绑在 127.0.0.1:8081，BASE_PATH=/health） ----------
	redir /health /health/ 308

	handle /health/* {
		# 照片 ≤10 MB、语音 ≤20 MB
		request_body {
			max_size 50MB
		}
		header {
			X-Content-Type-Options nosniff
			Referrer-Policy same-origin
			X-Robots-Tag noindex
		}
		# 应用自己挂在 /health 下，路径原样转发
		reverse_proxy 127.0.0.1:8081
	}

	# 其余路径一律 404
	handle {
		respond "Not Found" 404
	}
}
CADDY
```

校验（不占端口）：

```bash
cd /opt/gateway
docker compose config >/dev/null && echo compose ok
docker run --rm -e SITE_DOMAIN="$D" -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
    caddy validate --config /etc/caddy/Caddyfile
#   预期：Valid configuration
```

> 建议把 `/opt/gateway` 也用 git 管起来（`git init && git add -A && git commit -m init`），以后加应用改 Caddyfile 有记录可回退。

## 4. 切换 80/443（crab 中断几十秒）

```bash
# 4.1 停掉 crab 自带的 Caddy（只停这一个容器，crab-api 不动）
cd /opt/crab-order
docker compose stop caddy && docker compose rm -f caddy
docker ps --format '{{.Names}}' | grep crab       # 只剩 crab-api
sudo ss -lntp | grep -E ':(80|443) ' || echo "80/443 已空出"

# 4.2 启动网关
cd /opt/gateway
docker compose up -d
docker compose logs -f caddy
#   看到 "certificate obtained successfully" 后 Ctrl+C
#   （首次要重新签一次证书，一般 10～30 秒；80 端口必须能从公网访问）
```

## 5. 验证

```bash
# crab 不受影响
curl -s  "https://$D/api/" -o /dev/null -w 'crab api      %{http_code}\n'   # crab 的响应（401/404 都说明到了 crab）
curl -sI "https://$D/t"  | head -n1                                          # HTTP/2 200，买家查单页
curl -sI "https://$D/r"  | head -n1                                          # HTTP/2 200，买家登记页

# healthlog
curl -sI "https://$D/health" | grep -iE '^(HTTP|location)'                   # 308 → /health/
curl -sI "https://$D/health/" | head -n1                                     # HTTP/2 200
curl -s  "https://$D/health/api/me"                                          # {"error":{"code":"unauthorized",...}}

# 协议：不应宣告 HTTP/3（Safari 坑）
curl -sI "https://$D/health/" | grep -i alt-svc || echo "没有 alt-svc，正确"
```

最后用手机 Safari 和电脑浏览器各打开一次 `https://<域名>/health/`，用 2.5 建的账号登录（目前前端页面还是占位页，能登录说明链路通了）。
crab 的小程序也打开看一眼订单列表。

## 6. 出问题怎么回滚

回到切换前的状态（crab 自带 Caddy 接管 80/443），healthlog 继续在本机跑、不对外：

```bash
cd /opt/gateway && docker compose down            # 不要加 -v，证书卷留着下次用
cd /opt/crab-order && docker compose --profile proxy up -d caddy
```

常见问题：

| 现象 | 排查 |
|---|---|
| 网关起不来，日志说端口被占用 | `sudo ss -lntp \| grep -E ':(80\|443) '`，crab-caddy 没停干净，或宿主机装了 nginx |
| 证书一直签不下来 | `docker compose logs caddy`；80 端口要能从公网访问（云控制台防火墙放通 TCP 80） |
| `/health/` 502 | healthlog 没起来：`cd /opt/healthlog && docker compose ps && docker compose logs --tail=50 app` |
| `/t` 或 `/r` 404 | 网关里 crab 静态页目录挂载路径不对：`docker exec gateway-caddy ls /srv/crab/track` |
| crab 接口拿不到真实 IP | 网关默认会设置 `X-Forwarded-For`，crab 取第一跳，正常不会出现 |

## 7. 收尾

```bash
# healthlog 每天凌晨 3 点备份（和 crab 的 3 点备份错开 10 分钟）
( crontab -l 2>/dev/null; echo "10 3 * * * /opt/healthlog/scripts/backup.sh >> /var/log/healthlog-backup.log 2>&1" ) | crontab -
/opt/healthlog/scripts/backup.sh && ls -lh /opt/healthlog/backup/db/
docker stats --no-stream                      # 看一眼内存
```

以后要记住的：

- **crab 以后不要再 `docker compose --profile proxy up`**，那会重新拉起 crab 自带的 Caddy 去抢 443。
  crab 的 `./scripts/deploy.sh` 只重建 `api`，照常用，不受影响。
- crab 的 `scripts/tls-check.sh` 里「caddy 容器」那一节会报 caddy 没在跑，属正常；证书和 HTTPS 看 `docker logs gateway-caddy`。
- healthlog 日常发布：`cd /opt/healthlog && ./scripts/deploy.sh`。
- 以后同一个域名再加应用：应用绑一个 `127.0.0.1` 端口，在 `/opt/gateway/Caddyfile` 加一段 `handle`，
  然后 `docker exec gateway-caddy caddy reload --config /etc/caddy/Caddyfile`。注意 crab 的 `/t*`、`/r*`
  会吃掉所有 t、r 开头的路径，新前缀别用这两个字母开头。
