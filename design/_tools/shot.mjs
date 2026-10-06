// 基于 Chrome DevTools Protocol 的批量全页截图 + 布局自检工具
// 零依赖（Node 22+ 自带 WebSocket / fetch）
// 用法: node shot.mjs <manifest.json>
// manifest: { outDir, targets: [{ file, out, width, height?, mobile?, dark?, scale? }] }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const CDP_PORT = Number(process.env.CDP_PORT || 9333)
const manifestPath = resolve(process.argv[2])
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const baseDir = dirname(manifestPath)
const outDir = resolve(baseDir, manifest.outDir)
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getBrowserWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      const j = await r.json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error(`无法连接 CDP (port ${CDP_PORT})，Edge 是否已启动？`)
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = new Set()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 45000)
    })
  }
  once(method, sessionId) {
    return new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          this.listeners.delete(fn)
          resolve(msg.params)
        }
      }
      this.listeners.add(fn)
    })
  }
}

// 布局自检：横向溢出、内容裁剪、字号过小、空内容
const CHECK_JS = `(() => {
  const vw = document.documentElement.clientWidth;
  const over = [], clipped = [], tiny = [];
  const inClipper = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.spec')) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    // 1. 越出视口右边界（被任何裁剪/滚动容器包住的内容不算）
    if (r.width > 2 && r.right > vw + 1.5 && cs.position !== 'fixed' && !inClipper(el)) {
      const cls = typeof el.className === 'string' ? el.className : '';
      over.push(el.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\\s+/).slice(0,2).join('.') : '') + '@' + Math.round(r.right));
    }

    // 2. 内容被裁剪（自身或祖先可滚动的不算）
    const scrollable = cs.overflowX === 'auto' || cs.overflowX === 'scroll' || inClipper(el);
    if (!scrollable && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && r.width > 2) {
      clipped.push(el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : '') + ' ' + el.scrollWidth + '>' + el.clientWidth);
    }

    // 3. 字号过小（缩略预览内的微型文字不算 —— 那是等比缩放的示意）
    const inMiniature = el.closest('.frame-box, .preview-frame, .thumb, .preset-card');
    if (!inMiniature && el.children.length === 0 && (el.textContent || '').trim().length > 1) {
      const fs = parseFloat(cs.fontSize);
      if (fs && fs < 9 && el.offsetParent !== null) {
        tiny.push(Math.round(fs) + 'px: ' + (el.textContent || '').trim().slice(0, 14));
      }
    }
  }
  const text = (document.body.innerText || '').replace(/\\s+/g, '');
  return JSON.stringify({
    vw,
    scrollW: document.documentElement.scrollWidth,
    docH: document.documentElement.scrollHeight,
    overflow: [...new Set(over)].slice(0, 8),
    clipped: [...new Set(clipped)].slice(0, 6),
    tiny: [...new Set(tiny)].slice(0, 5),
    textLen: text.length
  });
})()`

const browserWs = await getBrowserWs()
const ws = new WebSocket(browserWs)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
const cdp = new Cdp(ws)

const results = []
for (const t of manifest.targets) {
  const width = t.width ?? 1440
  const scale = t.scale ?? 2
  const mobile = t.mobile ?? width < 768
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: t.height ?? 900,
      deviceScaleFactor: scale,
      mobile,
      screenWidth: width,
      screenHeight: t.height ?? 900,
    }, sessionId)
    if (t.dark) {
      await cdp.send('Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [{ name: 'prefers-color-scheme', value: 'dark' }],
      }, sessionId)
    }

    const url = 'file:///' + resolve(baseDir, t.file).replace(/\\/g, '/')
    const loaded = cdp.once('Page.loadEventFired', sessionId)
    await cdp.send('Page.navigate', { url }, sessionId)
    await Promise.race([loaded, sleep(8000)])
    await sleep(t.settle ?? 400)

    // ---- 自检 ----
    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: CHECK_JS,
      returnByValue: true,
    }, sessionId)
    const check = JSON.parse(evalRes.result.value)

    const metrics = await cdp.send('Page.getLayoutMetrics', {}, sessionId)
    const contentH = Math.ceil(
      (metrics.cssContentSize?.height ?? metrics.contentSize.height) + (t.padBottom ?? 0)
    )
    const clipH = Math.min(contentH, t.maxHeight ?? 26000)

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: clipH, scale: 1 },
      fromSurface: true,
    }, sessionId)

    const buf = Buffer.from(shot.data, 'base64')
    writeFileSync(join(outDir, t.out), buf)

    const problems = []
    if (check.scrollW > width + 1) problems.push(`横向溢出 ${check.scrollW}>${width}`)
    if (check.overflow.length) problems.push(`越界: ${check.overflow.join(' ')}`)
    if (check.clipped.length) problems.push(`裁剪: ${check.clipped.join(' ')}`)
    if (check.tiny.length) problems.push(`字号过小: ${check.tiny.join(' ')}`)
    if (check.textLen < 200) problems.push(`文本过少(${check.textLen})`)

    results.push({
      out: t.out,
      w: width,
      h: clipH,
      KB: Math.round(buf.length / 1024),
      check: problems.length ? '⚠ ' + problems.join(' | ') : 'OK',
    })

    await cdp.send('Target.closeTarget', { targetId })
  } catch (e) {
    results.push({ out: t.out, w: width, h: '-', KB: '-', check: 'ERROR: ' + String(e.message || e) })
  }
}

console.table(results)
const failed = results.filter((r) => r.check !== 'OK')
console.log(
  failed.length
    ? `\n⚠ ${failed.length}/${results.length} 张需要复查`
    : `\n✅ 全部 ${results.length} 张截图成功且布局自检通过`
)
ws.close()
process.exit(0)
