import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { JobChangedEvent, JobSnapshot } from '../shared/contract'
import type { JobRow } from '../storage/store'
import { AppError } from './errors'

export function snapshot(job: JobRow | undefined): JobSnapshot | null {
  if (!job) return null
  return {
    jobId: job.id,
    state: job.state,
    stage: job.stage,
    completed: job.completed,
    total: job.total,
    ...(job.error_code ? { error: { code: job.error_code, message: job.error_message ?? '' } } : {}),
  }
}

export function toEvent(job: JobRow): JobChangedEvent {
  return {
    jobId: job.id,
    seq: job.seq,
    state: job.state,
    stage: job.stage,
    completed: job.completed,
    total: job.total,
  }
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/bmp':
      return 'bmp'
    default:
      return 'png'
  }
}

export async function readableFile(filePath: string): Promise<string> {
  const listed = await fs.promises.lstat(filePath)
  if (listed.isSymbolicLink()) {
    const real = await fs.promises.realpath(filePath)
    const stat = await fs.promises.stat(real)
    if (!stat.isFile()) throw new AppError('FILE_UNREADABLE', '选择的路径不是文件。')
    return real
  }
  if (!listed.isFile()) throw new AppError('FILE_UNREADABLE', '选择的路径不是文件。')
  return filePath
}

export async function readHeader(filePath: string): Promise<Uint8Array> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(16)
    await handle.read(buffer, 0, 16, 0)
    return buffer
  } finally {
    await handle.close()
  }
}

export function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

export function directoryBytes(dir: string): number {
  return walkDirectory(dir).bytes
}

/** 只清空目录里的内容，保留目录本身：库还在用这些路径。 */
export function purgeDirectory(dir: string): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    try {
      fs.rmSync(full, { recursive: true, force: true })
    } catch {
      /* 个别文件被占用就跳过，下一次清除会再处理。 */
    }
  }
}

export function countRows(db: { get: (sql: string) => unknown }, table: string): number {
  const row = db.get(`SELECT COUNT(*) AS total FROM ${table}`) as { total?: number } | undefined
  return Number(row?.total ?? 0)
}

export function pruneAutoBackups(parent: string, keep: number): number {
  let removed = 0
  try {
    const entries = fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name.startsWith('寒窗备份-') || entry.name.startsWith('灯下备份-')))
      .map((entry) => {
        const full = path.join(parent, entry.name)
        return { full, mtime: fs.statSync(full).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    for (const entry of entries.slice(Math.max(1, keep))) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(entry.full, 'manifest.json'), 'utf8')) as { product?: unknown }
        if (manifest.product !== '寒窗' && manifest.product !== '灯下') continue
        if (path.dirname(entry.full) !== parent) continue
        fs.rmSync(entry.full, { recursive: true, force: true })
        removed += 1
      } catch {
        /* 不是完整的灯下备份就不动它。 */
      }
    }
  } catch {
    /* 目录读不到时不阻断备份。 */
  }
  return removed
}

export function walkDirectory(rootDir: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  const stack = [rootDir]
  while (stack.length) {
    const current = stack.pop() as string
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        files += 1
        bytes += fileBytes(full)
      }
    }
  }
  return { bytes, files }
}

export function sqliteIntegrityOk(file: string): boolean {
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(file, { readOnly: true })
    const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: unknown } | undefined
    return row?.integrity_check === 'ok'
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* 打不开或已关闭都不影响结论。 */
    }
  }
}

export function backupStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
