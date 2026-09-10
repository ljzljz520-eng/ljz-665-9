# 水厂泵站设备档案管理系统

面向水厂泵站的设备档案管理应用，记录 **泵站名称、设备编号、设备名称/型号、功率、安装位置、责任班组、投运日期、运行状态**，支持 **附件管理** 与 **操作日志**，提供搜索、分页、详情、新建/编辑/删除的完整闭环。

- 后端：Node.js + Express + mssql
- 数据库：Microsoft SQL Server（生产）；内置本地 JSON 驱动（免数据库演示）
- 前端：原生 HTML/CSS/JavaScript 单页，无需构建

---

## 一、功能清单

| 模块 | 说明 |
|---|---|
| 档案列表 | 分页（每页 10/20/50、首页/上一页/下一页/末页/跳页） |
| 搜索 | 关键字同时匹配泵站名称、设备编号、设备名称、安装位置、责任班组；状态下拉筛选 |
| 档案详情 | 基本信息、附件列表、最近操作日志 |
| 新建/编辑 | 表单校验（必填、功率数值、日期合法性、编号唯一、投运日期不晚于今天） |
| 删除 | 二次确认；附件文件与记录一并清除，日志保留 |
| 附件 | 上传（≤50MB）、下载（中文文件名）、删除，支持照片/说明书/检修单等任意文件 |
| 操作日志 | 自动记录新建、字段级编辑变更、删除、附件上传/删除；独立“操作日志”页可按设备检索、分页 |
| 操作人 | 右上角可填写操作人，随请求头 `X-Operator` 记入日志（浏览器本地记住） |

运行状态枚举：`运行中 / 停机 / 检修中 / 故障`。

---

## 二、快速开始（免 SQL Server，本地 JSON 模式）

```bash
# 1. 安装依赖（Node.js >= 16）
npm install

# 2.（可选）灌入 25 条演示数据
npm run seed

# 3. 启动
npm start
```

浏览器访问 <http://localhost:3000>。数据保存在 `data/db.json`，上传文件保存在 `uploads/`。

切换到 SQL Server 只需设置环境变量 `DB_DRIVER=mssql` 并配置连接信息（见下文），代码、接口完全一致。

---

## 三、SQL Server 部署说明（生产）

### 3.1 环境要求

- Node.js 16+
- SQL Server 2012 或更高（列表分页使用 `OFFSET/FETCH`）
- SQL Server 启用 TCP/IP 协议，并允许 SQL Server 身份验证登录

### 3.2 创建数据库与表

任选一种方式：

**方式 A：执行建库脚本（推荐）**

用 SSMS 打开并执行 `database/schema.sqlserver.sql`（或命令行）：

```bash
sqlcmd -S localhost -U sa -P 'YourStrong!Passw0rd' -i database/schema.sqlserver.sql
```

脚本会创建数据库 `PumpStationArchive` 及三张表：

| 表 | 用途 |
|---|---|
| `Equipment` | 设备档案主表（设备编号唯一约束） |
| `Attachment` | 附件元数据（外键级联删除，磁盘文件由应用清理） |
| `OperationLog` | 操作日志（删除设备时外键置空，日志保留） |

**方式 B：由应用自动建表**

应用首次启动（`DB_DRIVER=mssql`）时会自动执行幂等的建表/建索引语句，
但 **数据库本身需要提前手工创建**（登录账号需有该库的 DDL 权限，或先用方式 A 建好表）：

```sql
CREATE DATABASE PumpStationArchive;
```

### 3.3 连接配置（环境变量）

复制示例文件并修改：

```bash
cp .env.example .env
```

> 注意：应用不会自动读取 `.env` 文件，请通过系统环境变量、进程管理器（pm2 / systemd 的 `EnvironmentFile`）
> 或 `export $(grep -v '^#' .env | xargs)` 等方式注入。

| 变量 | 说明 | 示例 |
|---|---|---|
| `DB_DRIVER` | 数据库驱动，生产设为 `mssql` | `mssql` |
| `DB_SERVER` | 服务器地址 | `localhost` / `10.0.0.8` / `xxx.database.windows.net` |
| `DB_NAME` | 数据库名 | `PumpStationArchive` |
| `DB_USER` / `DB_PASSWORD` | SQL 认证账号密码 | `sa` |
| `DB_PORT` | 端口（默认实例静态端口，通常 1433） | `1433` |
| `DB_INSTANCE` | 命名实例（与端口**二选一**，配置后端口失效，走 SQL Browser UDP 1434 解析） | `SQLEXPRESS` |
| `DB_ENCRYPT` | 是否加密连接；本地一般 `false`，Azure SQL 必须 `true` | `false` |
| `DB_TRUST_SERVER_CERT` | 是否信任服务器证书（自签名证书场景） | `true` |
| `DB_CONNECT_TIMEOUT` / `DB_REQUEST_TIMEOUT` | 超时（毫秒） | `15000` / `30000` |
| `DB_POOL_MAX` | 连接池最大连接数 | `10` |
| `UPLOAD_DIR` | 附件磁盘目录（默认 `./uploads`） | `/data/pump/uploads` |
| `MAX_UPLOAD_MB` | 单个附件大小上限（MB） | `50` |
| `PORT` | HTTP 监听端口 | `3000` |

### 3.4 三种典型连接场景

```bash
# ① 默认实例 + 1433 端口
export DB_DRIVER=mssql DB_SERVER=10.0.0.8 DB_NAME=PumpStationArchive \
       DB_USER=pumpapp DB_PASSWORD='******' DB_PORT=1433 DB_ENCRYPT=false

# ② 命名实例 SQLEXPRESS（不要同时设置 DB_PORT，需放行 UDP 1434）
export DB_DRIVER=mssql DB_SERVER=10.0.0.8 DB_INSTANCE=SQLEXPRESS \
       DB_NAME=PumpStationArchive DB_USER=pumpapp DB_PASSWORD='******'

# ③ Azure SQL Database
export DB_DRIVER=mssql DB_SERVER=yourserver.database.windows.net \
       DB_NAME=PumpStationArchive DB_USER=pumpapp DB_PASSWORD='******' \
       DB_ENCRYPT=true DB_TRUST_SERVER_CERT=false
```

然后：

```bash
npm run seed     # 可选：演示数据
npm start
```

### 3.5 生产进程管理（可选）

pm2：

```bash
npm i -g pm2
DB_DRIVER=mssql DB_SERVER=... DB_PASSWORD='...' pm2 start server/index.js --name pump-archive
pm2 save && pm2 startup
```

建议把 `uploads/` 放到独立数据盘并纳入备份；`data/db.json` 仅用于 JSON 演示模式。

### 3.6 SQL Server 侧常见问题排查

| 现象 | 处理建议 |
|---|---|
| `Failed to connect to ... 1433` | 用「SQL Server 配置管理器」启用 TCP/IP；确认服务已启动；防火墙放行 1433（命名实例放行 UDP 1434） |
| `Login failed for user 'sa'` | 启用「SQL Server 和 Windows 身份验证模式」，检查账号密码，确认账号有目标库读写权限 |
| 连接被拒绝 / 超时 | 云主机检查安全组；本地检查 SQL Server Browser 服务（命名实例必须启动） |
| `Invalid object name 'dbo.Equipment'` | 未执行建表脚本：执行 `database/schema.sqlserver.sql`，或让有 DDL 权限的账号首次启动自动建表 |
| 证书相关错误 | 自签名证书临时设置 `DB_TRUST_SERVER_CERT=true`；Azure SQL 设置 `DB_ENCRYPT=true` |
| 中文乱码 | 本系统字符列全部使用 `NVARCHAR`，连接无需额外配置；手工插入数据时请加 `N'中文'` 前缀 |
| 端口与实例同时配置 | 二者互斥：设置 `DB_INSTANCE` 后 `DB_PORT` 不生效，请按 3.4 的场景二选一 |

最小权限建议（生产账号）：

```sql
CREATE LOGIN pumpapp WITH PASSWORD = N'YourStrong!Passw0rd';
USE PumpStationArchive;
CREATE USER pumpapp FOR LOGIN pumpapp;
ALTER ROLE db_datareader ADD MEMBER pumpapp;
ALTER ROLE db_datawriter ADD MEMBER pumpapp;
-- 若希望应用自动建表/升级，再授予 DDL（否则请用 schema 脚本预先建表）：
-- ALTER ROLE db_ddladmin ADD MEMBER pumpapp;
```

---

## 四、HTTP 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（返回当前数据库驱动） |
| GET | `/api/equipment?keyword=&status=&page=&pageSize=` | 分页搜索 |
| GET | `/api/equipment/meta/statuses` | 状态枚举 |
| GET | `/api/equipment/:id` | 详情（含附件、最近日志） |
| POST | `/api/equipment` | 新建（JSON） |
| PUT | `/api/equipment/:id` | 编辑（JSON，自动生成字段变更日志） |
| DELETE | `/api/equipment/:id` | 删除 |
| GET | `/api/equipment/:id/attachments` | 附件列表 |
| POST | `/api/equipment/:id/attachments` | 上传附件（`multipart/form-data`，字段 `file`） |
| GET | `/api/equipment/:id/attachments/:aid/download` | 下载附件 |
| DELETE | `/api/equipment/:id/attachments/:aid` | 删除附件 |
| GET | `/api/logs?equipmentId=&page=&pageSize=` | 操作日志分页 |

所有写接口可通过请求头 `X-Operator` 指定操作人（默认 `admin`）。统一响应：`{ code: 0, data, message }`，`code=1` 表示业务错误。

### curl 示例

```bash
# 新建
curl -X POST http://localhost:3000/api/equipment \
  -H 'Content-Type: application/json' -H 'X-Operator: zhangsan' \
  -d '{"stationName":"第一水厂取水泵站","equipmentCode":"BZ-01-009","powerKw":90,
       "installLocation":"取水泵房3号机位","teamName":"机电一班",
       "commissionDate":"2024-05-01","status":"运行中","remark":""}'

# 搜索 + 分页
curl 'http://localhost:3000/api/equipment?keyword=%E6%B3%B5%E7%AB%99&status=%E8%BF%90%E8%A1%8C%E4%B8%AD&page=1&pageSize=10'

# 上传附件
curl -X POST http://localhost:3000/api/equipment/1/attachments \
  -H 'X-Operator: zhangsan' -F 'file=@/path/to/铭牌.jpg'
```

---

## 五、目录结构

```
.
├── server/
│   ├── index.js            # Express 入口
│   ├── config.js           # 环境变量配置
│   ├── constants.js        # 状态枚举/字段中文名
│   ├── util.js             # 校验、操作人、字段 diff
│   ├── seed.js             # 演示数据
│   ├── db/
│   │   ├── index.js        # 按 DB_DRIVER 选择驱动
│   │   ├── mssql.js        # SQL Server 驱动（参数化查询）
│   │   └── jsondb.js       # 本地 JSON 驱动（演示）
│   └── routes/
│       ├── equipment.js    # 档案 CRUD
│       ├── attachments.js  # 附件上传/下载/删除
│       └── logs.js         # 操作日志
├── public/                 # 前端单页（index.html / styles.css / app.js）
├── database/
│   └── schema.sqlserver.sql# SQL Server 建库建表脚本
├── uploads/                # 附件磁盘存储（运行时生成）
├── data/db.json            # JSON 模式数据（运行时生成）
├── .env.example
└── package.json
```
