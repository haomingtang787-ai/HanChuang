import { describe, expect, it } from 'vitest'
import { detectFormat } from '../src/documents/formats'
import { estimateCostYuan, formatYuan, streakOf } from '../src/renderer/hanchuang/logic'

describe('estimateCostYuan（DeepSeek 2026-11 牌价）', () => {
  it('flash：1M 未命中输入 + 1M 输出 = 3 元', () => {
    expect(estimateCostYuan('deepseek-flash', 1_000_000, 0, 1_000_000)).toBeCloseTo(3, 6)
  })
  it('deepseek-chat 按 flash 计：全缓存命中 1M = 0.02 元', () => {
    expect(estimateCostYuan('deepseek-chat', 1_000_000, 1_000_000, 0)).toBeCloseTo(0.02, 6)
  })
  it('pro：1M 输入 + 1M 输出 = 9 元', () => {
    expect(estimateCostYuan('deepseek-v4-pro', 1_000_000, 0, 1_000_000)).toBeCloseTo(9, 6)
  })
  it('零用量为 0，负数安全', () => {
    expect(estimateCostYuan('', 0, 0, 0)).toBe(0)
    expect(estimateCostYuan('deepseek-flash', -5, -5, -5)).toBe(0)
  })
})

describe('formatYuan', () => {
  it('不足一分不显示假精度', () => expect(formatYuan(0.004)).toBe('不足 1 分钱'))
  it('两位小数', () => expect(formatYuan(1.234)).toBe('约 ¥1.23'))
  it('零', () => expect(formatYuan(0)).toBe('¥0'))
})

describe('streakOf 连续学习天数', () => {
  it('连续三天含今天', () => expect(streakOf(['2026-11-16', '2026-11-17', '2026-11-18'], '2026-11-18')).toBe(3))
  it('今天还没学，算到昨天', () => expect(streakOf(['2026-11-16', '2026-11-17'], '2026-11-18')).toBe(2))
  it('断档重计', () => expect(streakOf(['2026-11-10', '2026-11-17', '2026-11-18'], '2026-11-18')).toBe(2))
  it('空记录为 0', () => expect(streakOf([], '2026-11-18')).toBe(0))
})

describe('代码课件按文本导入', () => {
  const bytes = new TextEncoder().encode('#include <stdio.h>\nint main(void){return 0;}\n')
  it('.c → txt', () => expect(detectFormat('list.c', bytes)).toBe('txt'))
  it('.java → txt', () => expect(detectFormat('Main.java', bytes)).toBe('txt'))
  it('.py → txt', () => expect(detectFormat('sort.py', bytes)).toBe('txt'))
  it('.sql → txt', () => expect(detectFormat('schema.sql', bytes)).toBe('txt'))
  it('二进制伪装 .c 仍被拒绝', () => {
    expect(() => detectFormat('x.c', new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toThrow()
  })
  it('未知扩展名仍被拒绝', () => {
    expect(() => detectFormat('x.exe', bytes)).toThrow()
  })
})