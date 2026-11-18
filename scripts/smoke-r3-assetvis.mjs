// 只验证素材行视觉：写入一条假素材索引 → 刷新 → 截图确认「备课」按钮常显。
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
const courseId = await ev(`window.desk.study.courses().then((r) => r.ok ? r.data.items[0]?.courseId : null)`)
console.log('course', courseId)
await ev(`localStorage.setItem('hc.assets.v1', JSON.stringify([{ courseId: ${JSON.stringify(courseId)}, documentVersionId: 'demo-visual-check', name: '第三章-内存管理.pdf', addedAt: new Date().toISOString() }])); true`)
await send('Page.reload')
await new Promise((r) => setTimeout(r, 2600))
for (let i = 0; i < 30; i += 1) {
  if (await ev(`!!document.querySelector('.hc-app')`)) break
  await new Promise((r) => setTimeout(r, 800))
}
await ev(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('计基'))?.click()`)
await new Promise((r) => setTimeout(r, 1200))
const visible = await ev(`(() => { const btn = document.querySelector('.hc-asset-prep'); if (!btn) return 'NO BTN'; const rect = btn.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(btn).display !== 'none' })()`)
console.log('备课按钮常显:', visible)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.join(EVID, 'r3-09-asset-button.png'), Buffer.from(shot.result.data, 'base64'))
await ev(`localStorage.removeItem('hc.assets.v1'); true`)
console.log('ASSET_VISUAL_OK')
ws.close()
