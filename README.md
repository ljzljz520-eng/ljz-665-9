# 水厂泵站设备档案管理系统

面向水厂/泵站的设备档案管理：记录**泵站名称、设备编号、功率、安装位置、责任班组、投运日期、运行状态**，
支持扩展技术参数（型号、流量、扬程、转速、电压、电流、厂家、备注）、**附件管理**与**操作日志**，
提供**搜索、分页、详情、新建、编辑、删除**的完整 Web 界面与 REST API。

技术栈：**Node.js + Express + SQL Server（mssql 驱动）+ 原生前端（无构建步骤）**。

## 功能一览

| 模块 | 说明 |
| --- | --- |
| 设备档案 | 泵站名称、设备编号（唯一）、设备名称、型号、功率、流量/扬程/转速/电压/电流、厂家、安装位置、责任班组、投运日期、运行状态（运行/备用/检修/停用）、备注 |
| 搜索 | 关键字（编号/名称/泵站/位置/班组/厂家/型号/备注模糊匹配）+ 泵站名称（带联想）+ 运行状态，条件可组合 |
| 分页 | 页码、首页/上一页/下一页/末页、每页 10/20/50 条、总数与区间显示 |
| 详情 | 分组展示全部字段、附件列表、操作日志时间线 |
| 新增/编辑 | 同一表单弹窗，前后端双重校验，编辑自动记录字段级变更明细 |
| 删除 | 二次确认；附件与日志级联删除 |
| 附件 | 上传（multipart，默认单文件 ≤50MB）、中文名下载（RFC 5987）、删除；文件按 `设备ID/` 分目录落盘 |
| 操作日志 | 新建/编辑/删除/上传附件/删除附件，记录操作人、时间、变更明细；设备删除事件保留全局日志 |
| 概览 | 设备总数、四种状态数量、总功率统计卡片 |

## 快速开始（免数据库演示模式）

```bash
npm install
npm start
# 打开 http://localhost:3000
```

默认使用内存驱动（`DB_DRIVER=memory`），内置 10 条泵站设备演示数据，重启后重置。
该模式用于快速体验与前端联调；**生产部署必须切换为 SQL Server**。

## 生产部署（SQL Server）

详见 **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**（含 Windows/Linux/Docker 三种 SQL Server 配置方式、
TCP/IP 启用、账号授权、环境变量、systemd/PM2、反向代理与排错）。简要步骤：

```bash
# 1) 在 SQL Server 中执行建库脚本（SSMS 或 sqlcmd）
sqlcmd -S localhost -U sa -P '你的密码' -i database/schema.sql

# 2) 配置环境变量
cp .env.example .env
#   编辑 .env：DB_DRIVER=mssql、DB_SERVER/DB_PORT/DB_USER/DB_PASSWORD 等

# 3) 启动
npm start
```

## REST API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/equipment?keyword=&stationName=&status=&page=1&pageSize=10` | 分页搜索 |
| GET | `/api/equipment/:id` | 详情（含 attachments、logs） |
| POST | `/api/equipment` | 新建（JSON） |
| PUT | `/api/equipment/:id` | 编辑（JSON，仅传需改字段） |
| DELETE | `/api/equipment/:id` | 删除（级联附件/日志） |
| GET | `/api/equipment/stations?keyword=` | 泵站名称联想 |
| GET | `/api/equipment/summary` | 状态/功率统计 |
| GET | `/api/equipment/statuses` | 状态枚举 |
| POST | `/api/equipment/:id/attachments` | 上传附件（multipart，字段名 `file`） |
| GET | `/api/attachments/:id/download` | 下载附件 |
| DELETE | `/api/attachments/:id` | 删除附件 |
| GET | `/health` | 健康检查（含当前数据驱动） |

操作人默认取请求头 `X-Operator-Name`（缺省为 `admin`），便于后续接入统一登录。

## 测试

```bash
npm run smoke   # 端到端冒烟测试（内存模式，覆盖搜索/分页/详情/增改删/附件/日志）
```

## 目录结构

```
├── database/schema.sql      # SQL Server 建库建表脚本
├── docs/DEPLOYMENT.md       # 部署说明（重点覆盖 SQL Server 配置）
├── src/
│   ├── config.js            # 环境变量配置
│   ├── server.js            # Express 入口
│   ├── db/mssql-pool.js     # SQL Server 连接池（启动重试）
│   ├── repositories/        # 数据仓储：mssql-repo / memory-repo（同接口可切换）
│   └── routes/              # equipment / attachments 路由
├── public/                  # 原生前端（HTML/CSS/JS，无需构建）
├── uploads/                 # 附件磁盘存储（按设备ID分目录）
└── scripts/smoke-test.js    # 端到端冒烟测试
```
