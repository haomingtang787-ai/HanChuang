import { describe, expect, it } from 'vitest'
import { detectFormat } from '../src/documents/formats'
import { estimateCostYuan, formatYuan, streakOf } from '../src/renderer/hanchuang/logic'

const OFF_PEAK = new Date('2026-11-22T12:00:00Z') // 北京时间周日 20:00
const PEAK = new Date('2026-11-23T02:00:00Z') // 北京时间周一 10:00

describe('estimateCostYuan（DeepSeek 2026-11 官方峰谷价）', () => {
  it('flash 闲时：1M 未命中输入 + 1M 输出 = 5 元', () => {
    expect(estimateCostYuan('deepseek-flash', 1_000_000, 0, 1_000_000, OFF_PEAK)).toBeCloseTo(5, 6)
  })
  it('flash 高峰：1M 未命中输入 + 1M 输出 = 10 元', () => {
    expect(estimateCostYuan('deepseek-flash', 1_000_000, 0, 1_000_000, PEAK)).toBeCloseTo(10, 6)
  })
  it('flash 全缓存命中 1M：闲时 0.02，高峰 0.04', () => {
    expect(estimateCostYuan('deepseek-chat', 1_000_000, 1_000_000, 0, OFF_PEAK)).toBeCloseTo(0.02, 6)
    expect(estimateCostYuan('deepseek-chat', 1_000_000, 1_000_000, 0, PEAK)).toBeCloseTo(0.04, 6)
  })
  it('pro 闲时 1M 未命中输入 + 1M 输出 = 18 元，高峰 = 36 元', () => {
    expect(estimateCostYuan('deepseek-v4-pro', 1_000_000, 0, 1_000_000, OFF_PEAK)).toBeCloseTo(18, 6)
    expect(estimateCostYuan('deepseek-v4-pro', 1_000_000, 0, 1_000_000, PEAK)).toBeCloseTo(36, 6)
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