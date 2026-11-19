import { useId } from 'react'

/**
 * 品牌印记：和应用图标同一枚图形——夜里那扇亮着的拱窗。
 * 奶白拱体是光本身，底部被屋里的灯烘暖；没有窗棂、蜡烛与窗台。
 * 用 SVG 而不是图片，左栏 34px、欢迎页 60px 都清晰，夜间模式也不需要另存一张图。
 */
export function BrandMark({ className = 'hc-seal' }: { className?: string }) {
  const uid = useId().replace(/:/g, '')
  const night = `hc-night-${uid}`
  const ivory = `hc-ivory-${uid}`
  const bloom = `hc-bloom-${uid}`
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="寒窗">
      <defs>
        <linearGradient id={night} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2F5548" />
          <stop offset="58%" stopColor="#1A3A30" />
          <stop offset="100%" stopColor="#0D211B" />
        </linearGradient>
        <linearGradient id={ivory} x1="0" y1="0.16" x2="0" y2="0.72">
          <stop offset="0%" stopColor="#F6F1DD" />
          <stop offset="55%" stopColor="#F2E5C2" />
          <stop offset="100%" stopColor="#E2AC66" />
        </linearGradient>
        <radialGradient id={bloom} cx="0.5" cy="0.86" r="0.55">
          <stop offset="0%" stopColor="rgba(255, 224, 160, 0.5)" />
          <stop offset="60%" stopColor="rgba(240, 177, 96, 0.16)" />
          <stop offset="100%" stopColor="rgba(240, 177, 96, 0)" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14.4" fill={`url(#${night})`} />
      <path d="M16.6 46 V25.6 A15.4 15.4 0 0 1 47.4 25.6 V46 Z" fill={`url(#${ivory})`} />
      <path d="M16.6 46 V25.6 A15.4 15.4 0 0 1 47.4 25.6 V46 Z" fill={`url(#${bloom})`} />
    </svg>
  )
}
