// 展开课程，看看课件/课堂行到底有没有渲染出来，并进入第一堂课截图。
import fs from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await wait(500)
console.log('展开课程', await ev(`(() => { const r = document.querySelector('.hc-course-row'); if (!r) return false; r.click(); return true })()`))
await wait(1500)
console.log('左栏', await ev(`(() => [...document.querySelectorAll('.hc-session-row')].slice(0, 8).map((r) => r.textContent.trim().slice(0, 40)))()`))
const opened = await ev(`(() => {
  const rows = [...document.querySelectorAll('.hc-session-row')]
  const row = rows.find((r) => !r.classList.contains('asset') && !r.classList.contains('pending')) ?? rows[0]
  if (!row) return null
  row.click()
  return row.textContent.trim().slice(0, 40)
})()`)
console.log('进入', opened)
await wait(3000)
console.log('讲课卡', await ev(`document.querySelectorAll('.hc-lecture').length`))
await shot('r9-07-classroom')
console.log('原件', await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '原课件'); if (!b) return false; b.click(); return true })()`))
await wait(2500)
await shot('r9-08-classroom-source')
ws.close()
