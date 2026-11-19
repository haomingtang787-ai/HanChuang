// 已安装版（1.4.5）外观核对：只读，不建任何数据。
import fs from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9224/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!target) throw new Error('找不到已安装版页面')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (m, p = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })) })
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`docs/hanchuang-evidence/${name}.png`, Buffer.from(r.result.data, 'base64'))
  console.log('截图', name)
}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await wait(800)
console.log('版本', await ev(`(async () => (await window.desk.app.version?.()) ?? 'n/a')()`).catch(() => 'n/a'))
console.log('运行时令牌', await ev(`(() => {
  const s = getComputedStyle(document.documentElement)
  return JSON.stringify({
    bg: s.getPropertyValue('--hc-bg').trim(),
    accent: s.getPropertyValue('--hc-accent').trim(),
    brass: s.getPropertyValue('--hc-brass').trim(),
    radius: s.getPropertyValue('--hc-radius-card').trim(),
    brandMark: Boolean(document.querySelector('.hc-brand svg, .hc-brand-mark')),
    courses: document.querySelectorAll('.hc-course-row').length,
  })
})()`))
await shot('r9-18-installed-light')
const dark = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '夜间'); if (!b) return false; b.click(); return true })()`)
console.log('切夜间', dark)
await wait(900)
await shot('r9-19-installed-dark')
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '日间'); if (b) b.click(); return true })()`)
ws.close()
console.log('INSTALLED_DESIGN_OK')
