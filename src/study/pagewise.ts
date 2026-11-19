import type { AiClient } from '../ai/client'
import type { Habits } from '../teaching/habits'
import { habitBrief } from '../teaching/habits'
import { parsePagePlan, type PagePlanDraft } from './parse'

/** 一页原文：页码来自课件里的「【第 N 页】」标记，没有标记就按顺序编号。 */
export type MaterialPage = {
  number: number
  label: string
  text: string
}

export type PageBatch = {
  pages: MaterialPage[]
  range: string
}

export const PAGE_BATCH_MAX_PAGES = 4
export const PAGE_BATCH_MAX_CHARS = 7000

/** 按页标记切开整份材料；没有页标记时按空行切，仍尽量一页一段。 */
export function splitPages(text: string): MaterialPage[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const hasLabels = /【第\s*\d+\s*页/.test(trimmed)
  const chunks = hasLabels
    ? trimmed.split(/\n{2,}(?=【第\s*\d+\s*页)/).filter(Boolean)
    : trimmed.split(/\n{2,}/).filter(Boolean)
  const pages: MaterialPage[] = []
  chunks.forEach((chunk, index) => {
    const match = /^【第\s*(\d+)\s*页[^】]*】\s*/.exec(chunk.trim())
    const number = match ? Number(match[1]) : index + 1
    const body = (match ? chunk.trim().slice(match[0].length) : chunk.trim()).trim()
    pages.push({ number, label: match ? match[0].trim() : `【第 ${number} 页】`, text: body })
  })
  return pages
}

/** 4 页 / 7000 字一批：太少会多花调用，太多模型会把几页合成一讲。 */
export function batchPages(pages: MaterialPage[]): PageBatch[] {
  const batches: PageBatch[] = []
  let current: MaterialPage[] = []
  let chars = 0
  const flush = () => {
    if (current.length === 0) return
    const first = current[0]!
    const last = current[current.length - 1]!
    batches.push({
      pages: current,
      range: first.number === last.number ? `第 ${first.number} 页` : `第 ${first.number}–${last.number} 页`,
    })
    current = []
    chars = 0
  }
  for (const page of pages) {
    const size = page.text.length + page.label.length
    // 单页超长时独占一批，避免把整批挤爆。
    if (current.length > 0 && (current.length >= PAGE_BATCH_MAX_PAGES || chars + size > PAGE_BATCH_MAX_CHARS)) flush()
    current.push(page)
    chars += size
    if (chars >= PAGE_BATCH_MAX_CHARS || current.length >= PAGE_BATCH_MAX_PAGES) flush()
  }
  flush()
  return batches
}

const PAGE_PLAN_SYSTEM = [
  '你是「寒窗」的课程设计师，也是一位会当面讲课的私教。',
  '这次不要合并成「讲」：学生要按页、一段一段地听，所以把每一页分别拆成小讲。',
  '只输出一个 JSON 对象，不要 markdown 代码块，不要解释。',
  '字段：units[{title, source, minutes, keyPoints, segments[{source, explain, check}]}], skipped[]。',
  '每一页至少一讲；只有一页里有两个以上互不相干的主题时才拆成两讲，一页最多两讲。',
  'source 写「第 N 页」，N 用这一讲的原文页码。',
  'segments 1 到 3 段：每段只抓这一页里的一句关键原文（逐字复制，不改写、不合并句子），explain 180 到 330 字，必须走完四步：①这句原文用白话在说什么；②为什么会这样，讲清机制或因果；③给一个具体例子或反例；④最容易误解的地方是什么。check 是讲完问学生的一句小问题，没有就空字符串。',
  'minutes 是 3 到 8 的整数；keyPoints 2 到 3 条，每条一句。',
  '不要跨页合并，不要把这一页的内容留到下一讲；封面、目录、版权、致谢、纯图片没有知识内容的页不要拆，把页码写进 skipped。',
  '不要编造原文没有的事实。',
].join('\n')

export function buildPagePlanPrompt(input: {
  title: string
  subject: string
  batch: PageBatch
  habits: Habits
  repairNote?: string
}): { system: string; user: string } {
  const pages = input.batch.pages
    .map((page) => `${page.label}\n${page.text || '（这一页没有可读文字）'}`)
    .join('\n\n')
  const user = [
    `课件：${input.title}${input.subject ? `；科目：${input.subject}` : ''}`,
    `这一批是${input.batch.range}，共 ${pages.length} 页。`,
    '学生的习惯：',
    habitBrief(input.habits),
    '请把下面每一页分别拆成小讲，只讲这几页里的内容：',
    pages,
    input.repairNote ? `上一次输出不合格：${input.repairNote}。请重新输出完整 JSON。` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system: PAGE_PLAN_SYSTEM, user }
}

export type PagePlanOutcome = {
  units: PagePlanDraft['units']
  skipped: number[]
  warnings: string[]
}

/** 单页兜底：模型两次都没拆出来时，至少保留这一页原文，别让这一页在课堂里消失。 */
function fallbackUnits(pages: MaterialPage[]) {
  return pages
    .map((page) => {
      const sentences = page.text
        .split(/[。；\n]/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 8 && !line.startsWith('【'))
      const source = sentences[0] ?? page.text.trim().slice(0, 60)
      if (!source) return null
      return {
        title: page.text.trim().replace(/\s+/g, ' ').slice(0, 18) || `第 ${page.number} 页`,
        source: `第 ${page.number} 页`,
        minutes: 4,
        keyPoints: [sentences[1] ?? source].filter(Boolean).slice(0, 2),
        segments: [{
          source,
          explain: '这一页模型没拆成讲稿，先把原文留在这里；你点「详细讲这一讲」，我再逐句展开。',
          check: '',
        }],
      }
    })
    .filter((unit): unit is NonNullable<typeof unit> => unit !== null)
}

/**
 * 逐页拆讲：每批页一次调用，失败重试一次，仍失败就用原文兜底并记警告。
 * 进度按“已拆完的批数”回调，界面能看到一页页往下走。
 */
export async function planPagewise(
  client: Pick<AiClient, 'complete'>,
  input: {
    title: string
    subject: string
    material: string
    habits: Habits
    onProgress?: (done: number, total: number) => void
    concurrency?: number
  },
): Promise<PagePlanOutcome> {
  const pages = splitPages(input.material)
  const batches = batchPages(pages)
  if (batches.length === 0) return { units: [], skipped: [], warnings: ['这份材料没有可拆的页。'] }
  const results: PagePlanDraft['units'][] = new Array(batches.length)
  const skipped: number[] = []
  const warnings: string[] = []
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 2, batches.length))
  let done = 0
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= batches.length) return
      const batch = batches[index]!
      let units: PagePlanDraft['units'] | null = null
      let lastError = ''
      for (let attempt = 0; attempt < 2 && !units; attempt += 1) {
        try {
          const prompt = buildPagePlanPrompt({
            title: input.title,
            subject: input.subject,
            batch,
            habits: input.habits,
            repairNote: attempt ? lastError : undefined,
          })
          const raw = await client.complete(prompt.system, prompt.user, 12_000, 'disabled', 'plan-page')
          const parsed = parsePagePlan(raw, { maxUnits: batch.pages.length * 2 })
          units = parsed.units
          skipped.push(...parsed.skipped)
        } catch (error) {
          lastError = error instanceof Error ? error.message : '输出不合格'
        }
      }
      if (!units) {
        warnings.push(`${batch.range} 模型没拆成讲稿，先按原文保留。原因：${lastError}`)
        units = fallbackUnits(batch.pages)
      }
      results[index] = units
      done += 1
      input.onProgress?.(done, batches.length)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return {
    units: results.flat(),
    skipped: [...new Set(skipped)].sort((a, b) => a - b),
    warnings,
  }
}
