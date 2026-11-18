// r5 冒烟：素材行预估价格 + 点「备课」先弹价格确认（取消则完全不调用模型）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(expr, ms = 20000, step = 400) {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (await ev(`(async () => Boolean(await (${expr})))()`)) return true
    await wait(step)
  }
  return false
}
async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(EVID, name), Buffer.from(res.result.data, 'base64'))
}
const fail = (msg) => { throw new Error(msg) }

const tmp = path.join(os.tmpdir(), 'r5-estimate.md')
fs.writeFileSync(tmp, ['# 页表与地址转换（预估测试用）', '', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行：页表把虚拟地址拆成页号和页内偏移，页表项里存物理页框号和权限位。`)].join('\n'), 'utf8')

console.log('step1 新建课程并导入一份不备课的素材')
await ev(`(async () => {
  const list = await window.desk.study.courses()
  const stale = list.data.items.filter((c) => c.name === 'R5预估')
  for (const c of stale) await window.desk.study.courseDelete({ courseId: c.courseId })
  const docs = await window.desk.documents.list({ query: '', limit: 60 })
  const old = docs.data.items.filter((d) => d.displayName === 'r5-estimate.md')
  for (const d of old) await window.desk.documents.delete({ documentVersionId: d.documentVersionId })
  return { courses: stale.length, docs: old.length }
})()`)
await ev(`window.desk.study.courseCreate({ name: 'R5预估' })`)
const after = await ev(`(async () => (await window.desk.study.courses()).data.items)()`)
const course = after.find((c) => c.name === 'R5预估')
if (!course) fail('课程没建出来')
console.log('  courseId:', course.courseId)

const imported = await ev(`window.desk.documents.importPath({ path: ${JSON.stringify(tmp.replace(/\\/g, '/'))}, requestId: crypto.randomUUID() })`)
if (!imported?.ok) fail('导入失败：' + JSON.stringify(imported))
const jobId = imported.data.jobId
const dvid = imported.data.documentVersionId
if (!(await until(`(async () => { const j = await window.desk.jobs.get({ jobId: '${jobId}' }); return j.ok && !['queued','running'].includes(j.data.state) })()`, 40000))) {
  fail('解析超时')
}
const jobState = await ev(`(async () => { const j = await window.desk.jobs.get({ jobId: '${jobId}' }); return j.data.state })()`)
console.log('  解析状态:', jobState)
if (!['succeeded', 'partial'].includes(jobState)) fail('解析没成功：' + jobState)

console.log('step2 把素材挂到课程上并刷新界面')
await ev(`localStorage.setItem('hc.assets.v1', JSON.stringify([{ courseId: ${JSON.stringify(course.courseId)}, documentVersionId: ${JSON.stringify(dvid)}, name: 'r5-estimate.md', addedAt: new Date().toISOString() }])); true`)
await send('Page.reload')
if (!(await until(`!!document.querySelector('.hc-app')`, 20000))) fail('界面没起来')
if (!(await until(`[...document.querySelectorAll('.hc-course-row')].some((e) => e.textContent.includes('R5预估'))`, 20000))) fail('课程行没出现')
await ev(`(() => { const row = [...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('R5预估')); row?.click(); return true })()`)
await wait(1200)
if (!(await until(`document.querySelector('.hc-asset-cost')`, 12000))) fail('素材行没显示预估价')
const costText = await ev(`document.querySelector('.hc-asset-cost').textContent`)
const prepVisible = await ev(`(() => { const b = document.querySelector('.hc-asset-prep'); const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 })()`)
console.log('  预估标签:', costText, '| 备课按钮可见:', prepVisible)
if (!costText.includes('k–')) fail('预估标签内容不对')
await shot('r5-01-asset-cost.png')

console.log('step3 点「备课」：先弹价格确认，取消则不花钱')
await ev(`window.__lastConfirm = null; window.__origConfirm = window.confirm; window.confirm = (msg) => { window.__lastConfirm = msg; return false }; true`)
await ev(`document.querySelector('.hc-asset-prep').click()`)
await wait(1600)
const confirmText = await ev(`window.__lastConfirm`)
console.log('  确认框内容:\n' + String(confirmText).split('\n').map((line) => '    ' + line).join('\n'))
if (!confirmText || !confirmText.includes('备课一次预计')) fail('没有弹出价格确认')
const stillZero = await ev(`(async () => { const c = await window.desk.study.courses(); const row = c.data.items.find((x) => x.courseId === ${JSON.stringify(course.courseId)}); return row ? row.sessions.length : -1 })()`)
console.log('  取消后该课程课堂数:', stillZero)
if (stillZero !== 0) fail('取消后居然还是备课了')

console.log('step4 清理')
await ev(`window.confirm = window.__origConfirm; true`)
await ev(`window.desk.documents.delete({ documentVersionId: ${JSON.stringify(dvid)} })`)
await ev(`window.desk.study.courseDelete({ courseId: ${JSON.stringify(course.courseId)} })`)
await ev(`localStorage.removeItem('hc.assets.v1'); true`)
console.log('SMOKE_R5_OK')
ws.close()
