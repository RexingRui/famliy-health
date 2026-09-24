# 家庭健康管理（healthlog）

记录家人从生病到康复全过程的工具：**手机随手记，电脑汇总看，一键导出 PDF 报告。**

家庭自用的病程记录本，不做问诊，不给医疗建议。核心价值是：就诊时病史讲得清，复诊时有据可查，报销时材料齐全。

> 当前状态：**后端 MVP 接口已完成**（登录、成员、病程、记录、附件与语音转码、浏览视图、PDF 导出、备份与部署脚本），前端各路由仍是占位页。按下方「里程碑」推进。

## 文档

开发前先读这三份文档。仓库内是快照，原文更新后同步更新快照。

| 文档 | 仓库内 | 原文 | 用途 |
|---|---|---|---|
| 产品方案（MVP） | [docs/product.md](docs/product.md) | [链接](https://claude.ai/code/artifact/2cee63c4-4748-404b-b54c-fae6ba3f4f56) | 做什么：范围、概念、病程规则、字段、页面、流程、验收场景 |
| 前后端技术方案（MVP） | [docs/tech-plan.md](docs/tech-plan.md) | [链接](https://claude.ai/code/artifact/6b860948-4fcd-4a17-8cd3-67fbcd291543) | 怎么做：技术栈、架构、数据模型、API、关键流程、部署、里程碑 |
| 设计稿 | [docs/design.md](docs/design.md)（要点） | [链接](https://claude.ai/code/artifact/181d5e62-5cf3-4c2e-b088-7cdd0203ca67) | 长什么样：10 个画板、颜色、字体、尺寸 |

## 产品速览

**MVP 只做“记录 → 归类 → 浏览 → 导出”这条主线**，协作、提醒、AI 全部后置。

- **一套功能，两端侧重不同**：手机优先“记”，电脑优先“看”和“整理”。成员的添加和编辑只在手机端。
- **先存后整理**：记录不强制分类，没归类的进入“待整理”。
- **录入要快**：最短路径“记一笔 → 录音 → 保存”，3 次点击、10 秒内完成。
- **不依赖 AI**：原样保存文字、照片、语音。

核心概念：一个**账号**管理多个**成员**；成员有多个**病程**和**记录**；记录可归入 0 或 1 个病程（未归入即“待整理”）；病程按**病种标签**归类；记录包含照片 / 语音**附件**。

| 病程 | 状态 | 说明 |
|---|---|---|
| 短期（感冒、发烧） | 进行中 ⇄ 已康复 | 每次生病新建；14 天无新记录时提示“是否已康复” |
| 长期（哮喘、腰椎） | 治疗中 ⇄ 稳定期 → 已结束 | 持续追加；急性发作打“发作”标记 |

短期可转长期（active→treating，recovered→stable），原有记录保留。删除病程时记录退回待整理。

记录类型（选填）：症状（程度 0–10）、体温、用药（药名、剂量、单位）、就诊（医院、科室、医生、费用）、治疗康复、检查、其他。每条最多 9 张照片，每段语音最长 3 分钟；发生时间与录入时间相差超过 1 小时显示“补录”。

页面（9 个，全部响应式）：登录、首页 / 家庭总览（同一路由）、记一笔、病程详情、待整理、成员主页、成员管理（仅手机）、导出，外加打印专用页。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite、React Router、TanStack Query、Tailwind CSS 4、dayjs；按功能再加 ECharts、react-hook-form、idb-keyval、browser-image-compression、heic2any |
| 后端 | Go（单体单二进制）、chi、pgx + sqlc、goose、slog |
| 契约 | OpenAPI 3（`api/openapi.yaml`）→ oapi-codegen（Go strict server）+ openapi-typescript（TS 类型） |
| 数据库 | PostgreSQL 16 |
| 媒体 / PDF | ffmpeg（语音转 AAC m4a）、Gotenberg（无头 Chromium，官方镜像自带中文字体） |
| 部署 | docker compose：app + postgres + gotenberg；HTTPS 由同机 crab 项目的 Caddy 统一提供（见 [deploy/DEPLOY.md](deploy/DEPLOY.md)） |

前端构建产物通过 `go:embed` 编进后端二进制，前后端同域。`/api/*` 走接口，其余路径返回前端 `index.html`。

## 目录结构

```
api/
  openapi.yaml            接口契约，唯一事实来源
  oapi-codegen.yaml       Go 代码生成配置
cmd/healthlog/            main：serve、migrate、user create/passwd、purge-data
internal/
  api/                    [生成] oapi-codegen 输出
  httpx/                  chi 路由、中间件（请求日志、恢复、Origin 校验、请求体上限）、SPA、错误映射
  httpctx/                请求级上下文：原始请求、访问日志里的账号
  handler/                实现 StrictServerInterface：鉴权中间件、参数解析、响应组装（mapping.go）
  service/                业务规则：状态流转、类型与字段校验、幂等创建、批量归入、首页聚合、报告取数
  errs/                   业务错误（码、中文提示、字段），由 httpx 统一映射为 HTTP 状态
  timex/                  业务时间固定为 Asia/Shanghai：今天、按天分组、第几天
  store/                  连接池、迁移、事务
    dbgen/                [生成] sqlc 输出；每个查询都要求 family_id 参数
  storage/                Storage 接口，本期实现本地磁盘
  media/                  ffmpeg 转码、ffprobe 时长、JPEG 缩略图
  report/                 打印令牌（HMAC）、Gotenberg 客户端
  jobs/                   任务表队列：事务内入队、SKIP LOCKED 取任务、1/5/30 分钟退避
  auth/                   bcrypt、会话令牌、登录限流
  config/                 环境变量
  apitest/                端到端 API 测试（真实 PostgreSQL，每个测试独立 schema）
db/
  migrations/             goose 迁移（编进二进制，启动时自动执行）
  queries/                sqlc 的 SQL
web/
  embed.go                把 web/dist 编进 Go 二进制
  src/
    app/                  路由、外壳（MobileShell / DesktopShell）、Provider
    api/                  fetch 封装、QueryClient、[生成] schema.d.ts
    features/             auth home record episode inbox member export print
    components/           通用 UI
    lib/                  recorder image drafts time
    styles/               Tailwind 主题（颜色取自设计稿）
docker-compose.yml        生产部署（服务器上直接 docker compose up -d）
deploy/                   Dockerfile、开发依赖 compose、Caddy 站点、部署文档 DEPLOY.md
scripts/                  deploy.sh（发布与回滚）、backup.sh（pg_dump + 附件镜像）
docs/                     产品方案、技术方案、设计要点
Makefile                  gen、dev、test、lint、build、deploy、backup
```

## 快速开始

依赖：Go 1.26+、Node 22+、Docker（跑 PostgreSQL 和 Gotenberg）、ffmpeg（语音转码，本机跑后端时需要）、[sqlc](https://docs.sqlc.dev)（仅改 SQL 时需要，`go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1`）。oapi-codegen 和 air 已作为 Go tool 固定在 `go.mod` 中。

```bash
cp .env.example .env          # 填 PRINT_TOKEN_SECRET（openssl rand -hex 32）
cd web && npm install && cd ..
make dev-deps                 # postgres + gotenberg
make user-create USERNAME=me  # 建登录账号（首个账号同时创建家庭），交互输入密码
make dev                      # 后端 air 热重载（:8080），前端 Vite（:5173）
```

打开 http://localhost:5173 。Vite 把 `/api` 和 `/healthz` 代理到后端；本地 Gotenberg 通过 `host.docker.internal:5173` 打开打印页。手机真机调试录音需要 HTTPS，可用 mkcert 生成本地证书或内网穿透。

| 命令 | 作用 |
|---|---|
| `make gen` | 重新生成 sqlc、oapi-codegen、openapi-typescript 代码 |
| `make dev` / `make dev-down` | 启动 / 停止本地开发环境 |
| `make test` | 单元测试：`go test ./...` + Vitest |
| `make test-integration` | API 端到端测试，连 `TEST_DATABASE_URL`（每个测试建独立 schema，跑完删除） |
| `make lint` | `go vet` + gofmt + oxlint + `tsc` |
| `make build` | 构建前端并编译带前端的 `bin/healthlog` |
| `healthlog user create/passwd` | 建账号 / 改密码（改密码会注销全部会话） |
| `healthlog purge-data --confirm` | 注销并删除全部数据（成员、记录、文件） |

CI（`.github/workflows/ci.yml`）跑后端检查（含 PostgreSQL 服务和 ffmpeg 上的端到端测试）、前端检查，并校验生成代码与提交内容一致。

## 接口速览

完整定义见 `api/openapi.yaml`。所有业务接口在 `/api` 下，除登录、`/healthz`、附件文件和打印取数外都需要登录。

| 分组 | 接口 | 要点 |
|---|---|---|
| 账号 | `POST /auth/login`、`POST /auth/logout`、`GET /me` | Cookie `sid` 30 天滑动续期；同 IP 连续失败 5 次锁 15 分钟 |
| 首页 | `GET /home` | 每个成员：未结束病程（最新体温、上次用药、本周日历）、最近 4 条记录、近一年病程数；待整理数量 |
| 成员 | `/members` 增删改查、`/archive`、`/unarchive`、`/by-disease`、`/calendar` | 删除需 `confirm=true`，文件由后台任务清理 |
| 病种 | `GET/POST /disease-tags` | 预置 + 自定义，同名返回已有 |
| 病程 | `/episodes` 增删改查、`/calendar`、`/trend` | 状态随类型校验；短期可转长期；病种变了、名称仍是默认名时自动改名；删除后记录回到待整理 |
| 记录 | `GET /records`、`PUT/GET/PATCH/DELETE /records/{id}`、`POST /records/assign`、`GET /medications/last` | PUT 幂等；可随记录新建病程；类型与字段不匹配返回 422；游标分页；搜索覆盖正文、语音补充文字、药名、医院 |
| 附件 | `PUT /attachments/{id}`（multipart）、`PATCH/DELETE`、`GET /file`、`POST /reprocess` | 按文件头识别格式；照片≤9 张/条；语音异步转 m4a；文件支持 Range |
| 报告 | `POST /exports`、`GET /print-data` | Gotenberg 凭 5 分钟 HMAC 打印令牌取数和取图；预览凭登录态 |

## 开发约定

### 通用流程

1. **改接口先改契约**：编辑 `api/openapi.yaml` → `make gen` → 实现 handler → 前端用生成的类型。
2. **改表先写迁移**：在 `db/migrations/` 新增 goose 迁移文件（已发布的迁移不要改），SQL 写在 `db/queries/`，`make gen`。
3. 生成代码（`internal/api`、`internal/store/dbgen`、`web/src/api/schema.d.ts`）提交进仓库，不要手改。

### 后端

- **分层**：handler 只做参数解析和响应组装；业务规则都在 service；service 通过 store 访问数据库，跨表操作的事务由 service 发起。
- **错误**：service 返回 `errs.*`（码 + 中文提示 + 字段），httpx 统一映射成 `{"error":{"code","message","fields"}}`；其他错误一律 500，细节只进日志。
- **校验只在一处**：病程状态合法性、记录类型与字段的对应关系在 service 校验；前端同样校验只为体验。
- **数据隔离**：所有业务表带 `family_id`，sqlc 查询把它作为必填参数，调用方无法漏掉；`apitest` 里有跨家庭访问的测试守着。
- **ID 与幂等**：主键 UUIDv7。记录和附件 ID 由前端生成，用 `PUT /{id}` 创建，重复提交返回 200 和已有资源；并发重复提交在事务内回滚（连同随之新建的病程）。
- **PATCH**：只改出现的字段，可清空的字段传 `null` 清空（生成代码里是 `nullable.Nullable[T]`）。改记录类型时，旧类型专属字段自动清掉。
- **时间**：库里一律 `timestamptz`；“今天”、按天分组、日历统计一律经 `timex`（Asia/Shanghai），不直接用 `time.Now()` 的本地时区。
- **后台任务**：需要在事务提交后做的事（转码、删文件）在同一事务里入队，提交后唤醒 runner；失败按 1/5/30 分钟重试 3 次。
- **日志**：slog JSON 输出到标准输出，访问日志带账号 ID；**不记录请求体、查询串（含打印令牌）和附件内容**。
- **安全**：Cookie `sid`（HttpOnly、Secure、SameSite=Lax，本地 http 开发时关 Secure）；写请求校验 Origin；附件只能经鉴权接口或打印令牌（限定家庭和成员）读取。

### 前端

- 以 1024px（Tailwind `lg`）切换两套外壳；页面数据和逻辑共用，只有布局按端区分（`useIsDesktop`）。手机端全屏页（记一笔等）在路由 `handle` 里设 `hideMobileTabBar`。
- 服务端数据全部走 TanStack Query；保存记录后使首页、病程、待整理相关查询失效。
- 草稿和上传队列存 IndexedDB：**先落本地、再传服务器**，失败在首页提示并重试。
- 颜色、字体只用 `styles/index.css` 里的主题变量，不写裸色值；记录类型配色见 [docs/design.md](docs/design.md)。
- 不引用 Google Fonts（国内不稳定），用系统字体回退。
- 打印页（`/print/*`）无外壳，Gotenberg、导出预览和浏览器打印共用同一份代码：从 `/api/print-data` 取数（URL 带 `token` 时透传），图片 URL 附上同一个 `token`，图表画完后设 `window.__PRINT_READY__ = true`。

### 测试

| 层 | 方式 | 覆盖 |
|---|---|---|
| service | 单元测试（`internal/service/rules_test.go`） | 状态规则与短转长、默认名称与结束日期、第几天与康复提示、类型与字段、补录判断、游标与搜索 |
| API | `internal/apitest`，httptest + 真实 PostgreSQL | 鉴权与限流、CSRF、成员、病程生命周期、记录幂等与校验、分页搜索、批量归入、首页/日历/趋势/按病种、家庭隔离、照片与头像、语音转码、导出与打印令牌 |
| 基础包 | 单元测试 | 存储路径穿越、任务、令牌签名、缩略图与转码、时区 |
| 前端 | Vitest | 录音状态机、上传队列重试（待开发） |
| 真机 | 手动清单 | iOS Safari、安卓 Chrome 上录音、拍照、弱网保存 |

技术方案里 store 层用 testcontainers；这里改为连一个已有的 PostgreSQL（CI 用 service 容器），每个测试建独立 schema，不依赖 Docker-in-Docker。

## 与技术方案的差异

| 方案 | 实际 | 原因 |
|---|---|---|
| 自带 Caddy 容器 | 接入同机 crab 的 Caddy | 两个反代抢 443 会导致 HTTPS 随机失败，见 [deploy/DEPLOY.md](deploy/DEPLOY.md) |
| 国内服务器需备案 1–3 周 | 用 crab 已备案主域名的子域名 | 备案按主域名，技术方案里的这项风险不再存在 |
| `SESSION_SECRET` | 不需要 | 会话令牌是随机值，库里只存哈希，不需要签名密钥 |
| — | 新增 `PRINT_BASE_URL` | Gotenberg 打开打印页的地址（生产 `http://app:8080`，本地为 Vite） |
| 自建 Gotenberg 镜像装中文字体 | 直接用官方镜像 | 官方镜像已含 `fonts-noto-cjk`，省掉服务器上的 apt |
| 一次性打印令牌 | 5 分钟有效的无状态 HMAC 令牌，限定家庭、报告和成员 | 与方案“服务端不存状态”一致，只在有效期内可复用 |
| 接口清单 | 新增 `GET /records/{id}`、`GET /members/{id}/calendar`、`POST /attachments/{id}/reprocess` | 记录详情页、成员主页日历、转码失败“重新处理”按钮 |
| 照片 `storage_key` 为处理后文件 | 照片存缩略图的路径，原图在 `original_key` | 照片前端已压缩，处理后的产物就是缩略图 |
| store 层 testcontainers | 已有 PostgreSQL + 独立 schema | 见上文“测试” |

## 里程碑

按一人全职约 4 周，第 4 周末开始自用试用。

- [ ] **第 1 周**：~~工程骨架、代码生成、登录接口、部署脚本~~（已完成）、上线与 HTTPS、录音真机验证
  - 验收：手机浏览器能登录线上环境；iOS Safari 和安卓 Chrome 录音、上传、转码、回放全部跑通
- [ ] **第 2 周**：~~后端：成员、记录、附件、首页接口~~（已完成）；前端：成员管理、记一笔、上传队列、首页
  - 验收：首页 3 次点击完成一条语音记录；飞行模式下保存，恢复网络后自动上传
- [ ] **第 3 周**：~~后端：病程、待整理、总览、成员主页、搜索接口~~（已完成）；前端对应页面
  - 验收：产品方案的两个典型场景（感冒、腰椎）能完整走通
- [ ] **第 4 周**：~~后端：PDF 导出接口、备份脚本~~（已完成）；前端打印页与导出页、真机回归、细节打磨
  - 验收：两种报告的 PDF 与预览一致，中文和图表正常；备份能恢复

## 待定事项

- [x] ~~服务器与域名~~：与 crab 共用服务器，用其已备案主域名的子域名
- [ ] 预置病种列表：在技术方案示例的基础上补了常见病，先写入 17 个（`db/migrations/00002_preset_disease_tags.sql`），需要增删就加一个新迁移
- [ ] crab 仓库的一次性改动：Caddyfile 加 `import /etc/caddy/sites/*.caddy` 并挂载 `/opt/caddy-sites`（[deploy/DEPLOY.md](deploy/DEPLOY.md) 第 2 节）
- [ ] 设计稿补充：登录页、记录详情与编辑页、手机端成员列表
- [ ] 电脑端“记一笔”是否用弹窗
- [ ] 展示字体 ZCOOL XiaoWei 是否自托管子集

## 部署

与 crab 共用一台服务器，完整步骤和踩坑记录见 **[deploy/DEPLOY.md](deploy/DEPLOY.md)**。简要：

```bash
cd /opt/healthlog
cp .env.example .env && vi .env         # HEALTH_DOMAIN、POSTGRES_PASSWORD、PRINT_TOKEN_SECRET
sudo make docker-init
./scripts/deploy.sh                     # 备份 → 拉代码 → 构建 → 替换 → 写 Caddy 站点 → 自检，失败自动回滚
docker compose exec app healthlog user create --username me
```

应用启动时自动执行迁移。`/healthz` 检查数据库和 Gotenberg 连通性，可接外部拨测。每天凌晨用 `scripts/backup.sh` 备份。

## License

[Apache-2.0](LICENSE)
