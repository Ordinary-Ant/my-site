# 11 · 当前开发交接

## 当前状态（2026-10-13）

2026-10-13已公开交付：https://my-site-tgqonxxy.edgeone.dev，EdgeOne国际站my-site，当前部署dp2ry69pr5hy。实际云API、真实浏览器登录/CSP/CORS上传、三端首页、文章与开关/连续301闭环26项、三角色15项全部通过；临时探针已清理。Supabase PG17.11/8迁移与公开/私有Storage两桶已接入。分钟发布实际3次200，维护稳定版本连续5次200；每日维护及五分钟健康调度已配置，外部告警和自动独立备份尚未配置。

2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。

A–F已提交；本次G源代码、合同与脱敏证据一并提交main并推送origin，具体提交和远端CI见verification/release-final.json。历史诊断原始证据保留，不能把早期500/503当作当前状态。密码只在本地忽略文件.env.edgeone.local；SEED_ADMIN_PASSWORD为初始后台密码，首次登录后修改，不输出/提交。

## 已验证与边界

最新本地生产包完整E2E：65pass/46skip（共111）；177真实PG为服务读取去重改动后的结果。后续EdgeOne兼容守卫及安全诊断通过单元、正式隔离Linux构建及实际云闭环，未声称再次执行Windows完整E2E。此前localhost:3100服务使用独立personal_site_test库；2026-10-13续验时Docker已关闭，恢复后原数据库容器healthy。重新开网站前确认当前监听；运行中不要覆盖.next。

正式CLI1.6.41、适配器0.2.10-beta.9；构建配置Node24.18.0，实际云函数Node20.19，Prisma生成native+rhel-openssl-1.1.x。CLI构建退出0仍须检查非空middleware、环境清洗、请求级平台fetch绑定和凭据扫描。详18及14。

云数据库最终备份已保存本机.backups/cloud-release-20261013，并在独立PG17恢复库验证；媒体两桶当前0对象，独立快照及哈希清单已保存。自动独立备份和外部告警尚未配置；不填假lastBackupAt。分钟发布真实调度通过，每日维护已有实际调度成功记录（HTTP响应已超过保留期，未据此声称200），稳定版本手动5次200。

## 下次恢复

先git status及git log，再读AGENTS、台账和本交接；查线上/api/health及远端CI。待办：首页LCP约21ms差距、自动独立备份目的地/周期/保留及外部告警接收方、自定义域名。review P2仅为未来CLI模板守卫加强，当前实测产物并发通过。不得覆盖现有备份或重置云库。

## 本地看效果

先停止当前测试服务，然后在PowerShell执行（不覆盖.env）：

```powershell
$env:POSTGRES_PORT = '15432'
$env:DATABASE_URL = 'postgresql://dev:dev@localhost:15432/personal_site?schema=public'
$env:NEXT_PUBLIC_SITE_URL = 'http://localhost:3100'
npm run db:up
npm run dev -- --port 3100
```

首次环境按README迁移与seed；已有库先检查迁移状态，不reset。历史自动审批拒绝启动服务，仅用户手工启动，未绕过。测试固定启动文件.backups/start-e2e.cmd连接_test库，不能当作开发库入口。


## 远端CI首次执行与修复

main ae15613已推送，首轮run38282781294单元192通过，但真实PG因全新测试库仅迁移未seed，27失败/7skip。prepare-test-db现对已校验的*_test目标迁移后seed，捕获种子输出不暴露账户；新独立库基础回归RED→GREEN，全量178PG通过。应用运行代码未变，线上dp2ry69pr5hy无需因测试工具修改重发；修复ae89eb9已推送且远端CI38410370425全部通过：192unit/178PG、生产build、E2E65pass46skip；独立审查通过。最后仅提交验收文档，使用[skip ci]避免重复同一源码门禁，不跳过失败测试。


最终交付入口：https://my-site-tgqonxxy.edgeone.dev；后台/login。公开首页尚未添加个人内容，当前云库1管理员、6模块、0文章/媒体/待处理上传。后台初始凭据只在本地忽略环境文件，首次登录后修改密码。最近调度记录见cloud-scheduled-job-latest.json；自动独立备份与外部告警仍待配置。
