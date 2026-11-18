import { describe, expect, test } from 'vitest'
import { assetListOf, pageForQuote, prepPhaseLabel, readAssets, upsertAsset } from '../src/renderer/hanchuang/logic'
import type { SearchHit } from '../src/shared/search'

describe('备课进度文案', () => {
  test('三个阶段都有中文标签', () => {
    expect(prepPhaseLabel('vision')).toBe('读图')
    expect(prepPhaseLabel('reading')).toBe('读原文')
    expect(prepPhaseLabel('planning')).toBe('设计讲稿')
  })
})

describe('素材索引', () => {
  test('坏数据回落为空，不抛错', () => {
    expect(readAssets(null)).toEqual([])
    expect(readAssets('not json')).toEqual([])
    expect(readAssets('{"a":1}')).toEqual([])
    expect(readAssets('[{"documentVersionId":1}]')).toEqual([])
  })

  test('合法条目保留并去重', () => {
    const raw = JSON.stringify([
      { courseId: 'c1', documentVersionId: 'v1', name: '第一章.pptx', addedAt: '2026-11-18T00:00:00Z' },
      { courseId: 'c1', documentVersionId: 'v1', name: '第一章.pptx', addedAt: '2026-11-18T00:00:00Z' },
      { courseId: 'c2', documentVersionId: 'v2', name: 'note.txt', addedAt: '2026-11-18T00:00:00Z' },
    ])
    const items = readAssets(raw)
    expect(items).toHaveLength(2)
    expect(assetListOf(items, 'c1').map((item) => item.documentVersionId)).toEqual(['v1'])
    expect(assetListOf(items, 'c2')).toHaveLength(1)
  })

  test('同一份文档只留一条，新名字覆盖旧名字', () => {
    const items = upsertAsset(
      [{ courseId: 'c1', documentVersionId: 'v1', name: '旧名', addedAt: '2026-11-18T00:00:00Z' }],
      { courseId: 'c1', documentVersionId: 'v1', name: '新名', addedAt: '2026-11-18T01:00:00Z' },
    )
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('新名')
  })
})

describe('原文定位', () => {
  const hit = (documentVersionId: string, pageNumber: number | null): SearchHit => ({
    documentId: 'd',
    documentVersionId,
    displayName: 'x',
    format: 'pdf',
    pageNumber,
    pageId: pageNumber === null ? null : `p${pageNumber}`,
    blockId: 'b',
    kind: 'paragraph',
    snippet: '片段',
  })

  test('只认本课文档的命中页', () => {
    expect(pageForQuote([hit('other', 3), hit('v1', 7)], 'v1')).toBe(7)
  })

  test('没有命中或没有页码时回落到第一页', () => {
    expect(pageForQuote([], 'v1')).toBe(1)
    expect(pageForQuote([hit('v1', null)], 'v1')).toBe(1)
  })
})
