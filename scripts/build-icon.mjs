// 「寒窗」应用图标 · 纸底墨字（v4）
// 参照用户桌面上的两枚图标重做：诗窗（深底 + 一个奶白汉字 + 一圈细内框）、
// DeepSeek Harness（近白底 + 一整块深色剪影）。共同语言是：两种颜色、一整块形、
// 大留白、没有细碎线条。
//
// 于是弃掉窗的图案，改成印章（白文印）：一张宣纸色的方块上，一枚墨绿的「寒」。
// 汉字本身就是那一扇窗——不需要再画窗框窗棂，也不会在三十二像素里糊成一团；
// 纸色方块在深色任务栏上又有实体感，不会像墨底那样只剩一枚浮着的字。
// 字形来自 Noto Serif SC（OFL），由 scripts/extract-brand-glyph.py 抽成路径，
// 与界面里的品牌印记共用同一份轮廓，不依赖运行环境装没装这枚字体。
//
// 改形状后重跑 `node scripts/build-icon.mjs`，再看 build/icons/preview.png。
// 产物：build/icon.ico（多尺寸）、build/icon.png（512）、resources/icon.png（256）、build/icons/*。
import { createCanvas, Path2D } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GLYPH = fs.readFileSync(path.join(root, 'assets', 'han-glyph.txt'), 'utf8').trim()
// 24px 以下换更厚的字重：细笔画在 16px 会散成一堆点，读不出是字
const GLYPH_BOLD = fs.readFileSync(path.join(root, 'assets', 'han-glyph-bold.txt'), 'utf8').trim()

// 纸：宣纸的奶白，上端略亮、下端略沉，像压过的一页纸
const PAPER_TOP = '#FCF7EA'
const PAPER_BOTTOM = '#EADFC5'
// 墨：不是纯黑，是偏绿的墨（和界面里的墨绿同一族）
const INK = '#16261F'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * 每个尺寸一套微调：小尺寸的字略微放大，保证 16px 里字还占得住画面。
 * 不画印章内框——参考的两枚图标（鲸鱼剪影、诗窗）都只靠一块形加大量留白，
 * 双框在圆角方块里会显得像贴纸。
 */
function geometry(s) {
  if (s >= 48) return { glyph: 1.0, small: false }
  if (s >= 32) return { glyph: 1.04, small: false }
  if (s >= 24) return { glyph: 1.1, small: true }
  return { glyph: 1.14, small: true }
}

function drawIcon(size) {
  const s = size
  const g = geometry(s)
  const radius = s * 0.225
  const canvas = createCanvas(s, s)
  const ctx = canvas.getContext('2d')

  // 1) 纸色方块
  const bg = ctx.createLinearGradient(0, 0, 0, s)
  bg.addColorStop(0, PAPER_TOP)
  bg.addColorStop(1, PAPER_BOTTOM)
  roundRect(ctx, 0, 0, s, s, radius)
  ctx.fillStyle = bg
  ctx.fill()

  if (s >= 48) {
    // 一道极淡的压边：让纸块在浅色桌面上也有轮廓，不靠投影
    const inset = Math.max(0.5, s * 0.004)
    ctx.strokeStyle = 'rgba(18, 32, 25, 0.13)'
    ctx.lineWidth = Math.max(1, s * 0.006)
    roundRect(ctx, inset, inset, s - inset * 2, s - inset * 2, radius - inset)
    ctx.stroke()
  }

  // 2) 字：一整块实心，不做描边、不加阴影
  const glyph = new Path2D(g.small ? GLYPH_BOLD : GLYPH)
  ctx.save()
  const k = (s / 1000) * g.glyph
  ctx.translate(s / 2, s / 2)
  ctx.scale(k, k)
  ctx.translate(-500, -500)
  ctx.fillStyle = INK
  ctx.fill(glyph)
  ctx.restore()

  return canvas
}

function buildIco(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt8(0, at + 2)
    header.writeUInt8(0, at + 3)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(data.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...pngs.map((p) => p.data)])
}

/** 预览：同一枚图标在浅/深底上按真实使用尺寸排开，核对小尺寸。 */
function drawPreview() {
  const sizes = [16, 24, 32, 48, 64, 128]
  const pad = 40
  const gap = 36
  const width = pad * 2 + sizes.reduce((sum, n) => sum + n, 0) + gap * (sizes.length - 1) + 200
  const height = 420
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const half = height / 2
  ctx.fillStyle = '#F3EFE4'
  ctx.fillRect(0, 0, width, half)
  ctx.fillStyle = '#171C1B'
  ctx.fillRect(0, half, width, half)
  for (const [row, dark] of [[0, false], [1, true]]) {
    let x = pad
    const baseY = row * half + half / 2
    for (const size of sizes) {
      ctx.drawImage(drawIcon(size), x, baseY - size / 2)
      ctx.fillStyle = dark ? '#9AA79F' : '#6C7A70'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`${size}px`, x + size / 2, baseY + 84)
      x += size + gap
    }
    ctx.drawImage(drawIcon(160), x + 20, baseY - 80)
  }
  return canvas
}

const SIZES = [256, 128, 64, 48, 32, 24, 16]
const pngs = SIZES.map((size) => ({ size, data: drawIcon(size).toBuffer('image/png') }))

fs.mkdirSync(path.join(root, 'build'), { recursive: true })
fs.mkdirSync(path.join(root, 'resources'), { recursive: true })
fs.writeFileSync(path.join(root, 'build', 'icon.png'), drawIcon(512).toBuffer('image/png'))
fs.writeFileSync(path.join(root, 'resources', 'icon.png'), drawIcon(256).toBuffer('image/png'))
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), buildIco(pngs))
fs.mkdirSync(path.join(root, 'build', 'icons'), { recursive: true })
for (const { size, data } of pngs) fs.writeFileSync(path.join(root, 'build', 'icons', `icon-${size}.png`), data)
fs.writeFileSync(path.join(root, 'build', 'icons', 'preview.png'), drawPreview().toBuffer('image/png'))

console.log('icon written:', {
  icoEntries: SIZES.join('/'),
  icoBytes: fs.statSync(path.join(root, 'build/icon.ico')).size,
})
