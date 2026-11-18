import { useEffect, useState } from 'react'
import type { SearchHit } from '../../shared/search'
import { hitSubtitle } from './logic'

type Props = { onPick: (hit: SearchHit) => void }

/**
 * 顶栏搜索：接的是已经在库里跑着的 FTS（documents.search，中文按字 + 双字切分），
 * 只做界面，不新建索引。点结果直接在看板上翻开那一页。
 */
export function SourceSearch({ onPick }: Props) {
  const api = window.desk
  const [value, setValue] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!api) return
    const query = value.trim()
    if (query === '') {
      setHits([])
      setBusy(false)
      return
    }
    setBusy(true)
    const timer = setTimeout(() => {
      void (async () => {
        const result = await api.documents.search({ query, limit: 8 })
        setBusy(false)
        if (!result.ok) {
          setHits([])
          return
        }
        setHits(result.data.items)
        setOpen(true)
      })()
    }, 250)
    return () => clearTimeout(timer)
  }, [api, value])

  function choose(hit: SearchHit): void {
    onPick(hit)
    setOpen(false)
  }

  return (
    <div className="hc-search">
      <input
        className="hc-search-input"
        value={value}
        placeholder="搜课件原文，如：页表"
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => { if (hits.length > 0) setOpen(true) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter' && hits.length > 0) choose(hits[0])
        }}
      />
      {open && value.trim() !== '' && (
        <div className="hc-search-pop">
          {busy && hits.length === 0 && <div className="hc-search-empty">搜索中…</div>}
          {!busy && hits.length === 0 && <div className="hc-search-empty">没搜到，换个词试试（只搜已解析的课件）</div>}
          {hits.map((hit) => (
            <button
              key={`${hit.documentVersionId}:${hit.blockId}`}
              className="hc-search-hit"
              onClick={() => choose(hit)}
              title={hit.snippet}
            >
              <span className="hc-search-hit-head">
                <span className="hc-search-hit-name">{hit.displayName}</span>
                <span className="hc-search-hit-page">{hitSubtitle(hit)}</span>
              </span>
              <span className="hc-search-hit-snippet">{hit.snippet}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
