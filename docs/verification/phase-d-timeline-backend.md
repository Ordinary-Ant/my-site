# 阶段D03：时间线后端验收

日期：2026-10-08（本机Asia/Shanghai）；本次仅服务、validator、HTTP适配及真实PostgreSQL测试，不包含UI验收。

## 实现与合同

- `src/lib/validators/timeline.ts`：五类型WORK/EDUCATION/PROJECT/AWARD/MILESTONE；严格已知字段，description及其他nullable字段null清空，tags/highlights字符串数组整体替换；revision必传。
- 年/月/日与合法ISO输入先核验实际日历和0001–9998范围，使用输入日历部分（不把时区转换后的隔日当日历日期），UTC00:00归一：YEAR 1月1日、MONTH 1日、DAY原日。未传精度按输入推断；仅改precision时归一现有日期；合并后完整校验end>=start和isCurrent=>endDate=null。
- `src/lib/services/timeline.ts`：全部后台入口以requirePermission校验角色、启用用户、AT sid对应会话；写入口同Origin与PostgreSQL共享限流；事务内CAS、差异审计；成功后timeline/content/home/search/rss/sitemap/stats及profile/about标签失效。
- 公开timeline依据模块enabled、类型开关、visible、deletedAt过滤；没有status/publishedAt条件。排序isCurrent DESC、startDate配置方向、同日order ASC、id ASC；修改order无法跨日期或current分组。
- About helper仅WORK、showOnAbout、deletedAt=null，独立于visible；同时检查timeline/WORK/about/sections.experience开关。两公开DTO都先去deletedAt再applyPublicPrivacy。
- 重排items<=100且id唯一，统一id顺序行锁，事务内全量CAS；单条冲突整批回滚；purge仅ADMIN且必须已软删、revision匹配。
- HTTP：公开GET `/api/v1/timeline`；后台集合GET/POST、单记录GET/PATCH/DELETE、restore POST、purge DELETE、reorder PATCH。不新增公开详情/preview入口。

稳定调用：`TimelineCreateSchema`、`TimelineUpdateSchema`；`listPublicTimeline(params)`返回`{data,meta:{total}}`；`getPublicAboutExperience()`返回数组；`listAdminTimeline(params,request)`返回分页meta；getAdminTimeline/createTimeline/updateTimeline/deleteTimeline/restoreTimeline/purgeTimeline/reorderTimeline。service保留Date对象，HTTP JSON转换ISO；reorder返回`{items}`。

## 实际执行证据

- 新测试先运行时因新validator/service模块尚不存在失败；随后实现并修正测试登录邮箱大小写（auth正常小写化邮箱），不把该fixture错误当业务失败。
- `npm test -- tests/unit/timeline.test.ts`：11通过。涵盖闰日、无效日历、年/月/日推断及ISO日历部分、显式精度归一、当前结束日期约束、未知字段与null/数组合同。
- `TEST_DATABASE_URL=postgresql://dev:dev@localhost:5432/personal_site_test?schema=public npm run test:integration -- tests/integration/timeline.test.ts`：5通过。使用真实PG、bcrypt与真实login/session，包含五类型创建、nullable/arrays、precision-only patch、合并日期校验、409；current/date/order/id排序与ASC方向；重排整批回滚与反序并发（1成功/1受控409）；公开/About独立visible、教育排除、模块/WORK/experience开关、删除恢复purge及事务审计；三角色、inactive401、撤销401、跨用户sid401、Origin403、共享PG限流429；query400、分页、范围筛选、0001/9998边界及HTTP201/200/204/404/409。
- 全量 `npm run test:integration`：17文件109项全部通过，结束后连接已断开并通知协调者可build/generate。
- scoped eslint（service/validator/所有timeline API/两测试文件）：0错误0警告；`npm run typecheck`：exit0。
- 全量unit当时87项：86通过，唯一timeline-page自定义路径用例NEXT_NOT_FOUND；其时UI并行尚未接入dynamic dispatcher，已通知协调者。该记录不是最终UI结论。

## 验收边界

服务/HTTP/真实PG证据不替代浏览器功能、无JS、响应式、可访问性、UI操作和gzip预算验收。About完整页面与Profile编辑由D04最终联动；本次只验证共用经历helper。next/cache在PG测试中使用revalidateTag spy，因此证明失效依赖调用，不宣称真实浏览器5秒缓存验证。全量PG执行产生原有Vite未来configLoader警告，无测试失败。本任务未build/generate/commit/push，未公开部署。
