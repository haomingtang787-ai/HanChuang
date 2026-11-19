// 「寒窗」应用图标 · 夜窗
// 一个想法：夜里那扇亮着的拱窗。奶白拱体本身就是光，底部被屋里的灯烘出
// 一抹暖——没有窗棂、没有蜡烛、没有窗台，越少越贵。
// 大尺寸(≥48)有光晕与内部光；小尺寸走同一几何的实心版，16px 也认得出。
// 改形状后重跑 `node scripts/build-icon.mjs`，肉眼核对 build/icons/preview.png。
// 产物：build/icon.ico（多尺寸）、build/icon.png（512）、resources/icon.png（256）、build/icons/*。
import { createCanvas } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 夜色：更深更灰一档的墨绿，纵向渐变给出纵深，比斜向更安静
const NIGHT_TOP = '#2F5548'
const NIGHT = '#1A3A30'
const NIGHT_DEEP = '#0D211B'
// 拱体：象牙白，底部暖
const IVORY_TOP = '#F6F1DD'
const IVORY_MID = '#F2E5C2'
const WARM = '#E2AC66'

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

function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const s = size
  const detail = s >= 48

  // 1) 夜色底：纵向渐变（上微亮、下压深），squircle 圆角与平台一致
  const bg = ctx.createLinearGradient(0, 0, 0, s)
  bg.addColorStop(0, NIGHT_TOP)
  bg.addColorStop(0.58, NIGHT)
  bg.addColorStop(1, NIGHT_DEEP)
  roundRect(ctx, 0, 0, s, s, s * 0.225)
  ctx.fillStyle = bg
  ctx.fill()

  // 2) 拱窗几何：大尺寸留足呼吸；小尺寸放大窗体、压低窗脚
  const left = s * (detail ? 0.26 : 0.19)
  const right = s * (detail ? 0.74 : 0.81)
  const springY = s * (detail ? 0.40 : 0.42)
  const sillY = s * (detail ? 0.72 : 0.79)
  const cx = (left + right) / 2

  // 3) 大尺寸：拱后一圈极淡的暖光晕，像光透出来落在夜墙上
  if (detail) {
    const halo = ctx.createRadialGradient(cx, sillY - s * 0.04, s * 0.06, cx, sillY - s * 0.04, s * 0.5)
    halo.addColorStop(0, 'rgba(240, 177, 96, 0.16)')
    halo.addColorStop(1, 'rgba(240, 177, 96, 0)')
    ctx.fillStyle = halo
    roundRect(ctx, 0, 0, s, s, s * 0.225)
    ctx.fill()
  }

  // 4) 拱体：象牙白实心，自下而上被屋里的灯烘暖
  const body = ctx.createLinearGradient(0, springY - (right - left) / 2, 0, sillY)
  body.addColorStop(0, IVORY_TOP)
  body.addColorStop(detail ? 0.55 : 0.55, IVORY_MID)
  body.addColorStop(1, WARM)
  archPath(ctx, left, right, springY, sillY)
  ctx.fillStyle = body
  ctx.fill()

  // 5) 大尺寸：拱内底部一团柔光（光从屋里来），只留这一处细节
  if (detail) {
    ctx.save()
    archPath(ctx, left, right, springY, sillY)
    ctx.clip()
    const bloom = ctx.createRadialGradient(cx, sillY - (sillY - springY) * 0.08, s * 0.02, cx, sillY - (sillY - springY) * 0.08, (right - left) * 0.72)
    bloom.addColorStop(0, 'rgba(255, 224, 160, 0.55)')
    bloom.addColorStop(0.5, 'rgba(240, 177, 96, 0.22)')
    bloom.addColorStop(1, 'rgba(240, 177, 96, 0)')
    ctx.fillStyle = bloom
    ctx.fillRect(left, springY - (right - left) / 2, right - left, sillY - springY + (right - left) / 2)
    ctx.restore()
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
