// PDF 课堂的原文对照：必须显示真实页面图，并停在老师引用那一页。
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Page.javascriptDialogOpening') {
    ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: true } }))
  }
})
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500))
  return r.result?.result?.value
}
async function waitFor(expression, label, timeout = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await ev(expression)) return
    await new Promise((r) => setTimeout(r, 700))
  }
  throw new Error('等待超时: ' + label)
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(EVID, name), Buffer.from(r.result.data, 'base64'))
  console.log('截图:', name)
}

const session = await ev(`window.desk.study.list().then((r) => {
  const row = r.ok ? r.data.items.find((item) => /\\.pdf$/i.test(item.sourceName ?? '')) : null
  return row ? { title: row.title, courseId: row.courseId } : null
})`)
if (!session) throw new Error('没有 PDF 课堂可测')
const courseName = await ev(`window.desk.study.courses().then((r) => {
  const c = r.ok ? r.data.items.find((item) => item.courseId === ${JSON.stringify(session.courseId)}) : null
  return c ? c.name : null
})`)
console.log('[PDF]', session.title, '·', courseName)

const shown = await ev(`[...document.querySelectorAll('.hc-session-row')].some((e) => e.textContent.includes(${JSON.stringify(session.title)}))`)
if (!shown) {
  await ev(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes(${JSON.stringify(courseName)}))?.click()`)
}
await waitFor(`[...document.querySelectorAll('.hc-session-row')].some((e) => e.textContent.includes(${JSON.stringify(session.title)}))`, 'PDF 课堂行')
await ev(`[...document.querySelectorAll('.hc-session-row')].find((e) => e.textContent.includes(${JSON.stringify(session.title)})).click()`)
await waitFor(`[...document.querySelectorAll('.hc-header button')].some((e) => e.textContent.trim() === '原文')`, 'PDF 课堂打开')
await ev(`[...document.querySelectorAll('.hc-header button')].find((e) => e.textContent.trim() === '原文')?.click()`)
await waitFor(`!!document.querySelector('.hc-source-drawer')`, '原文抽屉')
await waitFor(`document.querySelectorAll('.hc-source-image img').length > 0`, 'PDF 页图')
const info = await ev(`({
  page: document.querySelector('.hc-source-page')?.textContent ?? '',
  img: document.querySelectorAll('.hc-source-image img').length,
  loaded: (() => { const img = document.querySelector('.hc-source-image img'); return img ? img.naturalWidth > 0 : false })(),
})`)
console.log('[PDF 抽屉]', JSON.stringify(info))
if (!info.loaded) throw new Error('页图没有真正加载出来')
await shot('r3-08-pdf-source.png')
console.log('SMOKE_R3_PDF_OK')
ws.close()
