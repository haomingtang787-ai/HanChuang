// 把我误删的 5 份原始课件重新导回用户库里，并等到全部解析完成。
import fs from 'node:fs'

const folder = 'C:\\Users\\16122\\Desktop\\计基2'
const names = [
  '09-存储器-Cache(二)-映射.pdf',
  '11-存储器-Cache(四)-性能评估.pdf',
  '12-存储器-虚拟存储器.pdf',
  '13-互连IO与存储（一）-总线与互连.pdf',
  '15-互连IO与存储（三）-硬盘.pdf',
]

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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const imported = []
for (const name of names) {
  const file = `${folder}\\${name}`
  if (!fs.existsSync(file)) { console.log('源文件不在了', name); continue }
  const out = await ev(`(async () => window.desk.documents.importPath({ path: ${JSON.stringify(file)}, requestId: crypto.randomUUID() }))()`)
  if (!out?.ok) { console.log('导入失败', name, JSON.stringify(out?.error)); continue }
  imported.push({ name, ...out.data })
  console.log('已导入', name, out.data.documentVersionId.slice(0, 8))
}

const started = Date.now()
let states = []
while (Date.now() - started < 6 * 60 * 1000) {
  states = await ev(`(async () => {
    const ids = ${JSON.stringify(imported.map((r) => r.jobId))}
    const out = []
    for (const id of ids) {
      const r = await window.desk.jobs.get({ jobId: id })
      out.push(r.ok ? { id, state: r.data.state, stage: r.data.stage, completed: r.data.completed, total: r.data.total, error: r.data.error?.message ?? null } : { id, state: 'unknown' })
    }
    return out
  })()`)
  const active = states.filter((s) => !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(s.state))
  console.log('进度', states.map((s) => `${s.state}/${s.stage} ${s.completed ?? 0}/${s.total ?? '?'}`).join(' | '))
  if (active.length === 0) break
  await wait(5000)
}
const bad = states.filter((s) => s.state !== 'succeeded' && s.state !== 'partial')
console.log('最终失败数', bad.length, bad.map((s) => s.error).join(' / '))
ws.close()
