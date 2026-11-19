import { describe, expect, it } from 'vitest'
import { parseContinuousPlan } from '../src/study/parse'
import { batchForContinuity, buildContinuousPrompt, planContinuous } from '../src/study/continuous'
import { splitPages } from '../src/study/pagewise'
import { pageRangeOf } from '../src/renderer/hanchuang/logic'
import { mergeOpening } from '../src/study/prompt'
import type { Habits } from '../src/teaching/habits'
import { DEFAULT_HABITS } from '../src/teaching/habits'

const habits: Habits = { ...DEFAULT_HABITS }

function materialOf(count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const page = index + 1
    return `【第 ${page} 页】\n第 ${page} 页的正文。`.repeat(1)
  }).join('\n\n')
}

function validSection(pages: number[], title = '一段') {
  return {
    pages,
    title,
    quote: `第 ${pages[0]} 页的原文`,
    explain: `这一段讲的是第 ${pages[0]} 页的核心内容。`.repeat(8),
    keyPoints: ['要点'],
  }
}

describe('连续讲：按内容并页、逐段往下讲', () => {
  it('把长课件按 12 页一批切开，页码连续且全都保留', () => {
    const pages = splitPages(materialOf(30))
    const batches = batchForContinuity(pages)
    expect(batches.length).toBe(3)
    expect(batches[0]!.pages.map((page) => page.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(batches[1]!.range).toBe('第 13–24 页')
    expect(batches[2]!.range).toBe('第 25–30 页')
    expect(batches.flatMap((batch) => batch.pages.map((page) => page.number))).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    )
  })

  it('提示词把这一批每一页都交给模型，并明确不许漏页', () => {
    const pages = splitPages(materialOf(3))
    const batch = batchForContinuity(pages)[0]!
    const prompt = buildContinuousPrompt({ title: '课件', subject: '计组', batch, habits })
    for (const page of [1, 2, 3]) expect(prompt.user).toContain(`【第 ${page} 页】`)
    expect(prompt.system).toContain('每一页都必须出现在且只出现在一段里')
    expect(prompt.system).toContain('不要分点')
  })

  it('模型把连续页并成一段时照收，页码区间从原文生成', () => {
    const sections = parseContinuousPlan(JSON.stringify({ sections: [validSection([1, 2, 3], '分层')] }), {
      allowedPages: [1, 2, 3],
      maxSections: 3,
    })
    expect(sections).toHaveLength(1)
    expect(sections[0]!.source).toBe('第 1–3 页')
    expect(sections[0]!.segments[0]!.check).toBe('')
  })

  it('漏一页就整批判不合格，绝不静默跳过', () => {
    expect(() =>
      parseContinuousPlan(JSON.stringify({ sections: [validSection([1]), validSection([3])] }), {
        allowedPages: [1, 2, 3],
        maxSections: 3,
      }),
    ).toThrow(/漏讲了第 2 页/)
  })

  it('同一页被两段讲也算不合格', () => {
    expect(() =>
      parseContinuousPlan(JSON.stringify({ sections: [validSection([1, 2]), validSection([2, 3])] }), {
        allowedPages: [1, 2, 3],
        maxSections: 3,
      }),
    ).toThrow(/重复讲/)
  })

  it('模型两次都不合格时按页兜底，警告写明原因，页码一页不少', async () => {
    const calls: string[] = []
    const fake = {
      complete: async (_system: string, user: string) => {
        calls.push(user)
        if (user.includes('第 13 页，共 1 页')) throw new Error('模型偷懒')
        const first = Number(/这一批是第 (\d+)/.exec(user)![1])
        const last = Number(/第 \d+–(\d+) 页/.exec(user)?.[1] ?? first + 11)
        return JSON.stringify({
          sections: Array.from({ length: last - first + 1 }, (_, index) => validSection([first + index])),
        })
      },
    }
    const outcome = await planContinuous(fake as never, {
      title: '课件',
      subject: '',
      material: materialOf(13),
      habits,
      concurrency: 2,
    })
    expect(outcome.coveredPages).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
    expect(outcome.units).toHaveLength(13)
    expect(outcome.warnings.join('')).toMatch(/第 13 页.*按页保留原文/)
    expect(calls.length).toBe(3) // 第一批 1 次 + 第二批重试 1 次 + 兜底不再调模型
  })

  it('模型把页区间写进标题时剥掉前缀，课堂头部不重复', () => {
    const sections = parseContinuousPlan(JSON.stringify({ sections: [validSection([2, 3], '第 2–3 页：Software')] }), {
      allowedPages: [2, 3],
      maxSections: 2,
    })
    expect(sections[0]!.title).toBe('Software')
  })

  it('连续讲开场只报页，不再出现「第 1 讲」', () => {
    const units = [{ title: 'Software', source: '第 1–2 页', minutes: 4, keyPoints: [], segments: [] }]
    expect(mergeOpening('我们从第一页开始。', units as never, 'continuous')).toBe('我们从第一页开始。\n\n我们从第 1–2 页《Software》开始。')
    expect(mergeOpening('我们从第一页开始。', units as never, 'lecture')).toContain('第 1 讲')
  })

  it('顶栏只认页区间，不认「第几讲」', () => {
    expect(pageRangeOf('第 3 页')).toEqual({ start: 3, end: 3 })
    expect(pageRangeOf('第 3–5 页')).toEqual({ start: 3, end: 5 })
    expect(pageRangeOf('第 3-5 页')).toEqual({ start: 3, end: 5 })
    expect(pageRangeOf('第 1 讲')).toBeNull()
  })
})
