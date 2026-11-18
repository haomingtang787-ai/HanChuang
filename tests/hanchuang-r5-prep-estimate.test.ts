import { describe, expect, test } from 'vitest'
import { estimatePrepCost, formatYuanRange } from '../src/renderer/hanchuang/logic'

describe('价格区间文案', () => {
  test('大额显示区间', () => {
    expect(formatYuanRange(0.038, 0.058)).toBe('¥0.04–0.06')
  })

  test('低于一分钱不显示 0.00', () => {
    expect(formatYuanRange(0.001, 0.003)).toBe('不到 1 分钱')
    expect(formatYuanRange(0.002, 0.012)).toBe('约 ¥0.01')
  })
})

describe('备课前费用预估', () => {
  test('82 页 PDF 的预估能把实测 3.7 万 tokens 包进去', () => {
    const est = estimatePrepCost('pdf', 82, 400)
    expect(est.readsImages).toBe(true)
    expect(est.tokensLow).toBeLessThanOrEqual(37000)
    expect(est.tokensHigh).toBeGreaterThanOrEqual(37000)
  })

  test('30 页 PPT 落在 1 万到 2.2 万之间', () => {
    const est = estimatePrepCost('pptx', 30, 200)
    expect(est.tokensLow).toBeGreaterThan(8000)
    expect(est.tokensHigh).toBeLessThan(24000)
  })

  test('纯文本不读图，预估明显更便宜', () => {
    const est = estimatePrepCost('txt', 1, 60)
    expect(est.readsImages).toBe(false)
    expect(est.tokensHigh).toBeLessThan(8000)
    expect(est.yuanLow).toBeLessThan(est.yuanHigh)
  })

  test('页数或块数为 0 也不给负数或 NaN', () => {
    const est = estimatePrepCost('docx', 0, 0)
    expect(Number.isFinite(est.tokensLow)).toBe(true)
    expect(est.tokensLow).toBeGreaterThan(0)
    expect(est.tokensLow).toBeLessThanOrEqual(est.tokensHigh)
  })
})
