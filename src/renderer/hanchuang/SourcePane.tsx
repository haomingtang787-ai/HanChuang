import { useEffect, useRef, useState } from 'react'
import type { BlockView, PageView } from '../../shared/contract'
import { clampPaneRatio, pageForQuote, PANE_RATIO_DEFAULT } from './logic'

type Props = {
  documentVersionId: string
  title: string
  quote: string
  initialPage?: number
  /** 面板占「课件 + 对话」这块宽度的比例，默认 0.5（一半一半）。 */
  ratio: number
  onRatioChange: (ratio: number) => void
  onClose: () => void
  onToast: (tone: 'info' | 'bad' | 'good', text: string) => void
}

/**
 * 左侧常驻的原课件面板：右边讲课、左边翻原件，不遮挡对话。
 * 有页面图（PDF/PPT/图片）就显示图；DOCX/TXT/代码显示这一页的原文段落。
 * 数据按「当前页」单页拉取，82 页的 PDF 也不会一次灌进内存。
 */
export function SourcePane({
  documentVersionId, title, quote, initialPage, ratio, onRatioChange, onClose, onToast,
}: Props) {
  const api = window.desk
  const paneRef = useRef<HTMLElement | null>(null)
  const [page, setPage] = useState<PageView | null>(null)
  const [total, setTotal] = useState(0)
  const [pageNumber, setPageNumber] = useState(initialPage && initialPage > 0 ? initialPage : 1)
  const [blocks, setBlocks] = useState<BlockView[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  // 换文档/换引文/从搜索结果带页码进来时，重新定位一次。
  useEffect(() => {
    if (!api) return
    let alive = true
    setStatus('loading')
    setError('')
    void (async () => {
      const first = await api.documents.pages({ documentVersionId, offset: 0, limit: 1 })
      if (!alive) return
      if (!first.ok) {
        setStatus('error')
        setError(first.error.message)
        return
      }
      setTotal(first.data.total)
      let target = initialPage && initialPage > 0 ? initialPage : 1
      if ((!initialPage || initialPage <= 0) && quote.trim() !== '') {
        const hits = await api.documents.search({ query: quote.trim().slice(0, 60), limit: 5 })
        if (!alive) return
        if (hits.ok) target = pageForQuote(hits.data.items, documentVersionId)
      }
      if (!alive) return
      setPageNumber(Math.min(Math.max(target, 1), Math.max(first.data.total, 1)))
      setStatus('ready')
    })()
    return () => { alive = false }
  }, [api, documentVersionId, quote, initialPage])

  // 翻到哪页就只拉哪页；依赖必须带 status，否则定位后页码仍是 1 时不触发取页。
  useEffect(() => {
    if (!api || status !== 'ready') return
    let alive = true
    void (async () => {
      const pages = await api.documents.pages({ documentVersionId, offset: pageNumber - 1, limit: 1 })
      if (!alive) return
      setPage(pages.ok ? pages.data.items[0] ?? null : null)
      const pageId = pages.ok ? pages.data.items[0]?.pageId : undefined
      const rows = await api.documents.blocks(
        pageId ? { pageId, limit: 60 } : { documentVersionId, scope: 'unpaged', limit: 60 },
      )
      if (!alive) return
      setBlocks(rows.ok ? rows.data.items : [])
    })()
    return () => { alive = false }
  }, [api, documentVersionId, pageNumber, status])

  async function openWithWps(): Promise<void> {
    if (!api) return
    const result = await api.documents.openNative({ documentVersionId })
    if (!result.ok) {
      onToast('bad', result.error.message)
      return
    }
    if (!result.data.opened) {
      onToast('bad', result.data.note)
      return
    }
    if (result.data.mode === 'wps') onToast('good', '已用 WPS 打开原件')
    else onToast('info', '没找到 WPS，已用系统默认程序打开原件')
  }

  // 拖右边缘调宽；按容器宽度换算成比例，窗口变大变小都保持这个比例。
  // 拖动过程先落状态，松手才由上层落盘（每帧都写 localStorage 会卡）。
  function beginResize(event: React.MouseEvent<HTMLDivElement>): void {
    event.preventDefault()
    const host = paneRef.current?.parentElement
    const hostRect = host?.getBoundingClientRect()
    if (!hostRect || hostRect.width <= 0) return
    const move = (ev: MouseEvent): void => onRatioChange(clampPaneRatio((ev.clientX - hostRect.left) / hostRect.width))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const imageUrl = page?.previewResourceId ? `app-resource://${page.previewResourceId}` : ''

  return (
    <aside className="hc-source-pane" ref={paneRef} style={{ width: `${(clampPaneRatio(ratio) * 100).toFixed(2)}%` }}>
      <header className="hc-source-head">
        <div className="hc-source-top">
          <div className="hc-source-title" title={title}>{title}</div>
          <button className="hc-source-close" onClick={onClose} title="收起原课件">收起</button>
        </div>
        <div className="hc-source-tools">
          {total > 0 ? (
            <>
              <button className="hc-source-nav" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}>上一页</button>
              <span className="hc-source-page">第 {pageNumber} / {total} 页</span>
              <button className="hc-source-nav" disabled={pageNumber >= total} onClick={() => setPageNumber((value) => Math.min(total, value + 1))}>下一页</button>
            </>
          ) : (
            <span className="hc-source-page">{blocks.length > 0 ? `全文 · ${blocks.length} 段` : '全文'}</span>
          )}
          <button className="hc-source-wps" onClick={() => void openWithWps()} title="用 WPS 打开原件，自己翻">用 WPS 打开</button>
        </div>
      </header>
      {quote.trim() !== '' && (
        <div className="hc-source-quote">
          <span className="hc-source-quote-tag">老师刚讲的这句</span>
          <blockquote>{quote}</blockquote>
        </div>
      )}
      <div className="hc-source-body">
        {status === 'loading' && <div className="hc-muted">正在打开原课件…</div>}
        {status === 'error' && <div className="hc-muted">原文打不开：{error}</div>}
        {status !== 'error' && imageUrl !== '' && (
          <div className="hc-source-image">
            <img src={imageUrl} alt={`第 ${pageNumber} 页原文`} />
          </div>
        )}
        {status !== 'error' && imageUrl === '' && (
          <div className="hc-source-texts">
            {blocks.length === 0 && <div className="hc-muted">这一页没有可显示的原文，可能还在解析。</div>}
            {blocks.map((block) => (
              <p key={block.blockId} className="hc-source-text">{block.text}</p>
            ))}
          </div>
        )}
      </div>
      <div
        className="hc-source-resize"
        onMouseDown={beginResize}
        onDoubleClick={() => onRatioChange(PANE_RATIO_DEFAULT)}
        title="拖动调宽，双击回到一半一半"
      />
    </aside>
  )
}
