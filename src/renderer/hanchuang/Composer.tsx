import { useState } from 'react'
import type { AiConfigView } from '../../shared/ai'
import type { StudySessionDetail, StudyToolKind } from '../../shared/study'
import { estimateCostYuan, formatTokens, formatYuan, primaryLabel, totalSegments, type Reveal } from './logic'

type Props = {
  detail: StudySessionDetail
  revealed: Reveal[]
  ai: AiConfigView | null
  models: string[]
  busy: string | null
  onPrimary: () => void
  onExpand: () => void
  onSend: (text: string) => void
  onTool: (tool: StudyToolKind) => void
  onFinish: () => void
  onModelChange: (model: string) => void
  onUsageClick: () => void
}

/** 底部：一个主行动按钮 + 输入框 + 模型和用量。学生永远只有一个「下一步」。 */
export function Composer(props: Props) {
  const { detail, revealed, ai, models, busy } = props
  const [text, setText] = useState('')
  const finished = detail.status === 'finished'
  const total = totalSegments(detail.units)
  const continuous = detail.layout === 'continuous'
  const label = primaryLabel(revealed.length, total, detail.layout)
  const disabled = busy !== null || finished
  // 模型只认接口拉回来的那份：不要塞 deepseek-chat 这类写死的名字，配置换了会显示错。
  const options = Array.from(new Set([ai?.model ?? '', ...models].filter((item) => item !== '')))
  const usedTokens = detail.usage.promptTokens + detail.usage.completionTokens
  const costText = formatYuan(estimateCostYuan(ai?.model ?? '', detail.usage.promptTokens, detail.usage.cachedTokens, detail.usage.completionTokens))

  function submit(): void {
    const content = text.trim()
    if (content === '' || disabled) return
    props.onSend(content)
    setText('')
  }

  if (finished) {
    return (
      <div className="hc-composer">
        <div className="hc-finished-note">本课已下课，学习总结在上面。去左栏「复习错题」巩固，或上传新课件继续。</div>
        <div className="hc-composer-foot">
          <span className="hc-model-static">{ai?.model ?? '未配置模型'}</span>
          <button className="hc-usage" onClick={props.onUsageClick}>
            本课 {formatTokens(usedTokens)} tokens · {costText}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="hc-composer">
      <div className="hc-actions">
        <button className="hc-primary" disabled={disabled || total === 0} onClick={props.onPrimary}>
          {label}
        </button>
        <button
          className="hc-expand"
          disabled={disabled || total === 0}
          title={continuous
            ? '把这一段展开成细讲：先讲理解门槛，再讲易错处，补一个具体例子'
            : '把这一讲从导览展开成细讲：先讲理解门槛，再讲易错处，补一个具体例子'}
          onClick={props.onExpand}
        >
          {continuous ? '这段详细讲' : '详细讲这一讲'}
        </button>
        <button disabled={disabled} onClick={() => props.onTool('quiz')}>出题考我</button>
        <button disabled={disabled} onClick={() => props.onTool('outline')}>课件大纲</button>
        <button disabled={disabled} onClick={() => props.onTool('summary')}>
          {continuous ? '总结这一课' : '总结这一讲'}
        </button>
        <button className="hc-danger" disabled={disabled} onClick={props.onFinish}>下课</button>
      </div>
      <div className="hc-input-row">
        <textarea
          rows={2}
          value={text}
          placeholder={continuous
            ? '随时插嘴问老师，讲课进度不会丢。例：第 39 页看不懂 / 这一段再举个例子。Enter 发送'
            : '随时插嘴问老师，讲课进度不会丢。例：第 39 页看不懂 / 第 2 讲再来个例子。Enter 发送'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button className="hc-send" disabled={disabled || text.trim() === ''} onClick={submit}>发送</button>
      </div>
      <div className="hc-composer-foot">
        {options.length > 0 ? (
          <select
            className="hc-model-select"
            value={ai?.model ?? ''}
            disabled={busy !== null}
            onChange={(event) => props.onModelChange(event.target.value)}
          >
            {options.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        ) : (
          <span className="hc-model-static">模型列表未拉到 · 去设置里检查地址和密钥</span>
        )}
        <button className="hc-usage" onClick={props.onUsageClick}>
          本课 {formatTokens(usedTokens)} tokens · 缓存命中 {formatTokens(detail.usage.cachedTokens)}
        </button>
      </div>
    </div>
  )
}