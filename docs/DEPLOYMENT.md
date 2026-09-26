# 部署说明 —— 水厂泵站设备档案管理系统

本文档覆盖：运行环境要求、**SQL Server 安装与配置（Windows / Linux / Docker）**、建库、
应用部署（直接运行 / PM2 / systemd / Nginx 反向代理）、附件目录规划、备份与常见问题排错。

---

## 1. 环境要求

| 组件 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | >= 18（推荐 20 LTS 或 22 LTS） | 仅使用 Node 内置能力与少量 npm 依赖 |
| SQL Server | 2014 及以上（推荐 2019 / 2022） | 分页使用 `OFFSET ... FETCH`（2012+ 即支持）；也支持 Azure SQL Database |
| npm | 随 Node 安装 | 安装依赖用 |
| 操作系统 | Windows / Linux（CentOS、Ubuntu、统信、麒麟等） | 均提供部署方式 |

依赖包：`express`（Web 框架）、`mssql`（SQL Server 官方风格 TDS 驱动 tedious）、
`multer`（文件上传）、`dotenv`（环境变量）。

---

## 2. SQL Server 配置（重点）

### 2.1 方式 A：Windows 上安装 SQL Server

1. 安装 **SQL Server 2019/2022 Express（免费）或标准版**，安装时身份验证模式选择
   **"混合模式（SQL Server 身份验证和 Windows 身份验证）"**，并为 `sa` 设置强密码。
   - 若安装时选了"仅 Windows 身份验证"，可用 SSMS 以 Windows 管理员登录后改为混合模式：
     服务器右键 → 属性 → 安全性 → "SQL Server 和 Windows 身份验证模式" → 确定后重启 SQL Server 服务。
     再于 安全性 → 登录名 → `sa` → 属性 中设置密码并"授予连接/启用登录"。
2. **启用 TCP/IP 协议（关键，默认常被禁用）**：
   - 打开 **SQL Server Configuration Manager**（配置管理器）；
   - 左侧选择 "SQL Server 网络配置" → 实例名（如 `SQLEXPRESS` 的协议）；
   - 右侧双击 **TCP/IP** → 选"是"启用；
   - 切换到"IP 地址"选项卡，拉到最底部 **IPAll**：
     - 默认实例（MSSQLSERVER）：TCP 端口填 `1433`；
     - 命名实例（如 SQLEXPRESS）：可清空"TCP 动态端口"并把 TCP 端口固定为 `1433`，
       或记录动态端口号；本应用支持用 `DB_INSTANCE_NAME=SQLEXPRESS` 连接命名实例。
   - 确定后，在"SQL Server 服务"中**重启 SQL Server 服务**使配置生效。
3. **放行防火墙 1433 端口**（应用与数据库不同机时需要）：
   ```powershell
   New-NetFirewallRule -DisplayName "SQL Server 1433" -Direction Inbound -Protocol TCP -LocalPort 1433 -Action Allow
   ```
4. 远程连接还需确认 SQL Server 允许远程连接：SSMS → 服务器属性 → 连接 →
   勾选"允许远程连接到此服务器"。

### 2.2 方式 B：Linux 上安装 SQL Server（RHEL / Ubuntu 等）

以 Ubuntu 22.04 为例（其余发行版参考微软官方文档）：

```bash
# 导入公共仓库 GPG 密钥并注册仓库（2022 示例）
curl https://packages.microsoft.com/keys/microsoft.asc | sudo tee /etc/apt/trusted.gpg.d/microsoft.asc
sudo add-apt-repository "$(wget -qO- https://packages.microsoft.com/config/ubuntu/22.04/mssql-server-2022.list)"
sudo apt-get update
sudo apt-get install -y mssql-server

# 初始化：选择版本（Express/Developer/Standard）并设置 sa 密码
sudo /opt/mssql/bin/mssql-conf setup

# 确认服务状态（默认监听 1433，Linux 上 TCP/IP 默认启用）
systemctl status mssql-server --no-pager

# 防火墙
sudo ufw allow 1433/tcp     # 或 firewall-cmd --add-port=1433/tcp --permanent && firewall-cmd --reload
```

sa 密码要求：至少 8 位，包含大写、小写、数字、符号中的三类。

### 2.3 方式 C：Docker 运行 SQL Server（最快，适合测试/容器化部署）

```bash
docker run -d \
  --name mssql \
  --restart=always \
  -e "ACCEPT_EULA=Y" \
  -e "MSSQL_SA_PASSWORD=Your_strong_Password123!" \
  -e "MSSQL_PID=Express" \
  -p 1433:1433 \
  -v mssql-data:/var/opt/mssql \
  mcr.microsoft.com/mssql/server:2022-latest

# 查看启动日志，确认无错误
docker logs mssql
```

> SQL Server 2019+ 在 Linux/容器上默认对连接启用 TLS，自签证书场景
> 应用侧设置 `DB_TRUST_SERVER_CERT=true`（本项目默认即 true）即可。

### 2.4 执行建库脚本

项目已提供 `database/schema.sql`（创建库 `PumpStationDB` 及
`equipment` / `attachment` / `operation_log` 三张表、唯一约束、外键级联、索引与 CHECK 约束）。

**方式一：SSMS（图形化）**
连接到实例 → 文件 → 打开 → 选择 `database/schema.sql` → 执行（F5）。
消息窗口出现"命令已成功完成"，对象资源管理器刷新可见三张表。

**方式二：sqlcmd 命令行（Windows）**
```powershell
# 默认实例
sqlcmd -S localhost -U sa -P "Your_strong_Password123!" -i database\schema.sql

# 命名实例 SQLEXPRESS
sqlcmd -S localhost\SQLEXPRESS -U sa -P "Your_strong_Password123!" -i database\schema.sql
```

**方式三：容器内 sqlcmd**
```bash
# 较新镜像
docker exec -i mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa \
  -P "Your_strong_Password123!" -i - < database/schema.sql
# 旧版工具路径为 /opt/mssql-tools/bin/sqlcmd，且无需 -C
```

**校验建表结果：**
```bash
sqlcmd -S localhost -U sa -P "密码" -d PumpStationDB -Q \
"SELECT name FROM sys.tables ORDER BY name;"
# 预期输出：attachment / equipment / operation_log
```

### 2.5 （推荐，生产）使用最小权限账号而非 sa

```sql
USE PumpStationDB;
CREATE LOGIN pump_app WITH PASSWORD = N'Another_Strong_Pwd_2026!',
    CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
CREATE USER pump_app FOR LOGIN pump_app;

-- 仅授予应用所需的 DML 权限（不给建表/删表权限）
ALTER ROLE db_datareader ADD MEMBER pump_app;
ALTER ROLE db_datawriter ADD MEMBER pump_app;
```
随后在 `.env` 中使用 `DB_USER=pump_app`。

### 2.6 应用侧连接参数对照（.env）

| 环境变量 | 说明 | 典型值 |
| --- | --- | --- |
| `DB_DRIVER` | 数据驱动，生产必须为 `mssql` | `mssql` |
| `DB_SERVER` | 数据库主机 | `localhost` / `10.0.0.20` / `db.internal` |
| `DB_PORT` | 端口 | 默认实例 `1433` |
| `DB_INSTANCE_NAME` | 命名实例名（与端口二选一） | `SQLEXPRESS` |
| `DB_DATABASE` | 库名 | `PumpStationDB` |
| `DB_USER` / `DB_PASSWORD` | SQL 账号 | 建议用 2.5 节的最小权限账号 |
| `DB_ENCRYPT` | 连接加密 | Azure SQL 必须 `true`；本地可 `true` |
| `DB_TRUST_SERVER_CERT` | 信任自签证书 | 自签证书设 `true`；有受信证书设 `false` |
| `DB_CONNECT_RETRIES` | 启动连接重试次数（间隔 2s） | `10`（容器编排等待数据库时很有用） |
| `DB_POOL_MAX` 等 | 连接池大小 | 按并发量调整 |

连接排错速查：
- `ECONNREFUSED 127.0.0.1:1433` → SQL Server 未启动 / TCP 未启用 / 端口不对；
- `Login failed for user 'sa'` → 账号密码错误，或实例为"仅 Windows 验证"；
- `Login timeout expired` → 防火墙未放行、远程连接未允许、或端口错误；
- 证书相关报错（`self signed certificate`）→ 设置 `DB_TRUST_SERVER_CERT=true`；
- 连命名实例失败 → 确认 SQL Browser 服务已启动（UDP 1434），或直接填固定 TCP 端口。

---

## 3. 应用部署

### 3.1 准备与配置

```bash
# 获取代码后进入目录
npm ci            # 或 npm install

cp .env.example .env
```

编辑 `.env`（最小生产配置示例）：

```ini
PORT=3000
DB_DRIVER=mssql
DB_SERVER=localhost
DB_PORT=1433
DB_DATABASE=PumpStationDB
DB_USER=pump_app
DB_PASSWORD=Another_Strong_Pwd_2026!
DB_ENCRYPT=true
DB_TRUST_SERVER_CERT=true
MAX_UPLOAD_MB=50
# UPLOAD_DIR=/data/pump-archive/uploads
```

启动验证：
```bash
npm start
curl http://localhost:3000/health
# {"code":0,"data":{"status":"ok","driver":"mssql",...}}
```

### 3.2 Linux：使用 PM2 常驻（推荐）

```bash
sudo npm install -g pm2
pm2 start src/server.js --name pump-archive
pm2 save
pm2 startup        # 按提示执行生成的开机自启命令
pm2 logs pump-archive
```

### 3.3 Linux：使用 systemd（无额外组件）

创建 `/etc/systemd/system/pump-archive.service`：

```ini
[Unit]
Description=Pump Station Equipment Archive
After=network.target mssql-server.service
Wants=mssql-server.service

[Service]
Type=simple
User=pumpapp
WorkingDirectory=/opt/pump-archive
EnvironmentFile=/opt/pump-archive/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin pumpapp
sudo chown -R pumpapp:pumpapp /opt/pump-archive
sudo systemctl daemon-reload
sudo systemctl enable --now pump-archive
sudo systemctl status pump-archive
```

### 3.4 Windows：常驻运行

生产可选 [node-windows](https://github.com/coreybutler/node-windows) 将应用注册为 Windows 服务；
简单场景也可用"任务计划程序 → 开机触发 → `node src\server.js`"或 PM2 (`pm2-windows-startup`)。

### 3.5 Nginx 反向代理（可选，建议生产启用 HTTPS）

```nginx
server {
    listen 80;
    server_name pump-archive.example.com;

    client_max_body_size 60m;   # 需略大于应用侧 MAX_UPLOAD_MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```
再用 certbot 等配置 HTTPS 证书。IIS 也可用 Application Request Routing 做同类反向代理。

---

## 4. 附件存储与备份

- 附件**文件本身保存在磁盘**（默认 `./uploads/设备ID/文件名`），元数据保存在 `attachment` 表。
- 生产建议将 `UPLOAD_DIR` 指向独立数据盘，例如 `/data/pump-archive/uploads`：
  ```bash
  sudo mkdir -p /data/pump-archive/uploads
  sudo chown pumpapp:pumpapp /data/pump-archive/uploads
  ```
- **备份必须同时覆盖数据库与文件目录**，二者缺一不可：

```bash
# 数据库全量备份（SQL Server 代理作业或定时脚本）
sqlcmd -S localhost -U sa -P "密码" -Q "
BACKUP DATABASE PumpStationDB
TO DISK = N'/var/opt/mssql/backup/PumpStationDB.bak'
WITH FORMAT, INIT, COMPRESSION, STATS = 10;"

# 附件目录打包备份
tar -czf /backup/uploads-$(date +%F).tar.gz /data/pump-archive/uploads
```
恢复时先还原数据库，再把附件目录还原到 `UPLOAD_DIR` 对应位置并保持属主/权限。

---

## 5. 升级与维护

```bash
git pull            # 或更新发布包
npm ci --omit=dev
pm2 restart pump-archive      # systemd 则：sudo systemctl restart pump-archive
```
`database/schema.sql` 采用 `IF ... IS NULL` 幂等写法，重复执行不会删除已有数据；
后续表结构变更请另行编写增量迁移脚本，不要直接改历史记录。

日志查看：
- PM2：`pm2 logs pump-archive`
- systemd：`journalctl -u pump-archive -f`

---

## 6. 常见问题（FAQ）

1. **页面能打开但列表转圈/报错**
   访问 `/health` 查看 `driver`；若为 `mssql` 且服务日志有连接报错，按 2.6 节排查。

2. **中文在库里显示为 `?`**
   本脚本所有中文列均为 `NVARCHAR`，查询参数由驱动以 Unicode 传递。
   若手工用 sqlcmd 执行含中文的 INSERT，请确认库/列排序规则为 `Chinese_PRC_CI_AS`
   且字符串字面量带 `N'中文'` 前缀。

3. **上传 413 / 请求实体过大**
   调大应用 `MAX_UPLOAD_MB`，并同步调大 Nginx `client_max_body_size`。

4. **重启后演示数据丢失**
   内存模式（`DB_DRIVER=memory`）本就如此；设置 `DB_DRIVER=mssql` 后数据持久化到 SQL Server。

5. **删除设备后还能看到一条"删除"日志**
   这是设计行为：设备级日志随设备级联删除，同时另写一条 `equipment_id=NULL` 的全局删除日志，
   便于审计追溯。

6. **容器间互联（应用容器 → SQL Server 容器）**
   同一 Docker 网络内 `DB_SERVER` 填数据库容器名；不同机则填宿主机/实例 IP，
   并确保 1433 端口可达。

---

## 7. 部署验收清单

- [ ] SQL Server 已启用 TCP/IP 并重启服务，1433 端口可连通
- [ ] 已执行 `database/schema.sql`，库中有 3 张表
- [ ] 已创建最小权限应用账号并完成连通性测试
- [ ] `.env` 中 `DB_DRIVER=mssql`，`/health` 返回 `"driver":"mssql"`
- [ ] `uploads/`（或 `UPLOAD_DIR`）对运行账号可读写，并已纳入备份
- [ ] 页面验证：搜索、分页、详情、新建、编辑、删除、附件上传/下载/删除、操作日志展示
- [ ] （可选）PM2/systemd 开机自启、Nginx + HTTPS、防火墙最小放行
- [ ] 数据库 + 附件目录的定期备份与一次恢复演练
