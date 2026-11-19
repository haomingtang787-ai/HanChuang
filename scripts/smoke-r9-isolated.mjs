// 设计验收（隔离实例）：用 --user-data-dir 起一个全新数据目录 + 本地假模型，
// 造出一堂真实的课，逐屏截图。全程不碰用户自己的库，也不产生任何模型费用。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })

const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!target) throw new Error('找不到隔离实例的页面')
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(EVID, `${name}.png`), Buffer.from(r.result.data, 'base64'))
  console.log('截图', name)
}
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await wait(600)

console.log('配置假模型', await ev(`(async () => {
  const r = await window.desk.ai.saveConfig({ baseUrl: 'http://127.0.0.1:8799/v1', model: 'fake-teacher', apiKey: 'local-fake' })
  return r.ok ? r.data.configured : JSON.stringify(r.error)
})()`))

const tmp = path.join(os.tmpdir(), 'r9-design-sample.md')
fs.writeFileSync(tmp, [
  '# 页表与地址转换',
  '',
  '页表把虚拟地址拆成页号和页内偏移。页表项里存物理页框号和权限位。',
  '虚拟地址的高位是页号，低位是页内偏移；页内偏移在转换前后保持不变。',
  '页表项里的有效位决定这一页是否在内存中；无效就要触发缺页处理。',
  '快表（TLB）缓存最近用过的页表项，命中时不必再访问内存里的页表。',
].join('\n'), 'utf8')

const setup = await ev(`(async () => {
  const course = await window.desk.study.courseCreate({ name: '设计验收' })
  if (!course.ok) return { error: course.error }
  const item = course.data.items.find((c) => c.name === '设计验收')
  const imported = await window.desk.documents.importPath({ path: ${JSON.stringify(tmp.replace(/\\/g, '/'))}, requestId: crypto.randomUUID() })
  if (!imported.ok) return { error: imported.error }
  return { courseId: item.courseId, dvid: imported.data.documentVersionId, jobId: imported.data.jobId }
})()`)
console.log('建课程与导入', JSON.stringify(setup))
if (setup.error) throw new Error(JSON.stringify(setup.error))

for (let i = 0; i < 40; i += 1) {
  const job = await ev(`(async () => (await window.desk.jobs.get({ jobId: ${JSON.stringify(setup.jobId)} })).data)()`)
  if (['succeeded', 'partial', 'failed'].includes(job.state)) { console.log('解析', job.state); break }
  await wait(700)
}

console.log('备课（假模型）…')
const created = await ev(`(async () => {
  const r = await window.desk.study.create({ requestId: crypto.randomUUID(), documentVersionId: ${JSON.stringify(setup.dvid)}, courseId: ${JSON.stringify(setup.courseId)} })
  return r.ok ? { sessionId: r.data.sessionId, units: r.data.units.length } : { error: r.error }
})()`)
console.log('备课结果', JSON.stringify(created))
if (created.error) throw new Error(JSON.stringify(created.error))

await ev(`(async () => { window.dispatchEvent(new Event('resize')); return true })()`)
await wait(1200)
// 回到界面：刷新后左栏应当出现这堂课
await send('Page.reload', { ignoreCache: false })
await wait(3500)
await ev(`(() => { const r = document.querySelector('.hc-course-row'); if (r) r.click(); return true })()`)
await wait(900)
const opened = await ev(`(() => {
  const row = [...document.querySelectorAll('.hc-session-row')].find((r) => !r.classList.contains('asset'))
  if (!row) return false
  row.click(); return row.textContent.trim().slice(0, 30)
})()`)
console.log('打开课堂', opened)
await wait(2500)
console.log('讲课卡数量', await ev(`document.querySelectorAll('.hc-lecture').length`))
await shot('r9-10-classroom-light')

console.log('原件对照', await clickText('原课件'))
await wait(2200)
await shot('r9-11-classroom-source')

console.log('夜间', await clickText('夜间'))
await wait(900)
await shot('r9-12-classroom-dark')
await clickText('日间')
await wait(600)

// 输入区聚焦态：真的把光标放进输入框
await ev(`(() => { const t = document.querySelector('.hc-input-row textarea'); if (t) { t.focus(); t.value = ''; } return Boolean(t) })()`)
await wait(500)
await shot('r9-13-composer-focus')
ws.close()
console.log('SMOKE_R9_DESIGN_OK')
