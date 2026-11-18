// 寒窗补充冒烟：H6 老师人格/习惯设置 + 复习页错题判分。
// 用法：应用带 --remote-debugging-port=9222 运行时 node scripts/smoke-ui-2.mjs
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('找不到页面 target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.error) throw new Error(JSON.stringify(r.error))
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600))
  return r.result?.result?.value
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(EVID, name), Buffer.from(r.result.data, 'base64'))
  console.log('截图:', name)
}
async function waitFor(expression, label, timeout = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await evalJs(expression)) return
    await new Promise((r) => setTimeout(r, 700))
  }
  throw new Error('等待超时: ' + label)
}
await send('Runtime.enable')
await waitFor(`!!window.desk && !!document.querySelector('.hc-app')`, '应用就绪')
await evalJs(`
  window.__hc = {
    setInput(selector, value) {
      const el = document.querySelector(selector)
      if (!el) throw new Error('找不到输入框 ' + selector)
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    clickText(selector, text) {
      const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().includes(text))
      if (!el) throw new Error('找不到按钮 ' + text)
      el.click()
      return true
    },
  }
  true
`)

// H6 人格：打开设置 → 老师页签 → 改名保存 → 读回 → 还原
const originalName = await evalJs(`(async () => { const r = await window.desk.teacher.overview(); return r.ok ? r.data.persona.name : null })()`)
console.log('[H6] 原人格名:', originalName)
await evalJs(`window.__hc.clickText('button', '设置')`)
await waitFor(`!!document.querySelector('.hc-modal')`, '设置弹层')
await evalJs(`window.__hc.clickText('.hc-tabs button', '老师')`)
await waitFor(`!!document.querySelector('.hc-modal-body input')`, '老师页签表单')
await evalJs(`window.__hc.setInput('.hc-modal-body input', '韩老师')`)
await evalJs(`window.__hc.clickText('.hc-modal-body button', '保存人格')`)
await waitFor(`document.body.textContent.includes('老师人格已更新')`, '保存成功提示')
const savedName = await evalJs(`(async () => { const r = await window.desk.teacher.overview(); return r.ok ? r.data.persona.name : null })()`)
console.log('[H6] 保存后读回:', savedName)
if (savedName !== '韩老师') throw new Error('人格保存未生效')
await shot('09-settings-teacher.png')
// 还原用户原设置
await evalJs(`window.__hc.setInput('.hc-modal-body input', ${JSON.stringify(originalName ?? '')})`)
await evalJs(`window.__hc.clickText('.hc-modal-body button', '保存人格')`)
await waitFor(`(async () => { const r = await window.desk.teacher.overview(); return r.ok && r.data.persona.name === ${JSON.stringify(originalName ?? '')} })()`, '人格还原')
console.log('[H6] 已还原为:', originalName)

// H6 习惯页签可加载
await evalJs(`window.__hc.clickText('.hc-tabs button', '我的习惯')`)
await waitFor(`document.querySelectorAll('.hc-modal-body select').length >= 4`, '习惯表单')
const habits = await evalJs(`[...document.querySelectorAll('.hc-modal-body select')].map((s) => s.value)`)
console.log('[H6] 习惯当前值:', JSON.stringify(habits))
await evalJs(`document.querySelector('.hc-modal-head button').click()`)

// H4 复习页：错题列表 → 记住一题 → 数量减少
await evalJs(`window.__hc.clickText('button', '复习错题')`)
await waitFor(`!!document.querySelector('.hc-review')`, '复习页')
await waitFor(`document.querySelectorAll('.hc-miss').length > 0`, '错题列表')
const missBefore = await evalJs(`document.querySelectorAll('.hc-miss').length`)
await shot('10-review.png')
await evalJs(`window.__hc.clickText('.hc-miss-actions button', '记住了')`)
await waitFor(`document.querySelectorAll('.hc-miss').length === ${missBefore - 1}`, '错题消掉一条')
console.log(`[H4] 复习判分：${missBefore} → ${missBefore - 1}`)
await evalJs(`window.__hc.clickText('.hc-review-head button', '回课堂')`)
await waitFor(`!!document.querySelector('.hc-composer')`, '回到课堂')

console.log('SMOKE2_OK')
ws.close()
process.exit(0)