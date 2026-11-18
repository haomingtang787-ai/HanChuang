// r4 冒烟：图解渲染 / 左侧原件面板并排不遮挡 / 顶栏搜索定位 / WPS 打开方案
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!target) throw new Error('找不到渲染进程页面')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))

let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 20000, step = 400) {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (await ev(`Boolean(${fn})`)) return true
    await wait(step)
  }
  return false
}
async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(EVID, name), Buffer.from(res.result.data, 'base64'))
}
function log(...args) { console.log(...args) }
const fail = (msg) => { throw new Error(msg) }

await ev(`(() => {
  const clickText = (selector, text) => {
    const nodes = [...document.querySelectorAll(selector)]
    const hit = nodes.find((node) => node.textContent.trim().includes(text))
    if (!hit) return false
    hit.click()
    return true
  }
  const setInput = (node, value) => {
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }
  window.__hc = { clickText, setInput }
  return true
})()`)

log('step1 打开计基的课堂')
await ev(`__hc.clickText('.hc-course-row', '计基')`)
await wait(900)
const sessionTitle = await ev(`(() => { const rows = [...document.querySelectorAll('.hc-session-row')]; return rows.length ? rows[0].textContent.trim() : '' })()`)
log('  会话:', sessionTitle)
await ev(`(() => { const rows = [...document.querySelectorAll('.hc-session-row')]; rows[0]?.click(); return true })()`)
if (!(await until(`document.querySelector('.hc-composer')`, 15000))) fail('课堂没打开')
const meta = await ev(`(async () => { const r = await window.desk.study.list(); const s = r.data.items[0]; return s ? { sessionId: s.sessionId, title: s.title, dvid: s.documentVersionId } : null })()`)
log('  当前课堂:', meta?.title)

log('step2 左侧原件面板：默认不显示')
if (await ev(`document.querySelector('.hc-source-pane')`)) fail('面板不该默认打开')

log('step3 点「原课件」：面板出现在左侧，且不遮挡聊天')
await ev(`__hc.clickText('.hc-theme-btn', '原课件')`)
if (!(await until(`document.querySelector('.hc-source-pane')`, 12000))) fail('面板没打开')
await wait(1400)
const rects = await ev(`(() => {
  const pane = document.querySelector('.hc-source-pane').getBoundingClientRect()
  const chat = document.querySelector('.hc-chat-col').getBoundingClientRect()
  return { paneLeft: pane.left, paneRight: pane.right, paneWidth: pane.width, chatLeft: chat.left, chatWidth: chat.width, overlap: pane.right > chat.left + 1 }
})()`)
log('  布局:', JSON.stringify(rects))
if (rects.overlap) fail('面板压住了聊天列')
const pageLabel = await ev(`document.querySelector('.hc-source-page')?.textContent ?? ''`)
log('  页码:', pageLabel)
if (!pageLabel.includes('/')) fail('没有显示总页数')
const wpsBtn = await ev(`Boolean([...document.querySelectorAll('.hc-source-wps')].length)`)
if (!wpsBtn) fail('缺少「用 WPS 打开」按钮')
await shot('r4-01-pane-docked.png')

log('step4 翻页')
const before = pageLabel
await ev(`__hc.clickText('.hc-source-nav', '下一页')`)
await wait(900)
const after = await ev(`document.querySelector('.hc-source-page')?.textContent ?? ''`)
log(`  ${before} -> ${after}`)
if (after === before) fail('翻页没生效')

log('step5 拖窄/拖宽并落盘')
const beforeWidth = await ev(`document.querySelector('.hc-source-pane').getBoundingClientRect().width`)
await ev(`(() => {
  const handle = document.querySelector('.hc-source-resize')
  const rect = handle.getBoundingClientRect()
  handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 40 }))
  window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: rect.top + 40 }))
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  return true
})()`)
await wait(600)
const afterWidth = await ev(`document.querySelector('.hc-source-pane').getBoundingClientRect().width`)
const saved = await ev(`localStorage.getItem('hc.pane.v1')`)
log(`  宽度 ${Math.round(beforeWidth)} -> ${Math.round(afterWidth)}，落盘 ${saved}`)
if (!saved || !JSON.parse(saved).open) fail('面板偏好没落盘')
if (Math.abs(afterWidth - 320) > 2) fail('拖动调宽没夹到最小 320')

log('step6 顶栏搜索：搜「存储器」→ 点结果定位原文')
await ev(`(() => { const input = document.querySelector('.hc-search-input'); __hc.setInput(input, '存储器'); return true })()`)
if (!(await until(`document.querySelectorAll('.hc-search-hit').length > 0`, 15000))) fail('搜索没出结果')
const hitCount = await ev(`document.querySelectorAll('.hc-search-hit').length`)
const firstHit = await ev(`document.querySelector('.hc-search-hit').textContent.trim()`)
log(`  命中 ${hitCount} 条，第一条：${firstHit}`)
await shot('r4-02-search.png')
await ev(`document.querySelector('.hc-search-hit').click()`)
await wait(1500)
const paneTitle = await ev(`document.querySelector('.hc-source-title')?.textContent ?? ''`)
const panePage = await ev(`document.querySelector('.hc-source-page')?.textContent ?? ''`)
log(`  面板切到：${paneTitle} / ${panePage}`)
if (!(await ev(`Boolean(document.querySelector('.hc-source-pane'))`))) fail('搜索结果没打开面板')
await shot('r4-03-search-hit.png')

log('step7 WPS 打开：dryRun 只算方案')
const wps = await ev(`window.desk.documents.openNative({ documentVersionId: ${JSON.stringify(meta.dvid)}, dryRun: true })`)
log('  ', JSON.stringify(wps?.data ?? wps))
if (!wps?.ok) fail('WPS 方案调用失败')
if (wps.data.mode !== 'wps') fail(`没有选中 WPS：${wps.data.mode}`)
if (!/wpp|wps|wpspdf/i.test(wps.data.exe ?? '')) fail('WPS 可执行文件路径不对')

log('step8 图解渲染：让老师用 mermaid 画链表节点')
await ev(`(() => { const area = document.querySelector('.hc-composer textarea'); __hc.setInput(area, '请用 mermaid 画一张图：链表节点由「数据域」和「指针域」组成，指针指向下一个节点。只给图，不要解释。'); return true })()`)
await wait(300)
await ev(`document.querySelector('.hc-send').disabled = false; document.querySelector('.hc-send').click()`)
if (!(await until(`document.querySelector('.hc-diagram svg')`, 60000))) {
  const fallback = await ev(`Boolean(document.querySelector('.hc-code'))`)
  await shot('r4-04-mermaid-fail.png')
  fail(`没渲染出图解（出现代码块兜底=${fallback}，请查看 docs/app-stderr.log）`)
}
const svgInfo = await ev(`(() => { const svg = document.querySelector('.hc-diagram svg'); return { width: Math.round(svg.getBoundingClientRect().width), chars: svg.outerHTML.length } })()`)
log('  图解:', JSON.stringify(svgInfo))
await shot('r4-04-mermaid.png')

log('SMOKE_R4_OK')
ws.close()
