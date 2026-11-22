/* DeepSeek 官方牌价（元/百万 tokens，2026-11 核实）。
 * 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * Flash：闲时 0.02 / 1 / 4，高峰 0.04 / 2 / 8（缓存命中 / 未命中 / 输出）
 * Pro：  闲时 0.15 / 4.5 / 13.5，高峰 0.3 / 9 / 27
 * 北京时间周一至周五 9:00-12:00、14:00-18:00 为高峰，其余时段为闲时；
 * 官方还排除法定节假日，这里只按工作日判断，节假日会按高峰算，属于偏高估计。
 */

export type PricePeriod = 'off-peak' | 'peak'

export type ModelPrice = {
  period: PricePeriod
  /** 元 / 百万 tokens。 */
  cacheHit: number
  cacheMiss: number
  output: number
}

const FLASH_OFF_PEAK: ModelPrice = { period: 'off-peak', cacheHit: 0.02, cacheMiss: 1, output: 4 }
const FLASH_PEAK: ModelPrice = { period: 'peak', cacheHit: 0.04, cacheMiss: 2, output: 8 }
const PRO_OFF_PEAK: ModelPrice = { period: 'off-peak', cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
const PRO_PEAK: ModelPrice = { period: 'peak', cacheHit: 0.3, cacheMiss: 9, output: 27 }

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 按北京时间判断是否高峰：周一至周五 9-12、14-18。 */
export function isPeakTime(at: Date = new Date()): boolean {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return false
  const beijing = new Date(at.getTime() + BEIJING_OFFSET_MS)
  const weekday = beijing.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

export function priceForModel(model: string, at: Date = new Date()): ModelPrice {
  const isPro = model.toLowerCase().includes('pro')
  if (isPro) return isPeakTime(at) ? PRO_PEAK : PRO_OFF_PEAK
  return isPeakTime(at) ? FLASH_PEAK : FLASH_OFF_PEAK
}

/** 单次调用的官方价估算：缓存命中、缓存未命中、输出分别按对应单价算。 */
export function estimateCallCostYuan(
  model: string,
  promptTokens: number,
  cachedTokens: number,
  completionTokens: number,
  at: Date = new Date(),
): number {
  const prompt = Math.max(0, Number.isFinite(promptTokens) ? promptTokens : 0)
  const completion = Math.max(0, Number.isFinite(completionTokens) ? completionTokens : 0)
  const cached = Math.min(prompt, Math.max(0, Number.isFinite(cachedTokens) ? cachedTokens : 0))
  if (prompt === 0 && completion === 0) return 0
  const miss = prompt - cached
  const price = priceForModel(model, at)
  return (miss * price.cacheMiss + cached * price.cacheHit + completion * price.output) / 1_000_000
}
