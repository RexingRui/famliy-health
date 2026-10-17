# 服务器操作清单：上线 healthlog，接入 crab-caddy

本次在服务器上要做的全部操作，按顺序执行。做完后：

- 80/443 和证书仍然归 **crab 的 Caddy 容器 `crab-caddy`**。它的 Caddyfile 已经有
  `import /etc/caddy/sites/*.caddy`，宿主机 `/opt/caddy-sites/` 挂在那里（zichan 上线时加的）。
- healthlog 往 `/opt/caddy-sites/` 放一个自己的 `healthlog.caddy`，把 `/health/*` 转给 `healthlog-app:8080`；
  `healthlog-app` 加入 crab 的 compose 网络 `crab-order_default`，crab-caddy 按容器名找到它（zichan 也是这么接的）。
- healthlog 的访问地址：`https://<crab 的域名>/health/`。

**crab 需要改吗？不需要。** crab 的代码、配置、容器都不动，接入时只对 crab-caddy 做一次热加载（`caddy reload`），
不重启、不中断，crab 和 zichan 都不受影响。

预计耗时：30～50 分钟，大头是首次构建 healthlog 镜像和拉取 Gotenberg 镜像（约 1.5 GB）。

---

## 0. 前置条件（在本地确认）

- [ ] 本次改动已经合并到 healthlog 的 `main` 分支（`deploy.sh` 只部署 `main`）。
- [ ] 能 SSH 到服务器，且当前用户能执行 `docker`（crab 部署时已经配好）。

## 1. 检查现状（只读，不改任何东西）

以下所有命令在**同一个 SSH 会话**里执行，后面会用到这一步设置的 `$D`（crab 的域名）。

```bash
docker version --format '{{.Server.Version}}' && docker compose version --short
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
#   预期：crab-api、crab-caddy（0.0.0.0:80,443）、zichan 都在运行

# crab-caddy 已经能引入其它项目的片段
docker inspect crab-caddy --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}' | grep caddy-sites
#   预期：/opt/caddy-sites -> /etc/caddy/sites
docker exec crab-caddy grep -n 'import /etc/caddy/sites' /etc/caddy/Caddyfile
#   预期：有一行 import /etc/caddy/sites/*.caddy
ls -l /opt/caddy-sites/
#   预期：只有 zichan.caddy

docker network ls --format '{{.Name}}' | grep crab
#   预期：crab-order_default（不是这个名字的话，2.2 里把 .env 的 PROXY_NETWORK 改成它）

sudo ss -lntp | grep -E ':(80|443|8081) '
#   预期：80/443 是 crab-caddy 的 docker-proxy，8081 没人用

D=$(docker inspect crab-caddy --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CRAB_DOMAIN=//p'); echo "域名：$D"
dig +short A "$D"; dig +short AAAA "$D"
#   预期：域名是 crab-doc.site；A 记录是本机公网 IP；AAAA 没有输出

free -h && df -h /
#   预期：可用内存 2G 以上，磁盘剩余 5G 以上
```

## 2. 部署 healthlog（此时还不对外，不影响 crab 和 zichan）

### 2.1 拉代码

```bash
sudo mkdir -p /opt/healthlog && sudo chown "$USER" /opt/healthlog
git clone https://github.com/RexingRui/famliy-health.git /opt/healthlog
cd /opt/healthlog && git log --oneline -1
```

### 2.2 写配置

```bash
cd /opt/healthlog
cp .env.example .env && chmod 600 .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^PRINT_TOKEN_SECRET=.*|PRINT_TOKEN_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^PUBLIC_DOMAIN=.*|PUBLIC_DOMAIN=$D|" .env
grep -nE '^(PUBLIC_DOMAIN|BASE_PATH|PROXY_NETWORK)=' .env; grep -cE '^(POSTGRES_PASSWORD|PRINT_TOKEN_SECRET)=.+' .env
#   预期：PUBLIC_DOMAIN 是 crab 的域名；BASE_PATH 为空（生产默认 /health）；
#         PROXY_NETWORK 是第 1 步看到的网络名；最后一行输出 2（两个密钥都有值）
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

报错 `network crab-order_default declared as external, but could not be found`：crab 没在跑，或者网络名不对，回到第 1 步。

构建失败多半是网络：Go 依赖走 goproxy.cn、npm 走 npmmirror、apk 走 mirrors.tencent.com、镜像走腾讯云镜像源，
都在 `.env` / `docker-compose.yml` 里可改。重跑 `./scripts/deploy.sh` 即可。

### 2.5 创建登录账号

```bash
docker compose exec app healthlog user create --username <你的用户名>
#   交互输入两次密码（至少 8 位）；预期输出 created account "..."
```

## 3. 接入 crab-caddy（热加载，不中断）

```bash
# 先确认 crab-caddy 在 crab 的网络里能找到 healthlog-app
docker exec crab-caddy wget -qO- http://healthlog-app:8080/health/healthz
#   预期：{"checks":{"database":"ok","gotenberg":"ok"},"status":"ok"}

cd /opt/healthlog
sudo make caddy-install
#   复制 deploy/healthlog.caddy 到 /opt/caddy-sites/，检查括号、整体校验、热加载 crab-caddy
#   预期：✓ 已安装 /opt/caddy-sites/healthlog.caddy 并热加载 crab-caddy
#   校验不过会自动撤回这个文件，并打印 Caddy 的报错；crab-caddy 继续用原来的配置
```

`healthlog.caddy` 的内容是站点块里的几条指令（`/health` 308 跳转、`/health/*` 限制 50 MB 请求体、加安全响应头、
反代到 `healthlog-app:8080`），会被拼接到 crab 站点块里、兜底 404 之前。证书沿用 crab-caddy 现有的，不用重新签。

## 4. 验证

```bash
# crab 不受影响
curl -s  "https://$D/api/" -o /dev/null -w 'crab api      %{http_code}\n'   # crab 的响应（401/404 都说明到了 crab）
curl -sI "https://$D/t"  | head -n1                                          # HTTP/2 200，买家查单页
curl -sI "https://$D/r"  | head -n1                                          # HTTP/2 200，买家登记页

# zichan 不受影响
curl -sI "https://$D/zichan/" | head -n1                                     # HTTP/2 401（要登录）

# healthlog
curl -sI "https://$D/health" | grep -iE '^(HTTP|location)'                   # 308 → /health/
curl -sI "https://$D/health/" | head -n1                                     # HTTP/2 200
curl -s  "https://$D/health/api/me"                                          # {"error":{"code":"unauthorized",...}}

# 协议：不应宣告 HTTP/3（Safari 坑）
curl -sI "https://$D/health/" | grep -i alt-svc || echo "没有 alt-svc，正确"
```

最后用手机 Safari 和电脑浏览器各打开一次 `https://<域名>/health/`，用 2.5 建的账号登录，能看到首页（还没有成员）。真机上的录音、拍照等验证按上线清单阶段 3 做。
crab 的小程序打开看一眼订单列表，`/zichan/` 也打开看一眼。

## 5. 出问题怎么回滚

摘掉 healthlog 的路由，crab 和 zichan 照常；healthlog 继续在本机跑、不对外：

```bash
sudo rm /opt/caddy-sites/healthlog.caddy
docker exec crab-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

常见问题：

| 现象 | 排查 |
|---|---|
| `make caddy-install` 报校验失败 | 看它打印的 Caddy 报错。文件已自动撤回，crab-caddy 没受影响 |
| `/health/` 502 | healthlog 没起来：`cd /opt/healthlog && docker compose ps && docker compose logs --tail=50 app`；或 crab-caddy 找不到它：`docker exec crab-caddy wget -qO- http://healthlog-app:8080/health/healthz` |
| `/health/` 404 | 片段没引入：`ls /opt/caddy-sites/`，有文件就再 `caddy reload` 一次 |
| crab-caddy 重建后 `/health/` 502 | 正常不会：healthlog-app 一直连在 crab 的网络里。真遇到就 `cd /opt/healthlog && docker compose up -d` |
| 证书、HTTPS 问题 | 归 crab-caddy 管：`docker logs crab-caddy`，排查思路见 crab 的 `scripts/tls-check.sh` |

## 6. 收尾

```bash
# healthlog 每天凌晨 3:10 备份（和 crab 的 3 点备份错开 10 分钟）
( crontab -l 2>/dev/null; echo "10 3 * * * /opt/healthlog/scripts/backup.sh >> /var/log/healthlog-backup.log 2>&1" ) | crontab -
/opt/healthlog/scripts/backup.sh && ls -lh /opt/healthlog/backup/db/
docker stats --no-stream                      # 看一眼内存
```

以后要记住的：

- healthlog 日常发布：`cd /opt/healthlog && ./scripts/deploy.sh`。它不碰 crab-caddy；
  `deploy/healthlog.caddy` 有改动时它会提示，再执行一次 `sudo make caddy-install`。
- healthlog 依赖 crab 的网络：服务器重启后 Docker 会按 `restart: unless-stopped` 把容器都拉起来，不用管；
  手动操作时先起 crab，再起 healthlog。
- crab 执行 `docker compose down` 时，因为 healthlog 和 zichan 还连着 `crab-order_default`，网络删不掉，会报
  `has active endpoints`，属正常，不影响 crab 再 `up`。不要手动 `docker network rm` 这个网络。
- 同一个域名再加应用：照 healthlog / zichan 的做法，在 `/opt/caddy-sites/` 放一个 `*.caddy`，容器加入
  `crab-order_default`，用唯一的容器名。注意 crab 的 `/t*`、`/r*`、`/admin*` 会吃掉所有这样开头的路径，
  新前缀别用 t、r 开头，也别用 admin 开头。
