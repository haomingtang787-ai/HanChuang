import { describe, expect, it } from 'vitest'
import type { StudySessionDetail, StudyUnit } from '../src/shared/study'
import { buildTimeline, currentUnitOrdinal, formatTokens, nextSegment, primaryLabel, totalSegments, type Reveal } from '../src/renderer/hanchuang/logic'

function unit(ordinal: number, segments: number): StudyUnit {
  return {
    id: `u${ordinal}`,
    ordinal,
    title: `第${ordinal + 1}讲`,
    source: '第 1 页',
    minutes: 5,
    keyPoints: [],
    segments: Array.from({ length: segments }, (_, index) => ({
      source: `原文${index}`,
      explain: `讲解${index}`,
      check: `问题${index}`,
    })),
  }
}

function detail(units: StudyUnit[]): StudySessionDetail {
  return {
    sessionId: 's1',
    documentVersionId: 'd1',
    courseId: 'c1',
    title: '测试课',
    subject: '数学',
    sourceName: '测试.pdf',
    layout: 'lecture',
    unitCount: units.length,
    messageCount: 0,
    status: 'ready',
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    overview: '',
    outline: [],
    units,
    messages: [],
    checks: [],
    warnings: [],
    truncated: false,
    materialChars: 0,
    materialChunks: 1,
    habits: { name: '同学', pace: 'steady', style: 'story', minutes: 25, window: 'evening', avoid: 'long' },
    summary: null,
    artifacts: [],
    teacherNote: null,
    usage: { calls: 0, promptTokens: 0, cachedTokens: 0, cacheMissTokens: 0, completionTokens: 0, reasoningTokens: 0, reportedCalls: 0, estimatedCalls: 0 },
  }
}

describe('寒窗讲课进度逻辑', () => {
  it('按讲序段序推进，讲完返回 null', () => {
    const units = [unit(0, 2), unit(1, 1)]
    expect(totalSegments(units)).toBe(3)
    expect(nextSegment(units, [])).toEqual({ unitOrdinal: 0, segmentIndex: 0 })
    const revealed: Reveal[] = [
      { unitOrdinal: 0, segmentIndex: 0, at: 1 },
      { unitOrdinal: 0, segmentIndex: 1, at: 2 },
    ]
    expect(nextSegment(units, revealed)).toEqual({ unitOrdinal: 1, segmentIndex: 0 })
    revealed.push({ unitOrdinal: 1, segmentIndex: 0, at: 3 })
    expect(nextSegment(units, revealed)).toBeNull()
  })

  it('乱序揭示也能找到真正缺的段', () => {
    const units = [unit(0, 2)]
    const revealed: Reveal[] = [{ unitOrdinal: 0, segmentIndex: 1, at: 1 }]
    expect(nextSegment(units, revealed)).toEqual({ unitOrdinal: 0, segmentIndex: 0 })
  })

  it('追问上下文取最近讲到的那一讲', () => {
    const units = [unit(0, 1), unit(1, 1)]
    expect(currentUnitOrdinal(units, [])).toBe(0)
    expect(currentUnitOrdinal(units, [{ unitOrdinal: 1, segmentIndex: 0, at: 1 }])).toBe(1)
  })

  it('主按钮文案随进度变化', () => {
    expect(primaryLabel(0, 3)).toBe('开始上课')
    expect(primaryLabel(1, 3)).toBe('继续上课 · 第 2/3 段')
    expect(primaryLabel(3, 3)).toBe('讲完了 · 总结这一讲')
    expect(primaryLabel(0, 0)).toBe('这份课件还没有讲稿')
  })

  it('聊天流按时间合并消息、讲课卡片和生成物', () => {
    const base = detail([unit(0, 1)])
    base.messages = [
      { id: 'm1', sessionId: 's1', role: 'assistant', unitOrdinal: null, content: '开场', citations: [], createdAt: '2026-11-18T10:00:00.000Z' },
      { id: 'm2', sessionId: 's1', role: 'user', unitOrdinal: 0, content: '提问', citations: [], createdAt: '2026-11-18T10:05:00.000Z' },
    ]
    base.artifacts = [
      {
        id: 'a1', kind: 'summary', scope: 'u0', title: '总结',
        body: { text: '总结正文' },
        createdAt: '2026-11-18T10:09:00.000Z', updatedAt: '2026-11-18T10:09:00.000Z',
      },
    ]
    const revealed: Reveal[] = [{ unitOrdinal: 0, segmentIndex: 0, at: Date.parse('2026-11-18T10:02:00.000Z') }]
    const timeline = buildTimeline(base, revealed)
    expect(timeline.map((item) => item.kind)).toEqual(['message', 'lecture', 'message', 'artifact'])
  })

  it('token 数格式化', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(2_500_000)).toBe('2.50M')
  })
})