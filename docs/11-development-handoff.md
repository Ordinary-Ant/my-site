# 11 · 开发交接与恢复

更新：2026-10-11。A（66dca93）、B（c5fe0c6）、C（cc9fb5d）已验收并本地提交；D01–D08已验收并本地提交80347bc；E开发中，F–G待开始。分支codex/full-site，保留master，origin已配置，禁止自动push。一期尚未完成；D整阶段已通过，之后进入E。

## 恢复顺序

1. 读AGENTS.md，核对Git状态和最近提交；当前未提交变化均属于E合同修订与实现，不覆盖/回退。
2. 读README、10台账、12批准计划及当前阶段verification；09只是旧可行性快照。
3. 检查Docker与实际端口。现有.env不可输出/覆盖/提交，不reset开发/生产库。
4. 开发前登记，实际验收后填证据；公开生产发布最终确认。

## 环境与启动

Node24.19/npm11.17，PostgreSQL16容器personal-site-db，卷personal-site_pgdata。2026-10-10 Windows excludedportrange含5341–5440，原5432无法绑定；已保留同卷重建映射15432。开发库4篇文章；开发与测试库现有8个迁移均已部署，未reset或修改.env。docker已在PATH，安装于用户AppData/Local/Programs/DockerDesktop。

当前启动命令（进程环境覆盖，不覆盖.env）：

```powershell
$env:POSTGRES_PORT = '15432'
docker compose up -d db
$env:DATABASE_URL = 'postgresql://dev:dev@localhost:15432/personal_site?schema=public'
npm run db:deploy
$env:NEXT_PUBLIC_SITE_URL = 'http://localhost:3100'
npm run dev -- --port 3100
```

独立测试：

```powershell
$env:TEST_DATABASE_URL = 'postgresql://dev:dev@localhost:15432/personal_site_test?schema=public'
$env:E2E_BASE_URL = 'http://localhost:3100'
$env:NEXT_PUBLIC_SITE_URL = $env:E2E_BASE_URL
npm run build
npm test
npm run test:integration
npm run test:e2e
```

迁移/seed已完成，不重复初始化。TEST_DATABASE_URL仅允许_test且核实current_database；禁止测试重置开发/生产。2026-10-11新增Windows保留端口2929–3028，3000启动EACCES，改用3100。Playwright通过E2E_BASE_URL配置本机地址，Origin/独立浏览器上下文/runner一致，构建时NEXT_PUBLIC_SITE_URL须与测试地址相同。Chromium可用。Windows Prisma DLL在PG测试期间可能被锁：PG与generate/build顺序执行，结束后disconnect再build。Docker端口参数与DATABASE_URL必须一致，不能只看容器healthy。

## 验收与证据

- A基础治理、B文章认证媒体发布、C模块路由配置隐私均已提交，见verification/phase-a/b/c.md及backend证据。
- D01日志、D02作品、D03时间线、D04 About已验收，功能/三端/权限/并发证据见verification/phase-d.md及对应backend文件。D04最终111unit/114PG，全部spec/quality通过。实际PNG/PDF上传、图集裁切、拖拽/键盘、无JS/reduce、About同源经历与隐私均有真实证据。
- D05分类标签已验收：118unit/123真实PG，最终taxonomy+roles浏览器8passed/10skipped（桌面业务只跑1440，三端布局全跑）；全部规格与质量复审通过，check/build退出0。分类父删除保护/同父排序、标签跨三模型合并去重、内容revision递增、bulk删正文保留、SLUG_CONFLICT、手动slug回调竞态、Navigation取消后退及不支持时sessionStorage恢复原revision、undo-to-clean防旧稿复活已验证。详见阶段D及taxonomy backend证据。
- D05 revision迁移20261009153000_taxonomy_revision两库已部署并可重跑；此前foundation/publication_backfill/media_upload_intents/home_default_order均已部署；D06新增20261010000000_seed_tag_slugs已部署两库，固定旧seed中文slug且保留ID/关系，1unit+1PG通过。
- .gitignore的logs/已改/logs/，否则src日志API被忽略；所有D新文件都必须随阶段提交。Markdown idPrefix及脚注命名空间避免双布局和相同标题DOM重复id。当前动态强调色对比度仍留F/G。

## 当前工作与下一步

D06已验收，完整记录见verification/phase-d.md及phase-d-data-backend.md：最终build退出0、127unit/138PG、data+roles浏览器5passed4skipped。规格/质量全部批准；时间线精度/年份、motion完整字段、生日UTC偏移漏洞均RED→GREEN并复审。真实下载、merge关系恢复、replace冲突/重算、旧稿409、三端暗色/reduce、角色越权均通过。gzip登录107816字节/107.82KB、文章126713字节/126.71KB。

D07用户管理合同已补03/04/02：ADMIN权限、User revision、随机初始/重置密码一次展示、停用/角色/邮箱变更撤销全部会话、自己不可停用降级、最后管理员并发保护、无物理删除。users_backend负责user service/validator/APIs、User revision迁移、auth改密码rev递增及unit/PG；root负责users UI/helpers/E2E和总文档。

测试备份已从.next改到Git忽略的/.test-backups/，避免build清理。浏览器data-browser-test-backup.json、后端data-backend-test-backup.json在replace前以wx保存原包，有残留必须先恢复_test再跑；成功恢复后才删除，不能覆盖/盲删。首轮测试清理错误曾导致_test几个配置未恢复，已核对seed重新初始化这些字段并明确记录，开发库未操作。恢复目录build保留探针及新路径E2E已通过，探针及成功恢复的原包均已删除。

20261010010000_user_revision已部署两库且重跑无待部署项，包含User revision与不区分大小写邮箱唯一索引。D07后端规格/质量复审批准；邮箱修改与登录竞态确定性PG红测复现旧邮箱错误登录，锁内邮箱重验后26项user/auth PG及2项user unit通过。root用户UI/helpers及浏览器已验收；132unit/147PG、users+roles5pass4skip18.1秒，全部规格质量批准。保存后旧筛选覆盖列表真实RED→GREEN；邮箱/avatar、复制/Escape清除、active筛选及权限均实际通过。PG/generate/build按顺序由root执行，其他审查只读。D08完整设置媒体已验收；D阶段本地提交后继续E/F/G。

## 未验证及环境边界

R2云ACL/CORS/公网直传、生产托管/域名/数据库和备份凭据未提供，G记录实际阻塞；B只证明本地协议与真实PG。真实分钟runner已在B验收，生产外部调度未配置。默认TRUST_PROXY=false，代理正确覆盖头后才开启。

主题对比度、全站最终视觉、动效、生产CSP、独立数据库/媒体备份恢复留F–G；搜索/RSS/sitemap在E已实现待整阶段验收。最近gzip登录107.90KB/文章126.80KB（D08实测）；预算110/135KB。生产audit既有0漏洞，开发链5high待G复核，不force降级Next。D07首轮全PG曾有media-r2本地模拟协议测试fetch bad port失败，随后全147项通过；实际随机端口未保留，不推测具体值，仍须稳定测试端口分配。密钥、RT、rotationReply、导入凭证不能输出日志或Git。

## D阶段最终恢复点

D01–D08及全部规格/质量复审通过。最终143unit（47文件）、156真实PG（23文件）、check/verify/生产build退出0，仅既有Markdown外部图片警告。全套96浏览器54pass42skip（2.6分钟，跳过设备不适用重复场景）。分类键盘偶发根因为Dnd键盘监听器延后注册，测试等待真实监听器后重复10次通过，见phase-d-taxonomy-keyboard.md。分类标签公开计数已复用日志日期/置顶过滤，真实RED→GREEN并复审。

全套浏览器之后补修404推荐链接：模块关闭隐藏、连续改路由使用当前路径。单元RED→GREEN，重新生产build后modules+foundation实际4pass2skip（8.3秒）。gzip登录107902字节、文章126799字节，均低于110/135KB。未覆盖生产R2和部署，不据此声称一期完成。测试恢复备份无残留。

阶段D本地提交80347bc，未push。当前已开始修订E搜索/归档/匿名阅读统计/订阅SEO合同再开发。搜索全局分页不得先每表截断再合并；阅读统计不存IP，以签名匿名访客cookie和PG30分钟窗口为准；lastBackupAt无实际来源时为null。继续登记E功能及真实验收，不自动push。

## E最新恢复点（2026-10-11）

D提交80347bc，所有新增未提交内容属于E，禁止覆盖。E合同已修原03/05/06/02及12：正确全局SQL分页、公开日期过滤、稳定匿名身份30分钟窗口、北京日历日期、未验证备份null；旧score/session-only/IP+slug合同移除。迁移20261011053000_view_receipts已部署开发及_test两库，当前8迁移，未reset/覆盖.env。

实现入口：services/search/public-content/seo/stats、visitor/search-display；公开search/views APIs、admin/stats，search页面、catchall归档，RSS/sitemap/robots/OG、JSON-LD/ViewCounter及Dashboard。搜索agent遇到账户使用额度限制后root承接实现；只读规格复审phase_e_contract_audit已批准，独立质量审查进行中。

已核实152unit/51文件、167真实PG/26文件及check/生产build通过，verify通过，只有既有Markdown图片warning；联合search-seo+roles+modules浏览器6pass6skip17.5秒。全套102浏览器58passed/44skipped（2.7分钟）；复审补修后重新check/build与相关浏览器6passed/6skipped（17.1秒）。生产manifest gzip登录107916字节/107.92KB、文章127132字节/127.13KB。

下一步等整套浏览器完成及规格/质量复审，修复确定缺口后再E阶段本地提交，随后F。PG测试与generate/build/browser保持串行，审查只读。R2/生产部署/备份凭据仍属G阻塞。

复审补修：归档翻页保留pageSize、About metadata使用公开headline/avatar，新增两项单元测试实际RED→GREEN；日志/作品列表CollectionPage、时间线BreadcrumbList补齐，日志保持统计且不显示阅读量。补验真实页面结构化数据与日志展示通过。

质量复审发现新/og会抢占D阶段合法栏目/历史别名，浏览器实际RED为图片响应text/html。修复使用/api/v1/og，旧/og路径与alias均保留；robots仅例外允许该公开图片，普通/api仍禁止。移除新增/og保留项，无需迁移用户路径。复审补验6pass6skip（16.7秒），规格/质量最终复审批准；最后robots小修后build/browser待root确认。

## E阶段最终恢复点

E01–E03整阶段通过：152unit/167真实PG、全102浏览器58pass44skip，复审后联合补验6pass6skip、最后robots修正4pass2skip（8秒），check/verify/build及107916/127132字节gzip均通过。规格/质量最终批准。分享图最终/api/v1/og，保留D阶段/og栏目/别名兼容。E本地提交后立即F01动效，F02三端视觉；F开始前登记开发中。生产R2/部署/备份凭据仍是G实际阻塞。
