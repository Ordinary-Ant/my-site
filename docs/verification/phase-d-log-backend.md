# D01 日志后端验收

日期：2026-10-08（Asia/Shanghai）。本记录只覆盖日志 service、validator、API 和自动化测试；页面交互与整体 D01 验收由主任务记录。

## 已实现

- 公开列表、详情与日历共享模块/类型、PUBLISHED、到期 publishedAt、未删除过滤；未来 logDate 仅置顶记录可见，置顶不能绕过发布时刻。列表不返回正文，提供与默认摘要均在完整隐私清理后截取 120 字；按置顶、日志日期倒序、id 升序分页。
- 支持 type/year/month/mood/tag/q 和精确 date；仅传 month 时按上海当前年筛选；未传 year 而传 date 时，列表和日历按该日期年份处理；日历从全部匹配记录聚合，返回 months/count/days/dayCounts/total，关闭模块返回空数据。后台日历包含草稿并支持回收站及逗号多状态条件，非法状态 400。from/to 作用于日志日期闭区间，支持严格日期或带时区 ISO 时间归一为上海日期，拒绝无效或倒置范围。稀疏 fields 使用固定 DTO 白名单，公开 DTO 先清理隐私再投影，禁止正文/删除信息/作者 ID 和未知危险字段；meta 保持完整。后台排序允许 logDate/updatedAt/title/viewCount 的通用负号语法（兼容 field:asc/desc），非法排序 400；公开顺序固定不受 sort 改变。
- 日期必须是有效 YYYY-MM-DD（年份 0001–9998），PostgreSQL Date 写 UTC 零点，所有 DTO 输出日期字符串；当天按 UTC+8 计算。状态默认 PUBLISHED，发布时间为空时由服务器补当前时刻。
- 创建、更新、删除、恢复、彻底删除逐次检查内容权限、启用账号与 AT 对应会话；客户端不能设置作者及统计字段。更新、删除、恢复和彻底删除均要求 revision；更新在 PostgreSQL 中 CAS，数组整体替换，可空装饰字段 null 清除。
- 标签关系、内容写入与审计使用同一事务；成功后失效 log 缓存。彻底删除限 ADMIN。批量操作逐条事务及 revision，不存在标签、内容和版本冲突记入部分失败；成功项独立审计。普通编辑保留实际变化字段（含完整正文、日期与图集），批量标签保留关联 tagIds 前后值。
- 所有公开日志 DTO 使用 applyPublicPrivacy；日志新增24h哈希预览凭据和共享预览页分发，凭据创建需content:read及POST同源，并显式消费共享PostgreSQL后台写入额度120次/15分钟；预览允许草稿/归档/未来/关闭子类型，仍检查模块及软删除。文章预览服务保持原合同。

## 实际证据

1. `npm test -- tests/unit/log.test.ts`：3 个测试通过；实现前缺失 validator 的 RED 已实际运行。覆盖合法闰日、无效日期、客户端越权字段、装饰白名单、不安全媒体、更新 revision 与 null/空数组、9998 接受而 9999 拒绝的年份边界。
2. `TEST_DATABASE_URL=...personal_site_test` + `npm run test:integration -- tests/integration/log.test.ts`：16 个测试通过，运行于独立真实 PostgreSQL _test 数据库；实现前缺失 service 的 RED 和批量无效标签 P2025 的 RED 已实际运行。
3. 集成验证默认发布/服务器作者/真实日期与分页、未来日期/置顶/发布调度过滤、类型和模块关闭、同 revision 并发仅一成功、数组清除、删除恢复彻底删除、回收站、批量部分成功审计、VIEWER 只读、停用账号及撤销会话被拒绝、多条同日日历聚合和精确日期、公开上下篇过滤、关系失败事务回滚、月份独立筛选、后台日期排序及非法字段/方向拒绝、长摘要固定 120 字、独立日期条件列表/日历一致、普通编辑与批量增减标签真实差异审计、真实日期范围过滤、上海时间归一、多状态列表/日历一致、稀疏响应字段和越权字段拒绝、非法 ISO 时区偏移在公开/后台列表与两种日历均返回 400 VALIDATION_ERROR；草稿公开404而有效预览可读、token哈希/24h、类型关闭私有预览仍可读、到期/软删除/关闭模块404，以及VIEWER创建预览/跨Origin和停用账号拒绝、同一用户第120次创建可通过而第121次429且不新增PreviewToken。
4. `npm test -- tests/unit/preview-dispatcher.test.ts`：3 个测试通过，覆盖文章/日志分发、日志正文/图库、凭据缺失/过期/未知类型404及noindex/dynamic声明。
5. `npm run typecheck` 通过；日志 service/validator/API/测试的 ESLint 通过。

## 尚未由本记录验收

- 预览浏览器展示与图集交互、浏览器三角色操作、SSR 日志展示、媒体上传集成与 gzip 预算属于主任务后续验收；不能以本次后端测试代替。
- 无生产发布、push、提交、构建、Prisma generate 或重置数据库操作。







