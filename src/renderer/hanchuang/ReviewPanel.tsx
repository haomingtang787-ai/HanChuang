import { useEffect, useState } from 'react'
import type { StudyMissItem } from '../../shared/study'
import type { DueCardItem } from '../../shared/teaching'

type Props = {
  onBack: () => void
  notify: (tone: 'info' | 'bad' | 'good', text: string) => void
  onReviewed: () => void
}

/** 复习页：课堂错题 + 到期复习卡。判分都在主进程，这里只负责展示和点击。 */
export function ReviewPanel(props: Props) {
  const api = window.desk
  const [misses, setMisses] = useState<StudyMissItem[]>([])
  const [cards, setCards] = useState<DueCardItem[]>([])
  const [flipped, setFlipped] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function reload(): Promise<void> {
    if (!api) return
    const [missList, dueList] = await Promise.all([api.study.misses({ limit: 200 }), api.teaching.dueCards()])
    if (missList.ok) setMisses(missList.data.items.filter((item) => item.resolvedAt === null))
    if (dueList.ok) setCards(dueList.data.items)
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function gradeMiss(item: StudyMissItem, remembered: boolean): Promise<void> {
    if (!api || busy) return
    setBusy(true)
    const result = await api.study.gradeMiss({ missId: item.id, remembered })
    setBusy(false)
    if (!result.ok) {
      props.notify('bad', result.error.message)
      return
    }
    props.notify(remembered ? 'good' : 'info', remembered ? '这道错题消掉了' : '好，过几天再练它')
    await reload()
    props.onReviewed()
  }

  async function gradeCard(item: DueCardItem, remembered: boolean): Promise<void> {
    if (!api || busy) return
    setBusy(true)
    const result = await api.teaching.gradeCard({
      origin: item.origin,
      lectureId: item.lectureId ?? undefined,
      cardId: item.card.id,
      remembered,
    })
    setBusy(false)
    if (!result.ok) {
      props.notify('bad', result.error.message)
      return
    }
    await reload()
    props.onReviewed()
  }

  return (
    <div className="hc-review">
      <div className="hc-review-head">
        <button onClick={props.onBack}>← 回课堂</button>
        <div className="hc-review-title">复习</div>
      </div>
      <div className="hc-review-body">
        <div className="hc-section-title">课堂错题（{misses.length}）</div>
        {loaded && misses.length === 0 && (
          <div className="hc-muted">还没有错题。上课被「停一下」问住、或题测答错，都会自动收进这里。</div>
        )}
        {misses.map((item) => (
          <div key={item.id} className="hc-miss">
            <div className="hc-miss-prompt">{item.prompt}</div>
            <div className="hc-miss-meta">
              第{item.unitOrdinal + 1}讲{item.pageNumber ? ` · 第${item.pageNumber}页` : ''} · {item.source}
            </div>
            <div className="hc-miss-answer">你当时答：{item.answer === '' ? '（未作答）' : item.answer}</div>
            <div className="hc-miss-explain">{item.explain}</div>
            <div className="hc-miss-actions">
              <button disabled={busy} onClick={() => void gradeMiss(item, true)}>记住了</button>
              <button disabled={busy} onClick={() => void gradeMiss(item, false)}>还没记住</button>
            </div>
          </div>
        ))}

        <div className="hc-section-title">今日到期复习卡（{cards.length}）</div>
        {loaded && cards.length === 0 && (
          <div className="hc-muted">今天没有到期的卡。课堂总结里点「做成复习卡」，或手动加卡，都会排进复习队列。</div>
        )}
        {cards.map((item) => {
          const open = flipped.has(item.card.id)
          return (
            <div key={item.card.id} className="hc-card">
              <div className="hc-card-front">{item.card.front}</div>
              {open && <div className="hc-card-back">{item.card.back}</div>}
              <div className="hc-miss-actions">
                {!open ? (
                  <button onClick={() => setFlipped((prev) => new Set(prev).add(item.card.id))}>看答案</button>
                ) : (
                  <>
                    <button disabled={busy} onClick={() => void gradeCard(item, true)}>记得</button>
                    <button disabled={busy} onClick={() => void gradeCard(item, false)}>忘了</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}