import { useId } from 'react'

/**
 * 品牌印记：和应用图标同一枚图形——墨绿夜色里的一扇拱窗，左下那格点着灯。
 * 用 SVG 而不是图片，左栏 34px、欢迎页 60px 都清晰，夜间模式也不需要另存一张图。
 */
export function BrandMark({ className = 'hc-seal' }: { className?: string }) {
  const uid = useId().replace(/:/g, '')
  const night = `hc-night-${uid}`
  const lamp = `hc-lamp-${uid}`
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="寒窗">
      <defs>
        <linearGradient id={night} x1="0.12" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#1D4A3E" />
          <stop offset="52%" stopColor="#123329" />
          <stop offset="100%" stopColor="#081C17" />
        </linearGradient>
        <linearGradient id={lamp} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD98A" />
          <stop offset="100%" stopColor="#E07E2B" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14.4" fill={`url(#${night})`} />
      <rect x="2.2" y="2.2" width="59.6" height="59.6" rx="12.4" fill="none" stroke="#C9A227" strokeOpacity="0.28" strokeWidth="0.8" />
      {/* 玻璃 */}
      <path d="M15 51 V29 A17 17 0 0 1 49 29 V51 Z" fill="#061512" />
      {/* 左下亮着的那一格 */}
      <path d="M17.3 37.6 H29.7 V48.7 H17.3 Z" fill={`url(#${lamp})`} />
      <path d="M23.5 40.2 C25.6 43 25.2 46.4 23.5 47.4 C21.8 46.4 21.4 43 23.5 40.2 Z" fill="#FFF6DC" />
      {/* 窗框与窗棂 */}
      <g fill="none" stroke="#F6F0DC" strokeWidth="4.6" strokeLinejoin="round">
        <path d="M15 51 V29 A17 17 0 0 1 49 29 V51 Z" />
        <path d="M32 12.6 V51" />
        <path d="M15 36.8 H49" />
      </g>
      {/* 窗台 */}
      <rect x="10.4" y="52.4" width="43.2" height="4.4" rx="1.8" fill="#E4DABA" />
      <rect x="13" y="53.6" width="38" height="0.9" rx="0.45" fill="#C9A227" fillOpacity="0.45" />
    </svg>
  )
}
