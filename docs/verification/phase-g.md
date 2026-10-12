# G当前交付状态（2026-10-13）

2026-10-13已公开交付：https://my-site-tgqonxxy.edgeone.dev，EdgeOne国际站my-site，当前部署dp2ry69pr5hy。实际云API、真实浏览器登录/CSP/CORS上传、三端首页、文章与开关/连续301闭环26项、三角色15项全部通过；临时探针已清理。Supabase PG17.11/8迁移与公开/私有Storage两桶已接入。分钟发布实际3次200，维护稳定版本连续5次200；每日维护及五分钟健康调度已配置，外部告警和自动独立备份尚未配置。

2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。

最新本地E2E共111：65pass/46skip；后续云兼容守卫以单元、正式Linux构建和真实云闭环验证，未虚报再次Windows整套E2E。最终check/unit/verify/audit及远端CI结果见release-final.json。

以下为历次诊断记录，早期待验证和未提交描述仅指当时，不作为当前状态。

# G · 本地发布准备验收记录

2026-10-11，基于F提交aa2775b。用户决定生产配置稍后提供；本阶段云端部署/R2/远端备份/生产Cron未验证。**本地G尚未整阶段验收：Lighthouse首轮已测、修复后复验待完成，不提交本阶段。**

## 已实际完成

- 每请求nonce CSP下发并透传Next，覆盖伪造nonce/CSP；主题和JSON-LD带nonce，预览同样受保护。真实三端浏览器验证正常脚本无违规、不可信HTML解析器脚本被拦、登录及主题正常。初始F构建缺少CSP真实RED；实现后GREEN。测试曾错误用CDP可信脚本创建子脚本模拟注入，strict-dynamic本来允许受信传播，已改真实HTML解析器注入，未因此削弱策略。
- /api/health只返回版本/最小DB状态，无缓存；正常真实PG 200由浏览器验证，故障503和异常脱敏单元通过；事务2秒statement timeout/2秒等待/3秒事务超时。
- /api/v1/jobs/maintenance独立Bearer权限，清过期会话、预览、限流、最近成功计数超30天收据，保留未过期旧RT摘要。数据库事务锁防重入；rotationReply仅超过10000ms清空。复审发现恰好10秒旧SQL提前清回复，真实PG冻结事务时间RED→GREEN，10000ms保留/10001ms清除。每日一次runner只输出固定状态，不泄露响应或凭据。
- 独立备份恢复实测通过：23表、8迁移、13已验证外键、1媒体。所有表内容哈希相同；源DB/媒体未变；损坏备份在创建目标库前拒绝。详见phase-g-backup.md与phase-g-restore-summary.json。原包仅在Git忽略目录，未提交。
- CI新增生产依赖审计门禁与动效体积artifact；远端Actions没有运行，未push。
- 最后172unit/58文件、177真实PG/28文件（34.82秒）、check/verify/生产build退出0。Lint仅既有Markdown图片warning。加入CSP后的完整111浏览器65passed/46skipped（2.9分钟），三端及实际分钟发布均通过；最后维护SQL边界修正后新增PG测试与重构建通过，前台未再变化。
- 当前生产gzip登录107975字节、文章128418字节、动效20986字节；均低于110/135/28KB预算。gzip不替代Lighthouse。
- 生产npm audit --omit=dev为0漏洞；完整audit有5个high，来源为eslint-config-next→@next/eslint-plugin-next→fast-glob→micromatch→braces开发链。[维护公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)当前无修复版本；涉及深层brace模式栈耗尽。运行时不含该开发链，构建/静态检查只用仓库受控模式，不接受用户传入glob。不force降级Next至14；例外仅限开发链，后续安装/升级重新audit，生产漏洞门禁保留。

## 未完成与恢复

Lighthouse13.5.0已对页面完成首轮测量，结果及后续修复见下文。最初CLI已可用但未能启动服务：自动审批两次拒绝启动本地生产服务：先npm run start -- --port 3100，再限定--hostname localhost仍拒绝，唯一返回原因“blocked by policy”。未绕过执行限制，未伪造Performance/A11y/Best Practices/SEO分数。待本地服务可用后，在生产构建、真实PG、无登录浏览器条件下对首页/文章/搜索逐项测移动和桌面，核实Performance≥85/95与01其他指标门槛。

备份演练包.backups/phase-g-local-drill-20261011，隔离库phase_g_local_20261011_restore_test与.restore-test同名目录保留，损坏副本phase-g-corrupt-20261011仅供拒绝证明；不要覆盖或当生产备份。新演练使用新名字，不DROP/clean原库。已核对的旧Origin误传恢复包origin-failure-reviewed.json在.test-backups保留，不是待恢复包。

规格复审已批准；独立质量复审已批准（仅实现质量，不代表整阶段验收）。继续先读11交接，核实Git/环境；当时未解决性能实测与阶段验收，未提交或推送；当前按用户2026-10-13明确暂缓LCP决定交付。

## 2026-10-12 性能首测与元数据修复

用户修正PowerShell环境变量后，健康/首页/文章/搜索均HTTP200。Lighthouse13.5.0、Chromium153、真实本地PG、生产next start、匿名独立浏览器；mobile默认模拟节流、desktop官方预设。报告位于lighthouse目录，summary.json保留原始设置/指标与错误。CLI启动器spawn UNKNOWN，但同一Chromium经Playwright启动并连接CDP可测，未替换浏览器或节流预算。

首轮首页移动94/桌面100，A11y/Best Practices/SEO均100。文章移动首轮Tracing.start Peer disconnected导致Performance=null，该报告无效，未作为验收；后续移动99、桌面100。文章SEO曾92/100波动，真实禁JS/启JS页面均复现description有时位于body；严格无JS head断言实际失败0!==1。已使用htmlLimitedBots全UA阻塞metadata流式输出，追加真实无JS浏览器回归；修后check/build/verify退出0，173unit通过，gzip文章128418/动效20986字节通过，等待用户重启后GREEN与最终六场景。

搜索SEO原始66，仅is-crawlable失败；这是既定noindex/robots规则，不删除规则凑分，13/12已明确仅预期禁止索引检查豁免，其余SEO项仍验收。首页首测LCP2264ms超过01的2000ms目标，不能仅凭Performance达标宣称所有指标通过；重构建后需复测并保留原始失败证据。INP需交互/现场测量，Lighthouse TBT不能冒充INP。

### 元数据GREEN与性能拆包续验

元数据修复新包四入口200；禁JS文章head description/canonical连续10次通过。完整六场景无audit错误：移动首页97/文章99/搜索99，桌面均100；A11y/Best Practices均100，可索引页面SEO100，搜索SEO66仅is-crawlable预期失败。首页/文章移动LCP2070/2050ms，追加两轮首页2029/2046、文章2058/1737ms，未以挑选最高分或最好单次结果冒充全部达标。

随后getPublicSite仅RSC请求内React cache去重，导航仅传5个必要字段；真实PG177/28文件（42.04秒）、173unit通过，check/build通过。首页HTML45490→43493字节；第二包六场景Performance移动98–99/桌面100，但移动LCP首页2189/文章2041/搜索2069ms，仍未达2000ms，未宣称优化已达标。进一步证据：公共catchall客户端chunk25568字节含后台“搜索图标”和日志日历；About误复用带选择器的admin client模块。已拆静态共享ProfileIcon，后台选择器保持原职责；日志/作品/About交互使用next/dynamic，保留SSR，只加载当前实际使用组件。该变更后173unit、tsc通过，正在新生产构建；未完成浏览器/性能复验前继续待验证。

### 2026-10-12最终构建恢复点

服务端dynamic未实际隔离日志脚本，网络检查仍包含日历，未将其记为成功。已改客户端content-widgets边界：隔离目录构建通过，Link依赖无日历/后台选择器，公共入口7.76→2.26KB；主工作区重新构建后2257字节。最终173unit/check/verify/build通过；真实PG177是同轮服务读取去重后结果，后续变更仅组件分包/类型与Lint忽略。最终浏览器三端+无JS27通过；最初networkidle超时、错误猜测/projects及未关闭菜单拦截点击均属探针步骤问题，已按实际模块路由、DOMContentLoaded和正常关闭菜单重跑，未force点击或修改站点规避。

最终移动每页3次Performance中位：首页99/文章99/搜索100，桌面均100；A11y/Best Practices100，可索引SEO100，搜索66仅预期is-crawlable。CLS0；LCP移动中位首页2024、文章1899、搜索1898ms，首页仍超2000ms，不将G03标完成。实验室Event Timing移动/桌面最大16ms，不冒充现场INP。最终gzip108096/120927/20986字节全通过；详lighthouse/README及summary、交互和27项JSON。新增E2E代码本轮未跑完整框架，等效公开无JS检查已过，完整E2E仍需最新包复验。

用户手动启动的最终服务当前在3100；不擅自停服/覆盖.next。下一步先在隔离环境验证首页预取等开销，随后合并验证与EdgeOne兼容性修正一起重构建，减少手动启停。G阶段代码继续未提交；独立候选与资源文档可提交，不代表G验收或公开生产发布。
