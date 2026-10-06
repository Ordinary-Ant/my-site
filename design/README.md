# Design · UI 设计稿与实现依据

[← 返回 README](../README.md)

本目录是**设计稿的唯一权威来源**。实现阶段的每一个页面、组件、交互，都应以此为准；与文档冲突时，以文档为准并回来修正设计稿。

---

## 一、怎么用

**第一步：打开评审看板**

```
design/index.html          ← 双击用浏览器打开
```

看板按「前台 / 后台 / 设计系统」三组列出全部 36 张设计图，每张附说明、视口标签，以及两个入口：**打开原图** 与 **查看 HTML 源稿**。

**第二步：按下面「设计图 ↔ 文档章节」表逐条对照**

设计图是"长什么样"，文档是"为什么这样、怎么实现"。两者互为索引。

**第三步：实现时把设计图当验收标准**

每个模块做完后，用 `npm run dev` 起本地站点，与对应设计图逐屏比对。三端（PC 1440 / 平板 820 / 移动 390）都要过。

---

## 二、目录结构

```
design/
├─ README.md                 ← 本文件
├─ index.html                ← 评审看板（浏览器打开）
│
├─ shots/                    ← 36 张 PNG 设计图（评审对象）
│
├─ *.html                    ← 27 个设计稿源文件（可交互的真实 HTML）
│  ├─ site-*.html            前台页面
│  ├─ admin-*.html           后台页面
│  ├─ design-system.html     UI Kit 总览
│  └─ motion-storyboard.html 动效分镜表
│
├─ _assets/
│  └─ mock.css               ← 设计系统（token + 组件样式，全部页面共用）
│
└─ _tools/                   ← 生成与校验脚本（非交付物）
   ├─ shot.mjs               截图 + 布局自检（CDP 驱动 headless Edge）
   ├─ lint.mjs               一致性检查（未定义 class / 外部资源 / 占位文案）
   ├─ build-index.mjs        生成 index.html 评审看板
   └─ patch-sidebar.mjs      批量同步后台侧边栏导航（一次性迁移工具）
```

> **设计稿是可运行的 HTML**，不是静态图片。用浏览器打开任意 `*.html`，**悬停、动效、响应式都会真实生效** —— 比如打开 `admin-motion.html` 能看到背景渐变真的在流动。

---

## 三、设计图 ↔ 文档章节对应表

### 前台（17 张）

| 设计图 | 文件 | 规模 | 对应文档章节 |
|---|---|:--:|---|
| `01a/b/c` | [site-home.html](site-home.html) | PC / 移动 / 暗色 | [05 §4.1](../docs/05-frontend-ia.md) · [06 §6 首页聚合层](../docs/06-modules.md) |
| `05a/b` | [site-logs.html](site-logs.html) | PC / 移动 | [05 §4.2](../docs/05-frontend-ia.md) · [06 §1 日志](../docs/06-modules.md) |
| `06a` | [site-log-detail.html](site-log-detail.html) | PC | [05 §4.3](../docs/05-frontend-ia.md) · [06 §1.4](../docs/06-modules.md) |
| `07a` | [site-logs-calendar.html](site-logs-calendar.html) | PC | [06 §1.4 日历视图](../docs/06-modules.md) · [03 §3.5](../docs/03-api-spec.md) |
| `08a/b` | [site-portfolio.html](site-portfolio.html) | PC / 移动 | [05 §4.4](../docs/05-frontend-ia.md) · [06 §2 作品集](../docs/06-modules.md) |
| `09a` | [site-project-detail.html](site-project-detail.html) | PC | [05 §4.5](../docs/05-frontend-ia.md) · [06 §2.4](../docs/06-modules.md) |
| `10a/b` | [site-timeline.html](site-timeline.html) | PC / 移动 | [05 §4.6](../docs/05-frontend-ia.md) · [06 §3 时间戳](../docs/06-modules.md) |
| `11a/b` | [site-about.html](site-about.html) | PC / 移动 | [05 §4.9](../docs/05-frontend-ia.md) · [06 §5 关于我](../docs/06-modules.md) |
| `12a` | [site-search.html](site-search.html) | PC | [05 §4.10](../docs/05-frontend-ia.md) · [03 §3.10](../docs/03-api-spec.md) |
| `13a` | [site-404.html](site-404.html) | PC | [05 §4.11](../docs/05-frontend-ia.md) |
| `14a` | [site-login.html](site-login.html) | PC | [03 §4 认证接口](../docs/03-api-spec.md) · [01 §6 鉴权](../docs/01-architecture.md) |

### 后台（17 张）

| 设计图 | 文件 | 规模 | 对应文档章节 |
|---|---|:--:|---|
| `02a/b` | [admin-modules.html](admin-modules.html) | PC / 平板 | **[04 §3 模块开关中心](../docs/04-admin-console.md)** · [01 §7 三层机制](../docs/01-architecture.md) · [03 §5.3](../docs/03-api-spec.md) |
| `03a/b` | [admin-article-list.html](admin-article-list.html) | PC / 移动 | [04 §4 通用列表页规范](../docs/04-admin-console.md) |
| `04a` | [admin-dashboard.html](admin-dashboard.html) | PC | [04 §11 仪表盘](../docs/04-admin-console.md) · [03 §5.6](../docs/03-api-spec.md) |
| `15a/b` | [admin-article-edit.html](admin-article-edit.html) | PC / 移动 | [04 §5 内容编辑器](../docs/04-admin-console.md) · [03 §5.1](../docs/03-api-spec.md) |
| `16a` | [admin-logs.html](admin-logs.html) | PC | [04 §4](../docs/04-admin-console.md) · [06 §1.5](../docs/06-modules.md) |
| `17a` | [admin-projects.html](admin-projects.html) | PC | [06 §2.5](../docs/06-modules.md) |
| `18a` | [admin-timeline.html](admin-timeline.html) | PC | [04 §6 拖拽排序](../docs/04-admin-console.md) · [06 §3.7](../docs/06-modules.md) |
| `19a` | [admin-about-edit.html](admin-about-edit.html) | PC | [04 §7 关于我编辑](../docs/04-admin-console.md) · [06 §5.6](../docs/06-modules.md) |
| `20a` | [admin-media.html](admin-media.html) | PC | [04 §8 媒体库](../docs/04-admin-console.md) · [03 §5.5](../docs/03-api-spec.md) · [01 §8](../docs/01-architecture.md) |
| `21a` | [admin-settings.html](admin-settings.html) | PC | [04 §9 站点设置](../docs/04-admin-console.md) · [03 §5.4](../docs/03-api-spec.md) |
| `22a` | [admin-users.html](admin-users.html) | PC | [04 §10](../docs/04-admin-console.md) · [01 §6.4 权限矩阵](../docs/01-architecture.md) |
| `23a` | [admin-audit.html](admin-audit.html) | PC | [04 §10 审计日志](../docs/04-admin-console.md) · [03 §5.7](../docs/03-api-spec.md) |
| `25a/b` | [admin-motion.html](admin-motion.html) | PC / 平板 | **[08 动效系统](../docs/08-motion-system.md)** · [04 §15](../docs/04-admin-console.md) · [03 §5.8](../docs/03-api-spec.md) |

### 设计系统与规范（2 张）

| 设计图 | 文件 | 规模 | 对应文档章节 |
|---|---|:--:|---|
| `24a` | [design-system.html](design-system.html) | PC | [05 §7 主题与视觉令牌](../docs/05-frontend-ia.md) · [01 §2 分层架构](../docs/01-architecture.md) · [README ADR D13](../README.md) |
| `26a` | [motion-storyboard.html](motion-storyboard.html) | PC | [08 动效系统](../docs/08-motion-system.md)（分镜、性能预算、六级降级链） |

---

## 四、三端覆盖情况

| 端 | 宽度 | 覆盖的设计图 |
|---|---|---|
| **移动** | 390px | 首页、日志列表、作品集、时间戳、关于我、文章列表、文章编辑 |
| **平板** | 820px | 模块开关中心、动效配置 |
| **PC** | 1440px | 全部 24 个页面 |
| **暗色主题** | 1440px | 首页（`01c`） |

> **未逐个出图的页面并非不需要响应式**：`_assets/mock.css` 里的断点规则（`≤1023px` / `≤767px`）对所有页面统一生效，实现时按 [05 §2 三端布局策略矩阵](../docs/05-frontend-ia.md) 验收即可。

---

## 五、设计系统速览

所有视觉决策集中在 `_assets/mock.css`，生产实现用 Tailwind v4 + shadcn/ui 表达同一套 token。

| 类别 | 值 |
|---|---|
| 强调色 | `#6366F1`（hover `#4F46E5`，soft `#EEF2FF`） |
| 语义色 | 蓝 `#3B82F6` 工作 · 绿 `#10B981` 教育/成功 · 紫 `#8B5CF6` 项目 · 金 `#F59E0B` 荣誉 · 橙 `#F97316` 里程碑 · 红 `#EF4444` 危险 |
| 圆角 | sm 8px · base 12px · lg 16px |
| 阴影 | sm / base / md / lg 四级 |
| 断点 | xs 380 · sm 640 · **md 768** · **lg 1024** · xl 1280 · 2xl 1536 |
| 字体 | Inter + PingFang SC / Microsoft YaHei；等宽用 JetBrains Mono |
| 强调色可配置 | 后台 `theme.accent` 覆盖，见 [04 §9](../docs/04-admin-console.md) |

---

## 六、重新生成

环境要求：Node 18+、Windows 上装有 Edge（用于 headless 截图）。

```bash
cd design

# 1. 一致性检查（未定义 class / 外部资源 / 占位文案 / 必需元素）
node _tools/lint.mjs .

# 2. 启动 headless Edge（CDP 调试端口 9333）
#    Windows:
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --headless=new --remote-debugging-port=9333 `
  --user-data-dir="$env:TEMP\dsh-cdp-profile" --no-first-run --disable-gpu about:blank

# 3. 批量截图 + 布局自检（横向溢出 / 内容裁剪 / 字号过小）
node _tools/shot.mjs manifest-all.json

# 4. 重建评审看板
node _tools/build-index.mjs .
```

**修改设计稿后的标准流程**：改 `*.html` 或 `_assets/mock.css` → 跑 lint → 跑 shot（自检必须全绿）→ 重建 index → 提交。

> `shot.mjs` 的布局自检会客观报告**横向溢出、内容被裁剪、字号过小**。这三类是设计稿最容易出的问题，且肉眼在整页截图里很难发现 —— 所以把它做成了每次截图的强制关卡。

---

## 七、约定

| 约定 | 说明 |
|---|---|
| 设计稿不引用任何外部资源 | 无图片 URL、无字体 CDN、无图标库。图片用 `.cover` 占位块，图标用 emoji / unicode |
| 文案必须真实 | 不许 Lorem ipsum、不许「示例文本」。人物统一 **Puly**，定位「5 年经验前端工程师」，杭州 |
| 不新增 `<style>` 块 | 唯一例外：前台移动端底部 Tab 的显示控制。其余一律用 `mock.css` 的 class |
| 每个页面带 `.spec` 标注条 | 顶部深色条，标明路由、模块、接口、关键约束 |
| 状态稿内嵌在同页 | 空态、错误态、弹窗、抽屉、toast 等次要状态放在页面底部的「状态与弹窗稿」区 |

---

## 八、关于体积

`shots/` 有约 20 MB PNG（2x 缩放便于查看细节）。个人仓库一次性提交可以接受；若将来觉得仓库过大，可考虑 Git LFS 或只保留 1x 版本。

---

## 九、状态

| 项 | 状态 |
|---|---|
| 设计稿 | ✅ 24 个页面 / 36 张图，通过 lint 与布局自检 |
| 评审 | ✅ 已确认 |
| 实现 | 🟡 M0 已完成并验证（`npm run build` 通过）—— 下一步 M1，见 [07-roadmap.md](../docs/07-roadmap.md) |
