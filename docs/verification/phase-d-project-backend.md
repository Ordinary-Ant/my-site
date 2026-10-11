# D02 作品后端验收

日期：2026-10-08。仅记录作品 service/API 与真实 PostgreSQL 功能证据；UI、公开页面、共享预览页面、浏览器外链检查和部署由主执行者单独验收。A–C提交不变，D未提交，未push。

## 入口与合同

- `src/lib/validators/project.ts`：四类型、必填卡片信息、可空长文、严格links五键、安全URL、日期及数组上限。PATCH必须revision，不传不变、nullable传null清空、数组整体替换。
- `src/lib/services/project.ts`：公开/后台列表与详情、创建/更新/删除/恢复/purge、批量、重排、选项、slug检查、预览摘要凭据及读取。所有后台入口通过服务权威授权，调用现有账号启用/AT sid会话/Origin/PG共享限流。
- `src/app/api/v1/projects` 与 `src/app/api/v1/admin/projects`：实际Route handler，reorder为PATCH，purge为DELETE，restore/preview-token/bulk为POST。
- 创建未传coverImage时默认gallery首图；显式null保持空。PATCH gallery变更不自动改封面，coverImage:null明确清空。published状态的空publishedAt自动分配当前时刻。
- 公开共用portfolio模块、类型、PUBLISHED、publishedAt<=now、deletedAt=null过滤。关闭模块列表200空数组/total0，详情404。公开列表无content/deletedAt/作者，详情带prev/next；全部公开DTO经applyPublicPrivacy，fields仅在清理后投影白名单。
- 默认排序order ASC、startDate DESC NULLS LAST、id ASC。latest为startDate DESC NULLS LAST、order ASC、id ASC。显式安全排序仅order/startDate/updatedAt/title/viewCount，支持负号及`:asc|desc`，id决胜；邻接固定默认顺序。
- typeCounts忽略选中type并保留其他筛选及公开边界，关闭类型为0。tech精确匹配历史数组项。from/to筛选startDate：纯日期按上海当日闭区间，带时区ISO保持真实时刻，非法/非有限/倒置拒绝。
- CRUD及关系/审计同事务，所有更新/删除/恢复/purge/reorder使用revision CAS。重排按id固定锁顺序、整体事务；bulk逐项事务并返回partial succeeded/failed。审计只记录实际变化字段及标签集合。
- 预览kind=project，仅保存sha256摘要，有效24h。VIEWER可生成且POST共享adminwrite 120/15分钟，读取不受类型/状态限制但模块关闭/软删/过期404。HTTP页面的no-store/noindex/referrer头由公共预览页面集成验收。

## 测试先行与实际结果

先编写3个unit及11个真实PG用例，再实现validator/service。最初两条测试命令均退出1：分别因作品validator、service尚不存在而加载失败（不是业务断言RED，不将其描述成断言失败）。validator实现后3unit通过；service实现后11PG通过。随后增加真实HTTP handler、并发重排、隐私、审计/缓存断言，15PG通过。

真实测试库仅使用`personal_site_test`，由现有integration setup检查_test后缀，未reset开发/生产库、未输出.env。夹具使用唯一slug/user/tag，结束恢复portfolio配置和隐私profile、清理夹具与preview/audit/限流，`afterAll`显式断开Prisma。

最终验证命令：

```powershell
$env:TEST_DATABASE_URL = 'postgresql://dev:dev@localhost:5432/personal_site_test?schema=public'
npm run test:integration -- tests/integration/project.test.ts
npm test -- tests/unit/project.test.ts
npm run typecheck
npx eslint src/lib/services/project.ts src/lib/validators/project.ts src/app/api/v1/projects src/app/api/v1/admin/projects tests/unit/project.test.ts tests/integration/project.test.ts
```

结果：最终18真实PG/3unit通过，所列后端eslint退出0。首轮typecheck退出0；复核期间全仓typecheck发现并行roles.spec.ts把authorId用于无作者字段的Project，已通知主执行者修复（本后端范围无TS错误）。首次eslint的两处Next.js `module`变量命名错误已修为projectModule。没有运行build/prisma generate，避免并行实现期间Windows DLL冲突。

## 功能覆盖

1. 外链且无长文作品实际创建、默认发布时刻、首图封面、列表分页与tech/featured筛选、历史技术栈选项。
2. 状态/未来发布时间/软删/模块/子类型过滤及忽略当前type的Tab计数。
3. null清空及数组替换、gallery不覆盖手动封面、合并后日期重新验证。
4. 同revision并发编辑仅一次成功409、真实唯一slug冲突、缺失标签事务回滚。
5. 上海日期from/to闭区间边界及ISO精确时刻、非法日期/倒置、fields和sort白名单。
6. NULL最后及id稳定决胜，公开相邻详情共用过滤。
7. 整体重排冲突回滚、反向锁顺序并发无死锁、同rev一成功一409、逐项审计/缓存依赖。
8. bulk部分成功、标签增减、缺失标签部分失败、真实changedfields无无变化字段。
9. 回收站显式includeDeleted及逗号状态、恢复/purge CAS、EDITOR拒绝purge、ADMIN彻底删除。
10. 24h哈希预览/VIEWER/Origin/共享PG限流、草稿与关闭类型可预览、过期/模块关闭/软删拒绝。
11. 禁用账号及撤销AT会话后数据入口401，VIEWER禁止写入与重排。
12. 全公开卡片/链接/长文/技术栈/亮点/邻接联系方式清理、先清理后fields投影、meta保留。
13. 实际Route handler：创建201、slug唯一409及字段details、危险链接400及字段details、过期revision409、公开列表meta.typeCounts。
14. 质量复核追加缺失标签HTTP：POST/PATCH均实际404 NOT_FOUND；POST不创建作品，PATCH保留原title/标签关系/revision且不产生update审计。两项首次即GREEN，未复现P2018→500，没有为假设错误修改service或通用apiHandler。
15. 原生GET筛选表单传`sort=`回归：先补真实PG/HTTP测试，初次RED为ApiError400排序参数无效；sort接受空字符串为默认后GREEN，实际HTTP200、order/startDate/id顺序与未传sort相同。其他任意排序仍按白名单拒绝。

## 未验证

浏览器UI/图集拖动/Lightbox/响应式、封面裁切、外链HEAD警告、公开页面和共享预览页面、首页精选消费、5秒新请求撤销、分钟调度、gzip预算及R2云配置不由本后端证据宣称通过。Vite的既有configLoader native相对import扩展名提示仍存在，未影响退出码。
