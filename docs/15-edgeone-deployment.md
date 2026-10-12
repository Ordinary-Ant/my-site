# 15 · EdgeOne CLI生产部署

2026-10-13已公开交付：https://my-site-tgqonxxy.edgeone.dev，EdgeOne国际站my-site，当前部署dp2ry69pr5hy。实际云API、真实浏览器登录/CSP/CORS上传、三端首页、文章与开关/连续301闭环26项、三角色15项全部通过；临时探针已清理。Supabase PG17.11/8迁移与公开/私有Storage两桶已接入。分钟发布实际3次200，维护稳定版本连续5次200；每日维护及五分钟健康调度已配置，外部告警和自动独立备份尚未配置。

## 当前资源与验收

| 项目 | 当前状态 |
|---|---|
| 应用 | EdgeOne国际站my-site，Upload项目makers-qn9pobisbj7w，production dp2ry69pr5hy，平台Success且实际功能通过 |
| 地址 | https://my-site-tgqonxxy.edgeone.dev；HTTPS已可用，自定义域名稍后绑定 |
| Git | main为本地和GitHub默认分支；本次G提交及远端CI以verification/release-final.json为准，不强推、保留master |
| 数据库 | Supabase PG17.11新加坡，site schema、8迁移、最小runtime角色/RLS；事务池运行、会话池迁移备份 |
| 存储 | Supabase公开my-site-media/私有my-site-upload-private，S3 path style；真实CSP/CORS浏览器直传、确认、公开读取、清理通过 |
| 安全 | HTTPS HttpOnly Cookie、Origin/CSP、三角色、停用/撤销、revision409和草稿隔离通过；服务器秘密只在平台环境，初始化密码仅本地 |
| 调度 | Vault+pg_cron/pg_net，分钟发布3次200；每日维护已配置且手动5次200，五分钟健康轮询 |
| 备份 | 独立本机PG17最终备份已隔离恢复；两桶空快照已保存；自动独立备份/保留策略与外部告警未配置 |
| 性能 | gzip预算全部通过；移动首页99分/LCP2021ms，用户批准先交付保留待办；云延迟不等于本地Lighthouse |

2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。

## 构建与运行边界

CLI1.6.41/adapter0.2.10-beta.9。edgeone.json配置构建Node24.18.0（24.19.0未预装）；实际云函数Node20.19，Prisma生成native+rhel-openssl-1.1.x。Node middleware正式CLI曾退出0却产物为空，现改Edge兼容nonce与同源Node路由查询。CLI原生fetch缺平台回源能力导致内部502，产物采用请求级hookCtx.fetch闭包并隔离webpack入口，实际VM并发及云连续301通过。详18，复现流程见14。

最终产物2997文件/122071706字节，middleware161537字节；3处环境注入清洗，真实凭据匹配0、无.env/外部链接。14个运行变量经Production/Preview白名单配置，不包含CLI Token、迁移密码、初始化管理员。Upload项目没有Git自动部署关联。

## 凭据配置规则

本地.env.edgeone.local已忽略，真实值不输出/提交：DATABASE_URL、MIGRATION_DATABASE_URL、JWT_SECRET、REVALIDATE_SECRET、STORAGE_DRIVER=s3、S3_ENDPOINT/REGION/BUCKET/PRIVATE_BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/PUBLIC_BASE_URL、NEXT_PUBLIC_SITE_URL。EDGEONE_API_TOKEN仅用于CLI/API授权；SEED_ADMIN_*仅安全初始化，不上传服务器配置。Supabase S3密钥绕过RLS并访问全部桶，不应公开；同项目第三桶不构成独立备份。

## 历史故障与证据

部署尝试详verification/edgeone-deployment-attempts.json。首次未预装Node失败；随后缺RHEL Prisma引擎导致500/503；引擎修复后仅栏目内部请求502，最终平台fetch绑定修复。AbortSignal Controller兼容和URL转string未单独解决该故障，不当作根因。部署切换时探针失败已在稳定版本重测，不把瞬时失败伪装通过。

实际云证据：edgeone-cloud-api-smoke.json、edgeone-cloud-browser-smoke.json、edgeone-cloud-content-loop.json、edgeone-cloud-role-smoke.json、cloud-maintenance-repeated.json、cloud-job-configuration.json、cloud-release-restore.json、cloud-media-backup.json。临时文章/用户/媒体已按归属清理。

官方参考：[CLI](https://pages.edgeone.ai/zh/document/edgeone-cli)、[Next.js](https://pages.edgeone.ai/document/framework-nextjs)、[构建版本](https://pages.edgeone.ai/document/build-guide)、[云函数](https://pages.edgeone.ai/document/cloud-functions)、[Supabase Cron](https://supabase.com/docs/guides/cron)、[S3权限](https://supabase.com/docs/guides/storage/s3/authentication)。
