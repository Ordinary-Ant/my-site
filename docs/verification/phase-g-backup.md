# G · 本地独立备份与恢复

## 合同与入口

`scripts/local-backup.mjs` 仅支持固定本机 Docker 容器 `personal-site-db`（PostgreSQL 16，映射端口 15432），原库允许 `personal_site` 或 `personal_site_test`。连接串通过当前进程 `DATABASE_URL` 提供，不读取、改写或输出 `.env`；密码经子进程环境传入 Docker，不出现在命令参数与清单中。

数据库使用 `pg_dump -Fc` 自定义二进制格式；Node 直接将 stdout 写入文件描述符，避免 PowerShell 管道编码转换。只读 Repeatable Read 事务导出快照，同一快照统计所有 public 普通表行数及已验证外键数量，`pg_dump --snapshot` 使用此快照。包含应用账户、会话、配置、正文、关系、审计及 Prisma 迁移表；不包括集群级 PostgreSQL 角色/其他数据库。

媒体独立复制 `.storage/media`（当前 LocalDriver 全部媒体键所在目录），逐文件 SHA256；清单覆盖 dump 与媒体。目录 `.backups/<name>` 和 `.restore-test/<name>` 均已 Git 忽略。包内包含私人正文及账户等敏感数据，不上传 Git 或聊天，不把数据库 JSON 导出当作完整备份。

演练期间暂停后台写入、媒体上传/删除和定时任务；数据库快照保证自身一致，媒体目录与数据库之间没有分布式快照，停写用于保证跨资源对应。复制时校验源/目标媒体字节一致；备份失败保留未完成包，缺少完整合法清单时无法恢复。

## 运行

先用本地环境注入 `DATABASE_URL`，不在日志打印其值。PowerShell：

```powershell
$env:BACKUP_NAME = 'phase-g-local-drill'
node scripts/local-backup.mjs backup
$env:RESTORE_DATABASE_NAME = 'phase_g_local_restore_test'
node scripts/local-backup.mjs restore
```

成功时只输出固定状态及工作区相对路径。`node scripts/local-backup.mjs --help` 不连接数据库。每次演练使用不同包名和目标库名；已有包、恢复目录或目标数据库均拒绝覆盖。目标必须满足 `^[a-z][a-z0-9_]{0,48}_restore_test$`，原库/测试库与远程连接均拒绝。脚本不 DROP、清库、递归删除或覆盖现有媒体。

恢复先校验所有文件集合、大小、SHA256、清单结构及路径，拒绝符号链接/junction、路径逃逸、额外文件与损坏；通过后才创建隔离目录与新数据库。`pg_restore --exit-on-error --single-transaction` 真正执行恢复和外键约束校验，再比对全部表行数/已验证外键数和媒体文件哈希。仅全部通过才写 `.restore-test/<name>/verification.json`；失败留下隔离现场，原库和原媒体不改动。清单哈希用于发现损坏，不代替离线保管、加密或真实性签名。

## 当前验证证据

- TDD：初始 3 个行为测试在空实现下均实际失败（远程/非隔离库未拒绝、路径逃逸未拒绝、清单缺失），实现后转绿。
- 2026-10-11：`npx vitest run tests/unit/local-backup.test.ts`，4/4 通过，覆盖数据库约束、目录逃逸、已有目录、junction、损坏、额外文件与恶意清单路径；第 4 项为新增回归检查。
- ESLint、TypeScript 和 CLI `--help` 实际通过。
- **真实 PG dump/restore 与媒体恢复演练已通过**：2026-10-11原库personal_site只读快照，备份phase-g-local-drill-20261011，恢复到新建phase_g_local_20261011_restore_test。23表、8迁移、13已验证外键、1媒体文件；独立计算全部表内容排序哈希，源/恢复一致，源媒体SHA256与清单一致。另复制损坏包并追加dump错误字节，restore拒绝且目标库未创建，之后源库内容哈希未变。实际退出0，摘要[phase-g-restore-summary.json](phase-g-restore-summary.json)。原包、损坏副本与隔离恢复目录均保留在Git忽略目录，未提交；不清库、不覆盖原媒体。

生产远程数据库/R2/异地备份凭据尚未提供，此脚本不作为生产备份承诺。可信远端备份来源未接入前，管理员统计中的备份时间保持 null。
