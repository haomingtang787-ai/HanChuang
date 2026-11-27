import { isPlainObject } from '../domain/validation'
import type { StudyArtifact, StudyUnit } from '../shared/study'
import type { StudyArtifactRow, StudyUnitRow } from '../storage/studyStore'

export type CitationPage = {
  pageId: string
  pageNumber: number
  text: string
  blocks: Array<{ id: string; text: string; bbox: [number, number, number, number] | null }>
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

export function artifactFromRow(row: StudyArtifactRow): StudyArtifact {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    title: row.title,
    body: parseArtifactBody(row.body_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function parseArtifactBody(raw: string): StudyArtifact['body'] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return isPlainObject(parsed) ? parsed as StudyArtifact['body'] : {}
  } catch {
    return {}
  }
}

export function artifactIdFrom(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const locator = JSON.parse(raw) as { artifactId?: unknown }
    return typeof locator.artifactId === 'string' ? locator.artifactId : ''
  } catch {
    return ''
  }
}

export function slideNumberFromLocator(raw: string | undefined): number | null {
  if (!raw) return null
  try {
    const locator = JSON.parse(raw) as { slideNumber?: unknown }
    return typeof locator.slideNumber === 'number' && Number.isInteger(locator.slideNumber) && locator.slideNumber > 0
      ? locator.slideNumber
      : null
  } catch {
    return null
  }
}

export function parseStringList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function unitFromRow(row: StudyUnitRow): StudyUnit {
  return {
    id: row.id,
    ordinal: Number(row.ordinal),
    title: row.title,
    source: row.source,
    minutes: Number(row.minutes),
    keyPoints: parseStringList(row.key_points_json),
    segments: parseSegments(row.segments_json),
  }
}

export function parseBbox(raw: string): [number, number, number, number] | null {
  try {
    const locator = JSON.parse(raw) as { bbox?: unknown }
    if (!Array.isArray(locator.bbox) || locator.bbox.length !== 4) return null
    if (!locator.bbox.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
    return locator.bbox as [number, number, number, number]
  } catch {
    return null
  }
}

export function pageRange(text: string): [number, number] | null {
  const match = /第\s*(\d{1,3})(?:\s*(?:-|–|—|~|至)\s*(\d{1,3}))?\s*页/.exec(text)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2] ?? match[1])
  if (start < 1 || end < start || end > 999) return null
  return [start, end]
}

export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？""''（）()\[\]【】《》·—–~]/g, '')
    .toLowerCase()
}

export function pageMentions(text: string): number[] {
  const found = new Set<number>()
  const patterns = [
    /(?:第\s*)?(\d{1,3})\s*页/g,
    /\[\s*p\.?\s*(\d{1,3})\s*\]/gi,
    /\bp\.\s*(\d{1,3})\b/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const number = Number(match[1])
      if (number > 0) found.add(number)
    }
  }
  return [...found]
}

export function quoteForPage(page: CitationPage, unit: StudyUnit): string {
  // 扫描版 PDF 的 OCR 文本可能是乱码；这一页正好是当前讲的出处页时，
  // 用老师讲稿里已经校对过的原句，不把 OCR 噪声当成“原文”展示给学生。
  const pageRef = /第\s*(\d+)\s*页/.exec(unit.source)
  if (pageRef && Number(pageRef[1]) === page.pageNumber) {
    const first = unit.segments[0]?.source.trim()
    if (first) return first.slice(0, 240)
    const afterColon = unit.source.split(/[：:]/)[1]?.trim()
    if (afterColon) return afterColon.slice(0, 240)
  }
  const segment = unit.segments.find((item) => normalizeText(page.text).includes(normalizeText(item.source)))
  if (segment) return segment.source.slice(0, 240)
  const text = page.text.replace(/\s+/g, ' ').trim()
  const sentence = text.split(/(?<=[。！？])/)[0] ?? text
  return sentence.slice(0, 180)
}

export function parseSegments(raw: string): StudyUnit['segments'] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const row = isPlainObject(item) ? item : {}
        return {
          source: typeof row.source === 'string' ? row.source : '',
          explain: typeof row.explain === 'string' ? row.explain : '',
          check: typeof row.check === 'string' ? row.check : '',
        }
      })
      .filter((segment) => segment.source && segment.explain)
  } catch {
    return []
  }
}
