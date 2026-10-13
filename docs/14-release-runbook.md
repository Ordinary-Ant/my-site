# 14 · 发布与恢复操作手册

2026-10-13已公开交付：https://my-site-tgqonxxy.edgeone.dev，EdgeOne国际站my-site，当前部署dp2ry69pr5hy。实际云API、真实浏览器登录/CSP/CORS上传、三端首页、文章与开关/连续301闭环26项、三角色15项全部通过；临时探针已清理。Supabase PG17.11/8迁移与公开/私有Storage两桶已接入。分钟发布实际3次200，维护稳定版本连续5次200；每日维护及五分钟健康调度已配置，外部告警和自动独立备份尚未配置。

用户已授权公开发布与main推送，不再索要同一发布确认。先读AGENTS、10台账、11交接；不覆盖.env、不打印密钥。

## 本地复验

Node24、Docker PostgreSQL16（15432），独立_test库；已有8迁移先检查status，不reset。check、verify、unit、相关真实PG、生产build、test:e2e按顺序执行；Windows不要在服务运行中覆盖.next或并行生成锁定的Prisma DLL。Lighthouse用匿名浏览器、真实PG、生产构建；移动至少3次，桌面传官方desktop配置对象，不能只传无效preset选项。

2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。

## EdgeOne复现发布

当前为Upload项目，Git push不会自动更新网站。正式CLI固定1.6.41，需独立Linux源目录和依赖，不复制.env、.storage、.backups、.test-backups或Windows引擎；构建阶段仅使用无真实秘密的受控变量。root edgeone.json保留npm ci及npm run build；隔离环境已安装依赖时才可显式跳过重复安装。

1. 在干净隔离目录执行makers build --mode prod；检查正式退出码及非空compiled-middleware.js。实际云函数Node20.19要求rhel-openssl-1.1.x，不能只看构建Node24.18.0。
2. 使用scripts/prepare-edgeone-artifact.mjs对生成.edgeone产物执行公开环境白名单清洗及每请求平台fetch闭包适配，执行 node <仓库绝对路径>/scripts/prepare-edgeone-artifact.mjs <隔离项目根目录>，不是传.edgeone子目录；配置以公开Origin环境变量提供。仅保留公开Origin，预期3处环境注入；模板不匹配或重复适配拒绝继续。该步骤不可省略，也不在直接Git远端构建中自动执行。
3. 扫描实际凭据、环境文件、外部链接，核验运行环境白名单；Token仅CLI进程环境，迁移/初始化管理员凭据不上传。Production/Preview平台分别配置服务器运行键，值不写文档。
4. 仅部署审查后的.edgeone目录：makers deploy <产物目录> -n my-site -e production -a overseas --skip-ai-gateway-sync。Token不写命令参数。记录部署ID及实际访问状态；平台Success不等于功能成功。
5. 稳定版本验收健康、浏览器登录/CSP、私有直传/确认/公开读取/删除、三角色停用/撤销、草稿预览与发布、revision409、模块开关、多次301及query、RSS/sitemap、调度。临时探针按自身ID清理，不删用户数据。

## 调度与监控

Supabase pg_cron+pg_net，密钥和站点Origin保存在Vault：publication每分钟，maintenance每日UTC19:15（北京时间次日03:15），health每5分钟。机器入口只接受独立Bearer。分钟任务已有3次实际200；每日维护手动连续5次200，2026-10-13已查到每日计划实际调度成功，但该次HTTP响应已超过保留期，不能把调度成功等同HTTP200。健康状态保存在响应表，外部告警接收方尚未配置。运行角色无Vault读取能力，不把平台扩展管理的net PUBLIC usage说成已撤销。

## 备份、恢复与回滚

本地完整数据库/媒体演练见verification/phase-g-backup.md；云PG17最终独立本机备份及隔离恢复见cloud-release-restore.json。备份包只在Git忽略.backups，包含敏感数据，不上传代码远端或聊天。两桶当前为空，独立媒体快照已验证文件哈希，不能声称空桶已完成非空对象恢复。自动异地备份目的地、加密/保留策略、周期与外部告警仍待配置。

事故先停写、保留现场及新备份；应用切回此前功能验证过的部署。当前8迁移不要求随应用反向执行；破坏性迁移必须隔离恢复验证，不盲回滚。恢复目标须新建独立数据库，缺运行角色先创建NOLOGIN角色，不覆盖唯一副本。恢复后验证健康、角色、文章/媒体、路径/别名、公开过滤与任务。Supabase公开对象删除需独立对象备份恢复，代码回滚不能还原文件。


当前云数据库备份范围为site应用Schema，不包含平台环境变量、Vault秘密或cron扩展配置；生产恢复须从安全凭据来源重新配置最小运行角色权限、平台环境和任务，不能把隔离库表/外键验证当作生产权限及密钥恢复。最终源码CI见verification/release-final.json，完整门禁已实际通过。
