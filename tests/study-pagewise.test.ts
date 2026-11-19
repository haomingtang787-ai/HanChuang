import { describe, expect, it } from 'vitest'
import { DEFAULT_HABITS } from '../src/teaching/habits'
import { batchPages, buildPagePlanPrompt, planPagewise, splitPages } from '../src/study/pagewise'
import { parsePagePlan } from '../src/study/parse'

const material = [
  '【第 1 页】封面：半导体存储器与寻址',
  '【第 2 页】分层存储：寄存器最快，主存次之，磁盘最慢。',
  '【第 3 页】局部性原理：时间局部性和空间局部性。',
  '【第 4 页】Cache 命中率 = 命中次数 / 总访问次数。',
  '【第 5 页】替换算法：LRU、FIFO。',
  '【第 6 页】写策略：写回与写直达。',
].join('\n\n')

describe('逐页拆讲', () => {
  it('按页标记切页，页码取原文而不是顺序', () => {
    const pages = splitPages(material)
    expect(pages.map((page) => page.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(pages[1]!.text).toContain('分层存储')
  })

  it('每批最多 4 页，长页独占一批', () => {
    const pages = splitPages(material)
    expect(batchPages(pages).map((batch) => batch.pages.length)).toEqual([4, 2])
    const huge = splitPages(`【第 1 页】${'很长的原文'.repeat(4000)}`)
    expect(batchPages(huge)).toHaveLength(1)
  })

  it('提示词要求一页一讲、原文逐字', () => {
    const pages = splitPages(material)
    const batch = batchPages(pages)[0]!
    const prompt = buildPagePlanPrompt({
      title: '计基',
      subject: '计算机基础',
      batch,
      habits: { ...DEFAULT_HABITS, note: '先给例子' },
    })
    expect(prompt.system).toContain('每一页至少一讲')
    expect(prompt.system).toContain('逐字复制')
    expect(prompt.user).toContain('第 1–4 页')
    expect(prompt.user).toContain('先给例子')
    expect(prompt.user).toContain('【第 2 页】')
  })

  it('解析允许超过 6 讲，但不超过这一批的上限', () => {
    const units = Array.from({ length: 7 }, (_, index) => ({
      title: `第 ${index + 1} 页讲了什么`,
      source: `第 ${index + 1} 页`,
      minutes: 4,
      keyPoints: ['一点'],
      segments: [{ source: `原文${index + 1}`, explain: '解释', check: '' }],
    }))
    const parsed = parsePagePlan(JSON.stringify({ units, skipped: [1, '3'] }), { maxUnits: 8 })
    expect(parsed.units).toHaveLength(7)
    expect(parsed.skipped).toEqual([1, 3])
    expect(() => parsePagePlan(JSON.stringify({ units }), { maxUnits: 4 })).toThrow(/上限/)
  })

  it('一批一个调用；两次都失败就按原文兜底并记警告', async () => {
    const calls: string[] = []
    const ok = JSON.stringify({
      units: [{
        title: '分层存储',
        source: '第 2 页',
        minutes: 4,
        keyPoints: ['寄存器最快'],
        segments: [{ source: '分层存储：寄存器最快，主存次之，磁盘最慢。', explain: '解释', check: '' }],
      }],
      skipped: [1],
    })
    const client = {
      async complete(_system: string, user: string) {
        calls.push(user.slice(0, 20))
        return ok
      },
    }
    const outcome = await planPagewise(client as never, {
      title: '计基',
      subject: '',
      material,
      habits: DEFAULT_HABITS,
      concurrency: 1,
    })
    expect(outcome.units).toHaveLength(2) // 两批都成功，各出一讲
    expect(calls.length).toBe(2)
    expect(outcome.skipped).toContain(1)

    const failing = { async complete() { throw new Error('模型挂了') } }
    const fallback = await planPagewise(failing as never, {
      title: '计基',
      subject: '',
      material,
      habits: DEFAULT_HABITS,
      concurrency: 1,
    })
    expect(fallback.units.length).toBeGreaterThan(0)
    expect(fallback.warnings.length).toBeGreaterThan(0)
  })
})
