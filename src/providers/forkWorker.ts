import { fork, type ChildProcess } from 'node:child_process'
import type { ParseResult, ParseTask, ProgressReport } from '../documents/parseTypes'
import { buildWorkerEnv } from './workerEnv'
import type { WorkerHandle, WorkerHost } from './workerHost'

type WorkerMessage =
  | { type: 'progress'; stage: string; completed: number; total: number | null }
  | { type: 'result'; result: ParseResult }
  | { type: 'error'; code: string; message: string }

export class ForkWorker implements WorkerHost {
  constructor(private readonly entry: string) {}

  start(task: ParseTask, onProgress: (progress: ProgressReport) => void): WorkerHandle {
    const child: ChildProcess = fork(this.entry, [], {
      // 一份 80 页的 PDF 逐页取文本 + 渲染预览图，512MB 会在中途爆掉；
      // 配合「同时最多 2 个任务」，1GB 留够余量。
      execArgv: ['--max-old-space-size=1024'],
      env: buildWorkerEnv(process.env, task.workDir),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let settled = false
    const stderrTail: string[] = []
    child.stderr?.on('data', (chunk: Buffer) => {
      // 只留最近几段，崩溃时能看出是 OOM 还是某个页面/字体报错
      stderrTail.push(String(chunk))
      if (stderrTail.length > 8) stderrTail.shift()
    })
    let resolveDone: (result: ParseResult) => void = () => undefined
    let rejectDone: (error: Error) => void = () => undefined
    let resolveExit: () => void = () => undefined
    const done = new Promise<ParseResult>((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    })
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    child.on('message', (message: WorkerMessage) => {
      if (message?.type === 'progress') onProgress(message)
      if (message?.type === 'result') finish(() => resolveDone(message.result))
      if (message?.type === 'error') finish(() => rejectDone(new Error(message.message)))
    })
    child.once('exit', (code, signal) => {
      resolveExit()
      const tail = stderrTail.join('').trim().slice(-400)
      if (code !== 0 && code !== null) console.error(`[parse-worker] exit code=${code} signal=${signal ?? '-'}\n${tail}`)
      finish(() => rejectDone(new Error(`worker exited (code=${code ?? '-'} signal=${signal ?? '-'}) ${tail}`)))
    })
    child.once('error', (error) => {
      resolveExit()
      finish(() => rejectDone(error))
    })
    child.send({ type: 'start', task })
    return {
      done,
      exited,
      kill: () => {
        if (child.exitCode !== null || child.signalCode !== null) return
        child.kill('SIGTERM')
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
        child.once('exit', () => clearTimeout(timer))
      },
    }
  }
}
