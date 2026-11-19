import { useId } from 'react'

/**
 * 品牌印记：和应用图标同一枚图形——夜里那扇亮着的拱窗。
 * 与 scripts/build-icon.mjs 的几何一一对应：象牙窗框、暖色玻璃、一根竖向窗棂、
 * 窗台压住窗脚。用 SVG 而不是图片，左栏 34px、欢迎页 60px 都清晰，夜间模式也不用另存一张图。
 */
export function BrandMark({ className = 'hc-seal' }: { className?: string }) {
  const uid = useId().replace(/:/g, '')
  const night = `hc-night-${uid}`
  const frame = `hc-frame-${uid}`
  const glass = `hc-glass-${uid}`
  const bloom = `hc-bloom-${uid}`
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="寒窗">
      <defs>
        <linearGradient id={night} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22453A" />
          <stop offset="55%" stopColor="#122E25" />
          <stop offset="100%" stopColor="#06130E" />
        </linearGradient>
        <linearGradient id={frame} x1="0" y1="19.39" x2="0" y2="47.36">
          <stop offset="0%" stopColor="#F8F2E0" />
          <stop offset="100%" stopColor="#E3D3AE" />
        </linearGradient>
        <linearGradient id={glass} x1="0" y1="19.39" x2="0" y2="47.36">
          <stop offset="0%" stopColor="#F7DEAC" />
          <stop offset="52%" stopColor="#EDB56A" />
          <stop offset="100%" stopColor="#C9803A" />
        </linearGradient>
        <radialGradient id={bloom} cx="0.5" cy="0.94" r="0.52">
          <stop offset="0%" stopColor="rgba(255, 224, 158, 0.34)" />
          <stop offset="55%" stopColor="rgba(244, 183, 101, 0.12)" />
          <stop offset="100%" stopColor="rgba(244, 183, 101, 0)" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14.4" fill={`url(#${night})`} />
      {/* 窗框 */}
      <path d="M16.13 47.36 V32.32 A15.87 15.87 0 0 1 47.87 32.32 V47.36 Z" fill={`url(#${frame})`} />
      {/* 玻璃：屋里透出来的暖光 */}
      <path d="M19.07 47.36 V32.32 A12.93 12.93 0 0 1 44.93 32.32 V47.36 Z" fill={`url(#${glass})`} />
      <path d="M19.07 47.36 V32.32 A12.93 12.93 0 0 1 44.93 32.32 V47.36 Z" fill={`url(#${bloom})`} />
      {/* 竖窗棂与横档 */}
      <rect x="30.656" y="19.39" width="2.688" height="27.97" fill={`url(#${frame})`} />
      <rect x="19.07" y="30.995" width="25.86" height="2.65" fill={`url(#${frame})`} />
      {/* 窗台 */}
      <rect x="14.34" y="47.36" width="35.32" height="2.048" rx="0.696" fill={`url(#${frame})`} />
      <rect x="15.05" y="46.98" width="33.9" height="0.512" fill="rgba(146, 104, 44, 0.34)" />
    </svg>
  )
}
