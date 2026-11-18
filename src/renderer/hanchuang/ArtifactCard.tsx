import type { StudyArtifact, StudyUnit } from '../../shared/study'
import { RichText } from './RichText'

type Props = {
  artifact: StudyArtifact
  units?: StudyUnit[]
  onMakeCards?: (unitOrdinal: number) => void
}

/** 工具生成物卡片：总结 / 大纲 / 找原文 / 复述批改。题测由 QuizCard 单独渲染。 */
export function ArtifactCard({ artifact, units, onMakeCards }: Props) {
  const body = artifact.body
  if (artifact.kind === 'summary') {
    const citations = body.citations ?? []
    const unitOrdinal = citations[0]?.unitOrdinal ?? units?.[0]?.ordinal ?? null
    return (
      <div className="hc-artifact">
        <div className="hc-card-title">本讲总结</div>
        {body.text && <RichText text={body.text} />}
        {citations.length > 0 && (
          <div className="hc-cites">
            {citations.map((cite, index) => (
              <span key={index} className="hc-cite">
                第{cite.unitOrdinal + 1}讲 {cite.unitTitle}{cite.pageNumber ? ` · 第${cite.pageNumber}页` : ''}
              </span>
            ))}
          </div>
        )}
        {onMakeCards && unitOrdinal !== null && (
          <div className="hc-form-actions">
            <button onClick={() => onMakeCards(unitOrdinal)}>做成复习卡</button>
          </div>
        )}
      </div>
    )
  }
  if (artifact.kind === 'outline') {
    const items = body.items ?? []
    return (
      <div className="hc-artifact">
        <div className="hc-card-title">课件大纲</div>
        {items.map((item, index) => (
          <div key={index} className="hc-outline-item">
            <div className="hc-outline-title">{item.title}</div>
            <ul className="hc-list">
              {item.points.map((point, j) => <li key={j}>{point}</li>)}
            </ul>
            {item.source !== '' && <div className="hc-outline-source">{item.source}</div>}
          </div>
        ))}
      </div>
    )
  }
  if (artifact.kind === 'search') {
    const matches = body.matches ?? []
    return (
      <div className="hc-artifact">
        <div className="hc-card-title">找原文{body.query ? `：${body.query}` : ''}</div>
        {matches.length === 0 && <div className="hc-muted">课件里没有找到匹配的句子。</div>}
        {matches.map((match, index) => (
          <div key={index} className="hc-search-match">
            <div className="hc-search-where">第{match.unitOrdinal + 1}讲 {match.unitTitle}</div>
            <blockquote className="hc-source">{match.excerpt}</blockquote>
          </div>
        ))}
      </div>
    )
  }
  if (artifact.kind === 'teachback') {
    return (
      <div className="hc-artifact">
        <div className="hc-card-title">复述批改</div>
        {body.feedback && <RichText text={body.feedback} />}
        {(body.covered ?? []).length > 0 && (
          <div className="hc-teachback-group">
            <div className="hc-teachback-label">讲到了</div>
            <ul className="hc-list">{(body.covered ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
        )}
        {(body.gaps ?? []).length > 0 && (
          <div className="hc-teachback-group">
            <div className="hc-teachback-label">还缺</div>
            <ul className="hc-list">{(body.gaps ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
        )}
      </div>
    )
  }
  return null
}