# 阶段 D 验收记录（持续更新）

更新：2026-10-11（Asia/Shanghai）。阶段 D 已整体验收，工作在 codex/full-site，准备本地阶段提交，未推送。以下保留分轮实测历史，最终结果见末节。

## D01 日志

已实现公开列表/详情/日历、后台快速记录/编辑/筛选/批量标签/回收站、版本锁、本地稿与草稿自动保存、服务器预览、图集与键盘浏览。公开查询复用模块、类型、发布状态、到期时刻、删除状态和联系方式过滤；未来日期只有置顶日志可见，但不能绕过未来发布时间。后端详细合同及 16 项 PostgreSQL 结果见 [日志后端记录](phase-d-log-backend.md)。

2026-10-08 当前生产构建的 Playwright logs.spec.ts：8 passed / 4 skipped。跳过项是仅适用于移动端或桌面的场景在其他尺寸中的重复执行，不是失败场景。

- 1440px：后台记一笔到公开正文、编辑保留发布时间毫秒精度、Ctrl+S、未保存浏览器返回取消、旧 revision 409、软删除后直链 404、恢复后可读；自动填写记录用时小于 60 秒，不能代替人工易用性评价。
- 390/820/1440px：列表和日历无横向溢出、视图偏好、暗色与 reduced-motion 条件下可浏览；禁用 JavaScript 后仍能切月。图集方向键、失效图片占位、Esc 关闭及回焦通过。
- 390px：加载更多追加而非替换；进入详情再返回时原查询、追加条数及记录的位置恢复。只保存已加载页数，恢复时重新读取公开接口，避免本地保存正文绕过配置变更。
- 真实 HTTP：日志 preview 创建成功、正文返回 200，no-store / noindex / no-referrer 响应头有效。原 no-referrer 被全局规则覆盖的 RED 已实际复现，调整规则顺序后的 GREEN 已通过。

截图：[390](phase-d-images/log-calendar-dark-390.png)、[820](phase-d-images/log-calendar-dark-820.png)、[1440](phase-d-images/log-calendar-dark-1440.png)。已人工查看 390 截图，日历及页脚布局可读；全站主题对比度和最终视觉验收仍属于 F/G。

最终 `npm run check`、verify 与生产构建通过，只有既有 Markdown 外部图片 lint 警告。53 个单元测试（18 文件）及全量 85 个真实 PostgreSQL 测试（14 文件）通过。后端与 UI 的规格/质量复审均批准，D01 验收完成。

最终 logs+roles 联合浏览器回归：9 passed / 6 skipped，无失败。新增实际证据包括：真实PNG及伪装PNG同批上传，后者415而成功图片继续保留并保存公开；EDITOR编辑、VIEWER正文可选择复制但写API403且无保存按钮；字段失焦校验/aria-invalid/首错聚焦；日期范围与批量标签筛选；列表→A→B→A后返回原列表、追加记录和位置正确。质量复审发现的两个P2已修复并验证，不依赖旧detail匹配来猜测浏览器上一历史记录。

最新生产manifest gzip：登录107743bytes（107.74KB）≤110KB，文章123369bytes（123.37KB）≤135KB。全站动效及Lighthouse仍待F/G。D01随阶段D最终提交；当前未提交，不push。

## D02 作品（已验收，随D提交）

后端已实现CRUD/筛选与类型计数/公开详情相邻项/回收站/批量/原子重排/历史技术栈/地址检查/24h预览，规格和质量只读审查批准。15项真实PG与3项unit通过，详见[后端证据](phase-d-project-backend.md)。质量审查提出不存在标签的HTTP错误码覆盖不足，正在补充实际测试，未以审查批准替代该边界验收。

编辑器及前台已接入四类型、显式字段清空/数组替换、完整ISO精度、修订锁、自动保存、本地恢复、只读正文、封面16:9裁切、图集拖拽、浏览器HEAD与共享卡片预览。新增裁切几何2unit、稿件2unit、日期与链接2unit、preview dispatcher4unit通过。首页旧发布时间排序已由真实PG测试复现RED，改为order/startDate/id后GREEN。

首轮生产构建与类型/Lint检查通过（既有Markdown图片warning）；Playwright projects.spec.ts为4passed/2skipped：1440发布/裁切真实上传1600×900/可空正文/私有no-store,noindex,no-referrer/旧revision409；390/820/1440四类型筛选、暗色reduce、图集方向键/Esc回焦、无JS详情及无横向溢出。已查看390截图：[390](phase-d-images/project-detail-dark-390.png)、[820](phase-d-images/project-detail-dark-820.png)、[1440](phase-d-images/project-detail-dark-1440.png)。失效图片使用占位，不能据此宣称真实多图视觉全部验收。

后台列表/回收站正在开发，新增角色、批量和重排浏览器场景未运行；编辑器与前台规格复审进行中。新增首页共享卡片与裁切资源限制在首轮构建之后修改，需要最终构建和回归。D02状态仍为开发中。首轮manifest登录107.77KB/文章123.66KB仅为该构建预算结果，最终版本需复测。

以上为首轮记录，最终2026-10-08 22:44代码验收完成：18作品PG+首页排序PG、全量104真实PG（16文件）、71unit（23文件），check/verify/build均退出0。只有既有Markdown外部图片warning。后端、编辑器/公开页、列表/回收站的规格与质量复审均批准。

复审实际修复并回归：原生GET默认sort空值400与tag遗失（旧构建真实浏览器RED→最终GREEN）；localStorage网格偏好及视图切换保留page=2；保存期间恢复按钮及div图集拖放由同步锁保护，延迟真实PATCH响应场景不会覆盖快照；不存在标签的POST/PATCH实际404，更新失败无部分写入。UI初写角色夹具误用了Project不存在的authorId，类型检查发现后已按id清理修正；删除/purge测试初将204误断言200，核对实际合同后修测试，这两项不算产品缺陷修复。

最终projects+logs+roles联合浏览器15passed/12skipped，无失败。跳过为桌面业务/移动追加场景在其他视口中的重复项。作品专项包括：真实1600×900裁切封面上传、首页精选、无正文详情、私有预览HTTP头、旧revision409、原生搜索保留标签、三端暗色/reduce/noJS详情、缩略图与390实际CDP横向触摸切图、当前页重排、批量一成功一冲突保留失败选择、删除404/恢复200/标题确认purge、EDITOR保存与purge403、VIEWER可选复制正文与写403/预览200。共享图集改动对日志的回归同时GREEN。

最终生产manifest：登录107771bytes（107.77KB）≤110KB，文章123660bytes（123.66KB）≤135KB。人工查看390详情失效占位截图；完整视觉/主题对比度、R2云和性能仍留F/G。D02已完成，D整阶段未完成，未提交/未push。

## 后续

D03时间线开发中：后端11unit/5项大PG场景，全量109PG通过，规格与质量审查批准。日期精度/当前优先/独立可见性/CAS/软删及About源查询已实现。首轮生产构建和timeline+roles浏览器5passed/4skipped，含YEAR保存、展开/无详情404、损坏本地JSON不阻塞服务器稿、409另存两个公开开关均关闭；32条经历三端当前项优先、移动折叠与无JS，EDITOR可写/VIEWER正文可复制与写403。后台列表9unit实现已交付，列表浏览器与审查待验；D04 About完整联动尚未实现。

时间线UI规格审查发现正文标题重复DOM id，已为每条及布局副本加前缀，markdown-prefix单元真实RED（只有2唯一ID）→GREEN（6唯一ID），文章默认锚点保持；32条浏览器夹具改用重复Markdown标题，需新构建回归。docs04重排示例已补revision，docs06月份专用旧合同修正为YEAR/MONTH/DAY。关于同页链接反馈正在核对：现有安全URL函数本来就不接受#fragment，不能把旧版span误报为加前缀后href回归。D03尚未完成，不能仅凭首轮浏览器或后端通过标记完成。

D03时间线开始登记实施；D04 About、D05分类标签、D06数据管理、D07用户、D08媒体库待开始。共享表单统一回归仍属于D整阶段范围；本记录不宣称D或全站完成。

### D03 浏览器复验（2026-10-09）

最新生产构建后的时间线/角色联合首轮5passed、6skipped、1failed：失败发生于键盘拖放测试未等待异步KeyboardSensor挂载，未发出重排请求。增加aria-pressed和目标区公告等待后，真实重排200通过。随后测试uncheck在受控开关服务端保存前检查即时DOM失败；改为点击并等待PATCH与最终checked状态。列表独立复跑1passed：同日期键盘拖拽只写当前组，日期组不可上移，visible/showOnAbout分别保存，删除204、恢复200、复制链接、标题确认purge204实际通过。以上两项为测试同步修正，没有修改产品代码。三端32条重复Markdown标题DOM ID唯一、暗色/reduce、无JS展开已通过。最新全量unit 97passed/29files；D04 About同源页面仍待实施，D03不标记全部完成。

### D03 核心及About联动验收完成；D04待最终质量复审（2026-10-09）

D03后端、列表、编辑器/前台规格及质量均批准。脚注重复ID新增真RED（12个ID仅2唯一）→GREEN：解析器脚注区块/引用节点按实例与块前缀隔离，往返链接和aria-describedby同步；普通同名标题不会误改，目录锚点保持。About浏览器实际验证visible=false/showOnAbout=true独立显示、修改Timeline名称后About刷新同步、关闭timeline后About经历消失且时间线404，D03最后依赖已通过，标记完成。

D04后端5真实PG/4unit，规格质量批准；整仓114PG/18files、108unit/33files，check/verify/build退出0。新增草稿形状恢复unit后需最终重跑unit；静态verify曾发现type-only hast未直接声明，已使用最小结构类型移除间接依赖，verify恢复通过。

前台与编辑器规格最终批准；quality待审。首轮About+timeline有测试定位status多匹配（Dnd直播区）修成明确文本匹配，产品保存已成功。修复后的最新联合日志/作品/Profile/Timeline/roles Playwright为25passed/20skipped，各视口真实展示，跳过为非目标视口业务。新Profile桌面补验3passed：优势删除撤销、图标搜索选择与键盘拖拽保存；真实PNG头像/PDF简历上传、HEAD链接测试、保存地址、恢复Profile引用后媒体DELETE200；删除后上传会结束旧撤销窗口；快速离开和未填完空标题稿可恢复、后续编辑终止撤销；三角色EDITOR可保存/VIEWER正文可复制且写403；revision409保留副本。前台联系方式false在About/首页/profile/site实际HTTP全无本人邮箱电话/mailto/tel；安全social保留。六区块关闭仍保留Hero；三端暗色/reduce/noJS/长文及200字符连续title/category/sociallabel无溢出。截图about-dark-390/820/1440已查看390，最终主题对比度与技能动效留F。

修复证据：快速离开原本3秒timer未落盘实际E2E RED→confirm/popstate即时保留后GREEN；本地稿原提交Schema会拒未完成输入，改形状校验、保存时校验业务；整份删除快照可能覆盖后续编辑，统一sync结束旧撤销窗口；390长连续标题实际RED溢出→min-w-0/break-words后联合三端GREEN。以上产品修复与测试定位修正分开记录。

最新manifest登录107787bytes（107.79KB）/文章126680bytes（126.68KB），仍低于110/135KB预算。未完成D整阶段，不提交、不push。

D04最终验收（2026-10-09）：全部后端/前端规格和质量批准。最终unit111/34files，check/build退出0，verify已通过；图标原型成员真实RED→Object.hasOwn安全回退GREEN，带点号电话真实RED→兼容GREEN。最终Profile+roles三端运行5pass6skip1fail为键盘拖拽测量就绪的测试竞态：手柄pressed早于droppable rect测量；增加初始移动到自身的无障碍公告等待后，结构化完整闭环连续两轮通过（2passed），其余三端/离开恢复/角色在该最终构建均通过。无产品拖拽逻辑变更。D04已完成，D整阶段仍未完成，不提交/不push。D05分类标签开始登记，合同已补03/04和02原模型revision；尚未实现。

## D05分类标签最终验收（2026-10-10）

后端Category/Tag revision迁移20261009153000_taxonomy_revision已部署开发/测试库，重跑无待迁移。独立backend规格/质量通过；frontend规格/质量经修复复审通过。真实PG全仓123/19files，unit最终118/36files，check/verify/build退出0，仅既有Markdown图片Lint警告。D05已完成，D整阶段仍未完成，不提交/push。

taxonomy+roles最终Playwright：8passed/10skipped，390/820/1440长名称无横向溢出、暗色/reduce、表格/标签云/筛选分页、删除末页回有效页；桌面完整分类两层创建、同级键盘排序、父删除422、叶删文章categoryId=null且revision++/正文保留、旧revision409；三模型标签merge预览去重3项/新增2项、关联目标去重、source删除、内容revision++、旧正文409、bulk删标签保留正文。EDITOR可维护/VIEWER无写控件且API403。

修复与实证：键盘向上原会命中相邻child实际RED，按同parent过滤keyboard rects和pointer collision后GREEN；手动slug350ms后被pinyin回调覆盖实际RED，回调二次检查manual flag后GREEN；SLUG_CONFLICT不再误报revision。单删/bulk/merge删除当前编辑项，clean清空、dirty保留转new并说明，不再PATCH已删ID404。合并重新预览清空旧影响。

未保存保护：支持Navigation API时原生后退confirm取消保留地址和form；Next先卸载popstate监听的真实失败已记录并改为pre-traverse。无Navigation API时按user/kind的sessionStorage恢复原revision，外部修改后恢复旧稿保存实际409。undo-to-clean原留下旧snapshot实际RED（1应0），localWrites只清本次写入快照后GREEN；初次待恢复稿不被误删。恢复稿形状strict但允许未完成字段。所有临时console/CDP诊断已移除。

环境恢复：Windows excludedports含5341–5440，Docker原5432无法绑定。保留personal-site_pgdata同卷重建使用15432，未reset或输出/修改.env；compose新增POSTGRES_PORT参数。确认开发库4篇文章、测试库5迁移仍在。此环境失败不算产品验收结果。新启动方法见11交接。

D05最终gzip生产manifest测量：登录107809bytes（107.81KB）<=110KB，文章126706bytes（126.71KB）<=135KB；scripts/measure-js.mjs退出0。

## D06数据管理验收（2026-10-10）

导出→严格预览联调实际发现旧seed“性能/工程化/重构”把中文直接作为slug，违反管理/恢复合同。新增SEED_TAGS固定合法slug，unit先缺模块RED后GREEN；迁移20261010000000_seed_tag_slugs开发/测试两库已部署。只改精确旧seed名/slug，ID/三模型关系保持，slug冲突使用-seed-N且既有目标/自定义不改，Tag及每篇关联内容revision递增。1条真实PG在固定SQL下验证以上规则及重跑幂等，退出0并disconnect；数据导入后端可继续原包恢复验收，不过滤坏包伪称成功。内部jobs.publication.cursor不属于用户可恢复设置，导出白名单及replace保留合同已修02。

root DataManager/DataFile及admin/data已实现文件初筛、下载、模式切换、预览计数/映射、10分钟凭证、替换文字确认、409重算与真实结果；3条客户端unit RED→GREEN，owned ESLint通过。2026-10-10本轮全仓check/verify退出0，124unit通过（39文件）；仅既有Markdown img警告。浏览器已完成完整原包下载、合并关系恢复、替换409及旧稿保护，测试原包保存Git忽略目录，恢复成功才删除。这是初次实现记录；审查后的最终结果见本节末尾D06最终验收。

2026-10-10追加真实结果：生产build退出0；最终data+roles Playwright为5passed/4skipped（完整恢复及角色流程仅1440，390/820/1440布局均运行）。真实下载完整JSON、预览报告无token、合并恢复分类父子/跨三模型标签/原文/未来发布时间/归档与软删除/隐藏经历精度、公开不可见、replace二次确认/业务变化409/重预览恢复/旧活跃文章PATCH revision冲突409均通过。文件重新选择和模式切换立即移除预览；Tab可经过映射折叠项到执行按钮并Enter完成；实际html.dark、reduce及无水平溢出通过。EDITOR/VIEWER export、preview、import均403。

浏览器开发测试两次RED为脚本假设错误：固定Tab次数漏掉details summary；对已软删除文章PATCH预期409而服务正确404。修正Tab遍历及fixture（活跃草稿文章、软删除归档作品）后最终GREEN；各次finally均真实replace恢复且ignored备份已清理。全量真实PG最终21文件136项通过（22:41:22启动，27.54秒），未操作开发库。当前gzip登录107816字节/107.82KB、文章126713字节/126.71KB，均在预算内。三端截图data-dark-390/820/1440.png，root已检查390长页。

前端规格/质量及seed迁移规格/安全审查已批准；后端规格两项P2（时间线导入日期边界/精度与motion完整字段）已红绿修复并经原审查者复审批准，该时点独立后端质量审查尚未完成，后续修复及最终批准见下文。

前端质量审查发现测试原包不能存.next（后续build会清理），已将浏览器恢复备份迁至独立/.test-backups/并加入Git忽略；后端集成测试同步修复。保留wx防覆盖、残留备份阻止再跑和恢复成功后删除规则；独立目录无敏感探针经真实生产build后原样保留，核验后仅删除探针。新路径data+roles浏览器最终再次5passed4skipped，恢复成功后两个原包备份均不存在，质量复审批准。

审查修复后最终门禁：build/check退出0，39文件126unit；21文件137真实PG通过（22:51:14启动，30.58秒），最新gzip登录107817字节、文章126714字节，两项预算通过。合法精度日期/完整动效原包不变，非法年份/不匹配精度/非UTC零时/缺动效字段均拒绝；详见data backend证据。

独立后端质量审查另发现生日ISO偏移漏洞：按字符串日期校验、按完整时间入库，会令日期偏移甚至跨9998年边界使Profile读取失败。已加专用生日UTC零时及年份范围校验，unit/PG RED明确旧逻辑接受偏移后GREEN；原审查者独立复现非法offset/年份/非零时拒绝、合法原包不变，质量复审批准。

D06最终验收：全部规格及质量审查通过；生产build退出0（仅既有Markdown img警告），39文件127unit、21文件138真实PG通过（22:58:05启动，29.24秒），最后一次data+roles浏览器5passed4skipped（17秒）。生日修复后完整原包恢复依然通过；两份测试原包均已成功恢复并清理。最新gzip登录107816字节/107.82KB、文章126713字节/126.71KB，预算通过。此为JSON内容迁移闭环验收，独立数据库/媒体灾备仍属G。D06标已完成，未提交，随D整阶段提交。

D07用户管理已登记开发中，合同补齐于03/04/02，root负责UI与浏览器，users_backend负责service/API/User revision迁移/真实PG；D08及E–G待开始。


## D07用户管理验证（2026-10-11）

后端User revision迁移两库部署且重跑无待部署项；服务/API规格及质量复审批准。登录邮箱变更竞态真实PG门闩RED明确旧邮箱在锁等待后错误登录成功，锁内邮箱重验后GREEN：401且无新Session、旧AT失效、新邮箱实际登录。相关user/auth26PG与user2unit通过，详见user backend证据。

前端原revision快照、409保留与显式加载最新、自己保护与账号安全入口、一次临时密码原生dialog及关闭清除、权限和互斥已实现。保存期间改变筛选竞态通过延迟真实PATCH响应确定RED：写完成刷新GET缺role；latestLoad修复后GREEN刷新请求role=VIEWER并保留当前列表。初轮脚本误将停用账号登录预期为401，原规范与服务正确返回403 ACCOUNT_DISABLED，修正脚本后通过；密码数字正则误报已由审查者核对原始字符撤回，无需修改。

最新users+roles真实Playwright 5passed/4skipped（18.1秒，390/820/1440布局全跑，完整生命周期及角色仅1440）。实际创建并登录、普通姓名/avatar修改保留会话、角色/停用/reset/revoke/email修改撤销会话、恢复登录、邮箱更新旧地址401新地址可登录；临时密码剪贴板复制正确并清理测试剪贴板、Escape及关闭按钮均清空，未进入storage。筛选分页刷新、active/role组合、未保存导航取消、暗色/reduce/键盘/无溢出截图已验证。EDITOR/VIEWER直访用户页无表单，list/create/update/reset/revoke全部403。

Windows新增2929–3028保留范围导致原3000服务EACCES；新增E2E_BASE_URL统一配置生产测试服务、Origin、runner及独立上下文，localhost白名单拒绝外部地址，切3100重建成功，未改.env。check/verify/build退出0，仅既有Markdown img警告；41文件132unit、22文件147真实PG通过（本机09:07:06启动，27.89秒，测试结束disconnect）。gzip登录107825字节/107.83KB、文章126722字节/126.72KB，通过110/135KB预算。前端规格复审批准，最后独立质量审查进行中；D07保持待验证，不能提前宣称一期完成。

D07最终质量复审批准。E2E地址环境加载前后不一致问题已将loadEnvFile移入共享base-url模块，配置与worker统一先加载再解析；相关eslint及浏览器最后再次5passed4skipped（18.1秒）通过。D07标已完成，随D整阶段提交；D08开发中。

## D08完整媒体与设置验证（2026-10-11）

媒体后端新增文件名/alt搜索、持久空目录及独立完整汇总、已验证对象秒传；权限、Origin、共享PG限流、原上传确认与引用保护保持权威服务核查。目录内部Setting不进入公开或内容导出，批量操作逐项使用现有授权写入口，保留失败选择和引用来源。后端规格/质量批准，9项新增真实PG及原媒体协议36项联合回归通过，详见phase-d-media-backend.md。fixture补高熵随机像素及双重归属清理后9PG再次通过。

前端媒体库实现URL搜索/类型/目录/分页、详情与真实引用、复制/编辑、批量移动/alt/删除、清理及原生选择器。上传队列最多50项、三路并发、真实XHR进度、独立失败重试；Local/R2均先鉴权秒传，服务端确认前不显示100%。六组22项设置以同一声明生成UI及schema，帮助/图片预览/媒体选择、null清空、未保存离开保护齐全。正文点击上传/粘贴/拖拽统一先进入选择器，确认非空描述后才插入，URL图片入口同样强制描述。

真实回归先复现选择器内粘贴冒泡：同一文件两次deduplicate请求且可能提前插正文；上传区捕获paste并隔离drop后GREEN。规格审查发现原直接插图及URL图片可空描述，文章上传回归在旧构建中明确RED（上传后选择器未打开），统一确认入口后GREEN。质量审查发现选择器目录form/默认分页按钮嵌入日志form会误提交宿主，新增有效标题正文的日志宿主测试在修复前RED（新目录操作导致日志保存重置、选择器提示消失），portal移出宿主DOM、双层submit隔离、分页显式button后GREEN；原审查者复审批准。

最终媒体设置+文章+角色真实浏览器10passed/8skipped（35.7秒）：390/820/1440文章完整发布阅读删除恢复、三端媒体设置暗色/reduce/键盘/无溢出；1440真实PNG与伪装415、秒传ID不变、断网独立重试、drop/paste、批量部分成功、软删引用保护、详情脏数据Escape取消、实际清理、Logo保存公开与清空、正文选择/必填描述、日志宿主隔离及EDITOR/VIEWER权限均通过。未把本地协议测试视为R2云验收。生产build退出0；142unit通过，check/verify退出0，新增测试Lint告警随后移除。gzip登录107902字节/107.90KB、文章126799字节/126.80KB，均在110/135KB预算。全量PG与整阶段浏览器回归仍在运行，D08保持待验证。

全量真实PG23文件156项通过（本机09:37:25开始，33.68秒）。整阶段Playwright96项首轮53passed/42skipped/1failed（2.7分钟），包括分钟任务实际60秒周期通过；唯一失败为分类键盘排序，Space启动后ArrowUp未移到同父前项。单项重跑通过不足以消除偶发问题，已登记调试并保留D整阶段待验证；不能将该轮记录为全通过或提交阶段D。媒体设置及其关联文章/角色均在该全量轮中通过。06原文ARCHIVED410冲突已改为权威404。

整合审查另确认taxonomy公开标签计数漏掉日志日期边界。增加未来记录日期非置顶/未来记录日期已置顶/未来发布时间已置顶三种真实fixture，旧实现RED返回hidden标签且log=1；复用现有publicLogWhere后全部taxonomy9PG GREEN（09:49:38，2.29秒）。未来日期仅置顶可公开，未来发布时间始终不公开；分类及其他资源过滤未改。规格/质量复审和整阶段最终回归仍待完成。

## D最终整阶段验收（2026-10-11）

D01–D08全部规格与质量复审批准。最终143unit/47文件、156真实PG/23文件、check/verify及生产build退出0；仅既有Markdown外部图片Lint警告。整套96浏览器54passed/42skipped（2.6分钟），含真实分钟发布。设备范围跳过不代表失败。

首轮分类键盘偶发失败已定位为Dnd监听器延后注册；等待真实监听器后同页30轮和独立10轮通过，最终全套通过，见taxonomy-keyboard记录。公开分类标签日志计数原漏未来日志日期过滤，新增真实PG红测后复用publicLogWhere，9项taxonomy及全156PG通过，规格质量复审批准。

整套浏览器之后发现404推荐硬编码文章路径，unit红测复现，改为启用模块公开DTO当前路径；全143unit及check通过。重新生产build后modules+foundation为4passed/2skipped（8.3秒），真实验证关闭隐藏和连续改路径后的404链接。此补验在全套回归之后，不将旧全套描述为新404代码的完整重跑。

最后生产manifest gzip登录107902字节（107.90KB）、文章126799字节（126.80KB），预算110/135KB通过。测试数据备份无残留；开发.env未修改。阶段D验收完成，可本地提交；E/F/G与云端R2仍待后续实际验收，不自动push。
