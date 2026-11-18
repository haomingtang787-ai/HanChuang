import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../src/renderer/hanchuang/richParse'
import { clampPaneRatio, hitSubtitle, readPanePref } from '../src/renderer/hanchuang/logic'
import { planOfficeLaunch, type WpsExes } from '../src/shared/office'
import type { SearchHit } from '../src/shared/search'

const exes: WpsExes = {
  writer: 'C:/wps/wps.exe',
  presentation: 'C:/wps/wpp.exe',
  spreadsheet: 'C:/wps/et.exe',
  pdf: 'C:/wps/wpspdf.exe',
}

describe('图解解析', () => {
  test('mermaid 代码块单独成图解块', () => {
    const blocks = parseBlocks('开头\n```mermaid\nflowchart LR\nA-->B\n```\n结尾')
    const kinds = blocks.map((block) => block.kind)
    expect(kinds).toEqual(['para', 'diagram', 'para'])
    const diagram = blocks[1]
    expect(diagram.kind === 'diagram' ? diagram.text : '').toBe('flowchart LR\nA-->B')
  })

  test('其余代码块保持代码，并记住语言', () => {
    const blocks = parseBlocks('```c\nint main(){}\n```')
    expect(blocks).toHaveLength(1)
    const code = blocks[0]
    expect(code.kind === 'code' ? code.lang : 'x').toBe('c')
  })

  test('没写语言时 lang 为空串', () => {
    const blocks = parseBlocks('```\nplain\n```')
    expect(blocks[0].kind === 'code' ? blocks[0].lang : 'x').toBe('')
  })

  test('Mermaid 大写、带空格也认', () => {
    const blocks = parseBlocks('``` Mermaid \ngraph TD\n```')
    expect(blocks[0].kind).toBe('diagram')
  })
})

describe('原件面板偏好', () => {
  test('比例被夹在 0.28–0.62', () => {
    expect(clampPaneRatio(0.1)).toBe(0.28)
    expect(clampPaneRatio(0.9)).toBe(0.62)
    expect(clampPaneRatio(0.5)).toBe(0.5)
  })

  test('非法比例回到默认 0.5（一半一半）', () => {
    expect(clampPaneRatio(Number.NaN)).toBe(0.5)
  })

  test('空数据回落为「默认收起、对半」', () => {
    expect(readPanePref(null)).toEqual({ open: false, ratio: 0.5 })
    expect(readPanePref('not json')).toEqual({ open: false, ratio: 0.5 })
  })

  test('合法偏好保留并夹比例', () => {
    expect(readPanePref('{"open":true,"ratio":0.9}')).toEqual({ open: true, ratio: 0.62 })
    expect(readPanePref('{"open":"yes","ratio":0.4}')).toEqual({ open: false, ratio: 0.4 })
  })

  test('旧版存的是像素宽度，读出来按对半处理，不再按像素算', () => {
    expect(readPanePref('{"open":true,"width":320}')).toEqual({ open: true, ratio: 0.5 })
  })
})

describe('WPS 组件选择', () => {
  test('PPT 走演示、DOCX 走文字、XLSX/CSV 走表格、PDF 走 PDF 组件', () => {
    expect(planOfficeLaunch('a.pptx', exes)).toEqual({ kind: 'presentation', exe: 'C:/wps/wpp.exe' })
    expect(planOfficeLaunch('a.doc', exes)).toEqual({ kind: 'writer', exe: 'C:/wps/wps.exe' })
    expect(planOfficeLaunch('a.xlsx', exes)).toEqual({ kind: 'spreadsheet', exe: 'C:/wps/et.exe' })
    expect(planOfficeLaunch('a.pdf', exes)).toEqual({ kind: 'pdf', exe: 'C:/wps/wpspdf.exe' })
  })

  test('没有 PDF 组件时退回文字组件', () => {
    expect(planOfficeLaunch('a.pdf', { ...exes, pdf: null })).toEqual({ kind: 'writer', exe: 'C:/wps/wps.exe' })
  })

  test('代码与纯文本不抢，交给系统默认', () => {
    expect(planOfficeLaunch('main.c', exes)).toBeNull()
    expect(planOfficeLaunch('notes.md', exes)).toBeNull()
    expect(planOfficeLaunch('noext', exes)).toBeNull()
  })

  test('没装 WPS 时一律返回 null', () => {
    expect(planOfficeLaunch('a.pptx', { writer: null, presentation: null, spreadsheet: null, pdf: null })).toBeNull()
  })

  test('大小写扩展名不影响判断', () => {
    expect(planOfficeLaunch('A.PPTX', exes)).toEqual({ kind: 'presentation', exe: 'C:/wps/wpp.exe' })
  })
})

describe('搜索结果副标题', () => {
  const hit = (pageNumber: number | null): SearchHit => ({
    documentId: 'd', documentVersionId: 'v', displayName: 'x', format: 'pdf',
    pageNumber, pageId: pageNumber === null ? null : 'p', blockId: 'b', kind: 'paragraph', snippet: 's',
  })

  test('有页码显示第 N 页，没有显示全文', () => {
    expect(hitSubtitle(hit(7))).toBe('第 7 页')
    expect(hitSubtitle(hit(null))).toBe('全文')
  })
})
