/* ============================================================
   水厂泵站设备档案 —— SQL Server 建库建表脚本
   适用：SQL Server 2012 及以上（OFFSET/FETCH 分页需 2012+）
   用法：用 SSMS / sqlcmd 以管理员身份执行本脚本
   字符集使用 Unicode（NVARCHAR），排序规则跟随库默认即可
   ============================================================ */

-- 1) 建库（如已存在可跳过）
IF DB_ID(N'PumpStationArchive') IS NULL
BEGIN
    CREATE DATABASE PumpStationArchive;
    PRINT N'数据库 PumpStationArchive 已创建';
END
GO

USE PumpStationArchive;
GO

-- 2) 设备档案表
IF OBJECT_ID('dbo.Equipment', 'U') IS NULL
CREATE TABLE dbo.Equipment
(
    Id              INT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_Equipment PRIMARY KEY,
    StationName     NVARCHAR(100)    NOT NULL,          -- 泵站名称
    EquipmentCode   NVARCHAR(50)     NOT NULL
        CONSTRAINT UQ_Equipment_Code UNIQUE,            -- 设备编号（唯一）
    EquipmentName   NVARCHAR(100)    NULL,              -- 设备名称（型号）
    PowerKw         DECIMAL(12,2)    NULL,              -- 功率(kW)
    InstallLocation NVARCHAR(200)    NULL,              -- 安装位置
    TeamName        NVARCHAR(50)     NULL,              -- 责任班组
    CommissionDate  DATE             NULL,              -- 投运日期
    Status          NVARCHAR(20)     NOT NULL
        CONSTRAINT DF_Equipment_Status DEFAULT N'运行中', -- 运行状态
    Remark          NVARCHAR(1000)   NULL,              -- 备注
    CreatedAt       DATETIME2        NOT NULL
        CONSTRAINT DF_Equipment_Created DEFAULT SYSDATETIME(),
    UpdatedAt       DATETIME2        NULL
);
GO

-- 3) 附件表（删除设备时级联删除附件记录）
IF OBJECT_ID('dbo.Attachment', 'U') IS NULL
CREATE TABLE dbo.Attachment
(
    Id           INT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_Attachment PRIMARY KEY,
    EquipmentId  INT NOT NULL
        CONSTRAINT FK_Attachment_Equipment
        FOREIGN KEY REFERENCES dbo.Equipment(Id) ON DELETE CASCADE,
    OriginalName NVARCHAR(255) NOT NULL,                 -- 原始文件名
    StoredName   NVARCHAR(255) NOT NULL,                 -- 磁盘存储名
    Size         BIGINT         NOT NULL,                -- 字节
    MimeType     NVARCHAR(200)  NULL,
    UploadedBy   NVARCHAR(50)   NULL,
    CreatedAt    DATETIME2      NOT NULL
        CONSTRAINT DF_Attachment_Created DEFAULT SYSDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Attachment_Equipment')
    CREATE INDEX IX_Attachment_Equipment ON dbo.Attachment(EquipmentId);
GO

-- 4) 操作日志表（删除设备时日志保留，EquipmentId 置空）
IF OBJECT_ID('dbo.OperationLog', 'U') IS NULL
CREATE TABLE dbo.OperationLog
(
    Id           INT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_OperationLog PRIMARY KEY,
    EquipmentId  INT NULL
        CONSTRAINT FK_Log_Equipment
        FOREIGN KEY REFERENCES dbo.Equipment(Id) ON DELETE SET NULL,
    Action       NVARCHAR(20)  NOT NULL,                 -- 新建/编辑/删除/附件
    Detail       NVARCHAR(MAX)  NULL,
    Operator     NVARCHAR(50)  NULL,
    CreatedAt    DATETIME2     NOT NULL
        CONSTRAINT DF_Log_Created DEFAULT SYSDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Log_Equipment')
    CREATE INDEX IX_Log_Equipment ON dbo.OperationLog(EquipmentId);
GO

PRINT N'表结构初始化完成：Equipment / Attachment / OperationLog';
GO
