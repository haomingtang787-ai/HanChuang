// 补一条真实件证据：82 页 PDF 的素材行预估价应显示 ¥0.04–0.06 一档。
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
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
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (expr, ms = 15000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await ev(`(async () => Boolean(await (${expr})))()`)) return true
    await wait(400)
  }
  return false
}

const info = await ev(`(async () => {
  const courses = (await window.desk.study.courses()).data.items
  const course = courses.find((c) => c.name === '计基')
  const session = course?.sessions?.[0]
  if (!course || !session) return null
  const docs = (await window.desk.documents.list({ limit: 20 })).data.items
  const doc = docs.find((d) => d.displayName.includes('存储器')) ?? docs[0]
  localStorage.setItem('hc.assets.v1', JSON.stringify([{ courseId: course.courseId, documentVersionId: doc.documentVersionId, name: doc.displayName, addedAt: new Date().toISOString() }]))
  return { courseId: course.courseId, dvid: doc.documentVersionId, name: doc.displayName }
})()`)
console.log('seeded asset:', info)
await send('Page.reload')
if (!(await until(`document.querySelector('.hc-app')`, 20000))) throw new Error('界面没起来')
await wait(1500)
await ev(`(() => { const row = [...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('计基')); row?.click(); return true })()`)
if (!(await until(`document.querySelector('.hc-asset-cost')`, 12000))) throw new Error('没出现预估价')
const cost = await ev(`document.querySelector('.hc-asset-cost').textContent`)
console.log('预估价标签:', cost)
const res = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.join(EVID, 'r5-02-pdf-cost.png'), Buffer.from(res.result.data, 'base64'))
await ev(`localStorage.removeItem('hc.assets.v1'); true`)
console.log('EVIDENCE_PDF_OK')
ws.close()
