/**
 * 讲课文本的块解析：Markdown 子集 + 代码块 + 图解块。
 * 单独放在这里是为了能被单测直接引用（不牵扯 React / KaTeX）。
 */
export type RichBlock =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'diagram'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; lines: string[] }

export function parseBlocks(text: string): RichBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: RichBlock[] = []
  let para: string[] = []
  let i = 0
  const flush = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', lines: para })
      para = []
    }
  }
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {
      flush()
      const lang = line.trim().slice(3).trim().toLowerCase()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      i += 1
      const body = buf.join('\n')
      if (lang === 'mermaid') blocks.push({ kind: 'diagram', text: body })
      else blocks.push({ kind: 'code', lang, text: body })
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line)
    if (item) {
      flush()
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length) {
        const match = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i])
        if (!match) break
        items.push(match[1])
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flush()
      const buf: string[] = []
      while (i < lines.length) {
        const match = /^\s*>\s?(.*)$/.exec(lines[i])
        if (!match) break
        buf.push(match[1])
        i += 1
      }
      blocks.push({ kind: 'quote', text: buf.join('\n') })
      continue
    }
    if (line.trim() === '') {
      flush()
      i += 1
      continue
    }
    para.push(line)
    i += 1
  }
  flush()
  return blocks
}
