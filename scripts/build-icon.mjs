// 生成「寒窗」应用图标：深墨绿圆角底 + 奶白窗棂 + 左下格暖灯。
// 逐尺寸按几何比例直接绘制（不是缩放大图），16px 下窗棂仍是实心 1px 线。
// 改配色/形状后重跑 `node scripts/build-icon.mjs` 即可；产物：build/icon.ico（多尺寸）、build/icon.png（512）、resources/icon.png（256）。
import { createCanvas } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const INK_DARK = '#0A211D'
const INK = '#13322A'
const INK_LIGHT = '#20564A'
const CREAM = '#F5EFD8'
const AMBER = '#F8B44C'
const AMBER_DEEP = '#DE7F2E'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const s = size

  // 底：圆角方块，中心偏上一点暖亮，暗角收边
  const bg = ctx.createRadialGradient(s * 0.5, s * 0.42, s * 0.06, s * 0.5, s * 0.5, s * 0.78)
  bg.addColorStop(0, INK_LIGHT)
  bg.addColorStop(0.55, INK)
  bg.addColorStop(1, INK_DARK)
  roundRect(ctx, 0, 0, s, s, s * 0.19)
  ctx.fillStyle = bg
  ctx.fill()

  const frameX = s * 0.185
  const frameY = s * 0.145
  const frameW = s * 0.63
  const frameH = s * 0.70
  const stroke = Math.max(1.3, s * 0.055)
  const radius = Math.max(1.2, s * 0.05)

  // 玻璃（四格暗底），让窗框有"里面"的感觉
  const glassX = frameX + stroke / 2
  const glassY = frameY + stroke / 2
  const glassW = frameW - stroke
  const glassH = frameH - stroke
  if (s >= 48) {
    roundRect(ctx, glassX, glassY, glassW, glassH, Math.max(1, radius - stroke / 3))
    ctx.fillStyle = 'rgba(4, 16, 13, 0.85)'
    ctx.fill()
  }

  // 左下格：暖灯（大尺寸带光晕，小尺寸只留纯色块，缩到 16px 也认得出）
  const inset = Math.max(1, s * 0.008)
  const paneX = frameX + frameW / 2 + stroke / 2 + inset
  const paneY = frameY + stroke / 2 + inset
  const paneW = frameW / 2 - stroke / 2 - inset
  const paneH = frameH / 2 - stroke / 2 - inset
  // 左下格 = 左半 + 下半
  const litX = frameX + stroke / 2 + inset
  const litY = frameY + frameH / 2 + stroke / 2 + inset
  const litW = paneW
  const litH = paneH
  void paneX
  void paneY

  if (s >= 48) {
    // 暗玻璃 + 从底部升起的暖光，像窗里点着一盏灯
    roundRect(ctx, litX, litY, litW, litH, Math.max(1, radius - stroke / 3))
    ctx.fillStyle = 'rgba(4, 16, 13, 0.92)'
    ctx.fill()
    const glowCx = litX + litW / 2
    const glowCy = litY + litH * 0.78
    const glow = ctx.createRadialGradient(glowCx, glowCy, litW * 0.02, glowCx, glowCy, litW * 0.95)
    glow.addColorStop(0, 'rgba(255, 214, 130, 0.95)')
    glow.addColorStop(0.45, 'rgba(248, 180, 76, 0.55)')
    glow.addColorStop(1, 'rgba(248, 180, 76, 0)')
    ctx.fillStyle = glow
    ctx.fill()
    // 灯芯
    const fx = glowCx
    const baseY = litY + litH * 0.82
    const topY = litY + litH * 0.26
    const half = litW * 0.15
    ctx.beginPath()
    ctx.moveTo(fx, topY)
    ctx.bezierCurveTo(fx + half * 1.3, topY + (baseY - topY) * 0.45, fx + half, baseY, fx, baseY)
    ctx.bezierCurveTo(fx - half, baseY, fx - half * 1.3, topY + (baseY - topY) * 0.45, fx, topY)
    ctx.closePath()
    const core = ctx.createLinearGradient(fx, topY, fx, baseY)
    core.addColorStop(0, '#FFFDF2')
    core.addColorStop(0.55, '#FFE9AE')
    core.addColorStop(1, '#F7B54C')
    ctx.fillStyle = core
    ctx.fill()
  } else {
    roundRect(ctx, litX, litY, litW, litH, 1)
    ctx.fillStyle = AMBER
    ctx.fill()
  }

  // 窗框（奶白）
  roundRect(ctx, frameX, frameY, frameW, frameH, radius)
  ctx.lineWidth = stroke
  ctx.strokeStyle = CREAM
  ctx.stroke()

  // 十字窗棂
  const cx = frameX + frameW / 2
  const cy = frameY + frameH / 2
  ctx.lineWidth = stroke
  ctx.strokeStyle = CREAM
  ctx.beginPath()
  ctx.moveTo(cx, frameY + stroke * 0.15)
  ctx.lineTo(cx, frameY + frameH - stroke * 0.15)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(frameX + stroke * 0.15, cy)
  ctx.lineTo(frameX + frameW - stroke * 0.15, cy)
  ctx.stroke()

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

const SIZES = [256, 128, 64, 48, 32, 24, 16]
const pngs = SIZES.map((size) => ({ size, data: drawIcon(size).toBuffer('image/png') }))

fs.mkdirSync(path.join(root, 'build'), { recursive: true })
fs.mkdirSync(path.join(root, 'resources'), { recursive: true })
fs.writeFileSync(path.join(root, 'build', 'icon.png'), drawIcon(512).toBuffer('image/png'))
fs.writeFileSync(path.join(root, 'resources', 'icon.png'), drawIcon(256).toBuffer('image/png'))
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), buildIco(pngs))
// 分尺寸 PNG 留作预览/核对（不参与打包）
fs.mkdirSync(path.join(root, 'build', 'icons'), { recursive: true })
for (const { size, data } of pngs) fs.writeFileSync(path.join(root, 'build', 'icons', `icon-${size}.png`), data)

console.log('icon written:', {
  icoEntries: SIZES.join('/'),
  icoBytes: fs.statSync(path.join(root, 'build/icon.ico')).size,
})

