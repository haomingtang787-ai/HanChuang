// 设计回归：在真实运行的寒窗里逐屏截图（课堂 / 原件对照 / 夜间 / 设置 / 欢迎页）。
// 只点真实按钮，不注入样式；产物落 docs/hanchuang-evidence/r9-*.png。
import fs from 'node:fs'

const outDir = 'docs/hanchuang-evidence'
fs.mkdirSync(outDir, { recursive: true })

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!target) throw new Error('找不到渲染进程页面')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
  console.log('截图', name)
}
const clickText = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)})
  if (!b) return false
  b.click(); return true
})()`)

// 窗口尺寸统一，截图之间可比
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await wait(600)

const state = await ev(`(() => ({
  sessions: document.querySelectorAll('.hc-session-row').length,
  courses: document.querySelectorAll('.hc-course-row').length,
  lecture: document.querySelectorAll('.hc-lecture').length,
  welcome: Boolean(document.querySelector('.hc-welcome-card')),
  theme: document.querySelector('.hc-app')?.dataset.theme ?? 'light',
}))()`)
console.log('初始状态', JSON.stringify(state))
await shot('r9-01-initial')

if (!state.lecture) {
  // 打开第一堂课，让讲课卡真的渲染出来
  const opened = await ev(`(() => {
    const row = [...document.querySelectorAll('.hc-session-row')].find((r) => !r.classList.contains('asset') && !r.classList.contains('pending'))
    if (!row) return false
    row.click(); return true
  })()`)
  console.log('打开课堂', opened)
  await wait(2500)
}
await shot('r9-02-classroom')

console.log('打开原件', await clickText('原课件'))
await wait(2200)
await shot('r9-03-source')

console.log('切夜间', await clickText('夜间'))
await wait(900)
await shot('r9-04-dark')

console.log('打开设置', await clickText('设置'))
await wait(900)
await shot('r9-05-settings')
await ev(`(() => { document.querySelector('.hc-modal-head button')?.click(); return true })()`)
await wait(500)

console.log('回日间', await clickText('日间'))
await wait(700)
console.log('收起原件', await clickText('原课件'))
await wait(700)
await shot('r9-06-light-final')

const tokens = await ev(`(() => {
  const app = document.querySelector('.hc-app')
  const cs = getComputedStyle(app)
  return {
    bg: cs.getPropertyValue('--hc-bg').trim(),
    accent: cs.getPropertyValue('--hc-accent').trim(),
    brass: cs.getPropertyValue('--hc-brass').trim(),
    radius: cs.getPropertyValue('--hc-radius-card').trim(),
    brandMark: Boolean(document.querySelector('.hc-brand svg.hc-seal')),
    composerRing: Boolean(getComputedStyle(document.querySelector('.hc-input-row') ?? document.body).borderRadius),
  }
})()`)
console.log('令牌', JSON.stringify(tokens))
ws.close()
