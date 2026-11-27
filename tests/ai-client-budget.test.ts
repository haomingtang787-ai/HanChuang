import { describe, expect, it, vi } from 'vitest'
import { AiClient, AiError, estimateImageTokens, type AiUsage } from '../src/ai/client'

const config = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', apiKey: 'k' }
const noWait = async () => {}

function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout')
  error.name = 'TimeoutError'
  return error
}

function jsonResponse(content: string, usage: Record<string, number>): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage,
    model: 'deepseek-flash',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function client(options: {
  fetchImpl: typeof fetch
  beforeCall?: () => void
  onUsage?: (kind: string, usage: AiUsage) => void
}): AiClient {
  return new AiClient(config, options.fetchImpl, 1_000, options.onUsage, options.beforeCall, noWait)
}

describe('模型重试与月度预算', () => {
  it('每一次真正发出的请求都先过预算', async () => {
    let calls = 0
    const beforeCall = vi.fn()
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls < 3) return new Response('busy', { status: 503 })
      return jsonResponse('好', { prompt_tokens: 10, completion_tokens: 4, prompt_cache_miss_tokens: 10 })
    }) as unknown as typeof fetch
    const text = await client({ fetchImpl, beforeCall }).complete('sys', 'user')
    expect(text).toBe('好')
    expect(beforeCall).toHaveBeenCalledTimes(3)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('预算到顶后不再发下一次重试', async () => {
    let checks = 0
    const beforeCall = () => {
      checks += 1
      if (checks >= 2) throw new AiError('LIMIT_EXCEEDED', '本月 AI 用量已达 100 tokens 上限')
    }
    const fetchImpl = vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch
    await expect(client({ fetchImpl, beforeCall }).complete('sys', 'user')).rejects.toThrow('上限')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('超时按已发出的提示词记一笔未回报用量', async () => {
    const noted: AiUsage[] = []
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(jsonResponse('好', { prompt_tokens: 8, completion_tokens: 2 })) as unknown as typeof fetch
    await client({ fetchImpl, onUsage: (_kind, usage) => noted.push(usage) }).complete('系统', '讲一下页表')
    expect(noted[0]?.providerReported).toBe(false)
    expect(noted[0]?.promptTokens).toBeGreaterThan(0)
    expect(noted[0]?.cacheMissTokens).toBe(noted[0]?.promptTokens)
    expect(noted[1]?.providerReported).toBe(true)
    expect(noted[1]?.promptTokens).toBe(8)
  })

  it('连不上服务器时不编造用量', async () => {
    const noted: AiUsage[] = []
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(client({ fetchImpl, onUsage: (_kind, usage) => noted.push(usage) }).complete('sys', 'user')).rejects.toThrow('连不上')
    expect(noted).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('可重试的错误响应里如果带了 usage，也记下来', async () => {
    const noted: AiUsage[] = []
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        usage: { prompt_tokens: 20, completion_tokens: 1, prompt_cache_miss_tokens: 20 },
        model: 'deepseek-flash',
      }), { status: 500 }))
      .mockResolvedValueOnce(jsonResponse('好', { prompt_tokens: 20, completion_tokens: 5 })) as unknown as typeof fetch
    await client({ fetchImpl, onUsage: (_kind, usage) => noted.push(usage) }).complete('sys', 'user')
    expect(noted.map((item) => item.promptTokens)).toEqual([20, 20])
    expect(noted[0]?.providerReported).toBe(true)
    expect(noted[1]?.completionTokens).toBe(5)
  })

  it('读图超时把图片本身的 token 也算进去', async () => {
    const noted: AiUsage[] = []
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(jsonResponse('图', { prompt_tokens: 3000, completion_tokens: 40 })) as unknown as typeof fetch
    await client({ fetchImpl, onUsage: (_kind, usage) => noted.push(usage) }).describeImage({
      mime: 'image/jpeg',
      base64: 'AAAA',
      prompt: '读这一页',
      width: 2048,
      height: 1152,
    })
    expect(noted[0]?.providerReported).toBe(false)
    expect(noted[0]?.promptTokens).toBeGreaterThanOrEqual(estimateImageTokens(2048, 1152))
    expect(noted[1]?.providerReported).toBe(true)
  })

  it('读图没有尺寸时用保守保底值，也不漏账', async () => {
    const noted: AiUsage[] = []
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(jsonResponse('图', { prompt_tokens: 1200, completion_tokens: 10 })) as unknown as typeof fetch
    await client({ fetchImpl, onUsage: (_kind, usage) => noted.push(usage) }).describeImage({
      mime: 'image/jpeg',
      base64: 'AAAA',
      prompt: '读图',
    })
    expect(noted[0]?.promptTokens).toBeGreaterThanOrEqual(1500)
  })
})
