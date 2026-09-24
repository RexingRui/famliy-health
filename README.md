# 家庭健康管理（healthlog）

记录家人从生病到康复全过程的工具：**手机随手记，电脑汇总看，一键导出 PDF 报告。**

家庭自用的病程记录本，不做问诊，不给医疗建议。核心价值是：就诊时病史讲得清，复诊时有据可查，报销时材料齐全。

> 当前状态：**工程骨架已搭好，业务功能尚未开发。** 后端只有 `/healthz`，前端各路由是占位页。按下方「里程碑」推进。

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
| 媒体 / PDF | ffmpeg（语音转 AAC m4a）、Gotenberg（无头 Chromium，内置中文字体） |
| 部署 | docker compose：Caddy（自动 HTTPS）+ app + postgres + gotenberg，一台 2 核 4 GB |

前端构建产物通过 `go:embed` 编进后端二进制，前后端同域。`/api/*` 走接口，其余路径返回前端 `index.html`。

## 目录结构

```
api/
  openapi.yaml            接口契约，唯一事实来源
  oapi-codegen.yaml       Go 代码生成配置
cmd/healthlog/            main：serve、migrate、user create 子命令
internal/
  api/                    [生成] oapi-codegen 输出
  httpx/                  chi 路由、中间件（请求日志、恢复、Origin 校验）、SPA 静态文件、统一错误
  handler/                实现生成的 StrictServerInterface，只做参数解析和响应组装
  service/                业务规则：状态流转、默认病程、批量归入、校验
  store/                  连接池、迁移；repository 封装（统一带 family_id）
    dbgen/                [生成] sqlc 输出
  storage/                Storage 接口，本期实现本地磁盘
  media/                  ffmpeg 转码、缩略图
  report/                 打印令牌、Gotenberg 客户端、报告数据组装
  jobs/                   任务表轮询和执行
  auth/                   密码、会话
  config/                 环境变量
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
deploy/                   Dockerfile、docker-compose（生产 / 开发）、Caddyfile、Gotenberg 镜像
docs/                     产品方案、技术方案、设计要点
Makefile                  gen、dev、test、lint、build
```

`internal/http` 在技术方案里的目录名改为 `internal/httpx`，避免与标准库 `net/http` 重名。

## 快速开始

依赖：Go 1.26+、Node 22+、Docker（跑 PostgreSQL 和 Gotenberg）、[sqlc](https://docs.sqlc.dev)（仅改 SQL 时需要，`go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1`）。oapi-codegen 和 air 已作为 Go tool 固定在 `go.mod` 中，无需单独安装。

```bash
cp .env.example .env          # 按需修改；SESSION_SECRET 等用 openssl rand -hex 32 生成
cd web && npm install && cd ..
make dev                      # 起 postgres + gotenberg，后端 air 热重载（:8080），前端 Vite（:5173）
```

打开 http://localhost:5173 。Vite 把 `/api` 和 `/healthz` 代理到后端。手机真机调试录音需要 HTTPS，可用 mkcert 生成本地证书或内网穿透。

| 命令 | 作用 |
|---|---|
| `make gen` | 重新生成 sqlc、oapi-codegen、openapi-typescript 代码 |
| `make dev` / `make dev-down` | 启动 / 停止本地开发环境 |
| `make test` | `go test ./...` + Vitest |
| `make lint` | `go vet` + gofmt + oxlint + `tsc` |
| `make build` | 构建前端并编译带前端的 `bin/healthlog` |
| `make docker-build` | 构建生产镜像 |
| `healthlog migrate` | 只执行数据库迁移 |

CI（`.github/workflows/ci.yml`）跑后端检查、前端检查，并校验生成代码与提交内容一致。

## 开发约定

### 通用流程

1. **改接口先改契约**：编辑 `api/openapi.yaml` → `make gen` → 实现 handler → 前端用生成的类型。
2. **改表先写迁移**：在 `db/migrations/` 新增 goose 迁移文件（已发布的迁移不要改），SQL 写在 `db/queries/`，`make gen`。
3. 生成代码（`internal/api`、`internal/store/dbgen`、`web/src/api/schema.d.ts`）提交进仓库，不要手改。

### 后端

- **分层**：handler 只做参数解析和响应组装；业务规则都在 service；service 通过 store 访问数据库，跨表操作的事务由 service 发起。
- **校验只在一处**：病程状态合法性、记录类型与字段的对应关系在 service 校验；前端同样校验只为体验。
- **数据隔离**：所有业务表带 `family_id`，所有查询都带家庭条件，在 repository 层统一加。
- **ID 与幂等**：主键 UUIDv7。记录和附件 ID 由前端生成，用 `PUT /{id}` 创建，重复提交返回已有资源。
- **时间**：库里一律 `timestamptz`；按天分组、日历统计按 `Asia/Shanghai` 计算。
- **错误**：统一 `{"error":{"code","message","fields"}}`（`httpx.WriteError`），状态码按语义用 400/401/404/409/413/422。
- **日志**：slog JSON 输出到标准输出；**不记录记录正文和附件内容**。
- **安全**：Cookie `sid`（HttpOnly、Secure、SameSite=Lax）；写请求校验 Origin（已实现）；附件只能经鉴权接口读取。

### 前端

- 以 1024px（Tailwind `lg`）切换两套外壳；页面数据和逻辑共用，只有布局按端区分（`useIsDesktop`）。手机端全屏页（记一笔等）在路由 `handle` 里设 `hideMobileTabBar`。
- 服务端数据全部走 TanStack Query；保存记录后使首页、病程、待整理相关查询失效。
- 草稿和上传队列存 IndexedDB：**先落本地、再传服务器**，失败在首页提示并重试。
- 颜色、字体只用 `styles/index.css` 里的主题变量，不写裸色值；记录类型配色见 [docs/design.md](docs/design.md)。
- 不引用 Google Fonts（国内不稳定），用系统字体回退。
- 打印页（`/print/*`）无外壳，Gotenberg、导出预览和浏览器打印共用同一份代码。

### 测试重点

| 层 | 方式 | 重点 |
|---|---|---|
| service | 单元测试 | 状态流转、默认病程规则、补录判断、批量归入 |
| store | testcontainers + 真实 PostgreSQL | family_id 隔离、级联删除 |
| API | httptest | 幂等创建、鉴权、错误格式 |
| 前端 | Vitest | 录音状态机、上传队列重试 |
| 真机 | 手动清单 | iOS Safari、安卓 Chrome 上录音、拍照、弱网保存 |

## 里程碑

按一人全职约 4 周，第 4 周末开始自用试用。

- [ ] **第 1 周**：~~工程骨架、代码生成~~（已完成）、登录、线上部署和 HTTPS、录音技术验证
  - 验收：手机浏览器能登录线上环境；iOS Safari 和安卓 Chrome 录音、上传、转码、回放全部跑通
- [ ] **第 2 周**：成员管理、记一笔（文字、录音、照片、类型字段、病程选择）、上传队列、首页
  - 验收：首页 3 次点击完成一条语音记录；飞行模式下保存，恢复网络后自动上传
- [ ] **第 3 周**：病程管理与状态流转、病程详情三种视图、待整理、家庭总览、成员主页、搜索
  - 验收：产品方案的两个典型场景（感冒、腰椎）能完整走通
- [ ] **第 4 周**：PDF 导出和打印、备份脚本、真机回归、细节打磨
  - 验收：两种报告的 PDF 与预览一致，中文和图表正常；备份能恢复

## 待定事项

- [ ] 服务器与域名：国内服务器并备案（1–3 周），还是先用香港服务器
- [ ] 预置病种列表（如感冒、发烧、肠胃炎、支原体肺炎、哮喘、过敏性鼻炎、高血压），确定后写成数据迁移
- [ ] 设计稿补充：登录页、记录详情与编辑页、手机端成员列表
- [ ] 电脑端“记一笔”是否用弹窗
- [ ] 展示字体 ZCOOL XiaoWei 是否自托管子集

## 部署

```bash
cp .env.example .env    # 填 DOMAIN、POSTGRES_PASSWORD、SESSION_SECRET、PRINT_TOKEN_SECRET
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
docker compose -f deploy/docker-compose.yml exec app healthlog user create --username me   # 待实现
```

应用启动时自动执行迁移。`/healthz` 检查数据库和 Gotenberg 连通性，可接外部拨测。备份（每日 `pg_dump` + 附件增量，加密后异地存储）在第 4 周实现。

## License

[Apache-2.0](LICENSE)
