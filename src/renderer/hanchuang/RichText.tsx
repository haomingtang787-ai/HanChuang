import { Fragment, useMemo, type ReactNode } from 'react'
import { MathText } from '../components/MathText'
import { parseBlocks } from './richParse'
import { MermaidDiagram } from './MermaidDiagram'

/** 行内只认 `代码` 和 **加粗**，其余交给 MathText 渲染公式；不解析原始 HTML，杜绝注入。 */
function inline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)
  const nodes: ReactNode[] = []
  parts.forEach((part, index) => {
    if (part === '') return
    const key = `${keyBase}-${index}`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      nodes.push(<code key={key} className="hc-inline-code">{part.slice(1, -1)}</code>)
    } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>)
    } else {
      nodes.push(<MathText key={key} text={part} />)
    }
  })
  return nodes
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className={className ?? 'hc-rich'}>
      {blocks.map((block, index) => {
        const key = `b${index}`
        if (block.kind === 'code') {
          return <pre key={key} className="hc-code"><code>{block.text}</code></pre>
        }
        if (block.kind === 'diagram') {
          return <MermaidDiagram key={key} code={block.text} />
        }
        if (block.kind === 'heading') {
          const Tag = (block.level <= 2 ? 'h3' : 'h4') as 'h3' | 'h4'
          return <Tag key={key} className="hc-heading">{inline(block.text, key)}</Tag>
        }
        if (block.kind === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return <Tag key={key} className="hc-list">{block.items.map((item, j) => <li key={j}>{inline(item, `${key}-${j}`)}</li>)}</Tag>
        }
        if (block.kind === 'quote') {
          return <blockquote key={key} className="hc-quote">{inline(block.text, key)}</blockquote>
        }
        return (
          <p key={key} className="hc-para">
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}