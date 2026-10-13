# Lighthouse本地实测

最新本地BUILD_ID=e6cUP4N0FoXaF2z1RHuM5，真实PG、匿名Chromium153、Node24.19.0/Lighthouse13.5.0；移动默认RTT150ms/1638.4Kbps/CPU4倍，3次中位。正确desktop配置作为第三参数传入，记录edge-desktop-summary.json；仅options.preset未生效的desktop-edge-1报告validScenario=false，已排除，不能当桌面验收。

| 页面 | 移动Performance | 桌面Performance | 移动LCP中位 | 桌面LCP |
|---|---:|---:|---:|---:|
| 首页 | 99 | 100 | 2020.673ms | 459.374ms |
| 文章 | 100 | 100 | 1874.945ms | 424.510ms |
| 搜索 | 100 | 100 | 1655.676ms | 441.616ms |

2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。

有效报告A11y/Best Practices100、CLS0；可索引SEO100，搜索原始66仅预期noindex扣分，未删限制凑分。移动最终报告见edge-summary.json、*-mobile-edge-1/2/3.json；正确桌面报告见edge-desktop-summary.json和对应file字段。原始summary.json及final命名文件保留此前构建历史，不混入最新统计。预取阻断报告仅诊断，未改善LCP，不作为验收。

实验室Event Timing最大16ms不是现场INP；gzip登录108098/文章120929/动效20986字节通过110/135/28KB。完整最新本地111 E2E实际65pass46skip，元数据无JS head回归已通过。EdgeOne云实际闭环另见上级edgeone-cloud-*.json；本地分数不代表云性能。


67份仓库内原始Lighthouse报告的SHA256见git-report-manifest.json，原采集summary.sha256引用逐项比对无差异。远端最终CI在ae89eb9实际65pass46skip，不以本地冒烟替代。
