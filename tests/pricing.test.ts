import { describe, expect, it } from 'vitest'
import { estimateCallCostYuan, isPeakTime, priceForModel } from '../src/shared/pricing'

const OFF_PEAK = new Date('2026-11-22T12:00:00Z') // 北京时间周日 20:00
const PEAK = new Date('2026-11-23T02:00:00Z') // 北京时间周一 10:00

describe('DeepSeek 峰谷时段', () => {
  it('周末全天闲时', () => {
    expect(isPeakTime(OFF_PEAK)).toBe(false)
  })

  it('工作日 9-12、14-18 为高峰，午休和晚上为闲时', () => {
    expect(isPeakTime(PEAK)).toBe(true)
    expect(isPeakTime(new Date('2026-11-23T04:30:00Z'))).toBe(false) // 北京时间 12:30
    expect(isPeakTime(new Date('2026-11-23T09:30:00Z'))).toBe(true) // 北京时间 17:30
    expect(isPeakTime(new Date('2026-11-23T10:00:00Z'))).toBe(false) // 北京时间 18:00 整，峰时结束
    expect(isPeakTime(new Date('2026-11-23T12:00:00Z'))).toBe(false) // 北京时间 20:00
  })

  it('模型价按峰谷切换，未知模型默认 flash', () => {
    expect(priceForModel('deepseek-flash', OFF_PEAK).output).toBe(4)
    expect(priceForModel('deepseek-flash', PEAK).output).toBe(8)
    expect(priceForModel('deepseek-v4-pro', OFF_PEAK).cacheMiss).toBe(4.5)
    expect(priceForModel('some-model', OFF_PEAK).cacheHit).toBe(0.02)
  })
})

describe('单次调用计费', () => {
  it('缓存命中、未命中、输出分别计价', () => {
    // 1M prompt 里 600k 命中，400k 未命中；输出 100k。闲时：0.4 + 0.012 + 0.4 = 0.812
    expect(estimateCallCostYuan('deepseek-flash', 1_000_000, 600_000, 100_000, OFF_PEAK)).toBeCloseTo(0.812, 6)
  })

  it('缓存命中数不会超过输入数', () => {
    expect(estimateCallCostYuan('deepseek-flash', 100, 200, 0, OFF_PEAK)).toBeCloseTo(0.000002, 8)
  })

  it('没有输入时不产生输入费', () => {
    expect(estimateCallCostYuan('deepseek-flash', 0, 0, 100, OFF_PEAK)).toBeCloseTo(0.0004, 6)
  })
})
