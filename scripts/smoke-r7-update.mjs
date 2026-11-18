// r7 冒烟：设置 → 关于与更新 → 检查更新（走 api.github.com 的最新 release 接口）
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })
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
async function until(expr, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await ev(`(async () => Boolean(await (${expr})))()`)) return true
    await wait(400)
  }
  return false
}
async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(EVID, name), Buffer.from(res.result.data, 'base64'))
}
const fail = (msg) => { throw new Error(msg) }

if (!(await until(`document.querySelector('.hc-app')`, 20000))) fail('界面没起来')

console.log('step1 打开设置')
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === '设置'); b?.click(); return !!b })()`)
if (!(await until(`document.querySelector('.hc-modal')`, 15000))) fail('设置面板没打开')

console.log('step2 切到「关于与更新」')
await ev(`(() => { const b = [...document.querySelectorAll('.hc-tabs button')].find((e) => e.textContent.trim() === '关于与更新'); b?.click(); return !!b })()`)
if (!(await until(`[...document.querySelectorAll('.hc-section-title')].some((e) => e.textContent.includes('寒窗'))`, 10000))) fail('版本区没出现')
const versionLine = await ev(`[...document.querySelectorAll('.hc-section-title')].map((e) => e.textContent.trim()).find((t) => t.startsWith('寒窗'))`)
console.log('当前版本行：', versionLine)

console.log('step3 点检查更新')
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === '检查更新'); b?.click(); return !!b })()`)
const got = await until(`document.querySelector('.hc-update-box')`, 30000)
await wait(800)
const boxText = await ev(`document.querySelector('.hc-update-box')?.textContent ?? ''`)
const boxClass = await ev(`document.querySelector('.hc-update-box')?.className ?? ''`)
await shot('r7-01-update-check.png')
console.log('检查结果：', boxText)
if (!got) fail('没拿到检查结果')
if (!/已是最新版|有新版/.test(boxText)) fail(`结果文案不对：${boxText}`)

console.log('step4 关闭设置，回到课堂界面')
await ev(`document.querySelector('.hc-modal-head button').click()`)
await wait(400)

const summary = { versionLine, boxClass, boxText }
fs.writeFileSync(path.join(EVID, 'r7-update.json'), JSON.stringify(summary, null, 2))
console.log('SMOKE_R7_OK')
ws.close()
