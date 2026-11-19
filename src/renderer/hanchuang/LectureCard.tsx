import { useState } from 'react'
import type { StudyCheck, StudyLayout, StudyUnit } from '../../shared/study'
import { RichText } from './RichText'

type Props = {
  unit: StudyUnit
  segmentIndex: number
  check: StudyCheck | null
  layout?: StudyLayout
  busy: boolean
  onAnswer: (unitOrdinal: number, segmentIndex: number, answer: string) => void
  onExplainDetail: (unit: StudyUnit, segmentIndex: number) => void
  onPreview: (unit: StudyUnit, segmentIndex: number) => void
}

/** 讲课卡片：原文 → 老师讲解 → 两个工具（详细讲 / 对照原文） → 停一下的问题。 */
export function LectureCard({ unit, segmentIndex, check, layout = 'lecture', busy, onAnswer, onExplainDetail, onPreview }: Props) {
  const [answer, setAnswer] = useState('')
  const segment = unit.segments[segmentIndex]
  if (!segment) return null
  const continuous = layout === 'continuous'
  return (
    <div className="hc-lecture">
      <div className="hc-lecture-head">
        <span className="hc-lecture-unit">
          {continuous ? `${unit.source}${unit.title ? ` · ${unit.title}` : ''}` : `第 ${unit.ordinal + 1} 讲 · ${unit.title}`}
        </span>
        {!continuous && <span className="hc-lecture-seg">第 {segmentIndex + 1}/{unit.segments.length} 段</span>}
      </div>
      <blockquote className="hc-source">{segment.source}</blockquote>
      <RichText text={segment.explain} />
      <div className="hc-lecture-tools">
        <button
          className="hc-lecture-tool"
          disabled={busy}
          title="让老师把这一段展开成 4 层，配一个小例子"
          onClick={() => onExplainDetail(unit, segmentIndex)}
        >
          这段详细讲
        </button>
        <button className="hc-lecture-tool" title="右边打开原课件，停在对应页" onClick={() => onPreview(unit, segmentIndex)}>
          对照原文
        </button>
      </div>
      {segment.check !== '' && (
        <div className="hc-check">
          <div className="hc-check-q"><span className="hc-check-chip">停一下</span>{segment.check}</div>
          {check ? (
            <div className="hc-check-done">
              <span className="hc-check-my">你的回答：{check.answer}</span>
              <span className="hc-check-tag">已记录，会进学习总结</span>
            </div>
          ) : (
            <div className="hc-check-form">
              <textarea
                rows={2}
                value={answer}
                placeholder="用自己的话答一句，答错也没关系"
                onChange={(event) => setAnswer(event.target.value)}
              />
              <button
                disabled={busy || answer.trim() === ''}
                onClick={() => {
                  onAnswer(unit.ordinal, segmentIndex, answer.trim())
                  setAnswer('')
                }}
              >
                提交回答
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
