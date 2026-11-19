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

  test('学生说没看懂要拓展时，允许讲课件外知识，不把老师锁在幻灯片里', () => {
    const prompt = buildStudyChatPrompt({
      overview: '总览',
      outline: ['第一讲'],
      units: [unit],
      unit,
      messages: [],
      question: '我还是没看懂，能不能拓展讲解一下ALU',
      habits,
    })
    expect(prompt.system).toContain('课件是这节课的主线，不是知识的天花板')
    expect(prompt.system).toContain('课件里没展开，我补一段')
    expect(prompt.system).toContain('不要因为课件没写就不讲')
    expect(prompt.system).not.toContain('如果课件不足以回答，明确说出来')
    expect(prompt.user).toContain('不是要你再念一遍课件')
    expect(prompt.user).toContain('至少给一个课件里没有的具体例子')
    expect(prompt.user).toContain('结尾不要再出题')
  })

  test('学生点名第 39 页时，把整页原文塞进提示词，不许说手上没有', () => {
    const prompt = buildStudyChatPrompt({
      overview: '总览',
      outline: ['第一讲'],
      units: [unit],
      unit,
      messages: [],
      question: '第39页我看不懂',
      habits,
      focus: [{ page: 39, text: '页表项的末位是有效位，清零表示这一页不在内存里。' }],
    })
    expect(prompt.user).toContain('第 39 页：页表项的末位是有效位，清零表示这一页不在内存里。')
    expect(prompt.user).toContain('不许说自己看不到')
  })
})
