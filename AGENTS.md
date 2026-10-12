# 仓库协作约定

## 规范与恢复

- 用户明确决策 > 已修订一期权威规范（docs/12-phase-one-plan.md、docs/08-motion-system.md、docs/设计规范.md）> 其他docs > HTML/截图。冲突必须修订原文，不能仅追加注释保留错误合同。
- 新会话/恢复先读Git状态和最近提交，再读README、台账、交接及当前阶段规范；确认未提交变化归属，不覆盖他人工作。
- 功能状态、依赖、验收、代码入口、证据、提交记入docs/10-development-tracker.md；构建、文件存在、Schema有效不能代替功能验收。
- 阶段验收后再本地提交；仅在用户明确授权时push。本次用户已授权推送origin的codex/full-site，禁止强推、覆盖远端历史或擅自合并master。授权范围内执行可逆部署验证，公开生产发布需最终确认。提交和必要代码注释用简短中文。

## 工程合同

- Next.js15.5 / Node runtime middleware；service为权威授权，所有数据入口检查权限、用户启用、AT sid对应会话。
- ADMIN/EDITOR/VIEWER按权限矩阵访问；RT在PostgreSQL原子轮转，10秒宽限复用同一后继凭证；超时旧token重放撤销该用户全部会话。
- 真实PostgreSQL迁移及集成测试，共享PostgreSQL限流；禁止内存Map作为生产限流合同。
- 公开过滤模块/类型开关、PUBLISHED、publishedAt<=now、deletedAt为空；时间线保留日期精度，当前项/日期/同日期order/id排序；revision写冲突409。
- 模块路径唯一；RouteAlias保存历史路径，301保留详情后缀和query直达当前路径，禁止保留路径/重叠/循环/抢占别名。
- 配置只合并已知嵌套键，数组整体替换，可空字段null清空，拒绝未知和危险键；合并后重验完整对象。
- contactVisible=false全站公开DTO、首页、页脚、social、metadata、JSON-LD移除email/phone及mailto/tel。
- 发布调度按分钟；缓存5秒指新请求，已打开页面需刷新；preview有效24h/no-store/noindex且不进搜索/RSS/sitemap。
- 本地Local与生产R2隔离；R2私有临时直传，服务端确认magic/大小/归属后公开；删除前检查全站引用。
- 动效version2默认editorial+none，仅none/tint静态装饰，无连续背景；系统reduce最高优先。文章135KB/动效28KB/登录110KB为gzip预算。
- 按风险测试功能，记录真实结果及未验证项；可逆低影响文档修改用静态检查。
