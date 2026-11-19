import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'src/renderer/hanchuang/hanchuang.css'), 'utf8')

/** 取出某个选择器块的正文，用来断言令牌真的落在那一套主题里。 */
function block(selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return ''
}

const light = block('.hc-app {')
const dark = block(".hc-app[data-theme='dark']")

describe('寒窗设计系统', () => {
  it('浅色与夜间都覆盖了同一套颜色与阴影令牌', () => {
    const themed = ['--hc-bg', '--hc-panel', '--hc-border', '--hc-text', '--hc-muted', '--hc-accent', '--hc-brass', '--hc-shadow', '--hc-shadow-lift', '--hc-ring']
    for (const token of themed) {
      expect(light, `浅色缺少 ${token}`).toContain(`${token}:`)
      expect(dark, `夜间缺少 ${token}`).toContain(`${token}:`)
    }
  })

  it('圆角与字体是全局尺度，只定义一次由夜间继承', () => {
    for (const token of ['--hc-radius-sm', '--hc-radius', '--hc-radius-card', '--hc-radius-lg', '--hc-sans', '--hc-display', '--hc-kai', '--hc-mono']) {
      expect(light, `基础尺度缺少 ${token}`).toContain(`${token}:`)
    }
    expect(dark).not.toContain('--hc-radius-card:')
    expect(dark).not.toContain('--hc-display:')
  })

  it('展示字阶真的用在了品牌与大标题上', () => {
    expect(css).toMatch(/\.hc-brand-name\s*{[^}]*font-family: var\(--hc-display\)/)
    expect(css).toMatch(/\.hc-welcome-brand\s*{[^}]*font-family: var\(--hc-display\)/)
    expect(css).toMatch(/\.hc-modal-title\s*{[^}]*font-family: var\(--hc-display\)/)
  })

  it('输入区在聚焦时整体高亮，而不是只有 textarea 变边框', () => {
    expect(css).toMatch(/\.hc-input-row:focus-within/)
  })

  it('键盘可见焦点与 reduced-motion 都有兜底', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('prefers-reduced-motion')
  })

  it('品牌印记用新的窗棂图形，不再是红底汉字方块', () => {
    const app = fs.readFileSync(path.join(root, 'src/renderer/hanchuang/HanchuangApp.tsx'), 'utf8')
    const sidebar = fs.readFileSync(path.join(root, 'src/renderer/hanchuang/Sidebar.tsx'), 'utf8')
    expect(app).toContain('BrandMark')
    expect(sidebar).toContain('BrandMark')
    expect(app).not.toContain('<text x="32" y="28"')
  })
})

describe('应用图标资产', () => {
  const ico = fs.readFileSync(path.join(root, 'build/icon.ico'))
  const png = fs.readFileSync(path.join(root, 'build/icon.png'))
  const winPng = fs.readFileSync(path.join(root, 'resources/icon.png'))

  it('ico 里带齐 16 到 256 的尺寸', () => {
    expect(ico.readUInt16LE(2)).toBe(1)
    const count = ico.readUInt16LE(4)
    const sizes: number[] = []
    for (let i = 0; i < count; i += 1) {
      const at = 6 + i * 16
      const raw = ico.readUInt8(at)
      sizes.push(raw === 0 ? 256 : raw)
    }
    for (const size of [16, 24, 32, 48, 64, 128, 256]) expect(sizes).toContain(size)
  })

  it('主图与窗口图都是真实 PNG，且尺寸够大', () => {
    for (const [file, min] of [[png, 512], [winPng, 256]] as const) {
      expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(file.readUInt32BE(16)).toBeGreaterThanOrEqual(min)
      expect(file.readUInt32BE(20)).toBe(file.readUInt32BE(16))
    }
  })

  it('16px 图标仍是「一扇亮着的窗」，而不是一块色块', async () => {
    // 上一版只留实心拱，16px 就是一个色块。这版要验三件事：暖色玻璃在、象牙窗框在、
    // 中间那根竖棂把亮面劈成了两扇窗。直接数像素，不看形状描述。
    const { loadImage, createCanvas } = await import('@napi-rs/canvas')
    const image = await loadImage(path.join(root, 'build/icons/icon-16.png'))
    expect(image.width).toBe(16)
    const canvas = createCanvas(16, 16)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, 16, 16)
    let warm = 0
    let ivory = 0
    for (let y = 2; y < 14; y += 1) {
      for (let x = 2; x < 14; x += 1) {
        const at = (y * 16 + x) * 4
        const [r, g, b, a] = [data[at], data[at + 1], data[at + 2], data[at + 3]]
        if (a > 200 && r > 170 && g > 100 && b < 160 && r - b > 60) warm += 1
        if (a > 200 && r > 225 && g > 215) ivory += 1
      }
    }
    expect(warm, '16px 没有可辨认的暖色玻璃').toBeGreaterThanOrEqual(45)
    expect(ivory, '16px 窗框不够亮，轮廓会糊').toBeGreaterThanOrEqual(14)

    // 竖棂：中间两列要有一串浅色像素，把玻璃分成左右两扇。
    let muntin = 0
    for (const x of [7, 8]) {
      for (let y = 3; y < 13; y += 1) {
        const at = (y * 16 + x) * 4
        const [r, g, b, a] = [data[at], data[at + 1], data[at + 2], data[at + 3]]
        if (a > 200 && r > 190 && g > 170 && b > 120) muntin += 1
      }
    }
    expect(muntin, '16px 看不出竖棂，窗就成了色块').toBeGreaterThanOrEqual(8)
  })
})
