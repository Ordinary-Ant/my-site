# 10 · 开发状态台账

更新：2026-10-11。A–D已完成，E–G待开始；D01–D08已验收。状态仅用待开始/开发中/待验证/已完成；已完成须有实际证据，阶段通过后本地提交，禁止自动push。

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
| D01 | 日志CRUD/日历/图集 | C | 日期、类型、发布、软删、开关 | 已完成 | log API/UI/preview | [阶段D持续证据](verification/phase-d.md)，85全量PG/53unit/联合E2E9pass，规格质量复审通过 | 未提交（随D阶段） |
| D02 | 作品CRUD/筛选/详情 | C | 类型、外链、图集、发布与开关 | 已完成 | project API/UI、project-editor/pages/card、cover-crop | 全量104PG/71unit，联合浏览器15pass12skip，各组规格质量批准，见[阶段D证据](verification/phase-d.md) | 未提交（随D阶段） |
| D03 | 时间线/日期精度/排序/软删 | C | 当前/日期/同日期order/id，年/月/日保存 | 已完成 | timeline API/UI | 全部规格质量批准，5PG/11unit、三端及列表/角色/脚注唯一/与About实际同源开关联动通过，见阶段D证据 | 未提交（随D阶段） |
| D04 | About/Profile/联系方式边界 | C | 区块开关、revision409、全站联系方式隐藏 | 已完成 | profile API/UI/DTO | 全部规格质量批准，114PG/111unit、联合25E2E及最终构建补验，真实上传/排序/恢复/隐私/同源联动/三角色通过，见阶段D证据 | 未提交（随D阶段） |
| D05 | 分类标签管理与关系 | C | 分类标签CRUD、归属引用完整 | 已完成 | taxonomy service/API/manager、revision迁移 | 118unit/123PG、浏览器8pass10skip、规格质量复审批准，见阶段D及taxonomy后端证据 | 未提交（随D阶段） |
| D06 | 导入导出/备份数据关系 | C | 冲突映射、事务失败边界、数据可恢复 | 已完成 | data service/validator、export/import APIs、data-manager/data-file | 最终127unit/138PG、data+roles5pass4skip、build/check通过，全部spec/quality批准，时间线/motion/生日校验与独立恢复备份均复审，见阶段D及data backend证据 | 未提交（随D阶段） |
| D07 | 用户管理/停用/角色/会话撤销 | B,C | ADMIN管理、最后管理员保护、停用即时失效 | 已完成 | users API/UI/service | 132unit/147PG、users+roles5pass4skip18.1秒、build/check/verify通过，全部规格质量批准，见阶段D | 未提交（随D阶段） |
| D08 | 站点设置/完整媒体库 | B,C | 全配置、目录/引用/确认/清理/审计 | 已完成 | settings共享定义、media folders/deduplicate API、media-browser/picker/upload-queue | 全部规格质量复审批准；143unit/156PG，整套浏览器54pass42skip，404补验4pass2skip，check/verify/build及预算通过，见阶段D最终验收 | 未提交（随D阶段） |
| E01 | 搜索/SEO/RSS/sitemap | D | 全部公共过滤、当前路径、缓存失效 | 待开始 | search、metadata、feeds | 待补实际运行证据 | 未提交 |
| E02 | 分类标签归档/阅读统计 | D | 当前路径、计数去重、开关公共过滤 | 待开始 | archives/stats | 待实现证据 | 未提交 |
| E03 | metadata/JSON-LD/OG/分钟定时发布 | D | 未发布/软删不索引、图生成、调度鉴权失效 | 待开始 | SEO/publish job | 待实现证据 | 未提交 |
| F01 | 动效v2/升级/后台预览 | E | 四预设none/tint，reduce/卸载/预览一致 | 待开始 | motion runtime/UI | 待补实际运行证据 | 未提交 |
| F02 | 移动/平板/桌面视觉 | E | 移动首页横轨/导航4.5、平板单列、桌面中轴Logo | 待开始 | site/admin styles/screenshots | 待补实际运行证据 | 未提交 |
| G01 | CI/安全依赖和会话清理 | F | 持续检查、审计例外、过期记录清理 | 待开始 | CI、cleanup jobs | 待补实际运行证据 | 未提交 |
| G02 | 真实PG集成/三端E2E | F | 业务/权限/并发/缓存/媒体真实闭环 | 待开始 | tests、Playwright | 待补实际运行证据 | 未提交 |
| G03 | gzip性能/可访问性 | F | 文章135/动效28/登录110KB、键盘/对比度 | 待开始 | performance evidence | 待补实际运行证据 | 未提交 |
| G04 | 备份恢复/健康监控/上线准备 | F | DB和媒体恢复演练、回滚文档、授权内可逆部署验证，缺凭据阻塞；公开生产发布最终确认 | 待开始 | ops/docs | 待补实际运行证据 | 未提交 |

## 环境事实与证据规则
协调记录：本地PostgreSQL已healthy，开发/独立_test两库迁移通过，publication_backfill回填已发布空时间，seed连续执行两次无重复；check/verify/build通过，Vitest5项unit+3项真实PG integration通过，Playwright390/820/1440首页可读无溢出3项通过；干净安装后的最终检查已全通过，A验收完成；CI远端尚未运行。命令、退出码、截图、数据库结果由执行者核实后更新，禁止推测。09报告是修订前审查快照，不能用旧事实覆盖当前运行结果。每阶段结束更新11交接，记录未完成、风险、下一步与实际提交hash。
