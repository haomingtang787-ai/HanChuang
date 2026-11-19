import type { AiClient } from '../ai/client'
import type { Habits } from '../teaching/habits'
import { habitBrief } from '../teaching/habits'
import { parseContinuousPlan, type ContinuousSectionDraft } from './parse'
import { splitPages, type MaterialPage } from './pagewise'

export type ContinuousBatch = {
  pages: MaterialPage[]
  range: string
}

/** 连续讲允许老师自己并页，所以一批比逐页拆大一些；一批最多 12 页 / 12000 字。 */
export const CONTINUOUS_BATCH_MAX_PAGES = 12
export const CONTINUOUS_BATCH_MAX_CHARS = 12_000

export function batchForContinuity(pages: MaterialPage[]): ContinuousBatch[] {
  const batches: ContinuousBatch[] = []
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
    if (current.length > 0 && (current.length >= CONTINUOUS_BATCH_MAX_PAGES || chars + size > CONTINUOUS_BATCH_MAX_CHARS)) {
      flush()
    }
    current.push(page)
    chars += size
    if (chars >= CONTINUOUS_BATCH_MAX_CHARS || current.length >= CONTINUOUS_BATCH_MAX_PAGES) flush()
  }
  flush()
  return batches
}

const CONTINUOUS_SYSTEM = [
  '你是「寒窗」的课程设计师，也是一位会当面讲课的私教。',
  '这次不分讲，也不要一页一页机械地切：学生要从课件第一页听到最后一页，由你判断哪几页属于同一件事，把它们并成一段，一段讲一段连贯的话；他听完点「继续」，你再讲下一段。',
  '只输出一个 JSON 对象，不要 markdown 代码块，不要解释。',
  '字段：sections[{pages:[页码], title, quote, explain, keyPoints}]。',
  '每一段覆盖连续的 1 到 5 页；按课件顺序往下排，后面的段不能讲回前面的页。',
  '这一批的每一页都必须出现在且只出现在一段里：不能漏页，不能重复，不能把页留给下一批。封面、目录、版权、致谢也要用一句话带过，不要跳过。',
  '怎么分段按内容判断，不按页数平均切：一个概念连同它的推导、例子可以放在一段；换主题、换问题、换章节才断开。',
  'explain 是 220 到 420 字的一段连贯口语讲解：先一句话点题，再把机制或因果讲透，中间给一个具体例子或反例，最后提醒最容易误解的地方。不要分点、不要小标题、不要「第一、第二」，就像老师当面讲一段话。',
  'quote 从这一段覆盖的页里逐字复制一句最关键的原文，不改写、不合并句子；title 是这一段讲什么，不超过 20 字。',
  '不要编造原文没有的事实。',
].join('\n')

export function buildContinuousPrompt(input: {
  title: string
  subject: string
  batch: ContinuousBatch
  habits: Habits
  repairNote?: string
}): { system: string; user: string } {
  const pages = input.batch.pages
    .map((page) => `${page.label}\n${page.text || '（这一页没有可读文字，也要用一句话带过）'}`)
    .join('\n\n')
  const user = [
    `课件：${input.title}${input.subject ? `；科目：${input.subject}` : ''}`,
    `这一批是${input.batch.range}，共 ${input.batch.pages.length} 页：${input.batch.pages.map((page) => page.number).join('、')}。`,
    '学生的习惯：',
    habitBrief(input.habits),
    '请按内容把这批页分成若干段，一段一段往下讲；保证每一页都在某一段里：',
    pages,
    input.repairNote ? `上一次输出不合格：${input.repairNote}。请重新输出完整 JSON。` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system: CONTINUOUS_SYSTEM, user }
}

export type ContinuousPlanOutcome = {
  units: Array<{
    title: string
    source: string
    minutes: number
    keyPoints: string[]
    segments: Array<{ source: string; explain: string; check: string }>
  }>
  coveredPages: number[]
  warnings: string[]
}

function firstSentence(page: MaterialPage): string {
  const lines = page.text
    .split(/[。；\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && !line.startsWith('【'))
  return lines[0] ?? page.text.trim().replace(/\s+/g, ' ').slice(0, 60)
}

/** 模型没拆出来时的兜底：一页一段，至少保证这一页在课堂里不消失。 */
function fallbackSections(pages: MaterialPage[]): ContinuousSectionDraft[] {
  return pages.map((page) => {
    const quote = firstSentence(page)
    return {
      pages: [page.number],
      title: page.text.trim().replace(/\s+/g, ' ').slice(0, 18) || `第 ${page.number} 页`,
      source: `第 ${page.number} 页`,
      minutes: 4,
      keyPoints: [],
      segments: [{
        source: quote || `第 ${page.number} 页`,
        explain: `这一页模型没拆出讲稿，先把原文关键句留在这里：${quote || '（这一页几乎没有可读文字）'}。你点「这段详细讲」，我再逐句展开，不会把这一页略过去。`,
        check: '',
      }],
    }
  })
}

/**
 * 连续讲：从头到尾按内容分段，每段一次调用、失败重试一次；仍失败就按页兜底并记警告。
 * 每一批都要求覆盖全部页码，模型漏页会重试，重试仍漏由兜底补齐，绝不静默跳过。
 */
export async function planContinuous(
  client: Pick<AiClient, 'complete'>,
  input: {
    title: string
    subject: string
    material: string
    habits: Habits
    onProgress?: (done: number, total: number) => void
    concurrency?: number
  },
): Promise<ContinuousPlanOutcome> {
  const pages = splitPages(input.material)
  const batches = batchForContinuity(pages)
  if (batches.length === 0) return { units: [], coveredPages: [], warnings: ['这份材料没有可讲的页。'] }
  const results: ContinuousSectionDraft[][] = new Array(batches.length)
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
      const allowedPages = batch.pages.map((page) => page.number)
      let sections: ContinuousSectionDraft[] | null = null
      let lastError = ''
      for (let attempt = 0; attempt < 2 && !sections; attempt += 1) {
        try {
          const prompt = buildContinuousPrompt({
            title: input.title,
            subject: input.subject,
            batch,
            habits: input.habits,
            repairNote: attempt ? lastError : undefined,
          })
          const raw = await client.complete(prompt.system, prompt.user, 12_000, 'disabled', 'plan-continuous')
          sections = parseContinuousPlan(raw, { allowedPages, maxSections: allowedPages.length })
        } catch (error) {
          lastError = error instanceof Error ? error.message : '输出不合格'
        }
      }
      if (!sections) {
        warnings.push(`${batch.range} 模型没按内容分段，已按页保留原文，没有漏页。原因：${lastError}`)
        sections = fallbackSections(batch.pages)
      }
      results[index] = sections
      done += 1
      input.onProgress?.(done, batches.length)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const covered = new Set(results.flat().flatMap((section) => section.pages))
  const coveredPages = [...covered].sort((a, b) => a - b)
  const missing = pages.map((page) => page.number).filter((page) => !covered.has(page))
  if (missing.length > 0) {
    warnings.push(`第 ${missing.join('、')} 页没有进课堂，已按原文补上，请对照原件。`)
  }
  return {
    units: results.flat().map((section) => ({
      title: section.title,
      source: section.source,
      minutes: section.minutes,
      keyPoints: section.keyPoints,
      segments: section.segments,
    })),
    coveredPages,
    warnings,
  }
}
