# 18 · EdgeOne中间件适配合同

2026-10-12，用户已要求持续执行直至部署发布完成。适配范围保持动态栏目、历史301、CSP和服务层权威授权，不删减安全检查。

## 实际原因

CLI1.6.41在Linux Node24正式makers build --mode prod退出0，但compiled-middleware.js为0字节。当前Node middleware被适配器编译成边缘代码；独立诊断已复现Node模块解析失败。仅凭构建退出码不能通过发布门禁。

## 实施边界

Next15.5保留，middleware改为Edge兼容实现：Web Crypto生成每请求nonce，继续覆盖输入nonce/CSP、透传相同请求头和响应头，轻量登录判断保持。权威授权、会话与全部数据库访问仍在Node服务层执行。

固定首页、系统入口不查询别名；可变栏目路径通过同源GET /api/v1/route-redirect?path=...读取Node服务返回的唯一target。该公开只读接口仅返回原本已公开的重定向目标，不返回表记录或任何凭据；严格限定本地绝对pathname、长度和编码，no-store。中间件使用配置的站点Origin发起请求，禁止随Host请求任意远端；失败返回503而非假装正常，避免隐匿路由故障。301由中间件执行，保留原详情后缀和query。

配置字段NEXT_PUBLIC_SITE_URL须与平台HTTPS域名一致。数据库查询增加一次边缘至Node请求只发生在可变栏目路径；首屏首页不增加请求。禁止缓存路由映射超过既有5秒新请求生效合同。

## 验收

先测试nonce唯一/请求响应一致、首页零查询、旧路径301及query、故障503和输入拒绝，再检查正式Linux适配产物非空、无Node内置模块依赖。云端验证健康、登录、动态别名301、CSP脚本执行、配置开关与直传确认。Windows、Linux与云结果分开记录，不以成功构建代替运行结果。


## 实际云运行平台补验（2026-10-13）

第二次生产部署平台Success，但健康503、页面500；控制台实际日志确认Nodejs20.19，PrismaClientInitializationError明确要求rhel-openssl-1.1.x，当前只有debian-openssl-3.0.x。Schema生成器补native与rhel-openssl-1.1.x目标；这不修改数据库模型，不需要DDL迁移。重新正式Linux构建与上传后实际云功能已通过；不把构建Node24.18.0当函数运行版本。


## CLI平台Fetch绑定修正（2026-10-13）

栏目接口外部200，middleware内部阶段码HTTP_502。CLI把平台hookCtx.fetch绑定在usercode函数内，middleware runner在全局作用域调用原生fetch，未继承平台回源能力。准备脚本将middleware模块和runner放入每请求工厂，并把该请求的平台fetch作为词法参数。禁止临时替换全局fetch。Webpack self/chunk/入口也必须隔离；首次实际产物并发测试复现第二次请求复用首个fetch，已修正独立self/chunk并移除全局_ENTRIES写入。

实际编译产物在原生fetch固定502条件下，平台fetch返回301并保留query；并发两个平台fetch分别得到/a、/b，已通过。该测试只证明产物作用域修正；随后dp2ry69pr5hy实际云栏目/RSS200，连续两次改路由、旧路径301保留详情及query、模块关闭恢复均通过。发布流程必须在正式CLI构建后执行scripts/prepare-edgeone-artifact.mjs；模板不匹配、重复适配或环境注入数量变化直接拒绝发布。
