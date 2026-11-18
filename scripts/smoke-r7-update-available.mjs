// r7 冒烟（临时版本号验证）：有新版时的界面、安装包信息、下载进度
import fs from 'node:fs'
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
async function until(expr, ms = 30000) {
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
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === '设置'); b?.click(); return !!b })()`)
if (!(await until(`document.querySelector('.hc-modal')`, 15000))) fail('设置没打开')
await ev(`(() => { const b = [...document.querySelectorAll('.hc-tabs button')].find((e) => e.textContent.trim() === '关于与更新'); b?.click(); return !!b })()`)
if (!(await until(`[...document.querySelectorAll('button')].some((e) => e.textContent.trim() === '检查更新')`, 10000))) fail('没到关于页')
console.log('当前版本行：', await ev(`[...document.querySelectorAll('.hc-section-title')].map((e) => e.textContent.trim()).find((t) => t.startsWith('寒窗'))`))

await ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === '检查更新'); b?.click(); return !!b })()`)
if (!(await until(`document.querySelector('.hc-update-box')`, 30000))) fail('没有检查结果')
await wait(500)
const boxText = await ev(`document.querySelector('.hc-update-box')?.textContent?.replace(/\\s+/g, ' ') ?? ''`)
const boxClass = await ev(`document.querySelector('.hc-update-box')?.className ?? ''`)
console.log('结果：', boxText)
if (!boxText.includes('有新版')) fail(`期望「有新版」，实际：${boxText}`)
await shot('r7-02-update-available.png')

if (!(await until(`[...document.querySelectorAll('button')].some((e) => e.textContent.trim() === '下载安装包')`, 10000))) fail('没有下载按钮')
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === '下载安装包'); b?.click(); return !!b })()`)

let progressText = ''
const t0 = Date.now()
while (Date.now() - t0 < 15000) {
  progressText = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => /下载中/.test(e.textContent)); const bar = document.querySelector('.hc-update-bar span'); return [b?.textContent?.trim() ?? '', bar ? bar.style.width : ''].join(' | ') })()`)
  if (/下载中/.test(progressText)) break
  await wait(500)
}
console.log('下载进度：', progressText)
await shot('r7-03-update-downloading.png')
if (!/下载中/.test(progressText)) fail('点下载后没有进入下载中状态')

fs.writeFileSync(path.join(EVID, 'r7-available.json'), JSON.stringify({ boxClass, boxText, progressText }, null, 2))
console.log('SMOKE_R7_AVAILABLE_OK')
ws.close()
