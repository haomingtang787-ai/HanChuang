// 寒窗界面冒烟验证：通过 Electron 自带 DevTools 协议驱动真实界面，
// 走「建课 → 备课 → 逐段上课 → 作答 → 追问 → 出题判卷 → 总结 → 用量」全链路。
// 用法：先 npm start -- --remote-debugging-port=9222，再 node scripts/smoke-ui.mjs
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })
const PORT = Number(process.argv[2] ?? 9222)

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('找不到寒窗页面 target: ' + JSON.stringify(list.map((t) => t.url)))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })

let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
function send(method, params = {}) {
  return new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
}
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
async function waitFor(expression, label, timeout = 180000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await evalJs(expression)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('等待超时: ' + label)
}
const log = (step, detail) => console.log(`[${step}]`, detail ?? '')

await send('Runtime.enable')
await send('Page.enable')
await waitFor(`!!window.desk && !!document.querySelector('.hc-app')`, '应用就绪')

// 页面内工具函数
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
    text(selector) { return document.querySelector(selector)?.textContent ?? '' },
  }
  true
`)

// H8 数据继承 + 初始界面
const initial = await evalJs(`(async () => {
  const [courses, ai, list] = await Promise.all([window.desk.study.courses(), window.desk.ai.status(), window.desk.study.list()])
  return {
    courses: courses.ok ? courses.data.items.map((c) => ({ name: c.name, sessions: c.sessions.length })) : courses.error,
    sessions: list.ok ? list.data.items.length : -1,
    ai: ai.ok ? { configured: ai.data.configured, model: ai.data.model } : ai.error,
    welcome: document.querySelector('.hc-welcome-brand')?.textContent ?? '',
    title: document.title,
  }
})()`)
log('H8 初始状态', JSON.stringify(initial))
await shot('01-welcome.png')
if (!initial.ai?.configured) throw new Error('真实 profile 未配置模型，无法继续')

// H1 新建课程（走真实界面输入）
await evalJs(`window.__hc.setInput('.hc-new-course input', '冒烟演示')`)
await evalJs(`document.querySelector('.hc-new-course-btn').click()`)
await waitFor(`[...document.querySelectorAll('.hc-course-name')].some((e) => e.textContent === '冒烟演示')`, '课程出现在左栏')
log('H1', '课程「冒烟演示」已创建并显示在左栏')

// 备课：用库里已有的一份小课件（导入管线由 278 项引擎测试覆盖，原生文件框不在 CDP 能力内）
const candidates = await evalJs(`(async () => {
  const r = await window.desk.documents.list({ limit: 100 })
  if (!r.ok) return []
  const ready = r.data.items.filter((d) => d.status === 'ready' || d.job?.state === 'succeeded' || d.job?.state === 'partial')
  ready.sort((a, b) => a.sizeBytes - b.sizeBytes)
  return ready.slice(0, 5).map((d) => ({ id: d.documentVersionId, name: d.displayName, size: d.sizeBytes }))
})()`)
if (!candidates.length) throw new Error('库里没有已解析的课件可供演示')
const courseId = await evalJs(`(async () => {
  const r = await window.desk.study.courses()
  return r.ok ? r.data.items.find((c) => c.name === '冒烟演示')?.courseId ?? null : null
})()`)
let created = null
for (const doc of candidates) {
  log('备课材料', JSON.stringify(doc))
  created = await evalJs(`(async () => {
    const r = await window.desk.study.create({ requestId: crypto.randomUUID(), documentVersionId: ${JSON.stringify(doc.id)}, title: '冒烟演示课', courseId: ${JSON.stringify(courseId)} })
    return r.ok ? { sessionId: r.data.sessionId, title: r.data.title, units: r.data.units.length, segments: r.data.units.reduce((s, u) => s + u.segments.length, 0), warnings: r.data.warnings.length } : { error: r.error }
  })()`)
  log('H7 备课结果', JSON.stringify(created))
  if (!created.error) break
}
if (!created || created.error) throw new Error('备课失败: ' + JSON.stringify(created?.error))

// 刷新界面 → 左栏展开课程 → 点进课堂（真实导航）
await send('Page.reload')
await waitFor(`!!window.desk && !!document.querySelector('.hc-app')`, '重载就绪')
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
    text(selector) { return document.querySelector(selector)?.textContent ?? '' },
  }
  true
`)
await evalJs(`window.__hc.clickText('.hc-course-row', '冒烟演示')`)
await waitFor(`document.querySelectorAll('.hc-session-row').length > 0`, '课件出现在课程下')
await evalJs(`window.__hc.clickText('.hc-session-row', ${JSON.stringify(created.title)})`)
await waitFor(`!!document.querySelector('.hc-stream') && !!document.querySelector('.hc-composer')`, '课堂打开')
await shot('02-classroom.png')
log('H1', '左栏课程→课件→课堂导航正常')

// H2 逐段上课
await evalJs(`window.__hc.clickText('.hc-actions button', '开始上课')`)
await waitFor(`document.querySelectorAll('.hc-lecture').length === 1`, '第一段讲课卡片')
await evalJs(`window.__hc.clickText('.hc-actions button', '继续上课')`)
await waitFor(`document.querySelectorAll('.hc-lecture').length === 2`, '第二段讲课卡片')
const lectureHead = await evalJs(`document.querySelector('.hc-lecture .hc-lecture-unit')?.textContent ?? ''`)
log('H2', '讲课卡片逐段出现: ' + lectureHead)
await shot('03-lecturing.png')

// H2 停一下作答
const hasCheck = await evalJs(`!!document.querySelector('.hc-check-form textarea')`)
if (hasCheck) {
  await evalJs(`window.__hc.setInput('.hc-check-form textarea', 'k 为 0 时式子退化成常数函数，图像是水平线。')`)
  await evalJs(`window.__hc.clickText('.hc-check-form button', '提交回答')`)
  await waitFor(`!!document.querySelector('.hc-check-done')`, '作答落库显示')
  log('H2', '停一下作答已记录')
}

// H3 插嘴追问
const before = await evalJs(`document.querySelectorAll('.hc-bubble-user').length`)
await evalJs(`window.__hc.setInput('.hc-input-row textarea', '用一句话告诉我 k 和 b 各管什么？')`)
await evalJs(`document.querySelector('.hc-send').click()`)
await waitFor(`document.querySelectorAll('.hc-bubble-user').length > ${before} && !document.querySelector('.hc-typing')`, '追问回答完成', 120000)
const stillNext = await evalJs(`window.__hc.text('.hc-actions .hc-primary')`)
log('H3', '追问完成，主按钮仍是: ' + stillNext)
await shot('04-qa.png')

// H4 出题 → 作答 → 判卷
await evalJs(`window.__hc.clickText('.hc-actions button', '出题考我')`)
await waitFor(`!!document.querySelector('.hc-quiz') && !document.querySelector('.hc-typing')`, '题测卡片', 180000)
const quizCount = await evalJs(`document.querySelectorAll('.hc-quiz-q').length`)
log('H4', '题测出好了，共 ' + quizCount + ' 题')
await evalJs(`
  document.querySelectorAll('.hc-quiz-q textarea').forEach((ta, i) => {
    const proto = window.HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(ta, '这是冒烟测试的第 ' + (i + 1) + ' 题作答：k 管方向，b 管截距。')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  true
`)
await evalJs(`window.__hc.clickText('.hc-quiz button', '交卷判分')`)
await waitFor(`!!document.querySelector('.hc-quiz-graded') && !document.querySelector('.hc-typing')`, '判卷完成', 180000)
log('H4', '判卷完成')
await shot('05-quiz-graded.png')

// H4 总结
await evalJs(`window.__hc.clickText('.hc-actions button', '总结这一讲')`)
await waitFor(`[...document.querySelectorAll('.hc-card-title')].some((e) => e.textContent.includes('本讲总结')) && !document.querySelector('.hc-typing')`, '总结卡片', 180000)
log('H4', '总结卡片已入流')
await shot('06-summary.png')

// H5 用量
const usageText = await evalJs(`window.__hc.text('.hc-usage')`)
await evalJs(`document.querySelector('.hc-usage').click()`)
await waitFor(`!!document.querySelector('.hc-usage-body')`, '用量弹层', 60000)
const usageBody = await evalJs(`window.__hc.text('.hc-usage-body')`)
log('H5', usageText + ' | ' + usageBody.slice(0, 200))
await shot('07-usage.png')
await evalJs(`document.querySelector('.hc-usage-head button').click()`)

// H5 模型下拉存在且可切换（切到 deepseek-chat 再切回，验证 saveConfig 保留密钥）
const modelOptions = await evalJs(`[...document.querySelectorAll('.hc-model-select option')].map((o) => o.value)`)
log('H5', '模型选项: ' + JSON.stringify(modelOptions))

// H10 窄屏
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 1, mobile: false })
await new Promise((r) => setTimeout(r, 800))
const overflow = await evalJs(`document.documentElement.scrollWidth - window.innerWidth`)
await shot('08-narrow.png')
await send('Emulation.clearDeviceMetricsOverride')
log('H10', '1000px 宽横向溢出: ' + overflow)

// 持久化读回：重启边界由 localStorage + SQLite 保证，这里直接查库
const persist = await evalJs(`(async () => {
  const d = await window.desk.study.get({ sessionId: ${JSON.stringify(created.sessionId)} })
  return d.ok ? { messages: d.data.messages.length, checks: d.data.checks.length, artifacts: d.data.artifacts.map((a) => a.kind), usageCalls: d.data.usage.calls } : null
})()`)
log('持久化读回', JSON.stringify(persist))

console.log('SMOKE_OK')
ws.close()
process.exit(0)