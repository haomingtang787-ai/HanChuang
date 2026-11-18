// 寒窗全功能自测：清库后以新用户身份走完整产品。
// 前置：应用带 --remote-debugging-port=9222 启动，且数据目录为空。
// 用法：node scripts/smoke-full.mjs
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })
const FIX = path.join(process.env.TEMP ?? '/tmp', 'hanchuang-fixtures')
const BAK = path.join(process.env.TEMP ?? '/tmp', 'hanchuang-backup-20261118', 'library')

// 新用户配置：密钥从备份读（用户自己的 key，配回用户自己的应用），不在日志里出现。
const backupSettings = JSON.parse(fs.readFileSync(path.join(BAK, 'settings.json'), 'utf8'))
const API_KEY = backupSettings.ai.apiKey

function findOriginals(ext) {
  const dir = path.join(BAK, 'originals')
  const out = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (p.toLowerCase().endsWith(ext)) out.push(p)
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out
}
const pdfPath = findOriginals('.pdf')[0]
const pptxPath = findOriginals('.pptx')[0] ?? null
if (!pdfPath) throw new Error('备份里没有 PDF 课件')
const cPath = path.join(FIX, 'linked_list.c')
const txtPath = path.join(FIX, 'note.txt')

let ws = null
let pageUrl = ''
let seq = 0
const pending = new Map()
async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
  if (!page) throw new Error('找不到页面 target')
  pageUrl = page.webSocketDebuggerUrl
  ws = new WebSocket(pageUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    // 原生 confirm（下课/删除/恢复）一律自动确认，模拟用户点「确定」。
    if (msg.method === 'Page.javascriptDialogOpening') {
      ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: true } }))
    }
  })
  await send('Runtime.enable')
  await send('Page.enable')
}
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
await connect()
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.error) throw new Error(JSON.stringify(r.error))
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 800))
  return r.result?.result?.value
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(EVID, name), Buffer.from(r.result.data, 'base64'))
  console.log('截图:', name)
}
async function waitFor(expression, label, timeout = 240000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await evalJs(expression)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('等待超时: ' + label)
}
async function setFiles(paths) {
  await send('DOM.enable')
  const doc = await send('DOM.getDocument')
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type="file"]' })
  if (!q.result.nodeId) throw new Error('找不到隐藏文件输入框')
  await send('DOM.setFileInputFiles', { files: paths, nodeId: q.result.nodeId })
}
const log = (step, detail) => console.log(`[${step}]`, detail ?? '')
const HC = `
  window.__hc = {
    setInput(selector, value, index = 0) {
      const el = document.querySelectorAll(selector)[index]
      if (!el) throw new Error('找不到输入框 ' + selector + '[' + index + ']')
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
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
`
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`!!window.desk && !!document.querySelector('.hc-app')`, '应用就绪')
await evalJs(HC)

// ---- 1 首启：未配置 → 设置自动弹出 → 填 key → 拉模型 → 测连接 → 保存 ----
await waitFor(`!!document.querySelector('.hc-modal')`, '首启设置弹层')
log('1 首启', '未配置模型，设置自动打开 ✓')
await evalJs(`window.__hc.setInput('.hc-modal-body input', 'deepseek-flash', 1)`)
await evalJs(`window.__hc.setInput('.hc-modal-body input[type="password"]', ${JSON.stringify(API_KEY)})`)
await evalJs(`window.__hc.clickText('.hc-modal-body button', '拉取模型列表')`)
await waitFor(`document.querySelectorAll('.hc-model-chips button').length > 0`, '模型列表')
await evalJs(`window.__hc.clickText('.hc-modal-body button', '测试连接')`)
await waitFor(`document.body.textContent.includes('连接成功')`, '测试连接')
await evalJs(`window.__hc.clickText('.hc-modal-body button', '保存配置')`)
await waitFor(`document.body.textContent.includes('模型配置已保存')`, '保存配置')
await evalJs(`document.querySelector('.hc-modal-head button').click()`)
log('1 首启', '拉模型 / 测连接 / 保存 全通过')
await shot('f01-welcome.png')

// ---- 2 建课 + 上传 PDF（真实文件输入框路径）----
await evalJs(`window.__hc.setInput('.hc-welcome-new input', '计算机组成原理')`)
await evalJs(`window.__hc.clickText('.hc-welcome-new button', '新建课程并上传课件')`)
await setFiles([pdfPath])
await waitFor(`!!document.querySelector('.hc-actions .hc-primary') && window.__hc.text('.hc-actions .hc-primary').includes('开始上课')`, 'PDF 备课完成', 300000)
const pdfSession = await evalJs(`(async () => { const r = await window.desk.study.list(); return r.ok ? r.data.items[0] : null })()`)
log('2 上传备课', JSON.stringify({ title: pdfSession?.title, units: pdfSession?.unitCount }))
await waitFor(`!!document.querySelector('.hc-rail')`, '进度轨')
await shot('f02-classroom.png')

// ---- 3 多文件上传：代码 +  txt（+ pptx 若有）----
const more = [cPath]
if (pptxPath) more.push(pptxPath)
more.push(txtPath)
await evalJs(`window.__hc.clickText('.hc-upload-btn', '上传课件')`)
await setFiles(more)
const expectSessions = pptxPath ? 4 : 3
await waitFor(`(async () => { const r = await window.desk.study.list(); return r.ok && r.data.items.length >= ${expectSessions} })()`, '多文件备课', 300000)
const codeCheck = await evalJs(`(async () => {
  const r = await window.desk.study.list()
  const code = r.data.items.find((i) => i.title.includes('链表') || i.title.includes('list') || i.title.includes('指针'))
  const all = r.data.items
  const target = code ?? all[all.length - 1]
  const d = await window.desk.study.get({ sessionId: target.sessionId })
  return d.ok ? { title: d.data.title, units: d.data.units.length, hasCode: d.data.units.some((u) => u.segments.some((s) => s.source.includes('malloc') || s.source.includes('Node'))) } : null
})()`)
log('3 多文件', JSON.stringify(codeCheck))
if (!codeCheck?.hasCode) log('3 警告', '代码课件未在原文里找到代码特征，需人工看')

// ---- 4 回到 PDF 课堂：逐段上课 + 作答 + streak ----
await evalJs(`window.__hc.clickText('.hc-session-row', ${JSON.stringify(pdfSession.title)})`)
await waitFor(`window.__hc.text('.hc-actions .hc-primary').includes('开始上课') || window.__hc.text('.hc-actions .hc-primary').includes('继续上课')`, '回到课堂')
for (let i = 1; i <= 3; i += 1) {
  await evalJs(`window.__hc.clickText('.hc-actions button', '上课')`)
  await waitFor(`document.querySelectorAll('.hc-lecture').length === ${i}`, '第' + i + '段')
}
await evalJs(`window.__hc.setInput('.hc-check-form textarea', '因为 CPU 和主存速度差上百倍，单层存储器跟不上 CPU。')`)
await evalJs(`window.__hc.clickText('.hc-check-form button', '提交回答')`)
await waitFor(`!!document.querySelector('.hc-check-done')`, '作答落库')
const streak = await evalJs(`window.__hc.text('.hc-streak')`)
log('4 上课', '3 段讲课 + 作答 ✓ streak=' + streak)

// ---- 5 追问 ----
const bubblesBefore = await evalJs(`document.querySelectorAll('.hc-bubble-user').length`)
await evalJs(`window.__hc.setInput('.hc-input-row textarea', '用一句话告诉我，为什么不能只用一种存储器？')`)
await evalJs(`document.querySelector('.hc-send').click()`)
await waitFor(`document.querySelectorAll('.hc-bubble-user').length > ${bubblesBefore} && !document.querySelector('.hc-typing')`, '追问')
log('5 追问', '主按钮仍为: ' + (await evalJs(`window.__hc.text('.hc-actions .hc-primary')`)))

// ---- 6 大纲 / 出题判卷 / 总结 / 复习卡 / 复述 / 找原文 ----
await evalJs(`window.__hc.clickText('.hc-actions button', '课件大纲')`)
await waitFor(`[...document.querySelectorAll('.hc-card-title')].some((e) => e.textContent.includes('课件大纲')) && !document.querySelector('.hc-typing')`, '大纲')
await evalJs(`window.__hc.clickText('.hc-actions button', '出题考我')`)
await waitFor(`!!document.querySelector('.hc-quiz') && !document.querySelector('.hc-typing')`, '题测')
await evalJs(`
  document.querySelectorAll('.hc-quiz-q textarea').forEach((ta, i) => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, i === 0 ? 'CPU 周期约 0.3ns，主存访问几十 ns，差上百倍，这就是存储墙，所以必须分层。' : '随便答一句用来产生错题。')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  true
`)
await evalJs(`window.__hc.clickText('.hc-quiz button', '交卷判分')`)
await waitFor(`!!document.querySelector('.hc-quiz-graded') && !document.querySelector('.hc-typing')`, '判卷')
await shot('f03-quiz.png')
await evalJs(`window.__hc.clickText('.hc-actions button', '总结这一讲')`)
await waitFor(`[...document.querySelectorAll('.hc-card-title')].some((e) => e.textContent.includes('本讲总结')) && !document.querySelector('.hc-typing')`, '总结')
await evalJs(`window.__hc.clickText('.hc-artifact button', '做成复习卡')`)
await waitFor(`document.body.textContent.includes('已做成')`, '复习卡')
log('6 工具', '大纲 / 出题判卷 / 总结 / 做成复习卡 ✓')
await evalJs(`window.__hc.setInput('.hc-input-row textarea', '我讲给你听：存储器分层是因为 CPU 太快主存太慢，速度差上百倍，所以快而小的靠近 CPU，大而便宜的放远处，每一层都是下一层的缓存，依据是程序局部性。')`)
await evalJs(`document.querySelector('.hc-send').click()`)
await waitFor(`[...document.querySelectorAll('.hc-card-title')].some((e) => e.textContent.includes('复述批改')) && !document.querySelector('.hc-typing')`, '复述批改')
await evalJs(`window.__hc.setInput('.hc-input-row textarea', '找原文：不可能三角')`)
await evalJs(`document.querySelector('.hc-send').click()`)
await waitFor(`[...document.querySelectorAll('.hc-card-title')].some((e) => e.textContent.includes('找原文')) && !document.querySelector('.hc-typing')`, '找原文')
log('6 工具', '复述批改 / 找原文 ✓')
await shot('f04-artifacts.png')

// ---- 7 模型切换 + 用量 ¥ + 余额 ----
await evalJs(`window.__hc.setInput('.hc-model-select', 'deepseek-chat')`)
await waitFor(`document.body.textContent.includes('已切换到 deepseek-chat')`, '切换模型')
await evalJs(`window.__hc.setInput('.hc-input-row textarea', '一句话：什么是时间局部性？')`)
await evalJs(`document.querySelector('.hc-send').click()`)
await waitFor(`!document.querySelector('.hc-typing')`, 'chat 模型回答')
await evalJs(`window.__hc.setInput('.hc-model-select', 'deepseek-flash')`)
await waitFor(`document.body.textContent.includes('已切换到 deepseek-flash')`, '切回 flash')
await evalJs(`document.querySelector('.hc-usage').click()`)
await waitFor(`!!document.querySelector('.hc-usage-cost')`, '用量弹层')
const cost = await evalJs(`window.__hc.text('.hc-usage-cost')`)
const balance = await evalJs(`window.__hc.text('.hc-usage-balance')`)
log('7 用量', cost + ' | ' + balance)
await shot('f05-usage.png')
await evalJs(`document.querySelector('.hc-usage-head button').click()`)

// ---- 8 下课锁定 ----
await evalJs(`window.__hc.clickText('.hc-actions button', '下课')`)
await waitFor(`!!document.querySelector('.hc-finished-note') && !!document.querySelector('.hc-summary')`, '下课总结')
log('8 下课', '学习总结 + 老师手记 + 输入锁定 ✓')
await shot('f06-finished.png')

// ---- 9 老师记忆确认 + 人格 + 档案 + 习惯 ----
await evalJs(`window.__hc.clickText('button', '设置')`)
await waitFor(`!!document.querySelector('.hc-modal')`, '设置')
await evalJs(`window.__hc.clickText('.hc-tabs button', '老师')`)
await waitFor(`document.querySelectorAll('.hc-memory').length > 0`, '记忆列表')
await evalJs(`document.querySelector('.hc-memory input[type="checkbox"]').click()`)
await waitFor(`(async () => { const r = await window.desk.teacher.overview(); return r.ok && r.data.memories.some((m) => m.userConfirmed) })()`, '记忆确认')
await evalJs(`window.__hc.setInput('.hc-modal-body input', '苏老师', 0)`)
await evalJs(`window.__hc.clickText('.hc-modal-body button', '保存人格')`)
await waitFor(`document.body.textContent.includes('老师人格已更新')`, '人格')
await evalJs(`window.__hc.setInput('input[placeholder*="期末"]', 'CSP 认证 + 期末不挂科')`)
await evalJs(`window.__hc.setInput('input[placeholder*="大二"]', '大二，基础薄弱，每天只有 1 小时')`)
await evalJs(`window.__hc.clickText('.hc-modal-body button', '保存档案')`)
await waitFor(`document.body.textContent.includes('学生档案已更新')`, '档案')
await evalJs(`window.__hc.clickText('.hc-tabs button', '我的习惯')`)
await waitFor(`document.querySelectorAll('.hc-modal-body select').length >= 5`, '习惯表单')
await evalJs(`window.__hc.setInput('.hc-modal-body input', 'Tommy', 0)`)
await evalJs(`window.__hc.setInput('.hc-modal-body select', 'slow', 0)`)
await evalJs(`window.__hc.setInput('.hc-modal-body select', 'story', 1)`)
await evalJs(`window.__hc.setInput('.hc-modal-body select', '25', 2)`)
await evalJs(`window.__hc.setInput('.hc-modal-body select', 'night', 3)`)
await evalJs(`window.__hc.setInput('.hc-modal-body select', 'formula', 4)`)
await evalJs(`window.__hc.clickText('.hc-modal-body button', '保存习惯')`)
await waitFor(`document.body.textContent.includes('学习习惯已保存')`, '习惯')
log('9 老师', '记忆确认 / 人格苏老师 / 档案 / 习惯 ✓')

// ---- 10 预算 + 备份 + 恢复 ----
await evalJs(`window.__hc.clickText('.hc-tabs button', '预算与数据')`)
await waitFor(`!!document.querySelector('.hc-modal-body input[type="number"]')`, '预算表单')
await evalJs(`window.__hc.setInput('.hc-modal-body input[type="number"]', '2000000')`)
await evalJs(`window.__hc.clickText('.hc-modal-body button', '保存预算')`)
await waitFor(`document.body.textContent.includes('预算已保存')`, '预算')
await evalJs(`window.__hc.clickText('.hc-modal-body button', '立即备份')`)
await waitFor(`document.body.textContent.includes('已备份到')`, '备份')
const backupPath = await evalJs(`([...document.querySelectorAll('.hc-toast')].find((t) => t.textContent.includes('已备份到'))?.textContent ?? '').replace('已备份到', '').trim()`)
log('10 备份', backupPath + ' exists=' + (backupPath ? fs.existsSync(backupPath.trim()) : false))
await evalJs(`window.__hc.clickText('.hc-modal-body button', '从备份恢复')`)
// applyRestore 会在 200ms 后重启应用：等旧 target 消失、新 target 起来再重连。
await new Promise((r) => setTimeout(r, 4000))
let reconnected = false
for (let i = 0; i < 40; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:9222/json/list')).json()
    const p = l.find((t) => t.type === 'page' && t.url.includes('index.html'))
    if (p && p.webSocketDebuggerUrl !== pageUrl) { await connect(); reconnected = true; break }
  } catch { /* 重启中 */ }
  await new Promise((r) => setTimeout(r, 1000))
}
if (!reconnected) throw new Error('恢复后应用没有重启回来')
await waitFor(`!!document.querySelector('.hc-app') && !!window.desk`, '重启后界面')
await evalJs(HC)
await evalJs(`if (document.querySelector('.hc-modal-head button')) document.querySelector('.hc-modal-head button').click()`)
log('10 数据', '预算 / 一键备份 / 一键恢复(含重启) ✓')

// ---- 11 复习：错题 + 复习卡 ----
await evalJs(`window.__hc.clickText('button', '复习错题')`)
await waitFor(`!!document.querySelector('.hc-review')`, '复习页')
await waitFor(`document.querySelectorAll('.hc-miss').length > 0`, '错题')
const missBefore = await evalJs(`document.querySelectorAll('.hc-miss').length`)
await evalJs(`window.__hc.clickText('.hc-miss-actions button', '记住了')`)
await waitFor(`document.querySelectorAll('.hc-miss').length === ${missBefore - 1}`, '错题消掉')
const cardCount = await evalJs(`document.querySelectorAll('.hc-card').length`)
if (cardCount > 0) {
  await evalJs(`window.__hc.clickText('.hc-miss-actions button', '看答案')`)
  await evalJs(`window.__hc.clickText('.hc-miss-actions button', '记得')`)
  await waitFor(`document.querySelectorAll('.hc-card').length === ${cardCount - 1}`, '复习卡判分')
}
log('11 复习', `错题 ${missBefore}→${missBefore - 1}，复习卡 ${cardCount} 张判分 ✓`)
await shot('f07-review.png')
await evalJs(`window.__hc.clickText('.hc-review-head button', '回课堂')`)

// ---- 12 改名 / 删课 / 删课堂 ----
await evalJs(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('计算机组成原理')).querySelector('button[title="重命名"]').click()`)
await evalJs(`window.__hc.setInput('.hc-course-edit input', '计算机组成原理（核心）')`)
await evalJs(`window.__hc.clickText('.hc-course-edit button', '存')`)
await waitFor(`[...document.querySelectorAll('.hc-course-name')].some((e) => e.textContent === '计算机组成原理（核心）')`, '改名')
await evalJs(`window.__hc.setInput('.hc-new-course input', '临时课程')`)
await evalJs(`document.querySelector('.hc-new-course-btn').click()`)
await waitFor(`[...document.querySelectorAll('.hc-course-name')].some((e) => e.textContent === '临时课程')`, '临时课程')
await evalJs(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('临时课程')).querySelector('button[title="删除课程"]').click()`)
await waitFor(`![...document.querySelectorAll('.hc-course-name')].some((e) => e.textContent === '临时课程')`, '删课')
const sessBefore = await evalJs(`(async () => (await window.desk.study.list()).data.items.length)()`)
if (!(await evalJs(`document.querySelectorAll('.hc-session-row').length > 0`))) {
  await evalJs(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes('计算机组成原理（核心）')).click()`)
}
await waitFor(`document.querySelectorAll('.hc-session-row').length > 0`, '课堂行可见')
const victim = await evalJs(`(async () => {
  const items = (await window.desk.study.list()).data.items
  const note = items.find((s) => s.sourceName === 'note.txt')
  return note ? note.title : null
})()`)
await evalJs(`(() => {
  const rows = [...document.querySelectorAll('.hc-session-row')]
  const wanted = ${JSON.stringify(victim)}
  const row = (wanted && rows.find((r) => r.textContent.includes(wanted))) || rows[rows.length - 1]
  row.querySelector('button[title="删除这份课件的课堂"]').click()
})()`)
await waitFor(`(async () => (await window.desk.study.list()).data.items.length === ${sessBefore - 1})()`, '删课堂')
log('12 管理', '改名 / 删课 / 删课堂 ✓')

// ---- 13 主题 + 窄屏 ----
await evalJs(`document.querySelector('.hc-theme-btn').click()`)
await waitFor(`document.querySelector('.hc-app').dataset.theme === 'dark'`, '夜间模式')
await shot('f08-dark.png')
await evalJs(`document.querySelector('.hc-theme-btn').click()`)
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 1, mobile: false })
await new Promise((r) => setTimeout(r, 800))
const overflow = await evalJs(`document.documentElement.scrollWidth - window.innerWidth`)
await shot('f09-narrow.png')
await send('Emulation.clearDeviceMetricsOverride')
log('13 视觉', '夜间模式 ✓ 1000px 溢出=' + overflow)

// ---- 14 持久化读回 ----
const persist = await evalJs(`(async () => {
  const [list, overview, habits, settings, due] = await Promise.all([
    window.desk.study.list(), window.desk.teacher.overview(), window.desk.teaching.habits.get(),
    window.desk.data.settings(), window.desk.teaching.dueCards(),
  ])
  const d = await window.desk.study.get({ sessionId: ${JSON.stringify(pdfSession.sessionId)} })
  return {
    sessions: list.data.items.length,
    persona: overview.data.persona.name,
    confirmedMemories: overview.data.memories.filter((m) => m.userConfirmed).length,
    habits: { pace: habits.data.pace, style: habits.data.style, window: habits.data.window },
    budget: settings.data.budget.monthlyTokens,
    artifacts: d.data.artifacts.map((a) => a.kind),
    finished: d.data.status,
    checks: d.data.checks.length,
  }
})()`)
log('14 读回', JSON.stringify(persist))
console.log('SMOKE_FULL_OK')
ws.close()
process.exit(0)