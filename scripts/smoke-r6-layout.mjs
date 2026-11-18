// r6 冒烟：左栏可收起；课件与对话宽度 1:1（窗口拉大/全屏也是各一半）。
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

console.log('step1 打开一堂课，并让原课件面板出现')
// 固定基线：左栏展开，避免受上次运行残留的状态影响
await ev(`localStorage.setItem('hc.sidebar.v1', '1'); true`)
await send('Page.reload')
if (!(await until(`document.querySelector('.hc-app')`, 20000))) fail('界面没起来')
if (!(await until(`document.querySelector('.hc-course-row')`, 20000))) fail('课程没加载出来')
await ev(`document.querySelector('.hc-course-row').click()`)
if (!(await until(`document.querySelector('.hc-session-row')`, 20000))) fail('课堂列表没展开')
await ev(`document.querySelector('.hc-session-row').click()`)
if (!(await until(`document.querySelector('.hc-composer')`, 20000))) fail('课堂没打开')
await wait(600)
// 顶栏「原课件」按钮：文字精确匹配，避免点到别的按钮
await ev(`(() => { const b = [...document.querySelectorAll('.hc-theme-btn')].find((e) => e.textContent.trim() === '原课件'); b?.click(); return !!b })()`)
if (!(await until(`document.querySelector('.hc-source-pane')`, 15000))) fail('原课件面板没打开')
await wait(900)

const geometry = () => ev(`(() => {
  const work = document.querySelector('.hc-work').getBoundingClientRect()
  const pane = document.querySelector('.hc-source-pane')?.getBoundingClientRect()
  const chat = document.querySelector('.hc-chat-col').getBoundingClientRect()
  const side = document.querySelector('.hc-sidebar')
  return {
    work: Math.round(work.width), pane: pane ? Math.round(pane.width) : 0, chat: Math.round(chat.width),
    side: side ? Math.round(side.getBoundingClientRect().width) : 0,
  }
})()`)

console.log('step2 左栏展开时：课件与对话应各占一半')
const withSide = await geometry()
console.log('  ', JSON.stringify(withSide))
if (withSide.side <= 0) fail('基线不对：左栏应展开')
const half = Math.abs(withSide.pane - withSide.chat)
if (half > 8) fail(`不是各一半：pane=${withSide.pane} chat=${withSide.chat}`)
await shot('r6-01-half-with-sidebar.png')

console.log('step3 收起左栏：课件与对话应各自变宽、仍各占一半')
await ev(`document.querySelector('.hc-menu-btn').click()`)
await wait(700)
const collapsed = await geometry()
console.log('  ', JSON.stringify(collapsed))
if (collapsed.side !== 0) fail('左栏没收起：' + collapsed.side)
if (Math.abs(collapsed.pane - collapsed.chat) > 8) fail(`收起后不是各一半：${collapsed.pane} vs ${collapsed.chat}`)
if (collapsed.pane <= withSide.pane) fail('收起后课件没有变宽')
const persisted = await ev(`localStorage.getItem('hc.sidebar.v1')`)
console.log('  收起状态已落盘:', persisted)
if (persisted !== '0') fail('收起状态没落盘')
await shot('r6-02-half-sidebar-collapsed.png')

console.log('step4 刷新后状态要保住（左栏仍收起，比例仍对半）')
await send('Page.reload')
if (!(await until(`document.querySelector('.hc-course-row')`, 20000))) fail('刷新后课程没加载')
// 刷新后课程树默认是收起的，要先展开才看得到课堂
await ev(`document.querySelector('.hc-course-row').click()`)
if (!(await until(`document.querySelector('.hc-session-row')`, 20000))) fail('刷新后课堂列表没展开')
await ev(`document.querySelector('.hc-session-row').click()`)
if (!(await until(`document.querySelector('.hc-composer')`, 20000))) fail('刷新后课堂没打开')
await wait(800)
await ev(`(() => { const b = [...document.querySelectorAll('.hc-theme-btn')].find((e) => e.textContent.trim() === '原课件'); b?.click(); return !!b })()`)
if (!(await until(`document.querySelector('.hc-source-pane')`, 15000))) fail('刷新后面板没恢复')
await wait(700)
const afterReload = await geometry()
console.log('  ', JSON.stringify(afterReload))
if (afterReload.side !== 0) fail('刷新后左栏又出来了')
if (Math.abs(afterReload.pane - afterReload.chat) > 8) fail('刷新后比例不对')
const pref = await ev(`localStorage.getItem('hc.pane.v2')`)
console.log('  pane 偏好:', pref)
if (!String(pref).includes('"ratio":0.5')) fail('比例没落盘为 0.5')

console.log('step5 双击分隔条回到一半一半（拖到 0.36 再双击）')
await ev(`(() => {
  const handle = document.querySelector('.hc-source-resize')
  const rect = handle.getBoundingClientRect()
  const host = handle.parentElement.parentElement.getBoundingClientRect()
  handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + 3, clientY: rect.top + 40 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: host.left + host.width * 0.36, clientY: rect.top + 40 }))
  window.dispatchEvent(new MouseEvent('mouseup'))
  return true
})()`)
await wait(500)
const dragged = await geometry()
console.log('   拖到约 36% 后:', dragged.pane, 'vs', dragged.chat)
await ev(`(() => { const h = document.querySelector('.hc-source-resize'); h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`)
await wait(500)
const reset = await geometry()
console.log('   双击复位后:', reset.pane, 'vs', reset.chat)
if (Math.abs(reset.pane - reset.chat) > 8) fail('双击没回到一半一半')

console.log('step6 还原现场（左栏展开）')
await ev(`document.querySelector('.hc-menu-btn').click()`)
await wait(400)
const restored = await geometry()
console.log('  ', JSON.stringify(restored))
if (restored.side <= 0) fail('左栏没还原')
console.log('SMOKE_R6_OK')
ws.close()
