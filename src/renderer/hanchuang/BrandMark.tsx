import { useId } from 'react'
import { HAN_GLYPH } from './hanGlyph'

/**
 * 品牌印记：与应用图标同一枚图形——宣纸色的方块上，一枚墨绿的「寒」。
 * 路径来自 assets/glyph（Noto Serif SC，OFL），和 scripts/build-icon.mjs 用的是同一份轮廓，
 * 所以左栏 34px、欢迎页 60px 与应用图标完全一致，也不依赖运行环境装没装那枚字体。
 */
export function BrandMark({ className = 'hc-seal' }: { className?: string }) {
  const uid = useId().replace(/:/g, '')
  const paper = `hc-paper-${uid}`
  return (
    <svg className={className} viewBox="0 0 1000 1000" role="img" aria-label="寒窗">
      <defs>
        <linearGradient id={paper} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FCF7EA" />
          <stop offset="100%" stopColor="#EADFC5" />
        </linearGradient>
      </defs>
      <rect
        width="1000"
        height="1000"
        rx="225"
        fill={`url(#${paper})`}
        stroke="rgba(18, 32, 25, 0.13)"
        strokeWidth="6"
      />
      <path d={HAN_GLYPH} fill="#16261F" />
    </svg>
  )
}
