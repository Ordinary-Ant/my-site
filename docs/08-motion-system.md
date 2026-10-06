# 08 · 动效系统（Motion System）

[← 上一篇：实施路线](07-roadmap.md) · [返回 README](../README.md) · [设计规范](设计规范.md)

> **本文档解决的问题**：让站点"活起来"，同时**不让动效拖慢首屏、不破坏可访问性、不烧掉访客的手机电量**。
> 核心原则一句话：**动效全部可在后台配置，但配置只在服务端注入属性，客户端零往返。**

---

> ## ⚠ v1.1 重要变更（2026-10）
>
> 本文档已按两条新设定修订，**旧版中与此冲突的内容一律以本节为准**：
>
> | # | 变更 | 影响 |
> |---|---|---|
> | 1 | **动效接入 [Anime.js](https://animejs.com/documentation) v4.5.0** | 分层策略从"CSS 优先 / 手写 JS"改为「**CSS + Anime.js 双层**」。删除手写 Canvas 粒子、手写 IntersectionObserver、手写数字滚动等 |
> | 2 | **视觉与动效节奏参照 [Clay Showreel 2023](https://showreel.design/videos/clay-showreel-2023/) / [clay.global](https://clay.global/)**（风格标注：**Minimal / Clean**） | 动效方向从"炫技向"（极光、粒子、星空、光斑）转为"**编排向**"（逐行遮罩揭示、滚动叙事、克制交错）。粒子/星空/极光降级为**默认关闭**的可选项 |
>
> **规范值请以 [设计规范.md](设计规范.md) §3 为准** —— 缓动曲线、时长刻度、交错刻度、体积预算都在那里。本文档讲**怎么实现**，规范讲**用什么值**。
>
> 实测体积（animejs@4.5.0，esbuild `--minify`，tree-shaken）：
> `animate`+`stagger` = 14.1 KB gzip · 加 `timeline`/`scope`/`onScroll` = 20.3 KB · **加 `splitText` = 22.8 KB** · 再加 `utils`/`createSpring` = 24.8 KB

---

## 1. 设计目标与原则

| 目标 | 说明 |
|---|---|
| 后台可配 | 动效强度、内容编排、可选装饰效果全部可在后台开关与调参，改完即时生效，无需发版 |
| 首屏不依赖 JS | 首屏可见内容的动效必须用 CSS 实现（见 [设计规范 §1.3 P3](设计规范.md)） |
| 不伤可访问性 | 强制尊重 `prefers-reduced-motion`，用户系统偏好优先级**高于**后台配置 |
| 自动降级 | 低端设备、低帧率、省电模式、页面不可见时自动降档 |
| 可预览 | 后台必须能实时看到效果，而不是"存了才知道长啥样" |

### 五条铁律

1. **CSS 能做的绝不用 JS**。悬停、焦点、背景层、骨架屏、**首屏 Hero 的逐行揭示**全部纯 CSS。
2. **只动 `transform` / `opacity` / `clip-path`**，绝不动 `width/height/top/left`。唯一例外是 `createLayout()` 的 FLIP。
3. **JS 动效必须能"不存在"**。关掉 JS 后站点功能与可读性完全不受影响，只是不动的 —— 首屏尤其如此。
4. **不阻塞 LCP**。装饰层用 `position: fixed` + `z-index: -1`；Anime.js 只接管滚动之后的部分。
5. **任何动效都要有"关闭"路径**，且关闭路径不依赖动效本身。

---

## 2. 分层实现策略 ★ 架构核心

> **v1.1 已重写**。旧版是"CSS 优先 + 手写 JS"，现改为「**CSS + Anime.js 双层**」。

```
┌──────────────────────────────────────────────────────────────────────┐
│ 第 0 层 · 服务端注入（0 KB JS，无闪烁）                                │
│   (site)/layout.tsx 读取 Setting.motion.config                        │
│     ├─ 写 <html data-motion-*> 属性     → 供 CSS 选择器命中            │
│     ├─ 写内联 CSS 变量 --motion-*       → 供 CSS 取缓动/时长值         │
│     └─ 序列化配置给 <MotionRoot />      → 供 Anime.js 读编排参数        │
│   收益：动效在 SSR 阶段就确定，无 FOUC、无客户端请求、无 hydration 依赖 │
├──────────────────────────────────────────────────────────────────────┤
│ 第 1 层 · CSS（0 KB）  ← 首屏与全部悬停态都在这里                       │
│   • 首屏 Hero 逐行遮罩揭示（overflow:hidden + translateY(110%)）        │
│   • 卡片/按钮/链接/图片的 hover 与 focus-visible 态                     │
│   • 背景装饰层（若启用，默认关闭）                                      │
│   • 骨架屏微光、焦点环、开关翻转                                        │
│   • 表格行悬停、导航当前态                                              │
│   → 判据：能靠"状态选择器 + transition/animation"表达的，一律 CSS        │
├──────────────────────────────────────────────────────────────────────┤
│ 第 2 层 · Anime.js（≤ 24.8 KB gzip）  ← 需要"编排"与"滚动感知"的部分    │
│   • 区块滚动入场编排（onScroll + createTimeline + stagger）             │
│   • 文字逐行/逐词揭示（splitText + stagger）★ Clay 风格的核心           │
│   • 数字滚动（计数动画）                                                │
│   • 页面切换淡入、弹窗/抽屉进出                                         │
│   • 列表重排 FLIP（createLayout）                                       │
│   • SVG 对勾描边（svg.createDrawable）                                  │
│   • 可选装饰：光标跟随、视差、磁吸、背景粒子（**默认全关**）             │
│   → 判据：需要"按时间轴编排多条""感知滚动进度""拆分文本"的才用它         │
├──────────────────────────────────────────────────────────────────────┤
│ 第 3 层 · 已删除                                                        │
│   旧版的手写 Canvas 粒子、手写 IntersectionObserver、手写 rAF 计数器      │
│   → 前两者由 Anime.js 覆盖；粒子因与 Minimal/Clean 冲突而整体移除        │
└──────────────────────────────────────────────────────────────────────┘
```

### 为什么首屏 Hero 仍然用 CSS

Clay 风格的签名动作是"标题逐行从小往上推出"。这个动效**首屏就要播**。

如果交给 Anime.js：JS 下载 → 解析 → 执行 `splitText` → 才开始动。在慢网络下，用户会先看到静止标题，然后它突然跳一下重播 —— 这正是"FOUC 式的动效事故"。

所以约定：**首屏 Hero 的逐行揭示用 CSS，服务端就写好 `--i` 序号**。

```css
/* 服务端渲染时直接输出 <span class="line-mask" style="--i:0"><span>第一行</span></span> */
.line-mask { display: block; overflow: hidden; }
.line-mask > span {
  display: block;
  transform: translate3d(0, 110%, 0);
  animation: line-up var(--duration-reveal) var(--ease-enter) forwards;
  animation-delay: calc(var(--i) * var(--stagger-loose));
}
@keyframes line-up { to { transform: none; } }
```

Anime.js 的 `splitText` 用在**滚动之后的内容**（文章正文小节、作品亮点列表等），那里没有首屏压力，且需要处理动态换行。

### Anime.js 在 React 里的接入范式

Anime.js v4 的 `createScope()` 是官方推荐的 React 用法，它解决两件事：**清理**与**响应式**。

```tsx
// components/site/motion/MotionRoot.tsx
'use client'

import { useEffect, useRef } from 'react'
import { createScope, animate, createTimeline, stagger, onScroll } from 'animejs'
import type { MotionConfig } from '@/config/motion/types'

export function MotionRoot({ config }: { config: MotionConfig }) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!root.current) return
    // 尊重系统偏好 —— 最高优先级，直接不初始化
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const scope = createScope({
      root: root.current,
      // 响应式：不同断点给不同编排
      mediaQueries: {
        isMobile: '(max-width: 767px)',
        isDesktop: '(min-width: 1024px)',
      },
    }).add((self) => {
      const { isMobile } = self.matches

      // ① 滚动入场
      onScroll({
        target: '.motion-section',
        threshold: 0.2,
        onEnter: (el) => {
          animate(el.querySelectorAll('.reveal'), {
            opacity: [0, 1],
            y: isMobile ? [10, 0] : [20, 0],
            duration: config.reveal.duration,
            delay: stagger(config.reveal.stagger),
            ease: config.reveal.easing,   // 规范值：'outExpo'
          })
        },
      })

      // ② 时间轴编排的区块
      createTimeline({ defaults: { ease: 'outExpo' } })
        .add('.hero-sub', { opacity: [0, 1], y: [12, 0], duration: 480 }, 420)
        .add('.hero-cta', { opacity: [0, 1], y: [10, 0], duration: 400, delay: stagger(80) }, 560)
    })

    return () => scope.revert()   // 卸载时干净回滚，避免残留内联样式
  }, [config])

  return <div ref={root}>{/* children */}</div>
}
```

**三个关键点**：

| 点 | 说明 |
|---|---|
| `scope.revert()` | 必写。Anime.js 会写内联 `style`，不 revert 会在路由切换后留下脏样式 |
| `mediaQueries` | 用它做响应式编排，**不要**在 JS 里手动监听 `resize` |
| 依赖数组含 `config` | 后台改配置 → `revalidateTag` → 页面重新渲染 → scope 重建，动效随之更新 |


### 为什么"服务端注入属性"是关键

错误做法（很多站点这么做）：

```
客户端 JS 读取配置 → 请求 /api/motion → 设置 CSS 变量 → 动画开始
                                ↑ 首屏已经渲染完了，动画才"跳"出来
```

正确做法：

```
SSR 时就把 data-motion-bg="gradient-flow" 和 --motion-bg-speed: 24s 写进 HTML
  → 首屏 HTML 一到，CSS 动画立即开始，无跳变、无请求、无 JS
```

配套 CSS：

```css
/* 背景动效层：固定定位、不占文档流、不阻塞 LCP */
[data-motion-bg]::before {
  content: "";
  position: fixed; inset: -20%;
  z-index: -1; pointer-events: none;
  background: linear-gradient(var(--motion-bg-angle), var(--motion-bg-c1), var(--motion-bg-c2), var(--motion-bg-c3));
  filter: blur(var(--motion-bg-blur));
  opacity: var(--motion-bg-opacity);
  will-change: transform;
}

[data-motion-bg="gradient-flow"]::before { animation: motion-flow var(--motion-bg-speed) ease-in-out infinite; }
[data-motion-bg="aurora"]::before        { animation: motion-aurora calc(var(--motion-bg-speed) * 1.6) ease-in-out infinite; }
[data-motion-bg="blur-blob"]::before     { animation: motion-blob calc(var(--motion-bg-speed) * 1.2) ease-in-out infinite; }
[data-motion-bg="grid"]::before          { background-image: linear-gradient(...), linear-gradient(...); animation: motion-grid-drift var(--motion-bg-speed) linear infinite; }

@keyframes motion-flow {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
  33%      { transform: translate3d(4%, -3%, 0) scale(1.08) rotate(6deg); }
  66%      { transform: translate3d(-3%, 4%, 0) scale(1.04) rotate(-4deg); }
}
```

> `inset: -20%` + `scale()` 是为了让模糊边缘不出框；`background: fixed` 避免滚动重绘。

### 零 JS 的滚动入场（现代方案）

```css
@supports (animation-timeline: view()) {
  [data-motion-reveal="fade-up"] .reveal {
    animation: motion-fade-up linear both;
    animation-timeline: view();
    animation-range: entry 0% entry var(--motion-reveal-range);
  }
}
@keyframes motion-fade-up {
  from { opacity: 0; transform: translate3d(0, 16px, 0); }
  to   { opacity: 1; transform: none; }
}
```

**降级链**：
1. 支持 `animation-timeline` → 纯 CSS 驱动，0 KB JS
2. 不支持 → `IntersectionObserver` 小组件（1.5 KB）加 `.is-visible` class
3. JS 也关闭 → 内容**直接可见**（`@media (scripting: none)` 兜底），绝不出现"内容永远不显示"

> ⚠️ 常见事故：入场动画失败导致内容停在 `opacity: 0`，整页看上去是空的。**必须**保证默认状态可见、动效是"增强"而非"前提"。实现上：`.reveal` 默认 `opacity: 1`，只在 `html[data-js-ready]` 时才设为 0（避免"JS 没跑完就隐藏内容"）。

### JS 动效的加载阈值

```tsx
// components/site/motion/MotionRuntime.tsx  (Client Component)
'use client'
import dynamic from 'next/dynamic'

const Particles = dynamic(() => import('./Particles'), { ssr: false, loading: () => null })
const CursorGlow = dynamic(() => import('./CursorGlow'), { ssr: false, loading: () => null })
const CountUp = dynamic(() => import('./CountUp'), { ssr: false, loading: () => null })

export function MotionRuntime({ config }: { config: MotionConfig }) {
  const [allowHeavy, setAllowHeavy] = useState(false)

  useEffect(() => {
    // 三重门槛：配置开启 + 非移动端 + 设备能力达标 + 未被降级
    const ok =
      config.background.type === 'particles' &&
      !matchMedia('(max-width: 767px)').matches &&
      (navigator.hardwareConcurrency ?? 8) > 4 &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !sessionStorage.getItem('motion:degraded')
    setAllowHeavy(ok)
  }, [config])

  return (
    <>
      {allowHeavy && <Particles count={config.performance.maxParticles} />}
      {config.interaction.cursor === 'glow' && !isMobile && <CursorGlow />}
    </>
  )
}
```

> 关键：`useEffect` 里判断 → 首次渲染**不加载**任何重动效，避免 SSR/CSR 不一致，也避免移动端白下载 15 KB。

---

## 3. 配置数据结构

### 存储方式

复用 `Setting` 表（KV + Json），**零数据库迁移**：

| key | group | value |
|---|---|---|
| `motion.config` | `motion` | 完整的 `MotionConfig` JSON |

> **为什么不单独建表**：动效配置是**单例、整体读写、无查询需求**的数据。用 KV + Zod 校验即可，加字段不用迁移。这也是 [02 文档 §2.3](02-data-model.md) 中 `Setting` 表设计的兑现。

### 完整结构

```jsonc
{
  "version": 1,
  "preset": "breath",              // minimal | breath | aurora | mesh | grid | stars | particles | custom

  // ---------- 全局 ----------
  "intensity": "standard",         // off | subtle | standard | rich  ← 总闸
  "respectReducedMotion": true,    // 锁定为 true，不可关闭
  "mobileIntensity": "subtle",     // off | subtle | standard  ← 移动端独立降级
  "autoDegrade": true,             // 低端设备 / 低帧率自动降级

  // ---------- 背景动效 ----------
  "background": {
    "enabled": true,
    "type": "gradient-flow",       // none | static | gradient-flow | aurora | blur-blob | grid | stars | particles
    "scope": "home",               // site（全站）| home（仅首页）| none
    "angle": 135,                  // deg
    "speed": 24,                   // 秒 / 一个循环
    "blur": 80,                    // px
    "opacity": 0.35,               // 0–1
    "noiseOverlay": true,          // 噪点叠加，消除渐变色带
    "parallax": true,              // 跟随鼠标轻微位移
    "light": { "colors": ["#6366F1", "#A855F7", "#EC4899"] },
    "dark":  { "colors": ["#1E1B4B", "#4C1D95", "#0F172A"] }
  },

  // ---------- 交互动画 ----------
  "interaction": {
    "cardHover": "lift",           // none | lift | scale | tilt | glow
    "buttonHover": "shine",        // none | color | shift | shine | scale
    "linkHover": "underline",      // none | underline | color
    "imageHover": "zoom",          // none | zoom | brighten
    "navIndicator": "slide",       // none | slide | fade
    "cursor": "glow",              // default | glow | none
    "magneticButtons": false       // 磁吸按钮（重动效）
  },

  // ---------- 入场动画 ----------
  "reveal": {
    "enabled": true,
    "type": "fade-up",             // none | fade | fade-up | scale | blur
    "range": 0.4,                  // 进入视口多少比例时完成
    "duration": 600,               // ms
    "stagger": 80,                 // ms，同级元素依次延迟
    "easing": "ease-out"
  },

  // ---------- 文字动效 ----------
  "text": {
    "heroType": "fade-words",      // none | fade-words | typewriter | gradient-flow
    "countUp": true,               // 数字滚动
    "gradientHeadings": false      // 标题渐变流动
  },

  // ---------- 微交互 ----------
  "micro": {
    "themeTransition": "circle",   // none | fade | circle
    "copyFeedback": "check",       // none | check | tooltip
    "pageTransition": "fade",      // none | fade
    "scrollProgress": true         // 顶部阅读进度条
  },

  // ---------- 性能与降级 ----------
  "performance": {
    "maxParticles": 60,
    "fpsGuard": true,
    "degradeBelowFps": 45,
    "pauseWhenHidden": true,
    "disableOnBattery": false
  }
}
```

### Zod Schema（前后端共用）

```ts
// lib/validators/motion.ts
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, '必须是 6 位十六进制颜色')

export const BackgroundSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(['none','static','gradient-flow','aurora','blur-blob','grid','stars','particles']),
  scope: z.enum(['site','home','none']),
  angle: z.number().min(0).max(360),
  speed: z.number().min(4).max(120),
  blur: z.number().min(0).max(200),
  opacity: z.number().min(0).max(1),
  noiseOverlay: z.boolean(),
  parallax: z.boolean(),
  light: z.object({ colors: z.array(Hex).min(1).max(4) }),
  dark:  z.object({ colors: z.array(Hex).min(1).max(4) }),
})

export const MotionConfigSchema = z.object({
  version: z.literal(1),
  preset: z.enum(['minimal','breath','aurora','mesh','grid','stars','particles','custom']),
  intensity: z.enum(['off','subtle','standard','rich']),
  respectReducedMotion: z.literal(true),                       // 不可为 false
  mobileIntensity: z.enum(['off','subtle','standard']),
  autoDegrade: z.boolean(),
  background: BackgroundSchema,
  interaction: z.object({
    cardHover: z.enum(['none','lift','scale','tilt','glow']),
    buttonHover: z.enum(['none','color','shift','shine','scale']),
    linkHover: z.enum(['none','underline','color']),
    imageHover: z.enum(['none','zoom','brighten']),
    navIndicator: z.enum(['none','slide','fade']),
    cursor: z.enum(['default','glow','none']),
    magneticButtons: z.boolean(),
  }),
  reveal: z.object({
    enabled: z.boolean(),
    type: z.enum(['none','fade','fade-up','scale','blur']),
    range: z.number().min(0.1).max(1),
    duration: z.number().min(100).max(2000),
    stagger: z.number().min(0).max(400),
    easing: z.enum(['linear','ease-out','ease-in-out','spring']),
  }),
  text: z.object({
    heroType: z.enum(['none','fade-words','typewriter','gradient-flow']),
    countUp: z.boolean(),
    gradientHeadings: z.boolean(),
  }),
  micro: z.object({
    themeTransition: z.enum(['none','fade','circle']),
    copyFeedback: z.enum(['none','check','tooltip']),
    pageTransition: z.enum(['none','fade']),
    scrollProgress: z.boolean(),
  }),
  performance: z.object({
    maxParticles: z.number().min(10).max(200),
    fpsGuard: z.boolean(),
    degradeBelowFps: z.number().min(20).max(60),
    pauseWhenHidden: z.boolean(),
    disableOnBattery: z.boolean(),
  }),
})
```

### 交叉校验规则（保存时执行，不通过则 422）

| 规则 | 原因 |
|---|---|
| `intensity === 'off'` → 所有子项强制为 `none` / `false` | 总闸关闭时不允许残留配置造成歧义 |
| `background.type === 'particles'` 且 `mobileIntensity !== 'off'` → **警告**（非阻止） | 粒子在移动端极耗电 |
| `maxParticles > 120` → **警告** | 低端机会掉帧 |
| 同时开启 ≥ 4 个"重动效"（particles / stars / cursor-glow / magnetic / parallax / countUp）→ **警告** | 组合开销叠加 |
| `light.colors` 与 `dark.colors` 为空 → `400 VALIDATION_ERROR` | 背景无颜色无法渲染 |
| `blur > 120` 且 `type !== 'none'` → **警告** | 大面积 `filter: blur` 在部分安卓机上极慢 |

---

## 4. 动效清单（8 类）

### 4.1 背景动效

| type | 视觉 | 实现 | JS |
|---|---|---|---|
| `none` | 纯色背景 | — | 0 |
| `static` | 静态渐变 | 单层 `linear-gradient` | 0 |
| `gradient-flow` | 渐变缓慢流动 | `::before` + `rotate/translate/scale` 关键帧 | 0 |
| `aurora` | 极光飘动 | 3 层 `radial-gradient` 叠不同速度 | 0 |
| `blur-blob` | 彩色光斑漂移 | 多个模糊圆点独立漂移 | 0 |
| `grid` | 网格缓慢漂移 | 双向 `linear-gradient` 网格 + 位移动画 | 0 |
| `stars` | 星空微闪 | `box-shadow` 点阵 + `opacity` 闪烁（**不用 canvas**） | 0 |
| `particles` | 粒子连线 | Canvas 2D 手写，最多 200 点，距离 < 120px 连线 | 12 KB |

**参数**：`angle` `speed` `blur` `opacity` `noiseOverlay` `parallax` `light.colors[]` `dark.colors[]`
**作用范围** `scope`：`site`（全站，含文章详情）/ `home`（仅首页，最省性能，**推荐**）

### 4.2 交互动画

| 目标 | 可选值 | 实现（纯 CSS） |
|---|---|---|
| 卡片 `cardHover` | `none` / `lift` / `scale` / `tilt` / `glow` | `hover` 内 `transform: translateY(-4px)` / `scale(1.02)` / `perspective + rotate` / `box-shadow` 扩散 |
| 按钮 `buttonHover` | `none` / `color` / `shift` / `shine` / `scale` | `shine` 用 `::after` 斜向白色渐变扫过 |
| 链接 `linkHover` | `none` / `underline` / `color` | `::after` 宽度 0 → 100% 过渡 |
| 图片 `imageHover` | `none` / `zoom` / `brighten` | 容器 `overflow:hidden` + 图片 `scale(1.05)` |
| 导航指示 `navIndicator` | `none` / `slide` / `fade` | 共享 `layoutId` 指示条（`framer-motion` 或纯 CSS `view-transition-name`） |
| 光标 `cursor` | `default` / `glow` / `none` | JS：`pointermove` → `translate3d`，rAF 节流；**触屏自动禁用** |
| 磁吸 `magneticButtons` | bool | JS：按钮 40px 范围内跟随指针偏移，`transform: translate` |

**全部包在能力查询里**：

```css
@media (hover: hover) and (pointer: fine) {
  [data-motion-card="lift"] .card:hover { transform: translate3d(0, -4px, 0); box-shadow: var(--shadow-md); }
}
```
> 触屏设备不会因为"没有 hover"而出现粘滞的悬停态 —— 这是移动端最常见的动效 bug。

### 4.3 入场动画（Reveal）

| type | 效果 |
|---|---|
| `none` | 直接显示 |
| `fade` | 仅透明度 |
| `fade-up` | 透明度 + 上移 16px（**默认**，最通用） |
| `scale` | 透明度 + 从 0.96 放大 |
| `blur` | 透明度 + `blur(8px)` → 0（较重，慎用） |

**交错（stagger）**：同级元素用 `--i` 变量逐个延迟

```css
[data-motion-reveal] .reveal { animation-delay: calc(var(--i, 0) * var(--motion-reveal-stagger)); }
```
服务端渲染时给列表项写 `style="--i:0"`、`--i:1`…（**服务端拆分，零客户端计算**）。

**排除项**：`above-the-fold` 的首屏内容**不做入场动画**（会拖累 LCP 观感），只对滚动进入视口的元素生效。

### 4.4 文字动效

| heroType | 效果 | 实现 |
|---|---|---|
| `none` | 静态 | — |
| `fade-words` | 逐词浮现 | 服务端按词拆 `<span style="--i:n">`，CSS `animation-delay` |
| `typewriter` | 打字机 + 光标闪动 | 纯 CSS `steps()` + `width` 动画（**仅限固定文案**，不支持换行） |
| `gradient-flow` | 渐变文字流动 | `background-clip: text` + `background-position` 动画 |
| `countUp` | 数字从 0 滚到目标 | JS 1.2 KB，`IntersectionObserver` 触发，`rAF` 插值 |
| `gradientHeadings` | 所有标题渐变流动 | 纯 CSS，可用但**克制**（大面积渐变文字伤可读性） |

> **无障碍**：文字动效必须保证最终可读。`typewriter` 对屏幕阅读器不友好，开启时自动加 `aria-label` 输出完整文本。

### 4.5 微交互

| 项 | 可选值 | 说明 |
|---|---|---|
| `themeTransition` | `none` / `fade` / `circle` | `circle` 用 View Transitions API 做"从按钮扩散"；降级为 `fade` |
| `copyFeedback` | `none` / `check` / `tooltip` | 复制代码/链接后的反馈 |
| `pageTransition` | `none` / `fade` | 路由切换淡入 |
| `scrollProgress` | bool | 文章详情顶部阅读进度条 |

### 4.6 加载动效

| 项 | 说明 |
|---|---|
| 骨架屏微光 | `background-position` 横扫，纯 CSS |
| 图片模糊占位 | `next/image` 的 `placeholder="blur"` + `blurDataURL` |
| 路由进度条 | 顶部 2px，跳转时出现（默认关闭，可选） |

### 4.7 状态反馈动效

| 项 | 说明 |
|---|---|
| 按钮点击 | `active:scale(.98)`，80ms |
| 表单错误 | 输入框左右抖动 2 次（`prefers-reduced-motion` 时禁用） |
| 成功对勾 | 描边绘制动画（SVG `stroke-dashoffset`） |
| 列表增删 | `FLIP` 动效（可选，较重） |

### 4.8 装饰动效

| 项 | 说明 |
|---|---|
| 噪点纹理 | SVG `feTurbulence` 叠加，消除渐变色带（`noiseOverlay`） |
| 噪点随动 | 噪点层轻微位移，模拟胶片颗粒（默认关） |
| 光标拖尾 | 仅 `particles` 预设下可选，默认关 |

---

## 5. 预设方案

> **v1.1 已重排**。预设的主轴从"背景有多花"改为"**编排有多丰富**" —— 这是 Minimal/Clean 方向的必然结果。
> 背景装饰类预设（极光/光斑/星空/粒子）**保留但全部降为"装饰"分组**，默认不选，且不与编排预设互斥。

### 5.1 编排预设（主轴，决定"页面怎么动"）

| 预设 | 强度 | 入场编排 | 文字揭示 | 悬停 | 背景 | 适用 |
|---|---|---|---|---|---|---|
| `static` **静态** | off | 无 | 无 | 仅颜色变化 | 纯色 | 追求极致性能；无障碍优先 |
| **`editorial` 编辑风** ★ | subtle | 区块淡入 + 轻微上移（480ms） | Hero 逐行遮罩（CSS） | 上浮 4px | 纯色 | **默认推荐** —— Clay 风格基线 |
| `narrative` **叙事** | standard | 时间轴多段编排 + 列表交错 | Hero 逐行 + 小节逐词 | 上浮 + 图片缩放 | 纯色 | 有故事要讲的页面：首页、关于我 |
| `kinetic` **动感** | rich | 全套编排 + FLIP + 数字滚动 | 逐行 + 逐词 + 渐变 | 上浮 + 倾斜 | 可叠加装饰 | 作品集、案例页 |

### 5.2 装饰预设（可选叠加层，默认全部关闭）

| 预设 | 内容 | 与风格的关系 |
|---|---|---|
| `none` **无装饰** ★ | 纯色背景 | **默认** |
| `tint` **淡色底** | 单层极淡渐变（无动画） | 可接受，静止的 |
| `flow` **流动渐变** | 缓慢流动的渐变层（24–36s） | ⚠ 与 Minimal 有张力，仅在首页考虑 |
| `aurora` **极光** | 多层光晕飘动 | ⚠ 属于 Motion Graphics 风格 |
| `blob` **光斑** | 模糊色斑漂移 | ⚠ 同上 |
| `grid` **网格** | 网格缓慢漂移 | ⚠ 偏极客风 |
| `stars` **星空** | 点阵闪烁 | ⚠ 暗色主题限定 |
| `particles` **粒子** | Canvas 点阵连线 | ❌ **与 Clean 方向冲突，不建议** |

> **为什么保留冲突项**：这是你的个人站，选择权在你。规范给出**推荐值**，但不剥夺可能性。后台会在选中 ⚠ / ❌ 项时给出风格提示（见 §8 危险配置确认）。

### 5.3 预设参数

```ts
// config/motion/presets.ts
export const MOTION_PRESETS: Record<PresetKey, Partial<MotionConfig>> = {
  // ── 默认推荐：Clay 风格基线 ─────────────────
  editorial: {
    intensity: 'subtle',
    background: { enabled: false, type: 'none', scope: 'none' },
    interaction: {
      cardHover: 'lift',      // translateY(-4px)
      buttonHover: 'color',
      linkHover: 'underline',
      imageHover: 'zoom',
      navIndicator: 'slide',
      cursor: 'none',
      magneticButtons: false,
    },
    reveal: {
      enabled: true,
      type: 'fade-up',        // y:+20px, opacity 0→1
      range: 0.2,
      duration: 480,          // 规范值 duration-slow
      stagger: 80,            // 规范值 stagger-base
      easing: 'outExpo',      // 规范值 ease-enter
    },
    text: {
      heroType: 'mask-lines', // CSS 逐行遮罩（首屏，0 KB）
      sectionType: 'none',    // 滚动后的小节不做文字动效
      countUp: false,
      gradientHeadings: false,
    },
    micro: {
      themeTransition: 'fade',
      copyFeedback: 'check',
      pageTransition: 'fade', // 280ms
      scrollProgress: true,
    },
  },

  // ── 叙事：多段编排 ──────────────────────────
  narrative: {
    intensity: 'standard',
    interaction: { /* 同 editorial */ },
    reveal: { enabled: true, type: 'fade-up', range: 0.2, duration: 600, stagger: 80, easing: 'outExpo' },
    text: { heroType: 'mask-lines', sectionType: 'mask-words', countUp: false, gradientHeadings: false },
    micro: { themeTransition: 'fade', copyFeedback: 'check', pageTransition: 'fade', scrollProgress: true },
  },

  // ── 动感：全套 ──────────────────────────────
  kinetic: {
    intensity: 'rich',
    interaction: { cardHover: 'tilt', imageHover: 'zoom', cursor: 'none', magneticButtons: true, /* … */ },
    reveal: { enabled: true, type: 'fade-up', range: 0.2, duration: 600, stagger: 60, easing: 'outExpo' },
    text: { heroType: 'mask-lines', sectionType: 'mask-words', countUp: true, gradientHeadings: false },
    micro: { themeTransition: 'circle', pageTransition: 'fade', scrollProgress: true, /* … */ },
    layout: { flip: true },   // createLayout 列表重排
  },

  static: {
    intensity: 'off',
    background: { enabled: false, type: 'none', scope: 'none' },
    interaction: { cardHover: 'color', buttonHover: 'color', linkHover: 'color',
                   imageHover: 'none', navIndicator: 'none', cursor: 'none', magneticButtons: false },
    reveal: { enabled: false, type: 'none', /* … */ },
    text: { heroType: 'none', sectionType: 'none', countUp: false, gradientHeadings: false },
    micro: { themeTransition: 'none', copyFeedback: 'check', pageTransition: 'none', scrollProgress: true },
  },
}
```

**切换预设的交互**：点预设卡 → 右侧预览窗立即套用 → 但不自动保存，需点「保存」；顶部提示条显示「已套用『叙事』，尚未保存」+ [撤销] [保存]。

---

## 6. 性能预算与降级策略 ★

### 6.1 体积预算

> **v1.1 已按实测重写**。旧版是"手写 JS、逐项估算、合计 22 KB"；现在是"**一个库 + 分层裁剪**"。
> 实测环境：animejs@4.5.0 · esbuild 0.28.2 · `--bundle --minify --format=esm` · GZip Optimal。

#### Anime.js 按导入组合实测

| 导入组合 | min | **gzip** | 说明 |
|---|---|---|---|
| `animate` + `stagger` | 35.3 KB | **14.1 KB** | 只能做简单补间，做不了编排 |
| + `createTimeline` `createScope` `onScroll` | 54.4 KB | **20.3 KB** | 能做滚动入场，**做不了逐行文字揭示** |
| **+ `splitText`** | 60.8 KB | **22.8 KB** | **推荐基线** —— Clay 风格的核心能力 |
| + `utils` `createSpring` | 65.9 KB | **24.8 KB** | 完整能力（弹簧、工具函数） |
| 全部走窄子路径 `animejs/text` 等 | 60.9 KB | **22.8 KB** | **与主入口完全相同**，没有收益 |

> **实测结论**：窄子路径导入**零收益**（22.8 = 22.8）。统一 `from 'animejs'` 导入，代码更干净。

#### 分层预算

| 层 | 实现 | JS (gzip) | 合成层 | 对 LCP 影响 |
|---|---|---|---|---|
| **CSS 层**（首屏 + 全部悬停态） | 纯 CSS transition/animation | **0** | 按需 | 无 |
| ├ Hero 逐行遮罩揭示 | CSS `overflow:hidden` + `translateY` | 0 | 按需 | **无（关键）** |
| ├ 卡片/按钮/链接/图片 hover | CSS `:hover` / `:focus-visible` | 0 | 按需 | 无 |
| ├ 背景装饰层（默认关闭） | CSS `::before` + transform | 0 | 1–3 | 无 |
| └ 骨架屏、焦点环、开关 | CSS | 0 | — | 无 |
| **Anime.js 层** | `animejs`（含 splitText/utils/spring） | **24.8** | 按需 | 无（滚动后才执行） |
| ├ 滚动入场编排 | `onScroll` + `animate` + `stagger` | ↑ 已含 | — | 无 |
| ├ 文字逐行/逐词揭示 | `splitText` + `stagger` | ↑ 已含 | — | 无 |
| ├ 数字滚动 / 页面切换 / FLIP | `animate` / `createLayout` | ↑ 已含 | 按需 | 无 |
| └ 可选装饰（光标/视差/磁吸/粒子） | `animate` + rAF | ↑ 已含 | 按需 | 无（默认全关） |
| **自研运行时** | 能力检测 / FPS 守护 / 偏好存储 | **~2** | — | 无 |
| **合计** | | **≈ 27 KB** | | |

**硬性红线：动效相关 JS 总量 ≤ 28 KB（gzip）。**

#### 预算为何放宽（25 → 28 KB）

旧红线是按"手写 JS、逐项累加"定的。换成 Anime.js 后有两个必然变化：

1. **Anime.js 无法按需裁剪到任意子集** —— `splitText` 是 Clay 风格的必要能力，一旦引入就是 22.8 KB 起
2. **旧方案里的手写 Canvas 粒子（12 KB）被删除** —— Minimal/Clean 方向不需要它

净变化：`-12 KB（粒子）+ 24.8 KB（Anime.js）+ 2 KB（自研）= +14.8 KB`，总预算从 25 → 28 KB，同时首屏 JS 预算从 110 → **135 KB**。

**用三条措施换回成本**：

| 措施 | 收益 |
|---|---|
| **后台完全不加载 Anime.js** | 后台仍是纯 CSS 过渡，首屏 JS 维持 ≤ 80 KB |
| **首屏 Hero 用 CSS** | Anime.js 只接管滚动之后的部分，不进入 LCP 关键路径 |
| **删除 Canvas 粒子** | −12 KB，且与风格方向一致 |

### 6.2 六级降级链（按优先级）

```
① prefers-reduced-motion: reduce          → 强制 intensity = 'off'（后台配置被覆盖）
   ↑ 最高优先级，用户系统偏好不可被站点无视

② 移动端（< 768px）                        → 降档到 mobileIntensity（默认 subtle）
                                             重动效一律不加载（粒子/光标/视差/磁吸）

③ 设备能力检测                             → hardwareConcurrency ≤ 4 或 deviceMemory ≤ 4
                                             或 connection.saveData           → 再降一档

④ FPS 守护                                → 连续 2s FPS < degradeBelowFps(45)
                                             关闭重动效 + 写 sessionStorage 记住本次会话

⑤ 省电模式 / prefers-reduced-transparency  → 关闭 blur 类背景（大面积 filter 最耗电）

⑥ 页面不可见（visibilitychange: hidden）    → 暂停所有 rAF 循环与 Canvas 绘制
```

**FPS 守护实现**：

```ts
// lib/motion/fpsGuard.ts
export function startFpsGuard(threshold = 45, onDegrade: () => void) {
  let frames = 0, last = performance.now(), lowStreak = 0
  const tick = (now: number) => {
    frames++
    if (now - last >= 1000) {
      const fps = (frames * 1000) / (now - last)
      lowStreak = fps < threshold ? lowStreak + 1 : 0
      if (lowStreak >= 2) { onDegrade(); return }   // 连续 2 秒低帧率才降级
      frames = 0; last = now
    }
    raf = requestAnimationFrame(tick)
  }
  let raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
```

降级后不弹任何提示（不打扰访客），但在**后台的预览窗**里显示「当前预览为降级状态：检测到低帧率」—— 让你知道真实访客看到的是什么。

### 6.3 用户端手动关闭

页脚放一个极小的图标按钮（`✨`/`⚡`），点击在三个档位间循环：**跟随系统 → 完整动效 → 关闭动效**，状态写 `localStorage`。这是给访客的最终兜底，也是 WCAG 2.2.2（暂停/停止/隐藏）的满足方式。

---

## 7. 可访问性

| 要求 | 落地 |
|---|---|
| 尊重系统偏好 | `@media (prefers-reduced-motion: reduce)` 全局把动画时长压到 0.01ms |
| 闪烁频率 | 任何动效闪烁 ≤ 3 Hz（WCAG 2.3.1）；禁止高频闪烁 |
| 不阻碍操作 | 动效时长全部 ≤ 600ms；入场动画不拦截点击（`pointer-events: none` 于装饰层） |
| 内容默认可见 | 入场动画失败时内容仍然可见（`opacity: 1` 为默认值） |
| 焦点可见 | `:focus-visible` 轮廓**不参与动效**，始终立即显示 |
| 文字可读 | 渐变文字必须满足对比度 ≥ 4.5:1（后台保存时做对比度校验，不达标给警告） |
| 屏幕阅读器 | 装饰性动效层加 `aria-hidden="true"`；typewriter 文案提供完整 `aria-label` |
| 键盘可达 | 所有 hover 动效对应的信息，键盘聚焦时同样呈现（`:focus-visible` 复用 `:hover` 样式） |
| 暂停能力 | 页脚提供显式「关闭动效」入口（见 §6.3） |

```css
@media (prefers-reduced-motion: reduce) {
  html[data-motion] *,
  html[data-motion] *::before,
  html[data-motion] *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  html[data-motion]::before { display: none !important; }   /* 背景动效层直接移除 */
}
```

---

## 8. 后台配置界面

**路由**：`/admin/settings/motion`（在侧边栏「站点设置」组下，显示名「动效」）
**接口**：`GET /api/v1/admin/settings/motion`、`PATCH /api/v1/admin/settings/motion`（仅 ADMIN）
**页面结构**：见设计稿 [`design/shots/25a-admin-motion-desktop.png`]

### 布局：左配置 + 右实时预览

```
┌────────────────────────────────────────────────────────────────────────────┐
│  动效                          [ 预览前台 ↗ ]  [ 恢复默认 ]  [ 保存 ]        │
│  让站点活起来，但别拖慢它                                                    │
├────────────────────────────────────────────────────────────────────────────┤
│  ⚡ 全局强度   [ 关闭 ] [ 轻微 ] [ ●标准 ] [ 丰富 ]     预设：[ 极光 ▾ ]     │
├──────────────────────────────────────────┬─────────────────────────────────┤
│  ┌ 预设方案 ──────────────────────────┐  │  ┌ 实时预览 ─────────────────┐  │
│  │ [极简][呼吸渐变][极光][光斑]        │  │  │  [ 亮色 | 暗色 ] [PC|移动] │  │
│  │ [网格][星空][粒子][自定义]          │  │  │  ┌───────────────────────┐ │  │
│  └────────────────────────────────────┘  │  │  │   ◐ 动效实时播放       │ │  │
│                                          │  │  │   Puly                │ │  │
│  ▼ 全局                                   │  │  │   5 年经验前端工程师   │ │  │
│     尊重系统"减弱动态效果"偏好  🔒 已锁定  │  │  │   [ 按钮 ] [ 按钮 ]    │ │  │
│     移动端强度  [ 轻微 ▾ ]                │  │  │   ┌─────┐ ┌─────┐    │ │  │
│     低端设备自动降级  [ ●━ ]              │  │  │   │卡片 │ │卡片 │    │ │  │
│                                          │  │  │   └─────┘ └─────┘    │ │  │
│  ▼ 背景动效                               │  │  └───────────────────────┘ │  │
│     启用  [ ●━ ]                          │  │                            │  │
│     类型  [无][静态][流动渐变][极光]       │  │  性能预估                   │  │
│           [光斑][网格][星空][粒子]        │  │  JS 体积    +0 KB   ✅      │  │
│     作用范围  ○全站  ●仅首页              │  │  合成层     2 层    ✅      │  │
│     亮色配色  ███ ███ ███                 │  │  LCP 影响   无      ✅      │  │
│     暗色配色  ███ ███ ███                 │  │  低端机     良好    ✅      │  │
│     速度  ──────●──── 24s                 │  │                            │  │
│     模糊  ─────●────── 80px               │  │  ⚠ 建议仅首页开启，可省 40%  │  │
│     不透明度 ────●──── 35%                │  │    渲染开销                 │  │
│     角度  ──────●──── 135°                │  └────────────────────────────┘  │
│     ☑ 噪点叠加  ☐ 鼠标视差                 │                                  │
│                                          │                                  │
│  ▶ 交互动画（6 项）                        │                                  │
│  ▶ 入场动画（5 项）                        │                                  │
│  ▶ 文字动效（3 项）                        │                                  │
│  ▶ 微交互（4 项）                          │                                  │
│  ▶ 性能与降级（5 项）                      │                                  │
└──────────────────────────────────────────┴─────────────────────────────────┘
```

### 关键交互

| 元素 | 行为 |
|---|---|
| **预设卡片** | 点击立即套用到预览窗（不自动保存）；顶部提示「已套用『极光』，尚未保存」+ [撤销] [保存] |
| **实时预览窗** | 内嵌一个迷你首页（Hero + 2 张卡片 + 2 个按钮），所有动效真实播放；可切亮色/暗色、PC/移动 |
| **移动端预览** | 切到「移动」时按 `mobileIntensity` 渲染，**如实反映访客在手机上的效果** |
| **参数滑块** | 拖动时预览**即时**更新（本地状态），松手后才写库 |
| **性能预估面板** | 实时计算当前配置的 JS 体积、合成层数、LCP 影响，超出阈值变黄/红 |
| **`respectReducedMotion`** | 带 🔒 图标锁定为开，悬浮提示「这是无障碍要求，不可关闭」 |
| **保存** | 校验 Zod → 交叉规则检查 → 若有警告弹确认框 → 写库 + `revalidateTag('setting')` + 写 AuditLog |
| **保存后的生效** | 前台 5 秒内生效（ISR tag 失效） |

### 危险配置的确认交互

当交叉校验命中警告时，不直接阻止，而是列出后果让你决定：

```
┌──────────────────────────────────────────────────────────┐
│  ⚠ 这个配置可能影响性能                                    │
├──────────────────────────────────────────────────────────┤
│  检测到 3 项需要注意：                                     │
│                                                          │
│  ⚠ 背景类型为「粒子」，但移动端强度为「标准」               │
│     → 粒子在中低端手机上可能掉到 30fps 以下，耗电明显       │
│  ⚠ 最大粒子数 150，超过建议值 120                         │
│  ⚠ 同时启用了 5 项重动效（粒子/星空/光标/视差/磁吸）        │
│     → 组合开销叠加，低端设备降级概率高                     │
│                                                          │
│  前置条件（已满足）：                                      │
│  ✓ 已开启低端设备自动降级                                  │
│  ✓ 已开启 FPS 守护（低于 45fps 自动关闭重动效）             │
│                                                          │
│  [ 返回调整 ]              [ 我知道，仍然保存 ]            │
└──────────────────────────────────────────────────────────┘
```

---

## 9. 前台注入机制（数据流）

```
后台 PATCH /api/v1/admin/settings/motion
  → motionService.update(dto)
      ├─ MotionConfigSchema.parse(dto)             Zod 校验
      ├─ assertNoBlockingIssues(dto)               交叉规则（阻断类）
      ├─ prisma.setting.upsert({ key:'motion.config', group:'motion', value })
      ├─ writeAuditLog({ resource:'setting', resourceId:'motion', before, after })
      └─ revalidateTag('setting')                  前台缓存失效
  ↓
访客请求首页
  → (site)/layout.tsx (Server Component)
      const motion = await settingService.getMotionConfig()   // 走 unstable_cache，tag 'setting'
      ├─ <html data-motion-bg="gradient-flow" data-motion-card="lift" …>
      ├─ <style> :root { --motion-bg-speed: 24s; --motion-bg-c1: #6366F1; … } </style>
      └─ <MotionRuntime config={motion} />          Client Component（默认不加载任何重动效）
  ↓
浏览器
  ├─ CSS 层：属性选择器命中 → 背景动画立即开始（0 JS，无 FOUC）
  ├─ 能力查询：@media (hover:hover) / (prefers-reduced-motion) 决定是否生效
  └─ 延迟加载：仅当配置含重动效且设备达标 → dynamic import 第 2/3 层
```

### 内联 style 的 CSP 考虑

内联 `<style>` 与 `style=` 属性需要 CSP 允许 `'unsafe-inline'`（[01 文档 §9](01-architecture.md) 已说明 Next.js 内联脚本本身就需要）。若要收紧，可改用 `<html>` 上的 `data-*` 属性 + 预定义的 CSS 变量组合（用有限枚举代替任意值），代价是失去滑块调参能力。**一期先用内联 style，接受 `'unsafe-inline'`。**

### 缓存策略

| 数据 | 缓存 | 失效 |
|---|---|---|
| `motion.config` | `unstable_cache`，tag `setting` | 后台保存时 `revalidateTag('setting')` |
| 前台页面 | ISR 300–3600s | 同上 |

动效配置变更后，前台最长 **5 秒**生效。

---

## 10. 文件结构

```
src/
├─ config/motion/
│  ├─ presets.ts              # 8 个预设的完整参数
│  ├─ types.ts                # MotionConfig 类型
│  └─ defaults.ts             # 默认配置（breath 预设）
├─ lib/
│  ├─ validators/motion.ts    # Zod schema + 交叉校验
│  ├─ services/motionService.ts
│  └─ motion/
│     ├─ inject.ts            # 配置 → data-* 属性 + CSS 变量
│     ├─ fpsGuard.ts          # FPS 守护
│     ├─ capability.ts        # 设备能力检测
│     └─ userPreference.ts    # localStorage 三档偏好
├─ components/site/motion/
│  ├─ MotionRuntime.tsx       # 客户端调度器（默认不加载重动效）
│  ├─ Particles.tsx           # Canvas 粒子（仅第 3 层）
│  ├─ CursorGlow.tsx          # 光标光晕
│  ├─ Parallax.tsx            # 视差容器
│  ├─ Magnetic.tsx            # 磁吸按钮
│  ├─ CountUp.tsx             # 数字滚动
│  ├─ Reveal.tsx              # 入场动画降级实现（IO）
│  ├─ ThemeToggleCircle.tsx   # 主题圆形扩散
│  └─ MotionPreferenceToggle.tsx  # 页脚的三档开关
├─ components/admin/motion/
│  ├─ PresetPicker.tsx        # 预设卡片选择器
│  ├─ MotionPreview.tsx       # 实时预览窗
│  ├─ PerfEstimate.tsx        # 性能预估面板
│  ├─ ParamSlider.tsx         # 带数值的滑块
│  ├─ ColorTriple.tsx         # 三色配色编辑
│  └─ MotionWarningDialog.tsx # 危险配置确认
└─ styles/
   ├─ motion.css              # 全部动效的 CSS 实现（按 data-* 属性选择器组织）
   └─ motion-reduced.css      # prefers-reduced-motion 兜底
```

> **`motion.css` 是唯一放动效的地方**，组件里不写动画代码。这样"找某个动效"只需看一个文件，也便于整块审计性能。

---

## 11. 验收标准

### 功能
- [ ] 后台 8 个预设都能一键套用，预览窗实时反映效果
- [ ] 每个参数滑块拖动时预览即时更新，松手后保存才写库
- [ ] 保存后前台 **5 秒内**生效
- [ ] 页脚「关闭动效」开关在三个档位间循环，刷新后保持
- [ ] 预设套用后手动改任一项，`preset` 自动变为 `custom`

### 性能
- [ ] 后台性能预估面板的 JS 体积数值与实测一致（误差 ≤ 10%）
- [ ] 配置 `minimal` 时，动效相关 JS **为 0 KB**
- [ ] 配置 `breath`（默认）时，动效相关 JS **为 0 KB**
- [ ] 配置 `particles` 时，动效 JS ≤ 25 KB（gzip）
- [ ] 移动端加载首页时，**不下载** `Particles.tsx` chunk（用 Network 面板确认）
- [ ] 开启背景动效后 LCP 变化 ≤ 0.1s
- [ ] 开启全部动效后 Lighthouse Performance 仍 ≥ 85（移动端）

### 降级
- [ ] 系统开启「减弱动态效果」后，所有动画停止且内容正常显示
- [ ] 模拟 4 核 CPU / 3G 网络 → 重动效不加载
- [ ] 用 DevTools 把 FPS 压到 30 → 2 秒内自动降级，且后台预览窗显示「降级状态」
- [ ] 切到其他标签页 → rAF 停止（Performance 面板确认无持续绘制）
- [ ] 禁用 JavaScript → 站点完整可读可用，入场内容全部可见（**不能是空白**）

### 可访问性
- [ ] `prefers-reduced-motion: reduce` 下背景动效层 `display: none`
- [ ] 键盘 Tab 到卡片/按钮时，`:focus-visible` 呈现与 hover 等效的视觉反馈
- [ ] 渐变文字对比度 ≥ 4.5:1（后台保存时给出校验）
- [ ] 所有装饰动效层带 `aria-hidden="true"`
- [ ] 无任何闪烁频率 > 3Hz 的动效

### 边界
- [ ] 触屏设备上不出现"粘住的 hover 态"
- [ ] 背景动效在 320px 窄屏下不产生横向滚动条
- [ ] 暗色/亮色两套配色都能正常渲染
- [ ] 背景动效层不遮挡任何可点击元素（`pointer-events: none`）
- [ ] 后台把 `intensity` 设为 `off` 后，所有子配置在 UI 上置灰但**不清空**（重新开启时配置还在）

---

## 12. 相关文档

- `Setting` 表与 KV 设计 → [02-data-model.md §2.3](02-data-model.md)
- 后台配置页信息架构 → [04-admin-console.md](04-admin-console.md)
- 前台渲染与三端策略 → [05-frontend-ia.md](05-frontend-ia.md)
- 性能预算总表 → [01-architecture.md §10](01-architecture.md)
- 实施任务与排期 → [07-roadmap.md](07-roadmap.md)
- 动效分镜表（静态图表达动画）→ `design/motion-storyboard.html`
