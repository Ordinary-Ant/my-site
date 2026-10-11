# D06 数据导入导出后端实测

2026-10-10；分支codex/full-site。后端未提交、未push，未改Schema、未运行generate/build；UI与独立复审由root负责。

## 实现与入口

- `src/lib/validators/data.ts`：版本1.0完整严格DTO，复用内容/分类/标签/Profile/module/settings/motion合同，移除编辑DTO默认值，缺少可空字段也拒绝。Markdown字段不做trim/渲染转换。关系、重复ID/slug、分类两层树、未知键/危险键/日历日期整体校验。
- `src/lib/services/data.ts`：完整导出、merge/replace计划、十分钟HMAC预览凭证（domain、actor、sid、mode、文件摘要、业务快照摘要）、Serializable事务、配置advisory锁与固定顺序业务表锁。表锁保护预览计划与实际写入期间的插入/编辑，40001/deadlock返回409。
- `/api/v1/admin/export`、`/import/preview`、`/import`：统一API响应、下载attachment/no-store、4MB/5000实体上限、读JSON沿用4.2MB请求上限。GET export需当前ADMIN/sid及显式PG额度，无Origin要求；两个POST需Origin及data:import。
- 导出仅已知settingGroups组及键，内部`jobs.publication.cursor`等运行状态不属于可恢复配置，replace保留这些内部行。JSON不含用户口令/会话/预览凭证/上传票据/媒体二进制/审计/限流。
- merge按slug复用词表并映射关系；已有文章/作品slug、日志/经历ID跳过；其他ID冲突重分配，缺失作者映射当前管理员。保留现有模块/设置/Profile配置并告知；来源历史路径合并且不可抢占。
- replace内容/词表/配置、关系、审计一次提交；同IDrevision大于旧值与来源值；撤销受影响预览。历史别名保留，模块改路径补旧路径别名，最终路径检查。成功后全部内容及配置依赖缓存失效。
- Zod前迭代结构检查：深度100、节点500000限制，禁止循环/共享对象与危险键；防止4MB深嵌套JSON触发递归栈溢出。字节/实体超限413，结构不合法400。

## 真实结果

连接仅`personal_site_test`，端口15432；beforeAll执行`SELECT current_database()`核实后才创建fixture。未reset或连接开发/生产库。

1. 红测：首次新增unit/PG因data模块尚未实现失败；后续完整DTO缺status红测明确观察到旧default错误接受缺字段，去掉default后转绿。
2. `npx vitest run --config vitest.integration.config.ts`：21文件、136项通过，退出0（22:34:59启动，27.36秒）。其后完整DTO修复再次运行data专属12项全部通过（22:36:20启动，2.58秒）。
3. `npx vitest run tests/unit/data.test.ts`：2项通过，退出0（22:36:44）；检查深度10000、循环和危险键不递归溢出。
4. `npx tsc --noEmit --pretty false`及本任务全部文件ESLint：退出0。根代理另行运行全仓check/verify、build与浏览器验收。

12项真实PG覆盖：无凭据完整导出与attachment；只读preview与merge skip；mode/file/state/签名/过期409；Origin/角色/禁用/撤销/PG额度；严格重复/缺字段/日历/危险键/关系与两层树；完整原包export→replace保留Markdown、日期、软删、future、统计、关系、配置与历史；ID冲突映射及缺作者；配置/Profile恢复、模块改路径保留旧/来源历史、预览撤销；PG审计触发器强制失败时内容关系revision与审计全回滚；replace与编辑并发恰一方409；4MB/5000项及恶意深度限制。

## 测试隔离与修复记录

- 首次原包导入暴露旧seed三个中文Tag slug违反现严格合同，以及内部publication cursor不应作为用户配置导出。root另行修复seed及精确迁移；本服务改为已知配置白名单。随后测试使用真实整包导出进行replace，没有过滤非法业务实体后冒充恢复验收。
- 测试开发期间两次清理错误已修：一次错误断言在精确恢复同一快照后要求旧token失效，导致多做一次replace；一次重命名局部module变量时误改测试Prisma属性，导致finally中断。后者影响仅_test的article路径/pageSize、site.name、Profile.company/contactVisible及revision；经root授权，按seed核对后重新初始化这几个测试配置字段，保留所有正文/关系/历史并回退额外revision。无法证明这些配置原值，故此处明确记录为测试基线重新初始化，不能称该次精确恢复。开发库未操作。
- 最终replace测试先以`wx`独占写入ignored `.test-backups/data-backend-test-backup.json`（移出会被build清理的`.next`），finally恢复，完整再次export.data相等后才删除备份；异常清理失败保留文件并阻止后续覆盖。最终13PG通过且备份文件不存在，fixture/测试用户/审计/额度清理完成、Prisma断开。测试暂时的审计失败触发器/函数已删除。

## 独立规格复审修复（22:48）

规格审查两项P2已修复。经历导入日期现同时核验0001–9998年、UTC零时以及与YEAR/MONTH/DAY规范化结果等值；只拒绝不规范输入，合法原包不转换。动效导入使用去default的完整专用schema，缺intensity/mobileIntensity也拒绝，原有编辑schema保持不变。

红测真实观察：新增unit两项分别因接受0000年与缺intensity失败；新增真实PG预览测试因接受非法经历日期失败。修复后22:48:11 unit4项、22:48:12真实PG13项均通过；合法年/月/日含0001与9998边界parse结果与输入完全相等，真实原包preview/replace仍通过。`tsc --noEmit`、相关ESLint退出0。`git check-ignore`确认新备份目录被忽略，文件不存在。

## 独立质量复审生日修复（22:56）

生日导入此前仅将ISO字符串前10位交ProfileSchema校验，接受offset/非零时会导致落库UTC跨日，甚至使9998年生日移至9999年。现导入专用birthday校验要求0001–9998有效日历日期且UTC零时，拒绝offset及非零时；合法原包和null不变。

红测unit/真实PG均明确观察到`2020-01-01T00:00:00+08:00`被错误接受；修复后5unit（22:56:35）与14真实PG（22:56:37）通过，原包replace/关系/配置回归仍通过。还覆盖9998年offset跨9999、非零时、闰日/非法日历及0001/9998边界。tsc、相关ESLint退出0，Prisma断开、测试备份不存在。未build或提交。

## 待后续验收

root独立spec/quality review、构建与浏览器原包下载→预览→merge/replace恢复流程尚需单独记录；此文不将后端测试代替UI或灾备恢复演练。数据库与媒体整体灾备仍属G。
