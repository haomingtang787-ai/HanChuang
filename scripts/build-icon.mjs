// 「寒窗」应用图标 · 夜窗（v2）
// 上一版只留一块实心拱，缩到 16px 就是一个色块，也读不出「窗」。这一版按
// 苹果 2025 的图标语言重做：分层（夜墙 / 亮着的窗 / 窗台）、光从屋里透出来、
// 圆角粗线代替细描边。构件只剩四样——拱、窗棂、窗台、暖光，每一样都在
// 小尺寸里承担识别：拱给轮廓，窗棂把色块劈成两扇窗，窗台把「窗」和「碑」分开。
// 改形状后重跑 `node scripts/build-icon.mjs`，再看 build/icons/preview.png。
// 产物：build/icon.ico（多尺寸）、build/icon.png（512）、resources/icon.png（256）、build/icons/*。
import { createCanvas } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 夜色：上端略透、底部压深；一层很淡的顶光让它像玻璃而不是油漆
const NIGHT_TOP = '#22453A'
const NIGHT = '#122E25'
const NIGHT_DEEP = '#06130E'
// 窗框与窗台：象牙白，越往下越沉一点，避免整块发亮
const FRAME_TOP = '#F8F2E0'
const FRAME_BOTTOM = '#E3D3AE'
// 玻璃里的光：上端奶油，中段琥珀，底部是屋里的暖橙——和象牙框拉开明度差，窗户才立得住
const GLASS_TOP = '#F7DEAC'
const GLASS_MID = '#EDB56A'
const GLASS_BOTTOM = '#C9803A'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 拱窗：上半是半圆（拱），下半直边，落在 sillY。 */
function archPath(ctx, left, right, springY, sillY) {
  const cx = (left + right) / 2
  const radius = (right - left) / 2
  ctx.beginPath()
  ctx.moveTo(left, sillY)
  ctx.lineTo(left, springY)
  ctx.arc(cx, springY, radius, Math.PI, 0)
  ctx.lineTo(right, sillY)
  ctx.closePath()
}

/**
 * 每个尺寸一套几何。窗要接近正方形：太瘦就是一块碑，太宽就不像拱窗。
 * 小尺寸不是等比缩小：窗体放大、线加粗，保证 16px 里窗棂两侧各留下 3px 以上的亮面。
 */
function geometry(s) {
  if (s >= 64) {
    return { l: 0.252, r: 0.748, sy: 0.505, sl: 0.740, t: 0.046, m: 0.042, sill: 0.032, over: 0.028, detail: true, transom: true }
  }
  if (s >= 48) {
    return { l: 0.238, r: 0.762, sy: 0.505, sl: 0.752, t: 0.054, m: 0.05, sill: 0.038, over: 0.03, detail: true, transom: false }
  }
  if (s >= 24) {
    return { l: 0.160, r: 0.840, sy: 0.500, sl: 0.775, t: 0.070, m: 0.068, sill: 0.052, over: 0.038, detail: false, transom: false }
  }
  return { l: 0.130, r: 0.870, sy: 0.490, sl: 0.780, t: 0.082, m: 0.082, sill: 0.068, over: 0.044, detail: false, transom: false }
}

function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const s = size
  const g = geometry(s)
  const radius = s * 0.225
  const left = s * g.l
  const right = s * g.r
  const springY = s * g.sy
  const sillY = s * g.sl
  const frame = s * g.t
  const cx = (left + right) / 2

  // 1) 夜色底：纵向渐变 + 四角压暗 + 顶部一层很淡的反光（玻璃感）
  const bg = ctx.createLinearGradient(0, 0, 0, s)
  bg.addColorStop(0, NIGHT_TOP)
  bg.addColorStop(0.55, NIGHT)
  bg.addColorStop(1, NIGHT_DEEP)
  roundRect(ctx, 0, 0, s, s, radius)
  ctx.fillStyle = bg
  ctx.fill()

  ctx.save()
  roundRect(ctx, 0, 0, s, s, radius)
  ctx.clip()
  if (g.detail) {
    const vignette = ctx.createRadialGradient(cx, s * 0.5, s * 0.2, cx, s * 0.5, s * 0.78)
    vignette.addColorStop(0, 'rgba(6, 16, 13, 0)')
    vignette.addColorStop(1, 'rgba(6, 16, 13, 0.34)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, s, s)
  }
  const sheen = ctx.createLinearGradient(0, 0, 0, s * 0.42)
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.09)')
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, s, s * 0.42)
  ctx.restore()

  // 2) 光：窗后一圈暖光，贴着窗脚落在夜墙上（只在大尺寸出现）
  if (g.detail) {
    ctx.save()
    roundRect(ctx, 0, 0, s, s, radius)
    ctx.clip()
    const halo = ctx.createRadialGradient(cx, sillY - s * 0.05, s * 0.05, cx, sillY - s * 0.05, s * 0.42)
    halo.addColorStop(0, 'rgba(244, 186, 106, 0.15)')
    halo.addColorStop(0.55, 'rgba(238, 170, 88, 0.06)')
    halo.addColorStop(1, 'rgba(238, 170, 88, 0)')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, s, s)
    ctx.restore()
  }

  // 3) 窗框：粗一圈象牙白。先带一层内阴影落到夜墙上，窗才像嵌进墙里而不是贴上去。
  const frameGradient = ctx.createLinearGradient(0, springY - (right - left) / 2, 0, sillY)
  frameGradient.addColorStop(0, FRAME_TOP)
  frameGradient.addColorStop(1, FRAME_BOTTOM)
  ctx.save()
  if (g.detail) {
    ctx.shadowColor = 'rgba(3, 10, 7, 0.34)'
    ctx.shadowBlur = s * 0.05
  }
  archPath(ctx, left, right, springY, sillY)
  ctx.fillStyle = frameGradient
  ctx.fill()
  ctx.restore()

  // 4) 玻璃：屋里透出来的暖光，底亮顶柔
  const glassLeft = left + frame
  const glassRight = right - frame
  const glassTop = springY - (right - left) / 2 + frame
  archPath(ctx, glassLeft, glassRight, springY, sillY)
  const glass = ctx.createLinearGradient(0, springY - (glassRight - glassLeft) / 2, 0, sillY)
  glass.addColorStop(0, GLASS_TOP)
  glass.addColorStop(0.52, GLASS_MID)
  glass.addColorStop(1, GLASS_BOTTOM)
  ctx.fillStyle = glass
  ctx.fill()

  if (g.detail) {
    // 玻璃顶部一道极淡的内反光，让窗"有厚度"
    ctx.save()
    archPath(ctx, glassLeft, glassRight, springY, sillY)
    ctx.clip()
    const inner = ctx.createRadialGradient(cx, springY - (glassRight - glassLeft) * 0.1, s * 0.02, cx, springY - (glassRight - glassLeft) * 0.1, (glassRight - glassLeft) * 0.9)
    inner.addColorStop(0, 'rgba(255, 252, 240, 0.3)')
    inner.addColorStop(0.6, 'rgba(255, 245, 220, 0)')
    ctx.fillStyle = inner
    ctx.fillRect(glassLeft, springY - (glassRight - glassLeft) / 2, glassRight - glassLeft, sillY)
    // 底部屋里的灯光汇聚处
    const bloom = ctx.createRadialGradient(cx, sillY - s * 0.02, s * 0.015, cx, sillY - s * 0.02, (glassRight - glassLeft) * 0.6)
    bloom.addColorStop(0, 'rgba(255, 224, 158, 0.34)')
    bloom.addColorStop(0.5, 'rgba(244, 183, 101, 0.12)')
    bloom.addColorStop(1, 'rgba(244, 183, 101, 0)')
    ctx.fillStyle = bloom
    ctx.fillRect(cx - (glassRight - glassLeft) * 0.8, sillY - s * 0.12, (glassRight - glassLeft) * 1.6, s * 0.14)
    // 斜向的明暗：玻璃不是均质发光，左上略亮、右下略沉，才有玻璃的厚度
    const slant = ctx.createLinearGradient(glassLeft, glassTop, glassRight, sillY)
    slant.addColorStop(0, 'rgba(255, 250, 232, 0.2)')
    slant.addColorStop(0.45, 'rgba(255, 250, 232, 0)')
    slant.addColorStop(1, 'rgba(92, 44, 10, 0.1)')
    ctx.fillStyle = slant
    ctx.fillRect(glassLeft, glassTop, glassRight - glassLeft, sillY - glassTop)
    ctx.restore()
  }

  // 5) 窗棂：一根竖向立柱，把整块亮面劈成两扇窗（没有它就是一块碑）
  const muntin = s * g.m
  const muntinX = cx - muntin / 2
  ctx.fillStyle = frameGradient
  ctx.fillRect(muntinX, glassTop, muntin, sillY - glassTop)

  // 横档：只在够大的尺寸出现，把上面两个拱瓣和下面两块窗格分开
  if (g.transom) {
    ctx.fillRect(glassLeft, springY - frame * 0.45, glassRight - glassLeft, frame * 0.9)
  }

  // 6) 窗台：比窗宽出一指的横条，压住窗脚，把「窗」坐实在墙上
  const sillTop = sillY
  const sillHeight = s * g.sill
  const sillLeft = left - s * g.over
  const sillWidth = right - left + s * g.over * 2
  roundRect(ctx, sillLeft, sillTop, sillWidth, sillHeight, Math.min(sillHeight * 0.34, s * 0.014))
  const sillGradient = ctx.createLinearGradient(0, sillTop, 0, sillTop + sillHeight)
  sillGradient.addColorStop(0, FRAME_TOP)
  sillGradient.addColorStop(1, FRAME_BOTTOM)
  ctx.fillStyle = sillGradient
  ctx.fill()

  // 窗台与窗框之间一道黄铜色的凹槽：老木窗上的那条线，是这枚图标唯一的工艺细节
  if (g.detail) {
    ctx.fillStyle = 'rgba(146, 104, 44, 0.34)'
    ctx.fillRect(sillLeft + sillWidth * 0.02, sillTop - s * 0.006, sillWidth * 0.96, s * 0.008)
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
