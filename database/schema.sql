/* ============================================================
   水厂泵站设备档案管理系统 —— SQL Server 建库脚本
   兼容：SQL Server 2014 及以上（使用 OFFSET/FETCH 分页）
   排序规则：Chinese_PRC_CI_AS（中文不区分大小写）
   字符集：NVARCHAR 以支持中文
   ============================================================ */

IF DB_ID(N'PumpStationDB') IS NULL
BEGIN
    CREATE DATABASE [PumpStationDB]
        COLLATE Chinese_PRC_CI_AS;
END
GO

USE [PumpStationDB];
GO

/* ---------------- 设备档案主表 ---------------- */
IF OBJECT_ID(N'dbo.equipment', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.equipment (
        id                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_equipment PRIMARY KEY,
        station_name      NVARCHAR(100)   NOT NULL,          -- 泵站名称
        device_code       NVARCHAR(50)    NOT NULL,          -- 设备编号（全厂唯一）
        device_name       NVARCHAR(100)   NOT NULL,          -- 设备名称
        pump_model        NVARCHAR(80)    NULL,              -- 水泵型号
        power_kw          DECIMAL(12,2)   NOT NULL,          -- 功率 kW
        flow_m3h          DECIMAL(12,2)   NULL,              -- 流量 m3/h
        head_m            DECIMAL(10,2)   NULL,              -- 扬程 m
        speed_rpm         INT             NULL,              -- 转速 r/min
        voltage           NVARCHAR(20)    NULL,              -- 额定电压
        current_a         DECIMAL(10,2)   NULL,              -- 额定电流 A
        manufacturer      NVARCHAR(100)   NULL,              -- 生产厂家
        install_location  NVARCHAR(200)   NOT NULL,          -- 安装位置
        responsible_team  NVARCHAR(50)    NOT NULL,          -- 责任班组
        commission_date   DATE            NULL,              -- 投运日期
        status            NVARCHAR(10)    NOT NULL,          -- 运行状态
        remark            NVARCHAR(1000)  NULL,              -- 备注
        created_at        DATETIME2(3)    NOT NULL
                              CONSTRAINT DF_equipment_created DEFAULT (SYSUTCDATETIME()),
        updated_at        DATETIME2(3)    NOT NULL
                              CONSTRAINT DF_equipment_updated DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT UQ_equipment_device_code UNIQUE NONCLUSTERED (device_code),
        CONSTRAINT CK_equipment_status
            CHECK (status IN (N'运行', N'备用', N'检修', N'停用')),
        CONSTRAINT CK_equipment_power CHECK (power_kw > 0)
    );

    CREATE INDEX IX_equipment_station ON dbo.equipment(station_name);
    CREATE INDEX IX_equipment_status  ON dbo.equipment(status);
END
GO

/* ---------------- 附件表 ---------------- */
IF OBJECT_ID(N'dbo.attachment', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.attachment (
        id             BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_attachment PRIMARY KEY,
        equipment_id   INT             NOT NULL,
        original_name  NVARCHAR(255)   NOT NULL,         -- 原始文件名
        stored_name    NVARCHAR(255)   NOT NULL,         -- 磁盘存储文件名
        file_path      NVARCHAR(500)   NOT NULL,         -- 相对 uploads 的路径
        mime_type      NVARCHAR(100)   NULL,
        file_size      BIGINT          NOT NULL
                           CONSTRAINT DF_attachment_size DEFAULT (0)
                           CONSTRAINT CK_attachment_size CHECK (file_size >= 0),
        uploaded_by    NVARCHAR(100)   NOT NULL
                           CONSTRAINT DF_attachment_by DEFAULT (N'system'),
        created_at     DATETIME2(3)    NOT NULL
                           CONSTRAINT DF_attachment_created DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT FK_attachment_equipment
            FOREIGN KEY (equipment_id)
            REFERENCES dbo.equipment(id)
            ON DELETE CASCADE
    );

    CREATE INDEX IX_attachment_equipment ON dbo.attachment(equipment_id);
END
GO

/* ---------------- 操作日志表 ---------------- */
IF OBJECT_ID(N'dbo.operation_log', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.operation_log (
        id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_operation_log PRIMARY KEY,
        equipment_id  INT             NULL,           -- 删除设备后保留的日志允许为空
        action        NVARCHAR(20)    NOT NULL,       -- 新建/编辑/删除/上传附件/删除附件
        detail        NVARCHAR(MAX)   NOT NULL
                          CONSTRAINT DF_log_detail DEFAULT (N''),
        operator      NVARCHAR(100)   NOT NULL,
        created_at    DATETIME2(3)    NOT NULL
                          CONSTRAINT DF_log_created DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT CK_log_action
            CHECK (action IN (N'新建', N'编辑', N'删除', N'上传附件', N'删除附件')),
        CONSTRAINT FK_log_equipment
            FOREIGN KEY (equipment_id)
            REFERENCES dbo.equipment(id)
            ON DELETE CASCADE
    );

    CREATE INDEX IX_log_equipment ON dbo.operation_log(equipment_id);
    CREATE INDEX IX_log_created   ON dbo.operation_log(created_at DESC);
END
GO

/* ============================================================
   完成。校验：
   SELECT name FROM sys.tables ORDER BY name;
   预期：attachment / equipment / operation_log
   ============================================================ */
