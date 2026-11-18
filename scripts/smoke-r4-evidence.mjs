// 补证据：把图解滚动到视野内单独截一张，并抓控制台错误数。
import fs from 'node:fs'
import path from 'node:path'
const EVID = path.resolve('docs/hanchuang-evidence')
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
const logs = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300))
  }
})
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
await send('Runtime.enable')
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value
const rect = await ev(`(() => { const el = document.querySelector('.hc-diagram'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
await new Promise((r) => setTimeout(r, 700))
const box = await ev(`(() => { const el = document.querySelector('.hc-diagram'); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
const clip = { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 40), width: Math.min(1400, box.width + 20), height: Math.min(900, box.height + 70), scale: 1 }
const res = await send('Page.captureScreenshot', { format: 'png', clip })
fs.writeFileSync(path.join(EVID, 'r4-05-mermaid-closeup.png'), Buffer.from(res.result.data, 'base64'))
console.log('diagram rect', JSON.stringify(rect))
console.log('console warnings/errors:', logs.length)
logs.slice(0, 8).forEach((line) => console.log('  ', line))
console.log('EVIDENCE_OK')
ws.close()
