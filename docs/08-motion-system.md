# 08 · 动效系统（一期权威合同 version 2）

2026-10-07修订。旧背景/光标/粒子等合同已移除；一期仅实施本文件。类型入口src/config/motion.ts，视觉令牌见[设计规范](设计规范.md)。以下均为待实现要求，配置类型存在不代表运行时完成。

## 1. 范围与职责
CSS负责首屏、Hero标题/副标题/CTA和基本状态；Anime.js仅按需用于离屏内容编排。正文不依赖JS显示，关闭/失败不保留隐藏内容。CSS集中样式、JS集中运行时。无Canvas、光标跟随、视差、磁吸、连续背景、星空/极光/粒子、3D倾斜。

## 2. 完整默认配置
```json
{
  "version": 2,
  "preset": "editorial",
  "intensity": "standard",
  "respectReducedMotion": true,
  "mobileIntensity": "subtle",
  "autoDegrade": true,
  "decoration": { "type": "none", "opacity": 0.06 },
  "reveal": { "enabled": true, "duration": 450, "stagger": 60 },
  "interaction": { "cardHover": "lift", "linkHover": "underline" }
}
```
存于Setting的motion.config，默认值与src/config/motion.ts同步维护，读写完整校验，不直接读取旧version1。

## 3. 字段合同
| 字段 | 合法值 |
|---|---|
| version | 固定2 |
| preset | static / editorial / narrative / kinetic |
| intensity | off / subtle / standard |
| respectReducedMotion | 固定true |
| mobileIntensity | off / subtle |
| autoDegrade | boolean |
| decoration.type | none / tint，tint为静态底色 |
| decoration.opacity | 0..0.15 |
| reveal.enabled | boolean |
| reveal.duration | 150..800ms |
| reveal.stagger | 0..100ms |
| interaction.cardHover | none / lift |
| interaction.linkHover | none / underline |

每层严格拒绝未知键。PATCH仅合并已知嵌套键，数组整体替换，合并后重验；本合同字段不可null。未知/非法值400；respectReducedMotion=false拒绝（422）。四预设为完整模板，套用后可在合法范围微调，无custom预设。

## 4. 四预设和升级
| 预设 | 编排 |
|---|---|
| static | off、reveal关闭、交互none、装饰none |
| editorial（默认） | 克制首次区块入场和卡片/链接状态 |
| narrative | 离屏内容按叙事顺序有限编排 |
| kinetic | 更鲜明的有限编排，遵守相同预算与降级 |

version1：minimal转static，其余旧预设转editorial；移除连续背景/光标/重交互字段，decoration重置none/0；保留合法强度和布尔值，respectReducedMotion强制true，duration/stagger收敛至新版范围。备份旧值、写升级审计，不透传未知旧字段。

## 5. 降级与生命周期
系统reduce和访客主动关闭最高优先；访客完整不可覆盖reduce。移动按mobileIntensity；autoDegrade结合可用硬件/省流量信息降档，API缺失保守fallback；FPS低停用JS编排。隐藏页暂停本页实例，路由切换清理scope/observer/rAF。省电API不可跨浏览器可靠检测，不作保证。关闭、失败、disabled时内容始终可读。

## 6. API与后台
GET /api/v1/admin/settings/motion返回config、四预设及明确标注的估算；PATCH限ADMIN、审计、失效setting与前台关联缓存。公开GET /api/v1/site仅含渲染配置。普通后台不加载站点动效；动效预览页按需加载同一运行时；预览不落库，保存才写入，取消恢复最近保存值。

## 7. 验收与性能
文章详情首屏≤135KB gzip、登录≤110KB gzip、动效≤28KB gzip（库/运行时/fallback合计）。Next First Load构建口径不能替代真实gzip传输量。static不下载库，editorial不承诺零JS。

- [ ] 四预设保存/刷新/恢复默认及version1升级。
- [ ] none/tint静态装饰不挡正文或点击，无连续背景。
- [ ] reduce动态变化、移动降档、关闭、隐藏页、卸载通过。
- [ ] Hero和正文关闭/失败可读，焦点立即显示。
- [ ] 预览与前台一致，普通后台不下载库。
- [ ] 构建chunk与网络实测预算、三视口截图通过。
- [ ] 保存后5秒新请求更新；已有页面主动刷新。
