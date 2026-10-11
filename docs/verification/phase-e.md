# 阶段 E 验收记录

2026-10-11，codex/full-site。D已本地提交80347bc，E整阶段验收及规格/质量复审均通过，准备本地提交。未推送。

## 已实现与证据

搜索服务使用参数化SQL UNION ALL全局分页，完整total与typeCounts、50项页面上限、严格输入、字面LIKE转义、只读RepeatableRead及事务内隐私清洗。真实PG用65文章+1日志+1作品验证两页67条无遗漏/重复，类型过滤不改变全类型计数；未来日志日期仅置顶可放宽，未来发布时间不放宽，模块关闭/改路径与草稿/归档/软删正确。分类根汇总直属子分类，标签归档只返回文章，无公开内容404；摘要/归档联系方式清洗及SQL注入字面查询通过。4项search PG通过。

RSS仅最近50条公开文章/日志，稳定resource:id GUID，摘要纯文本/XML转义；地图输出当前列表/详情/分类标签归档，不输出旧别名或私有内容。OG只从公开详情取标题，生成1200×630 PNG，不允许任意远程图抓取。robots禁止私有和搜索路径。2项SEO PG验证联系方式、草稿、未来、删除、日志置顶、关闭与改路径。JSON-LD安全序列化unit验证闭合script与Unicode分隔符转义；文章实际SSR包含BlogPosting、当前canonical和归档链接。

阅读统计使用30天签名HttpOnly匿名cookie，receipt唯一资源/ID/访客哈希，PG锁后读取数据库时间，同事务提交内容viewCount/每日统计/receipt。真实PG验证首次8并发及超窗5并发只接受一次；同日多窗口UV不重复，跨日窗口仍去重；重复请求不刷新receipt时间；内容revision/updatedAt不变；改路径保留身份；计数溢出失败全部回滚。首轮测试发现展开scope后单独id覆盖关闭模块的空ID约束，新增显式模块开关检查后原红测通过。5项views PG还验证Origin、严格字段、签名cookie、DNT、三角色统计读取与会话撤销立即401。

迁移20261011053000_view_receipts已实际部署开发和_test两库，保留旧DailyStat为legacy/path身份；当前8迁移，未reset或修改.env。仪表盘改读真实/admin/stats，显示七日阅读、热门公开文章和未验证备份null。

## 浏览器与检查

search-seo+roles+modules联合6passed/6skipped（17.5秒），跳过仅桌面业务场景在其他设备重复运行。真实搜索→类型筛选→文章→分类归档、RSS/XML、PNG OG、草稿OG404、匿名Cookie及并发POST、Origin403/未知字段400/草稿404、预览noindex且无上报、旧归档地址301保留query、新路径地图、关闭后搜索/RSS/OG隐藏均通过。三端暗色/reduce无溢出、无JS原生GET搜索通过。

初版E2E两项预期错误已纠正：两个独立浏览器匿名身份应各计一次；相对Location在HTTP协议中有效，使用URL解析后比较目标。不是修改生产合同来迁就失败。已查看390搜索截图，文字和布局可读；最终主题对比度仍留F/G。

最新全量167PG/26文件（40.84秒）、152unit/51文件、check/verify/生产build退出0，仅既有Markdown外部图片Lint警告。生产manifest gzip登录107916字节（107.92KB）、文章127132字节（127.13KB），低于110/135KB。全套102浏览器58passed/44skipped（2.7分钟）；规格复审批准。复审补修后重新check/build及search-seo+roles+modules补验6passed/6skipped（17.1秒）。独立质量复审最终批准。

## 后续

完成全套回归与复审，更新台账和交接，再本地E阶段提交。F动效及G性能/部署/备份尚未完成，生产R2/托管/域名/备份凭据缺失仍单独记录，不用本地验证代替。

复审补修：归档翻页保留pageSize、About metadata使用公开headline/avatar，新增两项单元测试实际RED→GREEN；日志/作品列表CollectionPage、时间线BreadcrumbList补齐，日志保持统计且不显示阅读量。补验真实页面结构化数据与日志展示通过。

质量复审发现新/og会抢占D阶段合法栏目/历史别名，浏览器实际RED为图片响应text/html。修复使用/api/v1/og，旧/og路径与alias均保留；robots仅例外允许该公开图片，普通/api仍禁止。移除新增/og保留项，无需迁移用户路径。复审补验6pass6skip（16.7秒），规格/质量最终复审批准；最后robots小修后生产build退出0、search-seo浏览器4passed/2skipped（8.0秒）通过。

## 最终判定

E01–E03已完成。152unit/51文件、167真实PG/26文件，全102浏览器58pass44skip；复审后联合补验6pass6skip，最后robots修正再补验4pass2skip。check/verify/build均通过，gzip登录107916/文章127132字节。规格与独立质量最终批准。分钟发布已有B真实验证且全套浏览器再次通过；无测试恢复备份残留，未改.env或推送。F/G继续按台账执行。
