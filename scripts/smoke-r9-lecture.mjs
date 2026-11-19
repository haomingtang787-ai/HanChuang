// 在隔离实例里真的开始上课，截讲课卡（浅色 + 夜间）。
import fs from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
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
const clickText = (t) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(t)}); if (!b) return false; b.click(); return true })()`)
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await wait(500)
console.log('开始上课', await clickText('开始上课'))
await wait(4000)
console.log('讲课卡', await ev(`document.querySelectorAll('.hc-lecture').length`))
await shot('r9-14-lecture-light')
console.log('再讲一段', await clickText('继续讲'))
await wait(3000)
await shot('r9-15-lecture-more')
console.log('夜间', await clickText('夜间'))
await wait(900)
await shot('r9-16-lecture-dark')
ws.close()
