import { describe, expect, it } from 'vitest'
import { readPrepMode } from '../src/renderer/hanchuang/logic'

describe('备课拆法默认值', () => {
  it('没选过就连续讲；显式选过的模式照原样保留', () => {
    expect(readPrepMode(null)).toBe('continuous')
    expect(readPrepMode('')).toBe('continuous')
    expect(readPrepMode('page')).toBe('page')
    expect(readPrepMode('overview')).toBe('overview')
    expect(readPrepMode('continuous')).toBe('continuous')
  })
})
