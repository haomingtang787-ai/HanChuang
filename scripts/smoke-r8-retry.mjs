// r8 冒烟：把上次整文件夹导入里失败的 16 份逐个重试，验证新的排队 + 内存上限能跑完。
import fs from 'node:fs'
import path from 'node:path'

const failed = JSON.parse(fs.readFileSync('.tmp-profile/failed.json', 'utf8'))
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

const retried = []
for (const job of failed) {
  const out = await ev(`(async () => {
    const r = await window.desk.jobs.retry({ jobId: ${JSON.stringify(job.id)}, requestId: crypto.randomUUID() })
    return r
  })()`)
  if (!out?.ok) {
    console.log('重试失败', job.id, out?.error)
    continue
  }
  retried.push({ source: job.id, id: out.data.jobId })
}
console.log('已重试', retried.length, '份')

const started = Date.now()
const last = new Map()
let done = false
while (Date.now() - started < 12 * 60 * 1000) {
  const states = await ev(`(async () => {
    const ids = ${JSON.stringify(retried.map((r) => r.id))}
    const out = []
    for (const id of ids) {
      const r = await window.desk.jobs.get({ jobId: id })
      out.push(r.ok ? { id, state: r.data.state, stage: r.data.stage, completed: r.data.completed, total: r.data.total, error: r.data.error?.message ?? null } : { id, state: 'unknown' })
    }
    return out
  })()`)
  for (const s of states) last.set(s.id, s)
  const active = states.filter((s) => !['succeeded', 'failed', 'cancelled', 'interrupted', 'partial'].includes(s.state))
  if (active.length === 0) { done = true; break }
  if (states.length) console.log('进行中', states.filter((s) => !last.get(s.id)?.error).length, states.map((s) => `${s.state}/${s.stage} ${s.completed}/${s.total}`).slice(0, 4).join(' | '))
  await wait(4000)
}

console.log('耗时', Math.round((Date.now() - started) / 1000), '秒，结束=', done)
const finalStates = [...last.values()]
console.log('最终：', finalStates.map((s) => `${s.state}`).join(', '), '失败=', finalStates.filter((s) => s.state === 'failed').length)
for (const s of finalStates.filter((s) => s.state === 'failed')) console.log('仍失败', s.id, s.error)
fs.writeFileSync('docs/hanchuang-evidence/r8-retry.json', JSON.stringify(finalStates, null, 2))
ws.close()
