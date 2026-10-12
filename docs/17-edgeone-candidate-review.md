# 17 · EdgeOne候选准备与待验证项

2026-10-12。本记录不代表已上传、已公开发布或G整阶段通过。

## 凭据与隔离目录

本地候选位于Git忽略的.backups/edgeone-candidate-1791812685522。源清单295文件及SHA256保存于candidate-manifest.json；基于c3600f3加当前工作区G变更，未构建、未上传、deployReady=false。源目录与所有本地凭据保留原样。

仅复制src、public、Prisma schema/migrations及构建配置。无.env、.git、node_modules、.next、备份、测试报告或设计稿；符号链接与密钥文件拒绝。候选package.json仅移除开发prepare/husky，源package.json不变。逐文件扫描真实云密码、完整URI、Token、S3密钥、JWT/任务密钥及管理员邮箱/密码，匹配0。

CLI1.6.41配套@edgeone/opennextjs-pages 0.2.10-beta.9的copyHandlerDependencies会复制.env、.env.production、.env.local、.env.production.local。这是必须隔离源目录的实际原因；不能把整个工作区直接交给deploy。Git忽略规则补为.env*，只例外保留无真实凭据的.env.example。

部署运行配置仅允许DATABASE_URL（独立runtime）、JWT_SECRET、必要JWT TTL、TRUST_PROXY、STORAGE_DRIVER与S3运行配置、NEXT_PUBLIC_SITE_URL、REVALIDATE_SECRET等经审核的运行键。不传EdgeOne CLI Token、迁移URI、postgres管理员密码、SEED_ADMIN_*；不上传凭据文件，不将服务器密钥改成NEXT_PUBLIC_变量。公开URL和可信代理语义未定前不生成最终运行配置包。

## 存储网络诊断

两种Supabase域名DNS均返回IPv4，直连Node fetch与https IPv4请求均出现ECONNRESET；系统代理下curl与Node --use-env-proxy均收到缺失对象的HTTP400响应。之后沿用系统代理，完整探针连续两轮通过签名PUT200、私有下载哈希、匿名公开REST拒绝、公开PNG读取哈希、本机Origin预检及测试对象清理。

证据支持本机直连路径不稳定，不能归因于桶权限或擅自删除校验。仅在本次子进程设置HTTP_PROXY/HTTPS_PROXY/NO_PROXY，未修改全局代理或把本机代理写入生产配置。实际EdgeOne出口与浏览器生产Origin仍需云测，不以两次本机通过宣布全云业务验收。

## 云运行时与中间件

官方更新日志明确项目设置增加Node22/24版本；云函数文档同时列出默认运行时Node20。CLI schema只有nodeVersion字符串及函数时长/区域等设置，未暴露独立云函数Node runtime版本字段。构建Node版本与函数实际运行时不能混同。当前file-type22要求Node>=22，工程Node>=24，需要平台实际运行时证据，不能直接降级依赖或宣称不可部署。

当前Next构建functions-config-manifest记录/_middleware runtime=nodejs。适配器会读取该值，并额外调用compileMiddleware、处理middleware manifest；不能仅因默认Edge说明就断言Node middleware不支持。直接在独立ESM诊断入口调用compiler时返回__filename未定义，未生成代码，因此该尝试不代表正式CLI构建失败，也不能把空输出VM求值成功记为兼容通过。后续需正式隔离Linux构建与真实云函数检查。

2026-10-12续验：以适配器内嵌esbuild相同版本0.25.5的二进制、关闭worker线程继续隔离诊断，未改项目或适配器依赖。首次匹配二进制执行出现spawn EBUSY，之后确认--version=0.25.5并重试，进入真实编译，返回17项解析错误、输出0字节，包括fs、crypto、async_hooks、buffer等Node内置模块及@opentelemetry/api。编译器以platform=browser打包；其detectBuildType把当前Node middleware产物识别为raw，触发transformSourceCode。证据见verification/edgeone-middleware-diagnostic.json。此前仅有__filename入口失败的诊断已推进到真实编译错误，但仍不是正式CLI/Linux/云端验收，不能概括为平台整体不支持Next.js。

官方[中间件发布说明](https://pages.edgeone.ai/resources/pages-support-middleware)说明Next middleware会自动在边缘节点执行；没有据此获得当前Prisma/Node middleware兼容保证。正式Linux构建随后确认middleware空产物，现已按18修订为Edge兼容nonce/301与Node只读路由查询；原Node middleware合同已替换，保留数据库重定向/CSP能力。新正式产物非空；最终dp2ry69pr5hy云验收已完成，详18/15。

参考：[云函数默认运行时与区域](https://pages.edgeone.ai/document/cloud-functions)、[Node构建版本扩展](https://pages.edgeone.ai/zh/document/release-notes)、[Next.js支持](https://pages.edgeone.ai/document/framework-nextjs)、[配置说明](https://pages.edgeone.ai/zh/document/edgeone-json)。

## 生产基础数据

使用独立runtime在site中初始化6模块（首页及五内容模块）、5项最小站点/主题/动效设置和1个空白Profile。沿用注册表默认配置，upsert更新为空，不覆盖用户配置；重复执行后所有记录（包括更新时间）完全相同。Profile待完善、联系方式关闭，不使用管理员邮箱作为公开联系方式。文章/日志/作品/时间线记录合计0，未导入演示内容。

## 性能与下一步

本轮自动审批再次拒绝npm run start -- --port 3100 --hostname localhost，仅返回blocked by policy，未换命令绕过。用户手动启动后首次健康503、首页/文章/搜索500；同机直接连接15432数据库成功，.env仍为5432，已请用户确认PowerShell逐行覆盖后重启。随后用户修正命令，四入口200，Lighthouse首轮已完成，原始报告见verification/lighthouse。文章metadata流式输出位置不稳定已真实RED，现已修复并重构建，用户再次启动后无JS head连续10次通过。最终客户端分包新包三端公开页面27项通过；移动Performance中位99/99/100、桌面全100，但首页LCP中位2024ms仍超2000ms，阶段G尚未整体验收，详verification/lighthouse/README.md。

最终新包健康200；本机3100由用户保持运行。下一步隔离验证首页剩余LCP开销并完成最新包完整回归；原295文件候选不含本次修复，完成G性能和相关回归后重新整理候选。另有performance-build-20261012隔离Windows构建，仅用于拆包检查，node_modules为junction，不能上传，也不代表Linux或云运行时通过。站点公开URL、Linux产物/Prisma引擎与云实际Node版本、生产Origin、分钟调度、独立云备份恢复及监控仍未验收。用户随后已明确授权持续执行到公开发布完成；新Linux候选已上传，平台成功后实际健康503，继续排查，不能据此声称可用。
