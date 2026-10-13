# 10 · 开发状态台账

更新：2026-10-13。A–F已完成，G已公开交付并保留用户批准的首页LCP待办及未配置运维项。常规状态为待开始/开发中/待验证/已完成；“已交付、保留待办”仅用于用户明确接受的范围，不代表该指标达标。提交ae15613已推送origin/main，远端CI见verification/release-final.json。

| 编号 | 细功能 | 依赖 | 验收 | 状态 | 代码/文档入口（规划或现有） | 证据 | 提交 |
|---|---|---|---|---|---|---|---|
| A01 | 原文规范/一期决策统一 | 无 | 旧冲突移除，01–08/README/设计一致 | 已完成 | docs/01–08、12；AGENTS.md | [阶段A实测](verification/phase-a.md) | 66dca93 |
| A02 | 开发/测试环境与依赖基线 | A01 | Node/npm可复现，依赖安全项审查 | 已完成 | package.json、lock、.env.example | [阶段A实测](verification/phase-a.md) | 66dca93 |
| A03 | Schema/迁移/seed真实PG | A01,A02 | 真实Postgres迁移、seed、约束可执行 | 已完成 | prisma/schema.prisma、migrations、seed.ts | [阶段A实测](verification/phase-a.md) | 66dca93 |
| A04 | 动效/模块配置校验统一 | A01 | v2/嵌套patch/数组/null/未知字段测试 | 已完成 | src/config、src/lib/validators | [阶段A实测](verification/phase-a.md) | 66dca93 |
| A05 | CI/测试基线/阶段证据 | A02,A03 | check/verify/build、真实PG基础测试 | 已完成 | tests、.github、scripts | [阶段A实测](verification/phase-a.md) | 66dca93 |
| A06 | 台账/恢复交接/本地提交规则 | A01 | 细功能、依赖、证据、提交可追溯 | 已完成 | docs/10、11、AGENTS.md | [阶段A实测](verification/phase-a.md) | 66dca93 |
| B01 | 登录/AT sid/用户停用 | A | 登录、有效会话、停用立即拦截 | 已完成 | src/lib/auth、services | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B02 | RT原子轮转/10秒宽限/重放 | A | 并发同后继、超时重放撤销全会话 | 已完成 | auth、Session | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B03 | 登出/密码/会话管理 | A | 撤销立即生效、安全next/草稿恢复 | 已完成 | auth API | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B04 | 三角色/Origin/service授权 | A | 每入口按权限、VIEWER可读、写越权拒绝 | 已完成 | rbac、services、middleware | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B05 | 共享PG限流/审计 | A | 多实例窗口一致、敏感日志脱敏 | 已完成 | RateLimit、AuditLog | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B06 | 后台壳/登录/仪表盘 | A | 三角色入口与错误状态可用 | 已完成 | admin UI | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B07 | 文章CRUD/分类标签关联 | A | 创建编辑读取、字段清空与slug约束 | 已完成 | article service/API/UI | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B08 | revision并发/软删恢复 | A | 旧revision409，回收站/恢复/purge授权 | 已完成 | article service | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B09 | 发布/分钟调度/24h预览 | A | 未来不公开，到期失效；preview隔离 | 已完成 | publish job、PreviewToken | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B10 | 文章列表详情/Markdown阅读 | A | 真实文/TOC/代码/SEO与公共过滤 | 已完成 | site articles、renderer | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B11 | Local/R2直传确认/媒体库 | A | 隔离、magic/大小/归属、临时清理 | 已完成 | storage、media API/UI | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B12 | 媒体引用保护/编辑器往返 | A | 引用阻止删除，真实Markdown不丢语义 | 已完成 | renderer、editor、reference scanner | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| B13 | 预览/slug完整UI | A | 24h到期、不缓存不索引、最终唯一约束 | 已完成 | preview UI/API | [阶段B实测](verification/phase-b.md) | c5fe0c6 |
| C01 | 模块关闭恢复/缓存5秒 | B | 新请求全部入口隐藏/恢复，数据保留 | 已完成 | module service、cache | [阶段C证据](verification/phase-c.md) | cc9fb5d |
| C02 | 动态路由/唯一/历史别名 | B | 301直达当前、详情query保留、无抢占循环 | 已完成 | middleware、RouteAlias | [阶段C证据](verification/phase-c.md) | cc9fb5d |
| C03 | 配置/开关中心/设置 | B | 已知嵌套合并/数组替换/null/拒绝未知 | 已完成 | module/settings service/UI | [阶段C证据](verification/phase-c.md) | cc9fb5d |
| C04 | 导航/首页聚合/审计/撤销 | B,C01–03 | 开关导航首页联动、排序条数、审计可回溯和撤销 | 已完成 | home/module/audit | [阶段C证据](verification/phase-c.md) | cc9fb5d |
| D01 | 日志CRUD/日历/图集 | C | 日期、类型、发布、软删、开关 | 已完成 | log API/UI/preview | [阶段D持续证据](verification/phase-d.md)，85全量PG/53unit/联合E2E9pass，规格质量复审通过 | 80347bc |
| D02 | 作品CRUD/筛选/详情 | C | 类型、外链、图集、发布与开关 | 已完成 | project API/UI、project-editor/pages/card、cover-crop | 全量104PG/71unit，联合浏览器15pass12skip，各组规格质量批准，见[阶段D证据](verification/phase-d.md) | 80347bc |
| D03 | 时间线/日期精度/排序/软删 | C | 当前/日期/同日期order/id，年/月/日保存 | 已完成 | timeline API/UI | 全部规格质量批准，5PG/11unit、三端及列表/角色/脚注唯一/与About实际同源开关联动通过，见阶段D证据 | 80347bc |
| D04 | About/Profile/联系方式边界 | C | 区块开关、revision409、全站联系方式隐藏 | 已完成 | profile API/UI/DTO | 全部规格质量批准，114PG/111unit、联合25E2E及最终构建补验，真实上传/排序/恢复/隐私/同源联动/三角色通过，见阶段D证据 | 80347bc |
| D05 | 分类标签管理与关系 | C | 分类标签CRUD、归属引用完整 | 已完成 | taxonomy service/API/manager、revision迁移 | 118unit/123PG、浏览器8pass10skip、规格质量复审批准，见阶段D及taxonomy后端证据 | 80347bc |
| D06 | 导入导出/备份数据关系 | C | 冲突映射、事务失败边界、数据可恢复 | 已完成 | data service/validator、export/import APIs、data-manager/data-file | 最终127unit/138PG、data+roles5pass4skip、build/check通过，全部spec/quality批准，时间线/motion/生日校验与独立恢复备份均复审，见阶段D及data backend证据 | 80347bc |
| D07 | 用户管理/停用/角色/会话撤销 | B,C | ADMIN管理、最后管理员保护、停用即时失效 | 已完成 | users API/UI/service | 132unit/147PG、users+roles5pass4skip18.1秒、build/check/verify通过，全部规格质量批准，见阶段D | 80347bc |
| D08 | 站点设置/完整媒体库 | B,C | 全配置、目录/引用/确认/清理/审计 | 已完成 | settings共享定义、media folders/deduplicate API、media-browser/picker/upload-queue | 全部规格质量复审批准；143unit/156PG，整套浏览器54pass42skip，404补验4pass2skip，check/verify/build及预算通过，见阶段D最终验收 | 80347bc |
| E01 | 搜索/SEO/RSS/sitemap | D | 全部公共过滤、当前路径、缓存失效 | 已完成 | search、metadata、feeds | 152unit/167真实PG、全102浏览器58pass44skip及补验6pass6skip，规格/质量批准，见[阶段E证据](verification/phase-e.md) | bd11e90 |
| E02 | 分类标签归档/阅读统计 | D | 当前路径、计数去重、开关公共过滤 | 已完成 | archives/stats | 152unit/167真实PG、全102浏览器58pass44skip及补验6pass6skip，规格/质量批准，见[阶段E证据](verification/phase-e.md) | bd11e90 |
| E03 | metadata/JSON-LD/OG/分钟定时发布 | D | 未发布/软删不索引、图生成、调度鉴权失效 | 已完成 | SEO/publish job | 152unit/167真实PG、全102浏览器58pass44skip及补验6pass6skip，规格/质量批准，见[阶段E证据](verification/phase-e.md) | bd11e90 |
| F01 | 动效v2/升级/后台预览 | E | 四预设none/tint，reduce/卸载/预览一致 | 已完成 | motion runtime/UI | 164unit/174PG、整套浏览器62pass46skip，安全区补验7pass2skip；规格质量通过，见[阶段F证据](verification/phase-f.md) | aa2775b |
| F02 | 移动/平板/桌面视觉 | E | 移动首页横轨/导航4.5、平板单列、桌面中轴Logo | 已完成 | site/admin styles/screenshots | 164unit/174PG、整套浏览器62pass46skip，安全区补验7pass2skip；规格质量通过，见[阶段F证据](verification/phase-f.md) | aa2775b |
| G01 | CI/安全依赖和会话清理 | F | 安全门禁、过期清理、远端CI | 已完成 | CI、csp/middleware、maintenance | 生产audit及最终检查见release-final；远端CI38410370425全部通过 | ae15613 |
| G02 | 真实PG集成/三端E2E | F | 权限/并发/缓存/媒体闭环 | 已完成 | tests、Playwright | 177真实PG；最新本地111浏览器65pass46skip；云端补验详JSON | ae15613 |
| G03 | gzip性能/可访问性 | F | 135/28/110KB、Lighthouse及LCP | 已交付，LCP待优化（用户批准） | performance evidence | gzip通过；移动首页99分/LCP2021ms，目标2000ms未达；正确桌面全100，见lighthouse/README | ae15613 |
| G04 | 本地备份恢复/健康/操作手册 | F | DB和媒体隔离恢复、健康最小状态、回滚文档 | 已完成 | backup、health、docs13/14 | 23表/8迁移/13外键/1媒体及完整内容哈希/损坏拒绝/原库未变实测，质量规格批准 | ae15613 |
| G05 | EdgeOne/Supabase云部署与运维 | G01–04 | 实际云闭环、调度、备份恢复、CI | 已交付，自动备份/外部告警待配置 | docs/14/15/18、云证据 | dp2ry69pr5hy功能通过，分钟调度实测，独立手动备份恢复通过；远端CI全部通过 | ae15613 |

## 环境事实与证据规则

### G06 · 新环境CI测试库初始化（已完成，2026-10-13）

- 依赖：G01/G02；触发：main ae15613远端CI的全新测试库没有种子数据，27项失败、7项跳过，不能记为通过。
- 验收：独立新建`*_test`库执行test:db后具备栏目、Profile、设置与分类标签；真实PG全量通过，并核对GitHub CI。
- 入口：scripts/prepare-test-db.ts、tests/integration/foundation.test.ts；先在全新独立库记录失败，再修复初始化，禁止改开发/生产库及放宽业务断言。
- 结果：Docker恢复后在新建personal_site_release_ci_test真实复现栏目为空的RED；迁移后对同一目标库seed，基础2项GREEN，全量28文件178项PG通过。未改应用运行逻辑、不放宽业务断言；第一次数据库不可达仅属环境失败。修复提交ae89eb9已推送，远端CI38410370425：192unit/178PG、生产build、E2E65pass46skip全部通过；独立审查通过，不将首轮失败算通过。

协调记录：本地PostgreSQL已healthy，开发/独立_test两库迁移通过，publication_backfill回填已发布空时间，seed连续执行两次无重复；check/verify/build通过，Vitest5项unit+3项真实PG integration通过，Playwright390/820/1440首页可读无溢出3项通过；干净安装后的最终检查已全通过，A验收完成；CI远端尚未运行。命令、退出码、截图、数据库结果由执行者核实后更新，禁止推测。09报告是修订前审查快照，不能用旧事实覆盖当前运行结果。每阶段结束更新11交接，记录未完成、风险、下一步与实际提交hash。

## G交付与剩余事项（2026-10-13）

2026-10-13已公开交付：https://my-site-tgqonxxy.edgeone.dev，EdgeOne国际站my-site，当前部署dp2ry69pr5hy。实际云API、真实浏览器登录/CSP/CORS上传、三端首页、文章与开关/连续301闭环26项、三角色15项全部通过；临时探针已清理。Supabase PG17.11/8迁移与公开/私有Storage两桶已接入。分钟发布实际3次200，维护稳定版本连续5次200；每日维护及五分钟健康调度已配置，外部告警和自动独立备份尚未配置。

2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。

云端验收详verification/edgeone-cloud-*.json；云数据库最终备份及恢复详cloud-release-restore.json，两桶独立本机快照详cloud-media-backup.json。无内容样本的空桶快照不能冒充对象恢复演练；本地媒体恢复已有哈希证据。自动异地备份的目的地、加密/保留策略与告警接收人尚未配置；自定义域名稍后绑定。当前Upload项目不会因Git push自动部署。

独立审查无阻塞问题；P2待办：prepare脚本对globalThis._ENTRIES移除增加唯一匹配断言及真实webpack夹具；当前实际产物VM并发隔离已通过。
