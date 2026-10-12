# 13 · 本地发布准备合同

2026-10-13已公开交付：https://my-site-tgqonxxy.edgeone.dev，EdgeOne国际站my-site，当前部署dp2ry69pr5hy。实际云API、真实浏览器登录/CSP/CORS上传、三端首页、文章与开关/连续301闭环26项、三角色15项全部通过；临时探针已清理。Supabase PG17.11/8迁移与公开/私有Storage两桶已接入。分钟发布实际3次200，维护稳定版本连续5次200；每日维护及五分钟健康调度已配置，外部告警和自动独立备份尚未配置。

## 安全与运维

HTML请求由Edge兼容middleware生成每请求nonce，同时覆盖传入CSP/x-nonce并透传服务端；响应下发同一CSP。Next启动、主题与JSON-LD脚本带nonce，生产脚本禁止unsafe-inline/unsafe-eval。CSS仍允许inline（主题变量、编辑器与有限动效需要）；图片/媒体允许HTTPS和本地blob/data，connect仅同源及配置的Supabase Storage endpoint；禁止object/frame，限制base/form。预览也应用nonce、no-store/noindex。生产HTTPS才启用upgrade-insecure-requests，localhost生产验收保留HTTP。

GET /api/health只返回应用版本、ok/degraded及数据库up/down；数据库探针设置2秒statement timeout，错误503，不返回SQL、主机、凭据或原始异常，不缓存。日志只输出请求ID和固定错误码；既有Origin/service授权不放宽。

受独立Bearer机器密钥保护的维护任务清理已过期Session/PreviewToken/RateLimit及最近成功计数超过30天的ViewReceipt；未过期旧RT记录保留用于重放检测，轮转10秒后只清空加密rotationReply。任务PG事务锁防重入，数据库时间统一判断，不删正文、审计、统计。临时媒体仍走已有带权限的失败清理入口，不能以过期缓存清理冒充Supabase Storage对象清理。发布仍按分钟；维护建议每日执行。

## 独立备份与恢复

本地备份使用真实PostgreSQL16 pg_dump自定义格式（完整Schema/关系/设置/账户/迁移）与独立媒体目录快照，SHA256清单校验。原包包含敏感数据，只写Git忽略目录，绝不输出数据/连接串；恢复先验证所有文件/路径/哈希，拒绝符号链接、路径逃逸及损坏。

恢复演练只允许localhost、独立新建*_restore_test库和工作区忽略目录中新媒体目录；拒绝当前开发/测试库、已存在目标、覆盖/清库及递归删除任意路径。实际pg_restore、表计数/外键和媒体哈希比对后才写通过证据；失败保留隔离现场，原库和原媒体不变。本地恢复脚本不作为尚未配置的生产备份承诺；管理员统计无可信远端备份来源时继续null。

## 性能与交付

公开元数据在首份HTML的head内完整输出，不依赖客户端移动流式标签；真实无JS浏览器验证文章description与canonical。搜索、预览和后台按合同禁止索引，其Lighthouse SEO保留原始分数，并逐项记录预期noindex/robots扣分；其余适用检查仍须通过，禁止删除索引限制凑分。首页与可索引文章继续执行原SEO门槛。

沿用文章135KB/登录110KB/动效28KB gzip；Lighthouse移动Performance≥85、桌面≥95。记录生产构建、浏览器版本、节流与真实指标，localhost测量不能代表云端。键盘、深浅主题、reduce、禁JS、390/820/1440已验功能在最终构建回归。用户已授权推送main，远端CI在本次推送后实际核对，本地结果不能代替Actions结果。

部署检查与回滚须覆盖环境变量名称（不含值）、迁移、独立备份、健康、定时发布、Supabase Storage私有桶ACL/CORS、HTTPS、域名及性能复验；用户已授权公开发布，实际验收仍须通过。


## 本次交付例外

2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。 自动独立备份及外部告警尚未配置，不能把手动备份或健康轮询当作自动恢复/通知保障。
