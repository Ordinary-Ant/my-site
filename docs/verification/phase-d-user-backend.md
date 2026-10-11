# D07 用户管理后端验收

2026-10-10，Node24.19.0/npm11.17.0，真实PostgreSQL16，端口15432。专属集成测试先查询current_database()并断言_test后缀；未使用reset/seed，未覆盖.env，未提交或push。

## 实现与迁移

- `src/lib/services/user.ts`、`src/lib/validators/user.ts`与`src/app/api/v1/admin/users/**`：ADMIN权威会话授权；GET不要求Origin，写入Origin及共享PG adminwrite额度。列表分页/筛选和详情只返回安全字段。
- User.revision默认1；迁移`20261010010000_user_revision`在开发及_test两库migrate deploy成功，新增lower(email)唯一索引，保留既有用户/会话。客户端generate成功。个人changePassword业务revision递增；登录lastLoginAt不递增。
- 创建/重置密码使用24随机byte（192位）及固定大小写数字前缀，bcrypt12；仅该响应返回一次，apiHandler统一no-store；审计没有密码、摘要或会话凭证。
- Serializable事务固定advisory锁74390233，actor/target按ID锁定，重新验证启用/ADMIN/sid及轮转宽限后继；CAS、自身保护、启用管理员数量检查、会话及rotationReply撤销、审计一起提交。序列化/死锁转409。
- 生命周期只启停，无物理删除接口。姓名/头像普通修改保留会话；角色/邮箱变更、停用、重置密码及全会话撤销立即废除原AT。

## 已执行验证

- TDD：先新增unit、PG用例并实际执行，得到缺失validator/service失败，再实现。最终专属unit 2/2、专属真实PG 8/8通过。
- 全部unit 41文件/132项通过；`npm run typecheck`退出0；专属service/validator/routes/unit/PG的eslint退出0。
- PG验证三角色、无Origin读取、无Origin写拒绝、共享额度429及Retry-After、分页/筛选/安全DTO、缺失404、随机密码真实登录与bcrypt12、邮箱归一及数据库大小写唯一、旧revision409、姓名改动保持会话、个人密码修改revision递增。
- PG验证角色/邮箱/停用使AT立即401并清空轮转回复、旧RT不能取回凭证、启用后登录、重置后旧密码拒绝/新密码可登录、撤销有效会话数、自停用/降级/管理重置和撤销422、审计脱敏、审计故障整次回滚用户与session。
- 并发两个ADMIN相互降级只一次成功；失败方401/403/409，最终两人中仍保留一位启用ADMIN。
- HTTP创建201、创建与列表Cache-Control:no-store、详情不返临时密码。
- 全PG首轮21文件/134项通过；media-r2旧协议模拟服务器出现Node fetch `bad port`（TypeError: fetch failed，Caused by Error: bad port，tests/integration/media-r2.test.ts:124:13），同文件12项失败，另3项通过。server.listen(0)分配的实际端口未在当时错误输出中显示，不能补造；该轮不能标记全PG通过。
- 未修改实现及media测试后重跑全PG，22文件/146项全部通过（34.63s）。上述端口随机失败仍作为测试稳定性问题交主任务处理，不能以重跑通过抹去首轮失败。

## 未验证范围

浏览器用户生命周期、三端UI与最终整阶段build由主任务完成。真实生产R2/公开生产发布不在本D07后端验收范围。临时密码与令牌未写入证据或日志。

## 质量审查修复：旧邮箱登录与修改并发

- 审查发现login在事务外按旧邮箱读用户并核验密码，仅在锁内重验启用和密码摘要；管理员修改邮箱并撤销会话提交后，等待中的旧邮箱登录仍可建立新有效会话。
- 确定性真实PG红测：updateUser实际修改邮箱、撤销会话并写审计后，用测试门闩暂缓提交；并发login读取旧已提交用户后等待用户行锁。查询pg_stat_activity确认wait_event_type=Lock且正在执行login的SELECT users FOR UPDATE，再允许管理事务提交。旧实现实际返回安全结果标签`{ok:true}`，断言预期INVALID_CREDENTIALS401失败；不是超时或顺序调用。密码/凭证不进入断言输出。
- 最小修复：auth.login锁内同时要求current.email===normalized及原密码摘要一致，不符统一INVALID_CREDENTIALS401。
- GREEN：user+auth两个文件26项真实PG通过（11.49s），专属unit2项通过；新增测试确认旧邮箱拒绝、session数量不增、原AT失效、新邮箱可以真实登录。门闩和spy在finally释放恢复，login promise立即附拒绝处理，所有fixture与清理限定_test专属ID。相关eslint及typecheck退出0。所有Prisma测试afterAll断开。
