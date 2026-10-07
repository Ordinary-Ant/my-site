# 阶段 A 验证记录

日期：2026-10-07；Windows、本地 Node 24.19.0 / npm 11.17.0、Docker Desktop、PostgreSQL 16。分支 `codex/full-site`，origin 指向用户仓库，远端 `git ls-remote origin` 成功返回空引用，未推送。

## 已执行的验证

| 检查 | 实际结果 |
| --- | --- |
| Docker compose 启动与健康状态 | `personal-site-db` healthy；保留既有数据卷 |
| 开发库、独立 `personal_site_test` 迁移 | 两库部署 `20261007043328_foundation` 与 `20261007044400_publication_backfill` 成功 |
| 种子数据重复执行 | 用户1、模块6、设置14、Profile1、文章3、日志3、作品2、时间线4；重复不增加 |
| 单元测试 | 5项通过：新版动效、严格配置、嵌套保留/null、危险键、路由冲突、数组替换与自身路径嵌套 |
| 真实 PostgreSQL 集成 | 3项通过：表/唯一路径、seed幂等/发布时间、回填重复执行不覆盖草稿与未来时间 |
| Playwright Chromium | 390/820/1440三个首页冒烟通过，主内容和标题可见，无页面横向溢出 |
| 类型检查、Lint、静态验证 | `npm run check`、`npm run verify`通过 |
| 生产构建 | Next.js15.5.27构建成功；骨架首页106kB First Load JS，此口径不作为一期真实gzip预算验收 |
| 设计源码与图 | 33个HTML lint通过；45PNG重新生成，越界/裁剪/微小字号布局检查45/45通过；重建评审看板 |
| 依赖 | `npm audit --omit=dev`：0漏洞；全量审计余5条high来自同一开发工具依赖链 |
| 独立审查 | 工程规格修正后通过、工程质量通过、治理原文冲突修正后通过 |

## 修复及证据边界

配置与路径测试先出现未实现/缺少自身嵌套校验的失败，修复后通过。seed集成先发现3条已发布日志发布时间为空，修复新seed并增加回填迁移后通过。迁移测试实际构造旧日志、草稿和未来作品，再执行SQL两次，检查其保存结果。

一次干净`npm ci`暴露Prisma Client未生成，类型检查/集成测试明确失败；新增`postinstall: prisma generate`后恢复通过，不能把安装成功等同于工程可用。

依赖升级为Tiptap3.31.4及官方Markdown扩展、tailwind-merge3、lint-staged17.6；固定PostCSS8.5.29、deepmerge-ts8.0.2、selector-parser7.1.6并验证锁文件安装。剩余`braces → micromatch → fast-glob → eslint-config-next`是开发工具链，上游目前无修复版本，拒绝自动建议的Next ESLint降级；仅使用受信任固定glob，生产安装不包含开发工具，发布前重新检查公告。[上游公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。

CI配置已建立，流程在本地按同等步骤执行；用户要求不推送，因此尚无GitHub Actions远端运行结果。设计图是静态视觉依据，首页冒烟是工程基线；均不替代登录、编辑、发布、权限、媒体、动态路由、性能及上线业务验收。B–G尚未通过。

## 重跑

```powershell
npm ci
npm run db:deploy
npm run db:seed
$env:TEST_DATABASE_URL = 'postgresql://dev:dev@localhost:5432/personal_site_test?schema=public'
npm run test:db
npm run check
npm run verify
npm test
npm run test:integration
npm run build
npm run test:e2e
npm audit --omit=dev
```

密钥保存在本地环境文件；本记录不包含生产连接与凭据。
