# Home Dashboard

面向公司员工的 Home Assistant 办公环境看板。员工打开用户域名即可查看和控制看板中允许的设备，不需要知道 Home Assistant 地址，也不会接触长期访问令牌。

## 安全架构

- 内网部署时浏览器只连接本系统的 HTTP/WS 同源接口；如将来接入 WAF 或 HTTPS，可再切换为 HTTPS/WSS。
- HA 地址与长期令牌只保存在服务端 secret 文件中。
- Node 后端代替浏览器连接 Home Assistant，并过滤实体状态和 WebSocket 命令。
- 普通员工只能看到看板配置中的实体，只能调用空调、窗帘和相关挡位服务。
- 管理员登录由服务端验证，密码使用 scrypt 哈希，不打包进前端。
- `/api/config` 只有管理员 HttpOnly 会话携带正确 CSRF token 才能写入。
- Docker 部署通过 Traefik 接入内网；如需限制来源网络，请在 Traefik 或防火墙侧配置。
- 容器以非 root 用户运行，不公开宿主机端口，并启用只读根文件系统和最小 Linux capabilities。

## 功能

- 多区域、区域块和设备卡片管理。
- 空调、传感器、窗帘/窗户和通用实体卡片。
- 实时状态、自动重连和传感器 24 小时趋势。
- 用户页 `/` 允许员工查看和控制设备，但不能编辑布局。
- 管理页 `/management` 登录后可以编辑区域、设备和布局。
- 管理员可在管理页创建和维护设备定时开关规则；规则通过 Home Assistant 原生配置 API 保存并由 HA 执行，员工页不可见。
- 配置统一保存在 PostgreSQL；首次初始化数据库时会自动导入 `data/import-config.json`。管理页「设置 → 数据库连接」可测试并切换数据库；凭据仅保存于服务端，不会返回密码。未配置数据库时服务仍会启动并显示管理员配置向导。
- PostgreSQL 连接参数与密码分开保存：`data/postgres-connection.json` 不包含密码，密码存于受保护的 `data/postgres-connection-password` 文件；数据库结构通过版本化迁移自动升级。

## 项目结构

```text
server/            Node 安全后端（同源托管前端产物 + API/WS 代理）
  index.mjs          HTTP/WS 入口、路由、IP 白名单、数据库引导
  ha-proxy.mjs       HA WebSocket 代理：实体白名单过滤 + 命令白名单
  security.mjs       管理员认证（scrypt）、会话签名 Cookie、CSRF、Origin 校验
  validation.mjs     /api/config 写入的配置结构校验
  db.mjs             PostgreSQL 连接、版本化迁移、看板配置读写
  hash-password.mjs  生成管理员密码哈希的 CLI（npm run password:hash）
src/               React 19 + TypeScript 前端
  components/        看板/管理页组件（cards/ 为各类设备卡片）
  lib/               配置同步、自动化规则、会话、类型定义等
  config/            看板默认配置与设备类型定义
  ha/                home-assistant-js-websocket 连接封装
test/              node --test 测试：API 白名单行为、配置校验
secrets/           机密文件（git 忽略，仅保留 .gitkeep）
data/              非机密运行时数据（git 忽略）
```

## 本地开发

生产/预览由 Node 在 `5174` 同时托管前端和安全后端：

```bash
npm install
npm run build
npm run serve
```

`npm run dev` 启动 Vite 开发服务器（默认 5173），并将 `/api` 与 WebSocket 代理到 5174；完整同源运行请使用 `npm run serve`。

开发环境使用 `data/hass-url.txt` 提供 HA 地址，Token 使用 `secrets/ha-token`；管理员密码和会话密钥分别使用 `secrets/admin-password-hash`、`secrets/session-secret`。

数据库无需手工导出环境变量：非生产模式下若未配置 `PGHOST`，服务会自动尝试用 `secrets/postgres-password` 连接本机 `127.0.0.1:5432` 的 PostgreSQL（如 `docker compose up -d dashboard-postgres` 启动的容器）。

### secrets/ 文件的两种用途

`secrets/` 目录下的文件同时服务于本地开发和 Docker 部署，但读取方式不同：

- **本地开发**：Node 进程直接按默认路径读取 `secrets/ha-token`、`secrets/admin-password-hash`、`secrets/session-secret`、`secrets/postgres-password`。
- **Docker 部署**：`docker-compose.yml` 的 `secrets:` 段将同一批文件挂载为 Docker secrets，出现在容器内的 `/run/secrets/`（只读内存挂载，不进入镜像层）；服务端通过 `HASS_TOKEN_FILE`、`ADMIN_PASSWORD_HASH_FILE` 等 `*_FILE` 环境变量指向这些路径读取。

因此部署章节创建的 secret 文件与本地开发用的是同一套约定，`secrets/` 整个目录都不应提交到代码仓库或打入备份压缩包。

## 内网部署

### 1. 创建 secret 文件

```bash
mkdir -p secrets
printf '%s' '新的HA长期令牌' > secrets/ha-token
printf '%s' '足够长的随机会话密钥' > secrets/session-secret
npm run --silent password:hash -- '至少12位的管理员强密码' > secrets/admin-password-hash
openssl rand -base64 32 > secrets/postgres-password
chmod 600 secrets/*
```

这四个文件对应 `docker-compose.yml` 中的四个 Docker secrets（`ha_token`、`session_secret`、`admin_password_hash`、`postgres_password`），缺一不可，否则 compose 启动会报 secret 文件不存在。

此前在 `/api/hass`、日志或聊天记录中出现过的旧 HA 令牌必须先在 Home Assistant 中撤销，再创建新的专用令牌。建议使用专门的非管理员 HA 用户生成令牌。

### 2. 配置地址和域名

将 Home Assistant 地址写入 `data/hass-url.txt`，例如：

```text
https://ha.seeed.cc
```

服务器域名和 Traefik entrypoint 直接配置在 `docker-compose.yml` 的 labels 中。当前使用
`dashboard.seeed.cc` 和 `ha`，部署时如有不同可直接修改该文件，不需要额外配置文件。

如果使用内网域名，看板和 Home Assistant 应使用不同域名：

```text
dashboard.seeed.cc → 本看板
ha.seeed.cc        → Home Assistant
```

不要让两个系统共用同一个 Host，否则 `/api/config`、`/api/websocket` 等路径容易路由冲突。

若员工在外网办公，应通过公司 VPN、零信任网关或身份访问代理进入，不建议直接向整个互联网开放设备控制入口。

### 3. 启动

```bash
docker network create proxy 2>/dev/null || true
docker compose up -d --build
```

Compose 默认假设 Traefik 已连接名为 `proxy` 的 external Docker 网络，并监听 `ha` entrypoint（HTTP :5174）。服务本身只使用 `expose: 5174`，不会通过宿主机端口绕过 Traefik。

访问地址：

```text
员工看板：http://dashboard.seeed.cc/
管理页面：http://dashboard.seeed.cc/management
```

## 环境变量参考

机密类变量均支持两种形式：`*_FILE` 指向文件路径（优先），或直接传值；Docker 部署统一使用 `*_FILE` 指向 `/run/secrets/`。

### 服务与安全

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5174` | HTTP/WebSocket 监听端口 |
| `NODE_ENV` | — | `production` 时启用生产校验（必须配置 `ADMIN_USERNAME`、管理员密码哈希等），且不再回退连接本机数据库 |
| `TRUST_PROXY` | `false` | `true` 时信任反向代理转发的 `X-Forwarded-For/Proto/Host`；位于 Traefik 之后必须开启 |
| `APP_ORIGIN` | 空 | 浏览器访问看板的预期 Origin（如 `http://dashboard.seeed.cc`），用于同源/CSRF 校验和 Secure Cookie 判定 |
| `COOKIE_SECURE` | `false` | HTTPS 部署时设为 `true`，为会话 Cookie 添加 Secure 属性 |
| `ALLOWED_IP_CIDRS` | 空（不限制） | 逗号分隔的 IPv4 CIDR 白名单（如 `10.0.0.0/8,192.168.1.0/24`），限制所有 HTTP/WS 访问来源 |
| `ADMIN_USERNAME` | `admin` | 管理员登录用户名 |
| `ADMIN_PASSWORD_HASH` / `ADMIN_PASSWORD_HASH_FILE` | `secrets/admin-password-hash` | 管理员 scrypt 密码哈希 |
| `SESSION_SECRET` / `SESSION_SECRET_FILE` | `secrets/session-secret` | 会话签名密钥；未配置时每次启动随机生成，重启后所有管理会话失效 |
| `SESSION_TTL_SECONDS` | `28800`（8 小时） | 管理会话有效期 |

### Home Assistant 连接

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HASS_URL` / `HASS_URL_FILE` | `data/hass-url.txt` | HA 地址；环境变量优先于文件 |
| `HASS_TOKEN` / `HASS_TOKEN_FILE` | `secrets/ha-token` | HA 长期令牌；文件优先于环境变量 |
| `HA_EXTRA_ENTITIES` | 空 | 逗号分隔的额外实体 ID，加入员工连接的允许范围（用于卡片关联的辅助实体） |
| `ALLOW_INSECURE_HASS` | — | `true` 时允许通过明文 HTTP 连接非内网地址的 HA；默认拒绝 |

### PostgreSQL

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PGHOST` / `PGPORT` | — / `5432` | 环境级数据库地址；`PGHOST` 与密码同时存在时优先于管理页保存的连接 |
| `PGDATABASE` / `PGUSER` | `ha_dashboard` | 数据库名与用户 |
| `PGPASSWORD` / `PGPASSWORD_FILE` | — | 环境级数据库密码 |
| `PGSSLMODE` | — | `require` 时对数据库连接启用 TLS |
| `DB_CONNECTION_FILE` | `data/postgres-connection.json` | 管理页「设置 → 数据库连接」保存的连接参数（不含密码） |
| `DB_PASSWORD_FILE` | `data/postgres-connection-password` | 上述连接的密码文件 |
| `CONFIG_IMPORT_FILE` | `data/import-config.json` | 首次初始化空数据库时自动导入的看板配置 |

数据库连接优先级：管理页保存的连接（`DB_CONNECTION_FILE`）→ 环境级 `PGHOST`/密码 → 非生产模式下用 `secrets/postgres-password` 连接本机 `127.0.0.1:5432` → 均未配置时进入管理员配置向导。

## Traefik 要求

- 必须保留原始 `Host`、`Origin`、`X-Forwarded-For`、`X-Forwarded-Proto`。
- 必须支持 WebSocket Upgrade，Traefik 默认支持。
- 当前内网模式使用 HTTP；服务端会根据浏览器请求的同源信息校验 Origin。如果将来改为 HTTPS，需要同步启用 Secure Cookie。
- 不要额外公开容器端口 `5174`。
- WAF 重新上线后，应继续保留公司网络/IP 或企业身份认证限制。

## HA WebSocket 代理允许范围

员工连接仅允许：

- 配置中实体的实时状态订阅；
- 配置中传感器的历史查询；
- 空调设置温度、模式和风速；
- 窗帘/窗户开、停、关和位置设置；
- 明确加入 `HA_EXTRA_ENTITIES` 的关联实体。

其他 HA WebSocket 命令和不在看板白名单中的实体会被服务端拒绝。管理员会话可以读取实体注册表以便选择设备，但仍不能通过代理执行未列入允许范围的 HA 服务。

## 数据与备份

- 共享看板布局：PostgreSQL（Docker Compose 默认）。`data/import-config.json` 仅用于首次数据库初始化导入；浏览器不再作为业务配置存储。
- Home Assistant 自动化配置存储：管理员创建的看板自动化规则（带有 `[Seeed 看板自动化]` 标记）。
- `secrets/ha-token`：HA 长期令牌，只读挂载。
- `secrets/admin-password-hash`：管理员 scrypt 密码哈希。
- `secrets/session-secret`：管理会话签名密钥。
- `secrets/postgres-password`：PostgreSQL 数据库密码。

备份配置时不要把 `secrets/` 打入普通压缩包或上传代码仓库。若 secret 曾经泄露，应撤销/轮换，而不是只删除文件。

## 验证

```bash
npm run build
npm run lint
npm test
npm audit
docker compose config
```

当前技术栈：React 19、TypeScript、Vite、Node.js、`home-assistant-js-websocket` 和 `ws`。
