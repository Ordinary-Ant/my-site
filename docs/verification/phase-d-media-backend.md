# D08 媒体管理后端证据

日期：2026-10-11。未提交，等待阶段D统一验收。只扩展媒体管理，不改B上传确认、引用删除、私有对象转公开与补偿清理协议。

## 实现

- `src/lib/services/media.ts`：列表q同时搜索originalName/alt，trim、大小写不敏感、最长200。folder省略全部，`/`精确根目录；保留历史含末尾斜杠目录的精确查询。
- `GET /api/v1/admin/media/folders`：content:read；完整目录统计不受列表筛选影响，合并媒体groupBy与持久空目录，根目录永有，按path排序，返回folders/total/totalSize；RepeatableRead保持汇总一致。
- `POST /api/v1/admin/media/folders`：media:write；严格path、200字符、去末尾斜杠、根目录幂等；Setting `media.folders`、group `internal`、路径数组持久化，无新模型/迁移。固定PG事务锁74390234保护幂等及200个登记目录上限；超限409 DIRECTORY_LIMIT；新建审计与元数据同事务。
- `POST /api/v1/admin/media/deduplicate`：严格小写sha256/正安全整数size/mimeType，拒绝未知metadata。仅匹配已验证登记Media的hash+size+真实mimeType，hash事务锁与上传/删除协调。命中返回安全DTO及deduplicated:true，保留原ID/url/alt/folder；不新建Media/UploadIntent，不触发上传20次/小时额度；命中审计同事务。未命中返回media:null/deduplicated:false，不写业务数据。
- 写接口复用权威requirePermission：启用用户、AT sid会话、Origin、角色及共享PG adminwrite额度120次/15分钟。支持类型用自有键检查，拒绝constructor等原型名。
- 内部Setting不进入公开/普通设置或内容JSON导出（既有白名单实测），完整数据库备份天然保留。

## 实际验证

- 新`tests/unit/media-management.test.ts`：3项通过；与原media unit合计6项通过（2026-10-11最终09:17:45，196ms）。目录参数、危险路径、未知键、查询trim/200上限/根及历史末尾斜杠、sha256/size/metadata。
- 新`tests/integration/media-management.test.ts`：9项真实PG通过；与原media/media-r2合计36项通过（最终09:17:03，6.01秒）。独立personal_site_test且current_database二次确认；fixture独立账号/真实PNG，不reset、不改开发库、不读取或输出.env。清理恢复原media.folders记录、删除fixture媒体/票据/审计/账号及限流桶，disconnect后归还PG给root。
- 覆盖三角色完整目录读取、ADMIN/EDITOR创建、VIEWER拒写、停用拒读写、失效sid拒读写、跨Origin403、PG额度429；q文件名/alt及全部/根目录；空目录并发幂等及持久化；满200幂等/新目录409；199目录跨用户并发只有一个新建成功；内部键不进设置/内容JSON；跨用户dedup保留metadata、无新Media/intent/上传额度、命中审计；未命中/大小及类型不符不写业务数据；真实路由响应及400/403。
- RED→GREEN：参数初轮3项按预期失败后实现；PG初轮7项因alt未搜索/新增service与route缺失失败后实现；constructor伪MIME复现错误命中验证后补自有键检查；历史末尾斜杠查询补红测后修复。
- 指定6个TS文件ESLint退出0；Prettier check通过；media.ts git diff --check通过。
- 全仓typecheck执行后，本任务错误已修复；余下仅root并行开发中的setting-definitions.test.ts引用尚未落地的config/settings等错误，最终全仓门禁由root完成。未运行build/generate，避免PG/Prisma DLL竞争。

## 边界

规格与质量审查均批准生产实现，无P1/P2。审查指出原测试PNG仅随机单个颜色字节、熵不足；fixture已改为crypto.randomBytes生成17×19×3随机像素，上传后确认uploadedBy属于本轮fixture账号才登记cleanup ID，删除前再次按ID+uploadedBy查询归属，防止去重接管非fixture对象。2026-10-11 09:30:55新增3unit通过，fixture ESLint/Prettier/diff检查通过。root释放PG窗口后，2026-10-11 09:36:56仅复跑media-management集成测试，9项全部通过，总耗时1.58秒（测试677ms）；afterAll恢复目录与清理本轮fixture后完成disconnect，进程退出0，PG窗口归还root。未运行generate/build或其他PG测试。

此文件证明后端功能与原协议回归；完整设置/媒体UI、队列/批量单项结果、picker、三端浏览器由root验收。R2云ACL/CORS/公网真实上传仍按阶段B/G边界，不以本地R2模拟测试替代云验收。
