// 生成设计图评审看板 index.html（扫描 shots/ 目录，按预设目录分组）
import { readdirSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const shotsDir = join(root, 'shots')

// 文件名前缀 → { 序号, 标题, 分组, 说明 }
const CATALOG = [
  // ---------- 前台 ----------
  ['01', 'site', '前台 · 首页', '聚合 4 个模块的精选内容，每个区块可独立开关与排序'],
  ['05', 'site', '前台 · 日志列表', '按年月分组、类型筛选、列表/日历双视图'],
  ['06', 'site', '前台 · 日志详情', '比文章详情轻量：无 TOC、无阅读量'],
  ['07', 'site', '前台 · 日志日历', '日历打点 + 当日预览 + 月度概览'],
  ['08', 'site', '前台 · 作品集', '类型 Tab、网格/列表切换、Skills 类型特殊卡片'],
  ['09', 'site', '前台 · 作品详情', '左图集右信息、量化亮点、外链按钮按存在渲染'],
  ['10', 'site', '前台 · 时间戳', 'PC 中轴左右交替 / 移动端自动变单列'],
  ['11', 'site', '前台 · 关于我', 'Hero + 6 个可独立开关的区块'],
  ['12', 'site', '前台 · 站内搜索', '跨模块搜索、命中词高亮、含空结果态'],
  ['13', 'site', '前台 · 404', '含「模块已下线」变体（不暴露技术细节）'],
  ['14', 'site', '登录页', '含登录失败与限流两个状态'],
  ['27', 'site', '前台 · 文章列表', '分类 Tab、标签入口、置顶；含分类归档 / 标签归档头部变体与两种空态', 'NEW'],
  ['28', 'site', '前台 · 文章详情', '整站最复杂展示页：sticky TOC、阅读进度条、Shiki 代码高亮、相关文章', 'NEW'],
  ['29', 'site', '前台 · 标签云', '字号映射使用次数；含按主题分组浏览与悬停 / 当前态', 'NEW'],
  // ---------- 后台 ----------
  ['02', 'admin', '后台 · 模块开关中心 ★', '「开启关闭所有功能」的落地界面：拖拽排序、双开关、影响清单确认、撤销'],
  ['03', 'admin', '后台 · 文章列表', '通用 DataTable 模板，五个内容模块共用'],
  ['04', 'admin', '后台 · 仪表盘', '登录后落地页，含系统状态与待办提醒'],
  ['15', 'admin', '后台 · 文章编辑', 'Tiptap 编辑器 + 右侧发布设置 + SEO 检查'],
  ['16', 'admin', '后台 · 日志管理', '日历为主视图 + 快速记录抽屉（60 秒记一笔）'],
  ['17', 'admin', '后台 · 作品集管理', '表格 + 外链管理 + 删除确认'],
  ['18', 'admin', '后台 · 时间戳管理', '列表即排序界面 + 双可见性开关'],
  ['19', 'admin', '后台 · 关于我编辑', '折叠区块；工作经历为只读（与时间戳共用数据）'],
  ['20', 'admin', '后台 · 媒体库', '目录树 + 引用追踪 + 秒传 + 上传进度'],
  ['21', 'admin', '后台 · 站点设置', 'Tabs 分组 + 校验错误态'],
  ['22', 'admin', '后台 · 用户管理', 'RBAC 三角色 + 权限矩阵'],
  ['23', 'admin', '后台 · 审计日志', 'before/after diff，可追溯每次写操作'],
  ['25', 'admin', '后台 · 动效配置 ★', '预设已改两级（编排 4 个 + 装饰 8 个带风格提示）· 实时预览 + 编排时间轴 + Anime.js 实测体积', 'NEW'],
  ['30', 'admin', '后台 · 分类管理', '树形结构 + 拖拽排序；含删除受阻弹窗与新建弹窗', 'NEW'],
  ['31', 'admin', '后台 · 标签管理', '使用次数与跨模块分布；重点是「合并标签」弹窗（不可撤销）', 'NEW'],
  ['32', 'admin', '后台 · 数据管理', '导出 JSON / 导入（含覆盖模式二次确认）/ 数据库备份与恢复演练', 'NEW'],
  ['33', 'admin', '后台 · 个人设置', '个人资料 / 修改密码（强度条）/ 活跃会话 / 界面偏好', 'NEW'],
  // ---------- 设计系统 ----------
  ['24', 'system', '设计系统 · UI Kit', '色板 / 排版 / 按钮 / 徽章 / 表单 / 卡片 / 反馈 / 圆角阴影 / 间距 / **缓动曲线** / **时长与交错** / 断点', 'NEW'],
  ['26', 'system', '动效分镜表 v2', '缓动曲线可视化（5 条 SVG 曲线）+ 入场编排时间轴 + 文字揭示关键帧 + Anime.js 实测体积', 'NEW'],
]

const GROUP_META = {
  site:   { title: '前台 · 公开页面（三端）', desc: '访客可见，只读，SEO 优先。移动端为独立布局而非缩放。' },
  admin:  { title: '后台 · 管理系统', desc: '私有，需登录。日常内容更新与全站配置都发生在这里。' },
  system: { title: '设计系统与规范', desc: 'Token、组件与动效基准。任何新页面都应复用，不要另起一套。' },
}

// 从 01a-site-home-desktop.png 还原出 site-home.html
const sourceHtml = (f) =>
  f.replace(/^\d+[a-z]-/, '').replace(/-(desktop|mobile|tablet|dark)\.png$/, '.html')

const VIEWPORT_LABEL = (name) => {
  if (name.includes('-mobile')) return { t: '移动 390px', c: 'mobile' }
  if (name.includes('-tablet')) return { t: '平板 820px', c: 'tablet' }
  if (name.includes('-dark'))   return { t: 'PC 1440px · 暗色', c: 'dark' }
  return { t: 'PC 1440px', c: 'desktop' }
}

const files = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((f) => f.endsWith('.png')).sort()
  : []

const items = []
for (const f of files) {
  const entry = CATALOG.find(([num]) => f.startsWith(num))
  if (!entry) continue
  const [num, group, title, note, badge] = entry
  const vp = VIEWPORT_LABEL(f)
  items.push({ num, group, title, note, badge, file: f, ...vp })
}

const groups = [
  { key: 'site', items: items.filter((i) => i.group === 'site') },
  { key: 'admin', items: items.filter((i) => i.group === 'admin') },
  { key: 'system', items: items.filter((i) => i.group === 'system') },
].filter((g) => g.items.length)

const totalSize = files.reduce((s, f) => s + statSync(join(shotsDir, f)).size, 0)

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>UI 设计图评审看板 · Puly 个人网站</title>
<style>
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; background: #f4f4f5; color: #18181b;
    font-family: "Inter","Segoe UI",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    font-size: 15px; line-height: 1.6;
  }
  header.top {
    position: sticky; top: 0; z-index: 50;
    background: rgba(24,24,27,.96); backdrop-filter: blur(12px);
    color: #fafafa; padding: 14px 28px;
    display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
    border-bottom: 1px solid #000;
  }
  header.top h1 { font-size: 17px; margin: 0; font-weight: 650; letter-spacing: -.01em; }
  header.top .meta { font-size: 12.5px; color: #a1a1aa; }
  header.top nav { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
  header.top nav a {
    color: #d4d4d8; text-decoration: none; font-size: 13px;
    padding: 5px 11px; border-radius: 999px; background: rgba(255,255,255,.08);
  }
  header.top nav a:hover { background: rgba(255,255,255,.16); }
  .legend {
    max-width: 1400px; margin: 0 auto; padding: 22px 28px 0;
    display: flex; gap: 22px; flex-wrap: wrap; font-size: 13px; color: #52525b;
  }
  .legend b { color: #18181b; }
  .legend .pill {
    display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
    border-radius: 999px; background: #fff; border: 1px solid #e4e4e7; font-size: 12px;
  }
  section.group { max-width: 1400px; margin: 0 auto; padding: 34px 28px 10px; }
  section.group > h2 {
    font-size: 21px; margin: 0 0 4px; letter-spacing: -.02em;
    display: flex; align-items: center; gap: 10px;
  }
  section.group > h2 .count {
    font-size: 12px; font-weight: 600; color: #6366f1;
    background: #eef2ff; border: 1px solid #c7d2fe; padding: 2px 9px; border-radius: 999px;
  }
  section.group > p.desc { margin: 0 0 20px; color: #52525b; font-size: 13.5px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr)); gap: 20px; }
  .grid .item.wide { grid-column: 1 / -1; }
  figure.card {
    margin: 0; background: #fff; border: 1px solid #e4e4e7; border-radius: 14px;
    overflow: hidden; box-shadow: 0 1px 3px rgba(16,24,40,.07);
    display: flex; flex-direction: column;
  }
  figure.card .head { padding: 14px 16px 12px; border-bottom: 1px solid #f0f0f1; }
  figure.card .head .row1 { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  figure.card .head .idx {
    font-family: ui-monospace, Consolas, monospace; font-size: 11.5px;
    color: #71717a; background: #f4f4f5; border-radius: 6px; padding: 2px 7px;
  }
  figure.card .head h3 { margin: 0; font-size: 15.5px; letter-spacing: -.01em; }
  figure.card .head .note { margin: 7px 0 0; font-size: 12.5px; color: #71717a; line-height: 1.55; }
  figure.card .vp {
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
    border: 1px solid #e4e4e7; color: #52525b; background: #fafafa;
  }
  figure.card .vp.mobile  { background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe; }
  figure.card .vp.tablet  { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
  figure.card .vp.dark    { background: #18181b; color: #fafafa; border-color: #3f3f46; }
  figure.card .badge-new {
    font-size: 10px; font-weight: 700; letter-spacing: .06em;
    padding: 2px 7px; border-radius: 999px;
    background: linear-gradient(135deg,#6366F1,#A855F7); color: #fff;
  }
  figure.card .shot {
    background: repeating-conic-gradient(#f4f4f5 0% 25%, #fff 0% 50%) 50%/18px 18px;
    padding: 0; overflow: hidden; max-height: 780px; position: relative;
  }
  figure.card .shot img { width: 100%; display: block; }
  figure.card .shot::after {
    content: ""; position: absolute; inset: auto 0 0 0; height: 40px;
    background: linear-gradient(transparent, rgba(255,255,255,.85)); pointer-events: none;
  }
  figure.card.tall .shot { max-height: 1100px; }
  figure.card .act { padding: 10px 16px; border-top: 1px solid #f0f0f1; display: flex; gap: 10px; }
  figure.card .act a {
    font-size: 12.5px; color: #6366f1; text-decoration: none; font-weight: 550;
  }
  footer.bot { max-width: 1400px; margin: 0 auto; padding: 30px 28px 60px; color: #a1a1aa; font-size: 12.5px; }
  @media (max-width: 700px) {
    section.group { padding: 24px 14px 6px; }
    .grid { grid-template-columns: 1fr; }
    header.top { padding: 12px 14px; }
  }
</style>
</head>
<body>

<header class="top">
  <h1>UI 设计图评审看板</h1>
  <span class="meta">Puly 个人网站 + 后台管理系统 · 共 ${items.length} 张 · ${(totalSize/1024/1024).toFixed(1)} MB</span>
  <nav>
    ${groups.map((g) => `<a href="#${g.key}">${GROUP_META[g.key].title.split(' · ')[0]} (${g.items.length})</a>`).join('\n    ')}
  </nav>
</header>

<div class="legend">
  <span><b>怎么用：</b>点任意图片可在新标签页打开原始尺寸，逐张核对。</span>
  <span class="pill">🖥 PC 1440px</span>
  <span class="pill">📱 移动 390px</span>
  <span class="pill">📲 平板 820px</span>
  <span class="pill">🌙 暗色主题</span>
</div>

${groups.map((g) => `
<section class="group" id="${g.key}">
  <h2>${GROUP_META[g.key].title} <span class="count">${g.items.length} 张</span></h2>
  <p class="desc">${GROUP_META[g.key].desc}</p>
  <div class="grid">
    ${g.items.map((i) => `
    <figure class="card ${i.c === 'mobile' ? 'tall' : ''}">
      <div class="head">
        <div class="row1">
          <span class="idx">${i.num}${i.file.replace(/^\d+/, '').charAt(0)}</span>
          <h3>${i.title}</h3>
          <span class="vp ${i.c}">${i.t}</span>
          ${i.badge ? `<span class="badge-new">${i.badge}</span>` : ''}
        </div>
        <p class="note">${i.note}</p>
      </div>
      <div class="shot"><img src="shots/${i.file}" alt="${i.title}" loading="lazy"></div>
      <div class="act">
        <a href="shots/${i.file}" target="_blank">↗ 打开原图</a>
        <a href="${sourceHtml(i.file)}" target="_blank">查看 HTML 源稿</a>
      </div>
    </figure>`).join('')}
  </div>
</section>`).join('')}

<footer class="bot">
  设计稿为静态 HTML 高保真还原，非最终代码。生产实现按设计文档用 Next.js 15 + Tailwind + shadcn/ui 落地。
  所有页面均通过横向溢出自动检测（scrollWidth ≤ 视口宽度）。
</footer>

</body>
</html>
`

writeFileSync(join(root, 'index.html'), html, 'utf8')
console.log(`✅ index.html 已生成：${items.length} 张设计图，分 ${groups.length} 组`)
for (const g of groups) {
  console.log(`   ${GROUP_META[g.key].title}：${g.items.map((i) => i.file).join(', ')}`)
}
const missing = CATALOG.filter(([num]) => !files.some((f) => f.startsWith(num)))
if (missing.length) {
  console.log(`\n⚠ 以下页面尚未生成截图：`)
  for (const [num, , title] of missing) console.log(`   ${num} ${title}`)
}
