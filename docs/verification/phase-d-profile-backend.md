# D04 Profile 后端验证

日期：2026-10-09。仅记录后端实际验证，后台/公开页面与浏览器联动由阶段 D 综合证据覆盖。未提交、未推送。

## 接口与边界

- `GET /api/v1/profile`：About 关闭返回 404；只接受 `fields` 白名单投影，禁止生日、revision、updatedAt。bio/advantages/skills/experience/services/contact 六区块默认开启，兼容旧四键配置并保留自定义 false。contact 关闭时不返回 socials；`fields=socials` 也不能恢复被关闭的数据。经历复用 `getPublicAboutExperience`，剔除经历内部修订、管理开关及审计时间字段。
- `GET /api/v1/admin/profile`：`content:read`，所有编辑字段、revision 和来自 Timeline 的只读 WORK 经历。生日为 `YYYY-MM-DD`。
- `PATCH /api/v1/admin/profile`：`content:write`，服务层鉴权、启用状态、sid、Origin 与 PostgreSQL 共享限流；严格已知字段，数组替换、nullable null 清空、合并后完整重验。CAS 防止旧稿覆盖，写入与差异审计同事务；失效 profile 及全站配置派生缓存。
- 空表 GET 返回占位资料及 revision 0，不写表。首次 PATCH 仅接受 revision 0，并发只允许一个原子创建成功，另一个 409。
- 联系方式复用 `applyPublicPrivacy`，覆盖 Markdown、数组、社交链接；avatar/resumeUrl 只接受 HTTP(S)/规范站内路径，socials 额外允许合法 mailto/tel，拒绝邮件头/编码换行。

## 实际命令与结果

- `npx vitest run tests/unit/profile.test.ts`：4 通过。旧四键配置补齐 bio/services、mailto 编码注入均先运行断言失败，再修复运行通过；初始缺失 Profile 模块也记录为失败。
- `npx vitest run tests/unit/profile.test.ts tests/unit/module-routing.test.ts tests/unit/public-privacy.test.ts`：12 通过。
- `TEST_DATABASE_URL=postgresql://dev:dev@localhost:5432/personal_site_test?schema=public`，运行 `npx vitest run --config vitest.integration.config.ts tests/integration/profile.test.ts`：最终 5 通过，真实 PostgreSQL。覆盖空表无写/并发首建、CAS 并发更新、null/数组/生日、审计、缓存标签、公开字段白名单/区块/同源经历、全 DTO 联系清洗、三角色/Origin/停用用户/伪 sid/共享限流。新增 contact 关闭不返回 socials/投影不能恢复数据的断言先运行失败，再修改 service 运行全绿。
- `npx tsc --noEmit`：退出 0。
- 对 Profile 服务/validator/routes/test 与 modules/public-site 修改运行 ESLint：退出 0，无警告。

测试恢复完整 Profile 单例、About/Timeline 开关及配置，删除本轮用户、审计、Timeline 与写限流记录，最后 `$disconnect()`。未运行 Prisma generate/build，未输出任何环境文件。

## 尚待完成

公开页/后台编辑器、三端和浏览器联动由 root 验收。
