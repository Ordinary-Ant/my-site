# 12 · 已批准一期实施计划

2026-10-07决策。保留现有Next.js工程及33个HTML/45张截图，先统一合同，再文章纵向闭环，再扩展模块。45–65人日为估算，按实际验收调整。

| 阶段 | 范围 | 验收出口 |
|---|---|---|
| A | 基础治理：文档/环境/版本/Schema/迁移/seed/测试基线 | 原文合同一致、真实PG证据与可恢复台账 |
| B | 文章闭环：auth/权限/编辑器/媒体/预览/发布/阅读/软删 | 三角色/会话重放/Markdown往返/真实发布阅读闭环 |
| C | 模块闭环：开关/导航/首页/config/动态改路由/审计/撤销 | 全入口5秒新请求、深合并、唯一路径/301保留详情query |
| D | 完整内容系统：日志/作品/时间线/About/taxonomy/users/settings/media/数据 | CRUD/日期精度排序/revision409/联系方式隐藏/数据恢复 |
| E | 搜索SEO：搜索/归档/统计/RSS/sitemap/metadata/JSON-LD/OG/定时 | 全部公共过滤、当前路径、分钟发布失效和真实内容 |
| F | 动效：version2四预设/运行时/后台预览/降级/预算 | none/tint、reduce/生命周期、三端视觉、gzip实测 |
| G | 发布准备：CI/安全/E2E/性能/备份恢复/部署验证 | 环境隔离、恢复演练、实际云功能验收；2026-10-13用户允许LCP暂缓交付，运维未配置项如实保留 |
## 一期关键决策
Next.js15.5 / Edge兼容middleware + Node路由查询；service授权、AT sid与用户停用校验；ADMIN/EDITOR/VIEWER权限矩阵。RT事务原子轮转、10秒宽限复用同一后继凭证，超时旧token重放撤销全会话；共享PostgreSQL限流。

公开内容检查模块/类型、PUBLISHED、publishedAt<=now、未软删；分钟定时发布；revision冲突409；24h预览no-store/noindex。配置已知嵌套键合并、数组替换、可空字段null清空、严格拒绝未知。动态路径唯一、保护保留路径/子路径、RouteAlias保留全部历史路径301直达当前路径且保留详情/query。

contactVisible=false全站移除公开email/phone与mailto/tel，含首页页脚social/metadata/JSON-LD。时间线当前项/日期/同日期order/id排序，保留年/月/日精度和软删。动效v2四预设默认editorial+none，仅none/tint静态装饰，详见08。

Local开发与生产对象存储隔离；2026-10-12改用同项目Supabase Storage替代无法开通的R2，私有临时直传后确认magic/大小/归属，保护引用；S3驱动适配及真实云端上传、确认、读取与删除已验收。保存后5秒指新请求。文章135KB/动效28KB/登录110KB gzip。移动首页作品横轨，平板时间线单列，桌面中轴，Logo回首页，移动导航对比度≥4.5。

首页默认区块顺序统一为Hero→精选作品（order=2）→最新文章（3）→最新日志（4）→近期经历（5），以06及首页设计为准。后台现有自定义顺序优先；数据迁移仅修复仍完整等于旧seed默认配置的顺序，不覆盖已编辑配置。

## 交付规则
真实PostgreSQL测试，阶段验收后本地提交，仅明确授权后push；2026-10-12用户授权推送origin的main，不强推或擅自合并master。部署验证在授权范围内执行，缺凭据记录阻塞。细功能登记依赖、验收、状态、代码、证据、提交；恢复先读Git/台账/交接。一期不做评论、注册、订阅、i18n、PWA。当前A–F已验收提交；2026-10-13已公开交付：https://my-site-tgqonxxy.edgeone.dev，EdgeOne国际站my-site，当前部署dp2ry69pr5hy。实际云API、真实浏览器登录/CSP/CORS上传、三端首页、文章与开关/连续301闭环26项、三角色15项全部通过；临时探针已清理。Supabase PG17.11/8迁移与公开/私有Storage两桶已接入。分钟发布实际3次200，维护稳定版本连续5次200；每日维护及五分钟健康调度已配置，外部告警和自动独立备份尚未配置。 2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。 实际证据和最新状态以10台账、11交接及15为准。

## 阶段 E 实施合同（2026-10-11）

搜索遵循03全局SQL分页和公开隐私边界。分类/标签归档使用当前文章模块路径/category或tag/slug；分类根汇总自己和直接子分类，标签归档仅文章，其他资源保留各自标签筛选；不存在或无公开文章的归档404。关闭或改路径后搜索、归档、RSS、sitemap、OG一致隐藏或更新。

阅读统计采用签名HttpOnly匿名cookie（固定30天，生产HTTPS secure），数据库仅保存匿名标识哈希，不保存IP。ViewReceipt唯一(resource,contentId,visitorHash)，保存windowExpiresAt、countedDate及最近成功计数updatedAt；锁定稳定身份后取数据库时间，30分钟内重复不修改任何计数和时间。首次PV/当日UV各加1，同日超窗PV加1/UV不加；跨午夜仍受30分钟窗口限制，次日首次成功计数才增加次日UV。UV指成功计数的匿名身份，不能描述为真实人数；无cookie首次并发可能形成不同匿名身份，已持同cookie的并发必须严格去重。请求不能传计数、路径或时间。DNT/GPC与常见bot跳过，Origin/PG限流仍有效。内容viewCount、receipt及DailyStat原子事务，不更新内容revision或updatedAt。G清理最近成功计数超过30天的receipt，不能按30分钟窗口清理。

DailyStat新增resource/contentId稳定维度，唯一(date,resource,contentId)，date为北京时间日历日期；path仅展示快照，统计链接从当前内容ID解析。旧数据迁为resource=legacy/contentId=旧path且保留原统计，不假装可关联现有内容。管理员统计使用真实未删除状态计数、北京时间最近7日及真实Top内容；备份无来源时lastBackupAt=null。

RSS合并最近50条公开文章/日志，摘要纯文本/XML转义，GUID为资源/ID，关闭全部仍返回有效空feed。sitemap包含启用列表、公开详情、可见分类标签归档及About/时间线；不包含别名/私有/搜索。robots禁止admin/api/login/preview/search，固定分享图/api/v1/og使用既有api保留路径，OG仅公开站点或已公开内容，缺失/关闭内容404，不抓取任意远程图片。SEO输出当前canonical、公开DTO的结构化数据，JSON-LD转义小于号等字符防脚本闭合。一期公开页面与SEO路由force-dynamic/no-store，不使用旧300–3600秒ISR合同；保留未来缓存依赖tag失效。

robots仍禁止普通/api抓取，但明确Allow: /api/v1/og，允许分享图读取。图片端点复用既有/api保留空间，D阶段合法的/og栏目和历史别名不受抢占。

G性能补验约定：元数据在首份HTML的head完整输出，避免流式标签对无JS读取与检测造成不一致。Lighthouse SEO门槛适用于可索引页面；搜索/预览/后台保留禁止索引合同，报告原始分数并仅豁免预期索引限制检查，其余适用项按原门槛验证。
