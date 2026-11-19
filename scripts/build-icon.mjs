// 生成「寒窗」应用图标：墨绿夜色里的一扇拱窗，左下那格点着灯。
// 逐尺寸按几何比例直接绘制（不是缩放大图）：大尺寸有玻璃、光晕与灯芯，
// 16/24px 只保留粗窗框 + 实心暖格，保证任务栏里一眼认得出。
// 改配色/形状后重跑 `node scripts/build-icon.mjs`。
// 产物：build/icon.ico（多尺寸）、build/icon.png（512）、resources/icon.png（256）、build/icons/*（预览）。
import { createCanvas } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const NIGHT_TOP = '#1D4A3E'
const NIGHT = '#123329'
const NIGHT_DEEP = '#081C17'
const GLASS = '#061512'
const CREAM = '#F6F0DC'
const CREAM_SHADE = '#E4DABA'
const AMBER = '#F7B24C'
const AMBER_DEEP = '#E07E2B'
const BRASS = '#C9A227'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 拱窗轮廓：上半是半圆，下半是直边，底边落在 sillY。 */
function archPath(ctx, left, right, top, springY, sillY) {
  const cx = (left + right) / 2
  const radius = (right - left) / 2
  ctx.beginPath()
  ctx.moveTo(left, sillY)
  ctx.lineTo(left, springY)
  ctx.arc(cx, springY, radius, Math.PI, 0)
  ctx.lineTo(right, sillY)
  ctx.closePath()
  void top
}

function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const s = size
  const tiny = s < 32
  const detail = s >= 48

  // 夜色底：左上偏亮、右下压深，像窗外月光斜进来
  const bg = ctx.createLinearGradient(s * 0.15, 0, s * 0.9, s)
  bg.addColorStop(0, NIGHT_TOP)
  bg.addColorStop(0.52, NIGHT)
  bg.addColorStop(1, NIGHT_DEEP)
  roundRect(ctx, 0, 0, s, s, s * 0.225)
  ctx.fillStyle = bg
  ctx.fill()

  // 大尺寸加一圈极细黄铜内边，收住圆角边界
  if (detail) {
    const inset = s * 0.035
    roundRect(ctx, inset, inset, s - inset * 2, s - inset * 2, s * 0.225 - inset)
    ctx.lineWidth = Math.max(1, s * 0.006)
    ctx.strokeStyle = 'rgba(201, 162, 39, 0.28)'
    ctx.stroke()
  }

  const stroke = s * (tiny ? 0.075 : 0.072)
  const left = s * (tiny ? 0.15 : 0.235) + stroke / 2
  const right = s * (tiny ? 0.85 : 0.765) - stroke / 2
  const sillY = s * (tiny ? 0.87 : 0.815) - stroke / 2
  const springY = s * (tiny ? 0.45 : 0.455)
  const cx = (left + right) / 2
  const transomY = s * (tiny ? 0.6 : 0.575)

  // 玻璃：先铺一整块暗底，让窗有"里面"
  archPath(ctx, left, right, springY - (right - left) / 2, springY, sillY)
  ctx.fillStyle = GLASS
  ctx.fill()

  // 左下那一格：夜里唯一亮着的灯。
  // 16/24px 放不下四格，改成左右两扇、左边整扇亮着，暖色块才有足够面积被认出来。
  const litLeft = left + stroke / 2
  const litRight = cx - stroke / 2
  const litTop = (tiny ? springY : transomY) + stroke / 2
  const litBottom = sillY - stroke / 2
  ctx.save()
  if (tiny) {
    archPath(ctx, left, right, springY - (right - left) / 2, springY, sillY)
    ctx.clip()
    ctx.beginPath()
    ctx.rect(litLeft, litTop, litRight - litLeft, litBottom - litTop)
    ctx.clip()
  } else {
    ctx.beginPath()
    ctx.rect(litLeft, litTop, litRight - litLeft, litBottom - litTop)
    ctx.clip()
  }
  if (detail) {
    ctx.fillStyle = GLASS
    ctx.fillRect(litLeft, litTop, litRight - litLeft, litBottom - litTop)
    const glowX = (litLeft + litRight) / 2
    const glowY = litBottom - (litBottom - litTop) * 0.16
    const glow = ctx.createRadialGradient(glowX, glowY, s * 0.004, glowX, glowY, (litRight - litLeft) * 1.25)
    glow.addColorStop(0, 'rgba(255, 226, 158, 0.98)')
    glow.addColorStop(0.4, 'rgba(247, 178, 76, 0.62)')
    glow.addColorStop(1, 'rgba(224, 126, 43, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(litLeft, litTop, litRight - litLeft, litBottom - litTop)
    // 灯芯：一枚安静的火苗
    const baseY = litBottom - (litBottom - litTop) * 0.14
    const topY = litTop + (litBottom - litTop) * 0.2
    const half = (litRight - litLeft) * 0.17
    ctx.beginPath()
    ctx.moveTo(glowX, topY)
    ctx.bezierCurveTo(glowX + half * 1.35, topY + (baseY - topY) * 0.46, glowX + half, baseY, glowX, baseY)
    ctx.bezierCurveTo(glowX - half, baseY, glowX - half * 1.35, topY + (baseY - topY) * 0.46, glowX, topY)
    ctx.closePath()
    const core = ctx.createLinearGradient(glowX, topY, glowX, baseY)
    core.addColorStop(0, '#FFFDF3')
    core.addColorStop(0.5, '#FFE7A8')
    core.addColorStop(1, AMBER)
    ctx.fillStyle = core
    ctx.fill()
  } else {
    // 小尺寸：整格实心暖色，缩到 16px 也不会糊成一团
    const flat = ctx.createLinearGradient(litLeft, litTop, litRight, litBottom)
    flat.addColorStop(0, AMBER)
    flat.addColorStop(1, AMBER_DEEP)
    ctx.fillStyle = flat
    ctx.fillRect(litLeft, litTop, litRight - litLeft, litBottom - litTop)
  }
  ctx.restore()

  // 窗框：奶白，底部略压暗一点，像被灯照过的木头
  const framePaint = ctx.createLinearGradient(0, springY - (right - left) / 2, 0, sillY)
  framePaint.addColorStop(0, CREAM)
  framePaint.addColorStop(1, detail ? CREAM_SHADE : CREAM)
  ctx.strokeStyle = framePaint
  ctx.lineWidth = stroke
  ctx.lineJoin = 'round'
  archPath(ctx, left, right, springY - (right - left) / 2, springY, sillY)
  ctx.stroke()

  // 窗棂：竖到拱顶；横档只在放得下的尺寸出现
  ctx.beginPath()
  ctx.moveTo(cx, springY - (right - left) / 2 + stroke * 0.2)
  ctx.lineTo(cx, sillY)
  if (!tiny) {
    ctx.moveTo(left, transomY)
    ctx.lineTo(right, transomY)
  }
  ctx.stroke()

  // 窗台：比窗身略宽的一道横板，给图形一个落脚
  const sillOverhang = s * (tiny ? 0.03 : 0.045)
  const sillH = stroke * (tiny ? 1.05 : 0.92)
  roundRect(ctx, left - stroke / 2 - sillOverhang, sillY + stroke * 0.1, right - left + stroke + sillOverhang * 2, sillH, sillH * 0.4)
  ctx.fillStyle = detail ? CREAM_SHADE : CREAM
  ctx.fill()
  if (detail) {
    // 窗台上的一线黄铜反光
    ctx.beginPath()
    ctx.moveTo(left - stroke / 2 - sillOverhang + sillH, sillY + stroke * 0.1 + sillH * 0.32)
    ctx.lineTo(right + stroke / 2 + sillOverhang - sillH, sillY + stroke * 0.1 + sillH * 0.32)
    ctx.lineWidth = Math.max(1, s * 0.005)
    ctx.strokeStyle = 'rgba(201, 162, 39, 0.45)'
    ctx.stroke()
    void BRASS
  }

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

/** 预览：同一枚图标在浅色/深色底上按真实使用尺寸排开，方便肉眼核对小尺寸。 */
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
