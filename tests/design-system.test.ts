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

  it('品牌印记用应用图标同一枚字形，不再是手画的窗', () => {
    const app = fs.readFileSync(path.join(root, 'src/renderer/hanchuang/HanchuangApp.tsx'), 'utf8')
    const sidebar = fs.readFileSync(path.join(root, 'src/renderer/hanchuang/Sidebar.tsx'), 'utf8')
    const mark = fs.readFileSync(path.join(root, 'src/renderer/hanchuang/BrandMark.tsx'), 'utf8')
    const glyph = fs.readFileSync(path.join(root, 'src/renderer/hanchuang/hanGlyph.ts'), 'utf8')
    expect(app).toContain('BrandMark')
    expect(sidebar).toContain('BrandMark')
    expect(app).not.toContain('<text x="32" y="28"')
    // 印记必须走字形路径，不能在组件里重新画一套几何
    expect(mark).toContain('HAN_GLYPH')
    expect(mark).not.toContain('M16.13 47.36')
    expect(glyph).toContain('export const HAN_GLYPH')
    expect(glyph.length).toBeGreaterThan(2000)
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

  it('16px 图标仍是「一枚墨字盖在纸上」，而不是一块色块', async () => {
    // 这一版是纸底印章：整块纸色 + 一个米字形的墨迹。16px 要验三件事：
    // 纸底够满（方块立得住）、墨迹有量（字没散掉）、墨迹落在中间（不是边缘脏点）。
    const { loadImage, createCanvas } = await import('@napi-rs/canvas')
    const image = await loadImage(path.join(root, 'build/icons/icon-16.png'))
    expect(image.width).toBe(16)
    const canvas = createCanvas(16, 16)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, 16, 16)
    let paper = 0
    let ink = 0
    let inkMid = 0
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const at = (y * 16 + x) * 4
        const [r, g, b, a] = [data[at], data[at + 1], data[at + 2], data[at + 3]]
        if (a < 200) continue
        if (r > 220 && g > 205 && b > 175) paper += 1
        else if (r < 160 && g < 170) {
          ink += 1
          if (x >= 5 && x <= 10 && y >= 4 && y <= 11) inkMid += 1
        }
      }
    }
    expect(paper, '16px 纸底不够满，方块立不住').toBeGreaterThanOrEqual(120)
    expect(ink, '16px 墨迹太少，字会散成脏点').toBeGreaterThanOrEqual(24)
    expect(inkMid, '16px 墨迹不在中央，字偏了').toBeGreaterThanOrEqual(20)
  })
})
