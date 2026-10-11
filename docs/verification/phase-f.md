# 阶段 F 持续验收

E提交bd11e90，F01/F02已验收，待本地提交；不推送。

配置四模板、v1事务备份/系统升级审计、ADMIN写入及422/400、共享前台/后台预览runtime已实现。164unit/55文件、174真实PG/27文件全量通过；其中新增7PG验证并发升级、API角色/停用/会话撤销、严格patch/危险键/partialmerge/cache及公开备份隔离。无新增迁移，未改.env。

root纯策略/对比度函数先RED后GREEN；浏览器动效编辑页在E构建中真实RED（404缺少标题）。运行时异常降级单元先RED（异常传播）后GREEN；隐藏页pause/resume、低FPS停用、scope/observer/rAF卸载清理单元通过。FPS累计均值漏掉后续慢帧已用100快帧→12慢帧RED重现，改最近12间隔窗口后GREEN。最大15%tint下红色强调色对比度3.8948的RED已修复，真实深浅浏览器对比度均≥4.5。

实现入口：config/motion、services/motion/settings/public-site、motion-policy/engine、MotionSurface、motion-editor/preview；brand-colors与html主题变量。2026-10-11断电恢复后check/verify/build退出0，仅既有Markdown图片Lint警告；完整108浏览器62passed/46skipped（2.7分钟），跳过为设备不适用重复业务。四预设保存刷新/预览不落库/取消默认、static零库下载、滚动完整入口与vendor下载、动态reduce清理、主动关闭持久化、禁JS和引擎下载失败可读均实际通过。三视口截图与网络证据见phase-f-images。

视觉验收发现移动底栏被header的backdrop-filter限住，实际偏移780px；移为header兄弟后几何测试GREEN。复审再发现34px设备安全区可能遮住末尾偏好控件，实际注入高度RED，padding计入env安全区后foundation+motion三端7passed/2skipped（10.4秒）。最终规格/质量复审批准，安全区修复追加复审批准；预算脚本同步计入新CSS。

最终生产gzip：登录107969字节（107.97KB）、文章128412字节（128.41KB）、动效20986字节（20.99KB，其中降级CSS617字节），低于110/135/28KB。逐文件去重并保守计入共chunk代码，清单motion-budget.json；Lighthouse与独立备份恢复留G，不能用gzip替代。

恢复时一次PG复跑误传浏览器3100 Origin，既有PG夹具固定3000导致403，并留下导入备份。核对76行现有内容/关系/配置无业务差异、6行已删除测试夹具，精确恢复5项module.updatedAt后将已核对原包保留在忽略目录origin-failure-reviewed.json。随后一次重跑因备份保护仍失败3项；最后完整重跑结果另记交接。开发库及.env未操作。PG测试使用NEXT_PUBLIC_SITE_URL=http://localhost:3000；浏览器构建/服务使用3100，必须分开设置。
