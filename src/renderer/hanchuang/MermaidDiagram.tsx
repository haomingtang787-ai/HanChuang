import { useEffect, useState } from 'react'

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, text: string) => Promise<{ svg: string }>
}

let loader: Promise<MermaidApi> | null = null

/** mermaid 体积大，第一次遇到图时才加载；strict 模式防注入，HTML 标签一律不走。 */
async function loadMermaid(): Promise<MermaidApi> {
  if (!loader) {
    loader = import('mermaid').then((mod) => {
      const api = mod.default as unknown as MermaidApi
      api.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'inherit',
        flowchart: { htmlLabels: false, useMaxWidth: true },
        themeVariables: {
          primaryColor: '#e6efe9',
          primaryBorderColor: '#2f6d5a',
          primaryTextColor: '#262218',
          lineColor: '#8f8871',
          fontSize: '14px',
        },
      })
      return api
    })
  }
  return loader
}

let seq = 0

/**
 * 讲解里的图解：老师写 ```mermaid 代码，这里渲染成图。
 * 语法错的图退回代码块显示——不能让一张坏图把整张讲课卡搞崩。
 */
export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setSvg('')
    setFailed(false)
    if (code.trim() === '') {
      setFailed(true)
      return () => { alive = false }
    }
    seq += 1
    const id = `hc-mermaid-${seq}`
    void (async () => {
      try {
        const api = await loadMermaid()
        if (!alive) return
        const result = await api.render(id, code)
        if (!alive) return
        setSvg(result.svg)
      } catch (error) {
        console.warn('图解渲染失败，退回代码块', error)
        if (alive) setFailed(true)
      }
    })()
    return () => { alive = false; document.getElementById(id)?.remove() }
  }, [code])

  if (failed) {
    return <pre className="hc-code"><code>{code}</code></pre>
  }
  if (svg === '') {
    return <div className="hc-diagram hc-diagram-loading"><span className="hc-muted">正在画图…</span></div>
  }
  return (
    <div className="hc-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  )
}
