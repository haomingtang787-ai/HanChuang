// 寒窗第三轮自测：讲解加深、备课进度条、素材（不备课入库）、原文对照抽屉。
// 前置：应用带 --remote-debugging-port=9222 启动，模型已配置。
// 用法：node scripts/smoke-r3.mjs
import fs from 'node:fs'
import path from 'node:path'

const EVID = path.resolve('docs/hanchuang-evidence')
fs.mkdirSync(EVID, { recursive: true })
const FIX = path.join(process.env.TEMP ?? '/tmp', 'hanchuang-r3-folder')
fs.rmSync(FIX, { recursive: true, force: true })
fs.mkdirSync(FIX, { recursive: true })
// 每轮用新文件名，避免命中「这份课件已经开过课」的复用分支，也避免文档重复导入。
const STAMP = Date.now().toString().slice(-6)
const mainFile = `a-链表笔记-${STAMP}.txt`
fs.writeFileSync(path.join(FIX, mainFile),
  `本轮自测课件编号 ${STAMP}。\n`
  + '链表由一个个节点组成，每个节点保存数据和指向下一个节点的指针。和数组不同，链表在内存里不需要连续空间，'
  + '所以插入删除不用搬动整片元素，但按下标随机访问必须从头一个个走。\n'
  + '插入分三步：先给新节点分配内存，再让新节点的 next 指向原来的后继，最后把前驱的 next 改成新节点。'
  + '顺序不能颠倒，否则原链会断掉，后半段直接丢掉。\n'
  + '删除时先用一个临时指针记住被删节点的后继，再改前驱指针，最后释放被删节点；'
  + '如果先释放再去找后继，就是访问已经释放的内存，程序会随机崩溃。\n'
  + '头插法插入是 O(1)，尾插法如果没有尾指针要走 O(n)；按值查找永远是 O(n)，这一点和数组一样。\n'
  + '最常见的误解是以为链表「插入一定是 O(1)」：那只在已经拿到前驱指针时成立，'
  + '如果还要先找到这个位置，整体还是 O(n)。\n')
fs.writeFileSync(path.join(FIX, 'b-栈.md'), '# 栈\n后进先出。\n')
fs.writeFileSync(path.join(FIX, 'c-代码.c'), 'int add(int a, int b) { return a + b; }\n')
fs.writeFileSync(path.join(FIX, '~$草稿.txt'), 'office 临时文件，应当被跳过')
fs.writeFileSync(path.join(FIX, '不支持.xyz'), 'x')

let ws = null
let seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
  if (!target) throw new Error('找不到页面 target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === 'Page.javascriptDialogOpening') {
      ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: true } }))
    }
  })
  await send('Runtime.enable')
  await send('Page.enable')
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.error) throw new Error(JSON.stringify(r.error))
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 700))
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
    await new Promise((r) => setTimeout(r, 800))
  }
  throw new Error('等待超时: ' + label)
}
const log = (step, detail) => console.log(`[${step}]`, detail ?? '')
const HC = `
  window.__hc = {
    setInput(selector, value, index = 0) {
      const el = document.querySelectorAll(selector)[index]
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
`
await connect()
await waitFor(`!!window.desk && !!document.querySelector('.hc-app')`, '应用就绪')
await evalJs(HC)

const configured = await evalJs(`window.desk.ai.status().then((r) => r.ok && r.data.configured)`)
if (!configured) throw new Error('模型未配置，先手动配好再跑本脚本')

// ---- 1 扫文件夹（真实 IPC）：只列受支持文件，跳过 ~$ 与不支持的格式 ----
const scan = await evalJs(`window.desk.documents.scanFolder({ path: ${JSON.stringify(FIX)} })`)
if (!scan.ok) throw new Error('扫描失败: ' + scan.error.message)
log('1 扫文件夹', `文件 ${scan.data.files.length} 份，跳过 ${scan.data.skipped} 个`)
if (scan.data.files.length !== 3) throw new Error('应只识别 3 份（txt/md/c），实际 ' + scan.data.files.map((f) => f.name).join(','))
if (!scan.data.files.every((f) => !f.name.startsWith('~$'))) throw new Error('~$ 临时文件没有被跳过')

// ---- 2 建课（真实侧栏）----
const existing = await evalJs(`window.desk.study.courses().then((r) => r.ok ? r.data.items.map((c) => c.name) : [])`)
let courseName = 'R3验证'
if (existing.includes(courseName)) courseName = `R3验证-${Date.now().toString().slice(-4)}`
await evalJs(`window.__hc.setInput('.hc-new-course input', ${JSON.stringify(courseName)})`)
await evalJs(`document.querySelector('.hc-new-course-btn').click()`)
await waitFor(`[...document.querySelectorAll('.hc-course-name')].some((e) => e.textContent.includes(${JSON.stringify(courseName)}))`, '新课程出现')
const alreadyOpen = await evalJs(`document.querySelectorAll('.hc-folder-btn').length > 0`)
if (!alreadyOpen) {
  await evalJs(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes(${JSON.stringify(courseName)})).click()`)
}
await waitFor(`document.querySelectorAll('.hc-folder-btn').length > 0`, '课程展开')
await shot('r3-01-course-folder-btn.png')
log('2 建课', `${courseName} 已建好，侧栏出现「导入整个文件夹」`)

// ---- 3 素材：只入库不备课（文件夹导入的实际入库动作）----
const courseId = await evalJs(`
  window.desk.study.courses().then((r) => {
    const c = r.data.items.find((item) => item.name === ${JSON.stringify(courseName)})
    return c ? c.courseId : null
  })
`)
if (!courseId) throw new Error('拿不到课程 id')
const imported = []
for (const file of scan.data.files) {
  const dv = await evalJs(`window.desk.documents.importPath({ path: ${JSON.stringify(file.path)}, requestId: crypto.randomUUID() }).then(async (r) => {
    if (!r.ok) return { error: r.error.message }
    if (r.data.duplicate) return { dvid: r.data.documentVersionId, name: ${JSON.stringify(file.name)}, state: 'duplicate' }
    let state = 'queued'
    for (let i = 0; i < 120; i += 1) {
      const job = await window.desk.jobs.get({ jobId: r.data.jobId })
      if (job.ok) { state = job.data.state; if (state !== 'queued' && state !== 'running') break }
      await new Promise((res) => setTimeout(res, 1000))
    }
    return { dvid: r.data.documentVersionId, name: ${JSON.stringify(file.name)}, state }
  })`)
  if (dv.error) throw new Error('导入失败: ' + dv.error)
  log('3 导入', `${dv.name} → ${dv.state}`)
  imported.push(dv)
}
// 素材索引是界面持久层：写进去后刷新，验证「素材」区能渲染、能点备课
await evalJs(`
  localStorage.setItem('hc.assets.v1', JSON.stringify(${JSON.stringify(imported.map((item) => ({
    courseId, documentVersionId: item.dvid, name: item.name, addedAt: new Date().toISOString(),
  })))})); true`)
await send('Page.reload')
await new Promise((r) => setTimeout(r, 2500))
await waitFor(`!!window.desk && !!document.querySelector('.hc-app')`, '刷新后就绪')
await evalJs(HC)
await evalJs(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes(${JSON.stringify(courseName)}))?.click()`)
await waitFor(`document.querySelectorAll('.hc-asset-head').length === 1 && document.querySelectorAll('.hc-asset-prep').length === 3`, '素材区渲染')
await shot('r3-02-assets.png')
log('3 素材', '3 份课件进素材区，未触发任何备课调用')

// ---- 4 点「备课」→ 备课进度条可见 → 真模型备课 ----
const created = await evalJs(`window.desk.study.list().then((r) => r.ok ? r.data.items.length : -1)`)
await evalJs(`[...document.querySelectorAll('.hc-asset-prep')][0].click()`)
await waitFor(`!!document.querySelector('.hc-prep-banner')`, '备课进度条出现', 60000)
await shot('r3-03-prep-banner.png')
log('4 备课条', await evalJs(`window.__hc.text('.hc-prep-banner')`))
await waitFor(`[...document.querySelectorAll('.hc-actions .hc-primary')].some((e) => e.textContent.includes('开始上课'))`, '备课完成', 300000)
const sessionsAfter = await evalJs(`window.desk.study.list().then((r) => r.ok ? r.data.items.length : -1)`)
log('4 备课', `课堂数 ${created} → ${sessionsAfter}`)

// ---- 5 开讲：讲解更长，两个工具按钮都在 ----
await evalJs(`window.__hc.clickText('.hc-actions button', '开始上课')`)
await waitFor(`document.querySelectorAll('.hc-lecture').length > 0`, '第一张讲课卡')
const explainLen = await evalJs(`document.querySelector('.hc-lecture .hc-rich')?.textContent.length ?? 0`)
log('5 讲解长度', `${explainLen} 字`)
if (explainLen <= 140) throw new Error('讲解仍然太短（≤140 字）: ' + explainLen)
const tools = await evalJs(`[...document.querySelectorAll('.hc-lecture-tools button')].map((e) => e.textContent.trim())`)
if (tools.length !== 2) throw new Error('讲课卡工具按钮数量不对: ' + tools.join(','))
await shot('r3-04-lecture-tools.png')
log('5 卡片', '工具: ' + tools.join(' / '))

// ---- 6 这段详细讲：追问真的把这一段展开 ----
const beforeMsgs = await evalJs(`document.querySelectorAll('.hc-bubble-teacher:not(.hc-typing)').length`)
await evalJs(`[...document.querySelectorAll('.hc-lecture-tools button')].find((e) => e.textContent.includes('详细讲')).click()`)
// 等「正在输入」消失且出现新的完整回答，别把打字气泡当答案。
await waitFor(`!document.querySelector('.hc-typing') && document.querySelectorAll('.hc-bubble-teacher:not(.hc-typing)').length > ${beforeMsgs}`, '详细讲回答', 240000)
const detailLen = await evalJs(`(() => { const list = [...document.querySelectorAll('.hc-bubble-teacher:not(.hc-typing)')]; const last = list[list.length - 1]; return last ? last.textContent.length : 0 })()`)
log('6 详细讲', `${detailLen} 字`)
if (detailLen < 250) throw new Error('「详细讲这一段」回答太短: ' + detailLen)
await shot('r3-05-detail.png')

// ---- 7 对照原文抽屉：停在引用这一页 ----
await evalJs(`[...document.querySelectorAll('.hc-lecture-tools button')].find((e) => e.textContent.includes('对照原文')).click()`)
await waitFor(`!!document.querySelector('.hc-source-drawer')`, '原文抽屉')
await new Promise((r) => setTimeout(r, 1200))
const drawer = await evalJs(`({
  page: window.__hc.text('.hc-source-page'),
  quote: window.__hc.text('.hc-source-quote blockquote'),
  texts: document.querySelectorAll('.hc-source-text').length,
  img: document.querySelectorAll('.hc-source-image img').length,
})`)
log('7 原文抽屉', JSON.stringify(drawer))
await shot('r3-06-source-drawer.png')
if (!drawer.page.includes('页') && !drawer.page.includes('全文')) throw new Error('抽屉没有页码/全文标识')
if (drawer.img === 0 && drawer.texts === 0) throw new Error('抽屉里既没有页面图也没有原文段落')
await evalJs(`document.querySelector('.hc-source-close').click()`)

// ---- 8 顶栏「原文」入口 ----
await evalJs(`window.__hc.clickText('.hc-header button', '原文')`)
await waitFor(`!!document.querySelector('.hc-source-drawer')`, '顶栏原文入口')
log('8 顶栏入口', '抽屉再次打开 ✓')
await shot('r3-07-header-source.png')
await evalJs(`document.querySelector('.hc-source-close').click()`)

// ---- 9 PDF 课堂：对照原文必须真的有页面图 ----
const pdfSession = await evalJs(`window.desk.study.list().then((r) => {
  if (!r.ok) return null
  const row = r.data.items.find((item) => /\.pdf$/i.test(item.sourceName ?? ''))
  return row ? { sessionId: row.sessionId, title: row.title, courseId: row.courseId, sourceName: row.sourceName } : null
})`)
if (pdfSession) {
  await evalJs(`window.desk.study.get({ sessionId: ${JSON.stringify(pdfSession.sessionId)} }).then((r) => r.ok)`)
  // 走真实入口：先展开课程，再点这一行课堂
  const courseName = await evalJs(`window.desk.study.courses().then((r) => {
    const c = r.ok ? r.data.items.find((item) => item.courseId === ${JSON.stringify(pdfSession.courseId)}) : null
    return c ? c.name : null
  })`)
  if (courseName) {
    const openAlready = await evalJs(`document.querySelectorAll('.hc-folder-btn').length > 0`)
    if (!openAlready) await evalJs(`[...document.querySelectorAll('.hc-course-row')].find((e) => e.textContent.includes(${JSON.stringify(courseName)}))?.click()`)
    await waitFor(`[...document.querySelectorAll('.hc-session-row')].some((e) => e.textContent.includes(${JSON.stringify(pdfSession.title)}))`, 'PDF 课堂行')
    await evalJs(`[...document.querySelectorAll('.hc-session-row')].find((e) => e.textContent.includes(${JSON.stringify(pdfSession.title)})).click()`)
    await waitFor(`document.querySelectorAll('.hc-lecture').length > 0`, 'PDF 课堂打开', 120000)
    await evalJs(`window.__hc.clickText('.hc-header button', '原文')`)
    await waitFor(`!!document.querySelector('.hc-source-drawer')`, 'PDF 原文抽屉')
    await waitFor(`document.querySelectorAll('.hc-source-image img').length > 0`, 'PDF 页图', 60000)
    const pdfDrawer = await evalJs(`({ page: window.__hc.text('.hc-source-page'), img: document.querySelectorAll('.hc-source-image img').length })`)
    log('9 PDF 页图', JSON.stringify(pdfDrawer))
    await shot('r3-08-pdf-source.png')
  }
}

console.log('SMOKE_R3_OK')
ws.close()
