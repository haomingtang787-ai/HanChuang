import { describe, expect, test } from 'vitest'
import {
  assetListOf, assetTreeEntries, assetTreeOf, diffFolderFiles, pageForQuote, prepPhaseLabel, readAssets, readFolderWatches,
  rememberFiles, upsertAsset, type FolderWatch,
} from '../src/renderer/hanchuang/logic'
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

  test('新素材保留源文件夹与相对路径，旧数据仍能读', () => {
    const items = readAssets(JSON.stringify([
      { courseId: 'c1', documentVersionId: 'v1', name: 'chapter1.pdf', addedAt: '2026-11-18T00:00:00Z', relativePath: 'chapter1.pdf' },
      { courseId: 'c1', documentVersionId: 'v2', name: 'A.c', addedAt: '2026-11-18T00:00:00Z', relativePath: 'HW/HW04/A.c', sourcePath: 'C:\\data\\HW\\HW04\\A.c' },
    ]))
    expect(items[0].relativePath).toBe('chapter1.pdf')
    expect(items[1].relativePath).toBe('HW/HW04/A.c')
    expect(items[1].sourcePath).toBe('C:\\data\\HW\\HW04\\A.c')
  })
})

describe('同步文件夹索引', () => {
  const watch: FolderWatch = {
    courseId: 'c1',
    folder: 'C:\\Users\\16122\\Desktop\\数据结构',
    folderName: '数据结构',
    enabled: true,
    known: {
      'chapter1.pdf': { sizeBytes: 10, modifiedMs: 100 },
      'gone.pdf': { sizeBytes: 20, modifiedMs: 200 },
    },
    failed: {},
    oversized: 0,
    lastScanAt: null,
    error: null,
    changedPaths: [],
    missingPaths: [],
  }

  test('坏数据回落，合法条目保留监听状态和已知文件', () => {
    expect(readFolderWatches('not json')).toEqual([])
    expect(readFolderWatches('[{"courseId":1}]')).toEqual([])
    const items = readFolderWatches(JSON.stringify([
      { ...watch, enabled: false, known: { 'chapter1.pdf': { sizeBytes: 10, modifiedMs: 100 } } },
      { ...watch },
    ]))
    expect(items).toHaveLength(1)
    expect(items[0].enabled).toBe(false)
    expect(items[0].known['chapter1.pdf']).toEqual({ sizeBytes: 10, modifiedMs: 100 })
    expect(items[0].failed).toEqual({})
    expect(items[0].oversized).toBe(0)
  })

  test('diff 只把没见过的算新增，改过的算变更，消失的算缺失', () => {
    const files = [
      { path: 'C:\\Users\\16122\\Desktop\\数据结构\\chapter1.pdf', name: 'chapter1.pdf', relativePath: 'chapter1.pdf', sizeBytes: 10, modifiedMs: 100 },
      { path: 'C:\\Users\\16122\\Desktop\\数据结构\\chapter1.pdf', name: 'chapter1.pdf', relativePath: 'chapter1.pdf', sizeBytes: 10, modifiedMs: 100 },
      { path: 'C:\\Users\\16122\\Desktop\\数据结构\\chapter2.pdf', name: 'chapter2.pdf', relativePath: 'chapter2.pdf', sizeBytes: 30, modifiedMs: 300 },
    ]
    const diff = diffFolderFiles(watch, files)
    expect(diff.added.map((file) => file.relativePath)).toEqual(['chapter2.pdf'])
    expect(diff.changed).toEqual([])
    expect(diff.missing).toEqual(['gone.pdf'])

    const changed = diffFolderFiles(watch, [
      { path: 'C:\\Users\\16122\\Desktop\\数据结构\\chapter1.pdf', name: 'chapter1.pdf', relativePath: 'chapter1.pdf', sizeBytes: 11, modifiedMs: 101 },
    ])
    expect(changed.changed.map((file) => file.relativePath)).toEqual(['chapter1.pdf'])
  })

  test('失败过且内容没变的文件不再算新增，不触发每轮重试', () => {
    const failedWatch: FolderWatch = {
      ...watch,
      failed: {
        'chapter2.pdf': { sizeBytes: 30, modifiedMs: 300, reason: 'PARSE_FAILED' },
      },
    }
    const same = diffFolderFiles(failedWatch, [
      { path: '', name: 'chapter2.pdf', relativePath: 'chapter2.pdf', sizeBytes: 30, modifiedMs: 300 },
    ])
    expect(same.added).toEqual([])
    expect(same.changed).toEqual([])

    const modified = diffFolderFiles(failedWatch, [
      { path: '', name: 'chapter2.pdf', relativePath: 'chapter2.pdf', sizeBytes: 31, modifiedMs: 301 },
    ])
    expect(modified.added.map((file) => file.relativePath)).toEqual(['chapter2.pdf'])
  })

  test('rememberFiles 只更新传入的文件，其它签名保留', () => {
    const known = rememberFiles(watch.known, [
      { path: '', name: 'chapter2.pdf', relativePath: 'chapter2.pdf', sizeBytes: 30, modifiedMs: 300 },
    ])
    expect(known['chapter2.pdf']).toEqual({ sizeBytes: 30, modifiedMs: 300 })
    expect(known['chapter1.pdf']).toEqual({ sizeBytes: 10, modifiedMs: 100 })
  })

  test('素材树按相对路径还原多层目录，同层文件夹排在文件前', () => {
    const tree = assetTreeOf([
      { courseId: 'c1', documentVersionId: 'v1', name: 'ai讲解1.pdf', addedAt: '2026-11-18T00:00:00Z' },
      { courseId: 'c1', documentVersionId: 'v2', name: 'chapter1.pdf', addedAt: '2026-11-18T00:00:00Z', relativePath: 'chapter1.pdf' },
      { courseId: 'c1', documentVersionId: 'v3', name: 'README.md', addedAt: '2026-11-18T00:00:00Z', relativePath: 'HW04_HW05_代码逐行讲解/README.md' },
      { courseId: 'c1', documentVersionId: 'v4', name: 'A.c', addedAt: '2026-11-18T00:00:00Z', relativePath: 'HW04_HW05_代码逐行讲解/HW04/A.c' },
    ])
    expect(assetTreeEntries(tree).map((entry) => entry.kind)).toEqual(['folder', 'asset', 'asset'])
    expect(tree.assets.map((asset) => asset.name)).toEqual(['ai讲解1.pdf', 'chapter1.pdf'])
    expect(tree.folders).toHaveLength(1)
    expect(tree.folders[0].name).toBe('HW04_HW05_代码逐行讲解')
    expect(assetTreeEntries(tree.folders[0]).map((entry) => entry.kind)).toEqual(['folder', 'asset'])
    expect(tree.folders[0].assets.map((asset) => asset.name)).toEqual(['README.md'])
    expect(tree.folders[0].folders[0].name).toBe('HW04')
    expect(tree.folders[0].folders[0].assets.map((asset) => asset.name)).toEqual(['A.c'])
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
