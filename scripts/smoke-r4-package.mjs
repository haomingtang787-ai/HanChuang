// 校验打包后的便携版：asar 内的 mermaid 分包能否被 file:// 动态 import（这是图解在安装包里能否渲染的关键）。
import fs from 'node:fs'
import path from 'node:path'

const assetsDir = path.resolve('out/renderer/assets')
const core = fs.readdirSync(assetsDir).find((name) => name.startsWith('mermaid.core'))
if (!core) throw new Error('没找到 mermaid.core 分包')

const port = 9224
const { spawn } = await import('node:child_process')
const exe = path.resolve('dist/寒窗 1.4.0.exe')
const child = spawn(exe, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' })
child.unref()

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let list = null
for (let i = 0; i < 40; i += 1) {
  try {
    list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    if (list?.length) break
  } catch { await wait(500) }
}
if (!list?.length) throw new Error('打包版没开 CDP')
const target = list.find((t) => t.type === 'page')
console.log('page url:', target.url.slice(0, 60))

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value

await wait(2500)
const appReady = await ev(`Boolean(document.querySelector('.hc-app') || document.querySelector('.hc-noapi'))`)
console.log('界面挂载:', appReady)
const imported = await ev(`(async () => { try { const m = await import('./assets/${core}'); return Object.keys(m).length > 0 } catch (error) { return 'FAIL: ' + (error && error.message) } })()`)
console.log('mermaid 分包动态 import:', imported)
const title = await ev(`document.title`)
console.log('标题:', title)
console.log(imported === true ? 'PACKAGE_MERMAID_OK' : 'PACKAGE_MERMAID_FAIL')
ws.close()
process.exit(0)
