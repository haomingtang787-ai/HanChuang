import { describe, expect, it } from 'vitest'
import { createHarness, ScriptedWorker, writeTemp } from './helpers/app'
import { SAMPLE_TXT } from './helpers/builders'

/**
 * 整文件夹导入会一次排几十个任务。每个任务是一个独立进程 + 一份 PDF 缓存，
 * 全部同时开跑会把内存吃光，进程被系统杀掉，表现就是「处理进程失败」。
 * 这里锁住契约：默认同时只跑 1 个，其余排队，前一个结束才启动下一个。
 */
describe('解析任务排队', () => {
  it('一次导入三份时只同时启动一个进程，结束后再放行下一份', async () => {
    const worker = new ScriptedWorker()
    const app = await createHarness({ worker, repair: false })
    try {
      const files = ['a.txt', 'b.txt', 'c.txt'].map((name, index) => writeTemp(name, `${SAMPLE_TXT}\n第 ${index + 1} 份的独有句子。`))
      const jobs: string[] = []
      for (const file of files) {
        const imported = await app.importFile(file)
        expect(imported.ok).toBe(true)
        if (imported.ok) jobs.push(imported.data.jobId)
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(jobs).toHaveLength(3)
      expect(worker.started).toHaveLength(1)

      // 结束掉第一个，第二个应当被放出来
      for (let index = 0; index < 2; index += 1) {
        const cancelled = await app.service.cancel({ jobId: worker.started[index].jobId })
        expect(cancelled.ok).toBe(true)
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      expect(worker.started.length).toBe(3)
    } finally {
      await app.cleanup()
    }
  })
})
