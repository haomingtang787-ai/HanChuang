import { useEffect, useRef } from 'react'
import type { StudyProgress, StudyQuizAnswer, StudySessionDetail, StudyUnit } from '../../shared/study'
import { buildTimeline, nextSegment, prepPhaseLabel, type Reveal } from './logic'
import { ArtifactCard } from './ArtifactCard'
import { LectureCard } from './LectureCard'
import { QuizCard } from './QuizCard'
import { RichText } from './RichText'

type Props = {
  detail: StudySessionDetail
  revealed: Reveal[]
  busy: string | null
  progress: StudyProgress | null
  teacherName: string
  onAnswerCheck: (unitOrdinal: number, segmentIndex: number, answer: string) => void
  onGradeQuiz: (answers: StudyQuizAnswer[]) => void
  onMakeCards: (unitOrdinal: number) => void
  onExplainDetail: (unit: StudyUnit, segmentIndex: number) => void
  onPreview: (unit: StudyUnit, segmentIndex: number) => void
}

/** 中间聊天流：讲课卡片、问答、工具生成物按时间排成一条流，像豆包一样往下滚。 */
export function ChatStream(props: Props) {
  const { detail, revealed, busy, progress, teacherName } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nearBottom = useRef(true)
  const timeline = buildTimeline(detail, revealed)
  const doneSet = new Set(revealed.map((item) => `${item.unitOrdinal}:${item.segmentIndex}`))
  const next = nextSegment(detail.units, revealed)
  const orderedUnits = [...detail.units].sort((a, b) => a.ordinal - b.ordinal)
  const totalDots = detail.units.reduce((sum, unit) => sum + unit.segments.length, 0)

  useEffect(() => {
    const node = containerRef.current
    if (node && nearBottom.current) node.scrollTop = node.scrollHeight
  }, [timeline.length, busy, detail.summary])

  return (
    <div
      className="hc-stream"
      ref={containerRef}
      onScroll={(event) => {
        const node = event.currentTarget
        nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 140
      }}
    >
      <div className="hc-stream-inner">
        {orderedUnits.length > 0 && (
          <div className="hc-rail" aria-label="讲课进度">
            {orderedUnits.length > 10 ? (
              <>
                <div className="hc-rail-unit current" title={next ? orderedUnits[next.unitOrdinal]?.title : '这一讲已讲完'}>
                  <span className="hc-rail-name">
                    第 {Math.min(orderedUnits.length, (next?.unitOrdinal ?? orderedUnits.length - 1) + 1)}/{orderedUnits.length} 讲
                  </span>
                </div>
                <div className="hc-rail-summary">
                  {next ? orderedUnits[next.unitOrdinal]?.title ?? '' : '全部讲完'}
                </div>
                <div className="hc-rail-progress" role="progressbar" aria-valuenow={doneSet.size} aria-valuemin={0} aria-valuemax={totalDots}>
                  <span style={{ width: `${totalDots > 0 ? Math.round((doneSet.size / totalDots) * 100) : 0}%` }} />
                </div>
              </>
            ) : orderedUnits.map((unit) => (
              <div
                key={unit.ordinal}
                className={`hc-rail-unit${next?.unitOrdinal === unit.ordinal ? ' current' : ''}`}
                title={unit.title}
              >
                <span className="hc-rail-name">第{unit.ordinal + 1}讲</span>
                <span className="hc-rail-dots">
                  {unit.segments.map((_, index) => (
                    <span
                      key={index}
                      className={`hc-rail-dot${doneSet.has(`${unit.ordinal}:${index}`) ? ' done' : ''}${next?.unitOrdinal === unit.ordinal && next.segmentIndex === index ? ' next' : ''}`}
                    />
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        {detail.warnings.length > 0 && (
          <details className="hc-warnings">
            <summary>课件说明（{detail.warnings.length} 条，老师如实标注，不假装读懂）</summary>
            <ul className="hc-list">
              {detail.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          </details>
        )}

        {timeline.map((item, index) => {
          if (item.kind === 'message') {
            const message = item.message
            if (message.role === 'user') {
              return <div key={message.id} className="hc-bubble-user"><RichText text={message.content} /></div>
            }
            return (
              <div key={message.id} className="hc-bubble-teacher">
                <div className="hc-teacher-label">{teacherName}</div>
                <RichText text={message.content} />
                {message.citations.length > 0 && (
                  <div className="hc-cites">
                    {message.citations.map((cite, j) => (
                      <span key={j} className="hc-cite">第{cite.pageNumber}页</span>
                    ))}
                  </div>
                )}
              </div>
            )
          }
          if (item.kind === 'lecture') {
            const unit = detail.units.find((candidate) => candidate.ordinal === item.reveal.unitOrdinal)
            if (!unit) return null
            const check = detail.checks.find(
              (candidate) => candidate.unitOrdinal === item.reveal.unitOrdinal && candidate.segmentIndex === item.reveal.segmentIndex,
            ) ?? null
            return (
              <LectureCard
                key={`l${index}`}
                unit={unit}
                segmentIndex={item.reveal.segmentIndex}
                check={check}
                busy={busy !== null}
                onAnswer={props.onAnswerCheck}
                onExplainDetail={props.onExplainDetail}
                onPreview={props.onPreview}
              />
            )
          }
          if (item.artifact.kind === 'quiz') {
            return <QuizCard key={item.artifact.id} artifact={item.artifact} busy={busy !== null} onGrade={props.onGradeQuiz} />
          }
          return <ArtifactCard key={item.artifact.id} artifact={item.artifact} units={detail.units} onMakeCards={props.onMakeCards} />
        })}

        {busy === 'create' && (
          <div className="hc-prep">
            <div className="hc-prep-title">
              老师正在备课{progress?.title ? `《${progress.title}》` : ''}{progress ? `：${prepPhaseLabel(progress.phase)}` : '…'}
            </div>
            {progress && progress.total > 0 && (
              <>
                <div className="hc-prep-bar"><div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
                <div className="hc-prep-count">{progress.done}/{progress.total}</div>
              </>
            )}
            <div className="hc-prep-note">备课只花一次钱，之后逐段上课不额外调用模型。</div>
          </div>
        )}

        {(busy === 'send' || busy === 'tool' || busy === 'grade' || busy === 'finish') && (
          <div className="hc-bubble-teacher hc-typing">
            <div className="hc-teacher-label">{teacherName}</div>
            <span className="hc-dot" /><span className="hc-dot" /><span className="hc-dot" />
          </div>
        )}

        {detail.summary && (
          <div className="hc-summary">
            <div className="hc-card-title">学习总结</div>
            <RichText text={detail.summary.overview} />
            <div className="hc-summary-grid">
              <div><div className="hc-summary-label">已掌握</div><ul className="hc-list">{detail.summary.mastered.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
              <div><div className="hc-summary-label">还不稳</div><ul className="hc-list">{detail.summary.weak.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
              <div><div className="hc-summary-label">易错点</div><ul className="hc-list">{detail.summary.pitfalls.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
              <div><div className="hc-summary-label">下一步</div><ul className="hc-list">{detail.summary.next.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
            </div>
          </div>
        )}

        {detail.teacherNote && (
          <div className="hc-artifact">
            <div className="hc-card-title">老师手记</div>
            <RichText text={detail.teacherNote.summary} />
            {detail.teacherNote.next.length > 0 && (
              <ul className="hc-list">{detail.teacherNote.next.map((item, index) => <li key={index}>{item}</li>)}</ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}