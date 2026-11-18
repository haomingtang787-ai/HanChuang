// 清掉本轮自测建的课程/课堂，并清空素材索引，避免留在用户库里。
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Page.javascriptDialogOpening') {
    ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: true } }))
  }
})
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
const courses = await ev(`window.desk.study.courses().then((r) => r.ok ? r.data.items.map((c) => ({ id: c.courseId, name: c.name, sessions: c.sessions.length })) : r.error)`)
console.log('清理前课程:', JSON.stringify(courses))
for (const course of courses) {
  if (!course.name.startsWith('R3验证')) continue
  const result = await ev(`window.desk.study.courseDelete({ courseId: ${JSON.stringify(course.id)} }).then((r) => r.ok)`)
  console.log('删除课程', course.name, result ? 'OK' : 'FAIL')
}
await ev(`localStorage.removeItem('hc.assets.v1'); localStorage.removeItem('hc.revealed.v1'); true`)
const after = await ev(`window.desk.study.courses().then((r) => r.ok ? r.data.items.map((c) => c.name + '(' + c.sessions.length + ')') : r.error)`)
console.log('清理后课程:', JSON.stringify(after))
console.log('CLEANUP_OK')
ws.close()
