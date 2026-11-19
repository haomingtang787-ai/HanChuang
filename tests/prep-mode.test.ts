import { describe, expect, it } from 'vitest'
import { readPrepMode } from '../src/renderer/hanchuang/logic'

describe('备课拆法默认值', () => {
  it('没选过就按页拆；主动选过「按主干」才走导览', () => {
    expect(readPrepMode(null)).toBe('page')
    expect(readPrepMode('')).toBe('page')
    expect(readPrepMode('page')).toBe('page')
    expect(readPrepMode('overview')).toBe('overview')
  })
})
