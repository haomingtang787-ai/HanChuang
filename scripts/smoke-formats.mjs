// 格式补测：真实 DOCX + 真实 PPTX 走 UI 上传→备课→上课全链路。
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
const DOCX = 'C:\\Users\\16122\\Desktop\\复习资料\\计基2\\03_第3章_存储器与Cache.docx'
const PPTX = 'C:\\Users\\16122\\Desktop\\世界社会主义500年\\世界社会主义五百年大脉络_30页.pptx'
for (const p of [DOCX, PPTX]) if (!fs.existsSync(p)) throw new Error('素材不存在: ' + p)

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
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
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.error) throw new Error(JSON.stringify(r.error))
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 800))
  return r.result?.result?.value
}
async function waitFor(expression, label, timeout = 300000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await evalJs(expression)) return
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('等待超时: ' + label)
}
const log = (step, detail) => console.log(`[${step}]`, detail ?? '')
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`!!window.desk && !!document.querySelector('.hc-app')`, '应用就绪')
await evalJs(`
  window.__hc = {
    setInput(selector, value, index = 0) {
      const el = document.querySelectorAll(selector)[index]
      if (!el) throw new Error('找不到输入框 ' + selector)
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    },
    clickText(selector, text) {
      const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().includes(text))
      if (!el) throw new Error('找不到按钮 ' + text)
      el.click()
      return true
    },
  }
  true
`)

// 建课程 → 展开 → 点该课程的上传入口 → 隐藏 input 塞两个真实文件
await evalJs(`window.__hc.setInput('.hc-new-course input', '课件格式验证')`)
await evalJs(`document.querySelector('.hc-new-course-btn').click()`)
await waitFor(`[...document.querySelectorAll('.hc-course-row')].some((e) => e.textContent.includes('课件格式验证'))`, '新课程')
const hasBtn = await evalJs(`(() => {
  const row = [...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('课件格式验证'))
  return !!row.parentElement.querySelector('.hc-upload-btn')
})()`)
if (!hasBtn) {
  await evalJs(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('课件格式验证')).click()`)
}
await evalJs(`(() => {
  const row = [...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('课件格式验证'))
  row.parentElement.querySelector('.hc-upload-btn').click()
})()`)
await send('DOM.enable')
const doc = await send('DOM.getDocument')
const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type="file"]' })
if (!q.result.nodeId) throw new Error('找不到隐藏文件输入框')
await send('DOM.setFileInputFiles', { files: [DOCX, PPTX], nodeId: q.result.nodeId })
log('F1 上传', 'docx + pptx 已交给导入管线')

// 等两份都备课完成（status ready 且单元数 > 0）
await waitFor(`(async () => {
  const items = (await window.desk.study.list()).data.items
  const d = items.find((s) => s.sourceName.endsWith('.docx'))
  const p = items.find((s) => s.sourceName.endsWith('.pptx'))
  return !!d && !!p && d.status === 'ready' && p.status === 'ready' && d.unitCount > 0 && p.unitCount > 0
})()`, 'docx/pptx 备课完成')
const info = await evalJs(`(async () => {
  const items = (await window.desk.study.list()).data.items
  return items.filter((s) => s.sourceName.endsWith('.docx') || s.sourceName.endsWith('.pptx'))
    .map((s) => ({ source: s.sourceName, title: s.title, units: s.unitCount, status: s.status }))
})()`)
log('F2 备课', JSON.stringify(info))

// 打开 pptx 课堂 → 开始上课 → 第一段讲课卡可见 → 截图
await evalJs(`(() => {
  const row = [...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('课件格式验证'))
  if (!row.parentElement.querySelector('.hc-session-row')) row.click()
})()`)
await waitFor(`[...document.querySelectorAll('.hc-session-row')].some((e) => e.textContent.includes('社会主义') || e.textContent.includes('脉络'))`, 'pptx 课堂行')
await evalJs(`[...document.querySelectorAll('.hc-session-row')].find((e) => e.textContent.includes('社会主义') || e.textContent.includes('脉络')).click()`)
await waitFor(`!!document.querySelector('.hc-rail')`, '进度轨')
await evalJs(`window.__hc.clickText('.hc-actions button', '上课')`)
await waitFor(`document.querySelectorAll('.hc-lecture').length > 0`, 'pptx 讲课卡')
await new Promise((r) => setTimeout(r, 800))
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.join(EVID, 'f10-pptx-docx.png'), Buffer.from(shot.result.data, 'base64'))
log('F3 上课', 'pptx 第一段讲课卡 ✓ 截图 f10-pptx-docx.png')
console.log('SMOKE_FORMATS_OK')
ws.close()
process.exit(0)