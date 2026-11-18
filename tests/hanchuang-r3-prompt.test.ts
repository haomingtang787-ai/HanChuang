import { describe, expect, test } from 'vitest'
import { buildStudyChatPrompt, buildStudyPlanPrompt } from '../src/study/prompt'
import { DEFAULT_HABITS } from '../src/teaching/habits'
import type { StudyUnit } from '../src/shared/study'

const habits = { ...DEFAULT_HABITS, name: 'Tommy' }

const unit: StudyUnit = {
  id: 'u1',
  ordinal: 0,
  title: '第一讲',
  source: '第 1 页',
  minutes: 10,
  keyPoints: ['要点一'],
  segments: [{ source: '原文一句话', explain: '讲解', check: '' }],
}

describe('讲解深度', () => {
  test('备课提示词要求每段 180–330 字并走四步', () => {
    const prompt = buildStudyPlanPrompt({
      title: '计组',
      subject: '计组',
      material: '正文',
      habits,
      truncated: false,
    })
    expect(prompt.system).toContain('180 到 330')
    expect(prompt.system).toContain('白话')
    expect(prompt.system).toContain('例子')
    expect(prompt.system).toContain('误解')
    expect(prompt.system).not.toContain('40 到 140')
  })

  test('备课提示词仍限制每讲 2 到 4 段，不按页平均拆', () => {
    const prompt = buildStudyPlanPrompt({
      title: '计组',
      subject: '计组',
      material: '正文',
      habits,
      truncated: false,
    })
    expect(prompt.system).toContain('2 到 4 个 segments')
    expect(prompt.system).toContain('绝不按页平均拆')
  })

  test('对话提示词支持「详细讲这一段」展开到 350–550 字', () => {
    const prompt = buildStudyChatPrompt({
      overview: '总览',
      outline: ['第一讲'],
      units: [unit],
      unit,
      messages: [],
      question: '详细讲这一段：原文一句话',
      habits,
    })
    expect(prompt.system).toContain('详细讲这一段')
    expect(prompt.system).toContain('350 到 550')
  })

  test('讲解不够清楚时明确要求补一个更小的例子，而不是只换说法', () => {
    const prompt = buildStudyChatPrompt({
      overview: '总览',
      outline: ['第一讲'],
      units: [unit],
      unit,
      messages: [],
      question: '没听懂',
      habits,
    })
    expect(prompt.system).toContain('小例子')
  })
})
