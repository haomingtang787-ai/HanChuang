// 已安装版（1.4.6）外观核对：只读。端口 9226。
import fs from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9226/json/list')).json()
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
await wait(900)
console.log('印记与品牌字', await ev(`(() => {
  const seal = document.querySelector('.hc-seal')
  const brand = document.querySelector('.hc-brand-name')
  return {
    brandMark: Boolean(seal && seal.querySelector('svg path')),
    brandFont: brand ? getComputedStyle(brand).fontFamily.slice(0, 40) : null,
    letterSpacing: brand ? getComputedStyle(brand).letterSpacing : null,
    courses: document.querySelectorAll('.hc-course-row').length,
  }
})()`))
await shot('r10-08-installed-welcome')
const dark = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '夜间'); if (!b) return false; b.click(); return true })()`)
console.log('切夜间', dark)
await wait(900)
await shot('r10-09-installed-dark')
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '日间'); if (b) b.click(); return true })()`)
ws.close()
console.log('INSTALLED_R10_OK')
