// r11 验收（隔离实例）：设置里的「清除数据」走一遍真实的点击路径，逐屏截图。
// 用法：先启动隔离实例（--remote-debugging-port=9231）+ 假模型，再 `node scripts/smoke-r11-clear.mjs 9231`
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = process.argv[2] ?? '9231'
const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
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
await wait(500)

console.log('配置假模型', await ev(`(async () => {
  const r = await window.desk.ai.saveConfig({ baseUrl: 'http://127.0.0.1:8799/v1', model: 'fake-teacher', apiKey: 'local-fake' })
  return r.ok ? r.data.configured : JSON.stringify(r.error)
})()`))

const tmp = path.join(os.tmpdir(), 'r11-clear-sample.md')
fs.writeFileSync(tmp, ['# 进程与线程', '', '进程是资源分配的单位，线程是调度的单位。', '一个进程可以有多个线程，它们共享地址空间。'].join('\n'), 'utf8')
const imported = await ev(`(async () => {
  const r = await window.desk.documents.importPath({ path: ${JSON.stringify(tmp.replace(/\\/g, '/'))}, requestId: crypto.randomUUID() })
  return r.ok ? { documentId: r.data.documentId, jobId: r.data.jobId } : r.error
})()`)
console.log('导入', JSON.stringify(imported))
for (let i = 0; i < 30; i += 1) {
  const job = await ev(`(async () => (await window.desk.jobs.get({ jobId: ${JSON.stringify(imported.jobId)} })).data)()`)
  if (job && ['succeeded', 'partial', 'failed'].includes(job.state)) { console.log('解析', job.state); break }
  await wait(600)
}

// 打开设置 → 预算与数据
console.log('开设置', await clickText('设置'))
await wait(500)
console.log('切到数据 tab', await ev(`(() => { const b = [...document.querySelectorAll('.hc-tabs button')].find((x) => x.textContent.trim() === '预算与数据'); if (!b) return false; b.click(); return true })()`))
await wait(400)
await shot('r11-01-settings-data')

const before = await ev(`(async () => {
  const storage = await window.desk.data.storage()
  const stats = await window.desk.data.stats()
  return { storage: storage.ok ? storage.data : storage.error, stats: stats.ok ? stats.data : stats.error }
})()`)
console.log('清除前', JSON.stringify(before))

console.log('展开危险区', await clickText('清除本机数据…'))
await wait(400)
await shot('r11-02-clear-panel')

// 选中“全部清空”，再输入确认词
await ev(`(() => { const r = [...document.querySelectorAll('input[name="hc-clear-scope"]')][1]; if (!r) return false; r.click(); return true })()`)
await wait(200)
const typed = await ev(`(() => {
  const input = [...document.querySelectorAll('.hc-danger-confirm input')][0]
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '清除')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
console.log('输入确认词', typed)
await wait(300)
await shot('r11-03-clear-armed')

console.log('点确认清除', await clickText('确认清除'))
await wait(1600)
await shot('r11-04-cleared')

const toast = await ev(`(() => document.querySelector('.hc-toast')?.textContent?.trim() ?? '')()`)
console.log('提示条:', toast)

// 重新进设置读一次数据，确认库真的清空
await ev(`location.reload()`)
await wait(2500)
console.log('开设置(重载后)', await clickText('设置'))
await wait(600)
console.log('切到数据 tab', await ev(`(() => { const b = [...document.querySelectorAll('.hc-tabs button')].find((x) => x.textContent.trim() === '预算与数据'); if (!b) return false; b.click(); return true })()`))
await wait(400)
await shot('r11-05-after-reload')
const after = await ev(`(async () => {
  const storage = await window.desk.data.storage()
  const stats = await window.desk.data.stats()
  const list = await window.desk.documents.list({ offset: 0, limit: 10 })
  return { storage: storage.ok ? storage.data : storage.error, sessions: stats.ok ? stats.data.sessions : null, docs: list.ok ? list.data.total : null }
})()`)
console.log('清除后', JSON.stringify(after))
process.exit(0)
