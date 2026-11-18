import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { latestSession, studyStage, studyUnitCount } from '../src/renderer/study/landing'

describe('1.1.0 书架 → 课程 → 这一讲', () => {
  it('没有详情时先书架，选了课程才进课程页，打开讲才进课堂', () => {
    expect(studyStage({ detail: false, activeCourse: false })).toBe('shelf')
    expect(studyStage({ detail: false, activeCourse: true })).toBe('course')
    expect(studyStage({ detail: true, activeCourse: true })).toBe('classroom')
    expect(studyStage({ detail: true, activeCourse: false })).toBe('classroom')
  })

  it('继续上次只取最近更新的一条', () => {
    const sessions = [
      { id: 'old', updatedAt: '2026-11-17T08:00:00.000Z' },
      { id: 'new', updatedAt: '2026-11-17T10:00:00.000Z' },
      { id: 'middle', updatedAt: '2026-11-17T09:00:00.000Z' },
    ]
    expect(latestSession(sessions)?.id).toBe('new')
    expect(latestSession([])).toBeNull()
  })

  it('课程页的总讲数由课件累加，不把单份课件误当成整门课', () => {
    expect(studyUnitCount({ sessions: [{ unitCount: 3 }, { unitCount: 4 }] })).toBe(7)
    expect(studyUnitCount(null)).toBe(0)
  })

  it('界面真的换成了书架和课程页，而不是旧首屏加说明', () => {
    const source = readFileSync('src/renderer/study/StudyView.tsx', 'utf8')
    const app = readFileSync('src/renderer/App.tsx', 'utf8')
    expect(source).toContain('ws-shelf-center')
    expect(source).toContain('ws-course-center')
    expect(source).toContain('继续上次')
    expect(source).toContain('我的课程')
    expect(source).toContain('← 书架')
    expect(source).not.toContain('ws-intro-center')
    expect(source).not.toContain('今天想学什么')
    expect(app).not.toContain('<nav className="tabs"')
  })

  it('复习页返回的是书架，不承诺回到已经不存在的上一屏课堂', () => {
    const review = readFileSync('src/renderer/teaching/ReviewView.tsx', 'utf8')
    expect(review).toContain('← 回书架')
    expect(review).not.toContain('← 回课堂')
  })

  it('学习习惯展开后书架仍可滚动，不被 flex 子项压扁', () => {
    const css = readFileSync('src/renderer/styles.css', 'utf8')
    expect(css).toContain('.shelf-scroll > *')
    expect(css).toContain('.course-scroll > *')
    expect(css).toContain('flex: 0 0 auto')
  })

  it('课堂头部有可见的总结入口，并说明总结后怎么做成复习卡', () => {
    const source = readFileSync('src/renderer/study/StudyView.tsx', 'utf8')
    const review = readFileSync('src/renderer/teaching/ReviewView.tsx', 'utf8')
    expect(source).toContain('ws-summary-btn')
    expect(source).toContain('总结这一讲')
    expect(source).toContain('做成复习卡')
    expect(review).toContain('回书架，打开一门课的某一讲')
  })
})
