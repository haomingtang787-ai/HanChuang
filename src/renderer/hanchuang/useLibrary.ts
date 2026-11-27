import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderFile, JobChangedEvent } from '../../shared/contract'
import { CODE_EXTENSIONS } from '../../shared/contract'
import type { DeskApi } from '../../preload'
import type { PendingUpload } from './Sidebar'
import {
  diffFolderFiles, dropAsset, dropFolderWatch, estimatePrepCost, formatYuanRange,
  loadAssets, loadFolderWatches, rememberFiles, saveAssets, saveFolderWatches, upsertAsset, upsertFolderWatch,
  type AssetItem, type FolderKnownFile, type FolderWatch,
} from './logic'

export type JobMeta = {
  courseId: string
  dvid: string
  name: string
  prep: boolean
  /** 文件夹导入的元数据：成功后写进素材，并记住已扫过的文件签名。 */
  relativePath?: string
  sourcePath?: string
  sizeBytes?: number
  modifiedMs?: number
  /** 侧栏进度行用相对路径做键，避免不同子目录里的同名文件互相覆盖。 */
  pendingKey?: string
}

type Tone = 'info' | 'bad' | 'good'

const FILE_ACCEPT = ['.pptx', '.docx', '.pdf', '.txt', '.md', '.markdown', '.png', '.jpg', '.jpeg', ...CODE_EXTENSIONS.map((ext) => `.${ext}`)].join(',')

/**
 * 素材库和文件夹同步。课堂对话不放这里：解析完成后要备课的，交给 onPrep。
 */
export function useLibrary(options: {
  api: DeskApi | undefined
  notify: (tone: Tone, text: string) => void
  /** 还没配模型时返回 false，并自行提示。只拦「上传即备课」和点「备课」。 */
  ensureModel: () => boolean
  onPrep: (meta: JobMeta) => void
}) {
  const { api, notify, ensureModel, onPrep } = options

  const [pending, setPending] = useState<PendingUpload[]>([])
  const [assets, setAssets] = useState<AssetItem[]>(loadAssets)
  const [folderWatches, setFolderWatches] = useState<FolderWatch[]>(loadFolderWatches)
  const [assetCosts, setAssetCosts] = useState<Record<string, string>>({})

  const jobMeta = useRef<Map<string, JobMeta>>(new Map())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadTarget = useRef<string | null>(null)
  const folderWatchesRef = useRef<FolderWatch[]>(folderWatches)
  const pendingRef = useRef<PendingUpload[]>(pending)
  const syncingFolders = useRef<Set<string>>(new Set())
  const folderErrorNotified = useRef<Set<string>>(new Set())
  const folderChangedNotified = useRef<Set<string>>(new Set())
  const folderSkippedNotified = useRef<Set<string>>(new Set())
  const syncFolderRef = useRef<(courseId: string, manual?: boolean) => Promise<void>>(async () => {})

  useEffect(() => {
    folderWatchesRef.current = folderWatches
    saveFolderWatches(folderWatches)
  }, [folderWatches])

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  useEffect(() => {
    if (!api) return
    if (assets.length === 0) {
      setAssetCosts({})
      return
    }
    let alive = true
    void (async () => {
      const rows = await Promise.all(assets.map(async (asset) => {
        const info = await api.documents.get({ documentVersionId: asset.documentVersionId })
        if (!info.ok) return [asset.documentVersionId, ''] as const
        const est = estimatePrepCost(info.data.format, info.data.pageCount, info.data.blockCount)
        const tokens = `${Math.round(est.tokensLow / 1000)}k–${Math.round(est.tokensHigh / 1000)}k`
        return [asset.documentVersionId, `${formatYuanRange(est.yuanLow, est.yuanHigh)} · ${tokens}`] as const
      }))
      if (!alive) return
      setAssetCosts(Object.fromEntries(rows.filter(([, value]) => value !== '')))
    })()
    return () => { alive = false }
  }, [api, assets])

  const commitAsset = useCallback((meta: JobMeta) => {
    setAssets((prev) => {
      let next = prev
      if (meta.relativePath) {
        next = next.filter((item) => !(item.courseId === meta.courseId
          && item.relativePath === meta.relativePath
          && item.documentVersionId !== meta.dvid))
      }
      next = upsertAsset(next, {
        courseId: meta.courseId,
        documentVersionId: meta.dvid,
        name: meta.name,
        addedAt: new Date().toISOString(),
        ...(meta.sourcePath ? { sourcePath: meta.sourcePath } : {}),
        ...(meta.relativePath ? { relativePath: meta.relativePath } : {}),
      })
      saveAssets(next)
      return next
    })
  }, [])

  const markKnownInWatch = useCallback((meta: JobMeta) => {
    if (!meta.relativePath || meta.sizeBytes === undefined || meta.modifiedMs === undefined) return
    const file: FolderFile = {
      path: meta.sourcePath ?? '',
      name: meta.name,
      relativePath: meta.relativePath,
      sizeBytes: meta.sizeBytes,
      modifiedMs: meta.modifiedMs,
    }
    setFolderWatches((prev) => {
      const watch = prev.find((item) => item.courseId === meta.courseId)
      if (!watch) return prev
      const next = prev.map((item) => item.courseId !== meta.courseId
        ? item
        : {
            ...item,
            known: rememberFiles(item.known, [file]),
            failed: Object.fromEntries(Object.entries(item.failed).filter(([path]) => path !== meta.relativePath)),
            changedPaths: item.changedPaths.filter((path) => path !== meta.relativePath),
            error: null,
          })
      folderWatchesRef.current = next
      return next
    })
  }, [])

  const updateWatch = useCallback((courseId: string, patch: Partial<FolderWatch>) => {
    setFolderWatches((prev) => {
      const next = prev.map((item) => item.courseId === courseId ? { ...item, ...patch } : item)
      folderWatchesRef.current = next
      return next
    })
  }, [])

  const markFolderFailure = useCallback((
    courseId: string,
    relativePath: string | undefined,
    sizeBytes: number | undefined,
    modifiedMs: number | undefined,
    reason: string,
  ) => {
    if (!relativePath || sizeBytes === undefined || modifiedMs === undefined) return
    setFolderWatches((prev) => {
      const watch = prev.find((item) => item.courseId === courseId)
      if (!watch) return prev
      const detail = reason.replace(/\s+/g, ' ').trim().slice(0, 200) || '解析失败'
      const next = prev.map((item) => item.courseId !== courseId
        ? item
        : {
            ...item,
            failed: {
              ...item.failed,
              [relativePath]: { sizeBytes, modifiedMs, reason: detail },
            },
          })
      folderWatchesRef.current = next
      return next
    })
  }, [])

  const notePrep = useCallback((documentVersionId: string, stage: string) => {
    setPending((prev) => prev.map((item) => item.dvid === documentVersionId ? { ...item, stage } : item))
  }, [])

  const forgetCourse = useCallback((courseId: string) => {
    setFolderWatches((prev) => {
      const next = dropFolderWatch(prev, courseId)
      folderWatchesRef.current = next
      return next
    })
    setAssets((prev) => {
      const next = prev.filter((item) => item.courseId !== courseId)
      saveAssets(next)
      return next
    })
  }, [])

  useEffect(() => {
    if (!api) return
    const finishJob = (meta: JobMeta, state: string, message?: string): void => {
      setPending((prev) => prev.filter((item) => !(item.courseId === meta.courseId
        && item.name === (meta.pendingKey ?? meta.name))))
      if (state !== 'succeeded' && state !== 'partial') {
        notify('bad', `《${meta.name}》解析失败：${message ?? state}`)
        markFolderFailure(meta.courseId, meta.relativePath, meta.sizeBytes, meta.modifiedMs, message ?? state)
        return
      }
      if (meta.prep) {
        onPrep(meta)
        return
      }
      commitAsset(meta)
      markKnownInWatch(meta)
    }
    const off = api.jobs.onChanged((event: JobChangedEvent) => {
      const meta = jobMeta.current.get(event.jobId)
      if (!meta) return
      if (event.state === 'queued' || event.state === 'running') {
        setPending((prev) => prev.map((item) =>
          item.courseId === meta.courseId && item.name === (meta.pendingKey ?? meta.name)
            ? { ...item, stage: event.total ? `解析中 ${event.completed}/${event.total}` : '解析中' }
            : item,
        ))
        return
      }
      if (!jobMeta.current.delete(event.jobId)) return
      finishJob(meta, event.state)
    })
    return () => { off() }
  }, [api, notify, onPrep, commitAsset, markKnownInWatch, markFolderFailure])

  function upload(courseId: string): void {
    if (!ensureModel()) return
    uploadTarget.current = courseId
    fileInputRef.current?.click()
  }

  async function importFiles(courseId: string, files: File[], prep = true): Promise<void> {
    if (!api) return
    for (const file of files) {
      const filePath = api.documents.pathForFile(file)
      if (!filePath) {
        notify('bad', `《${file.name}》：读不到文件路径，请改用「上传课件」按钮或「导入整个文件夹」`)
        continue
      }
      setPending((prev) => [...prev, { courseId, name: file.name, stage: '正在导入' }])
      const result = await api.documents.importPath({ path: filePath, requestId: crypto.randomUUID() })
      if (!result.ok) {
        setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === file.name)))
        notify('bad', `《${file.name}》：${result.error.message}`)
        continue
      }
      const meta: JobMeta = { courseId, dvid: result.data.documentVersionId, name: file.name, prep }
      setPending((prev) => prev.map((item) =>
        item.courseId === courseId && item.name === file.name ? { ...item, dvid: meta.dvid } : item,
      ))
      if (result.data.duplicate) {
        setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === file.name)))
        if (prep) {
          onPrep(meta)
        } else {
          setAssets((prev) => {
            const next = upsertAsset(prev, {
              courseId, documentVersionId: meta.dvid, name: meta.name, addedAt: new Date().toISOString(),
            })
            saveAssets(next)
            return next
          })
        }
        continue
      }
      jobMeta.current.set(result.data.jobId, meta)
      setPending((prev) => prev.map((item) =>
        item.courseId === courseId && item.name === file.name ? { ...item, stage: '解析中' } : item,
      ))
      const job = await api.jobs.get({ jobId: result.data.jobId })
      if (job.ok && job.data.state !== 'queued' && job.data.state !== 'running') {
        if (jobMeta.current.delete(result.data.jobId)) {
          setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === file.name)))
          if (job.data.state === 'succeeded' || job.data.state === 'partial') {
            if (prep) {
              onPrep(meta)
            } else {
              setAssets((prev) => {
                const next = upsertAsset(prev, {
                  courseId, documentVersionId: meta.dvid, name: meta.name, addedAt: new Date().toISOString(),
                })
                saveAssets(next)
                return next
              })
            }
          } else {
            notify('bad', `《${file.name}》解析失败：${job.data.error?.message ?? job.data.state}`)
          }
        }
      }
    }
  }

  async function importFolderFile(courseId: string, file: FolderFile): Promise<boolean> {
    if (!api) return false
    const pendingKey = file.relativePath || file.name
    setPending((prev) => [...prev, { courseId, name: pendingKey, stage: '正在导入' }])
    const result = await api.documents.importPath({ path: file.path, requestId: crypto.randomUUID() })
    if (!result.ok) {
      setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === pendingKey)))
      notify('bad', `《${pendingKey}》：${result.error.message}`)
      markFolderFailure(courseId, file.relativePath, file.sizeBytes, file.modifiedMs, result.error.message)
      return false
    }
    const meta: JobMeta = {
      courseId,
      dvid: result.data.documentVersionId,
      name: file.name,
      prep: false,
      relativePath: file.relativePath,
      sourcePath: file.path,
      sizeBytes: file.sizeBytes,
      modifiedMs: file.modifiedMs,
      pendingKey,
    }
    if (result.data.duplicate) {
      setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === pendingKey)))
      commitAsset(meta)
      markKnownInWatch(meta)
      return true
    }
    jobMeta.current.set(result.data.jobId, meta)
    const job = await api.jobs.get({ jobId: result.data.jobId })
    if (job.ok && job.data.state !== 'queued' && job.data.state !== 'running' && jobMeta.current.delete(result.data.jobId)) {
      setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === pendingKey)))
      if (job.data.state === 'succeeded' || job.data.state === 'partial') {
        commitAsset(meta)
        markKnownInWatch(meta)
        return true
      }
      notify('bad', `《${pendingKey}》解析失败：${job.data.error?.message ?? job.data.state}`)
      markFolderFailure(courseId, file.relativePath, file.sizeBytes, file.modifiedMs, job.data.error?.message ?? job.data.state)
      return false
    }
    return true
  }

  async function syncCourseFolder(courseId: string, manual = false, confirmChanged = true): Promise<void> {
    if (!api) return
    const watch = folderWatchesRef.current.find((item) => item.courseId === courseId)
    if (!watch || !watch.enabled) return
    if (syncingFolders.current.has(courseId) || pendingRef.current.some((item) => item.courseId === courseId)) return
    syncingFolders.current.add(courseId)
    try {
      const scan = await api.documents.scanFolder({ path: watch.folder })
      if (!scan.ok) {
        updateWatch(courseId, { error: scan.error.message, lastScanAt: new Date().toISOString() })
        if (!folderErrorNotified.current.has(courseId)) {
          folderErrorNotified.current.add(courseId)
          notify('bad', `文件夹同步失败：${scan.error.message}`)
        }
        return
      }
      folderErrorNotified.current.delete(courseId)
      const alive = new Set(scan.data.files.map((file) => file.relativePath))
      const failed = Object.fromEntries(Object.entries(watch.failed).filter(([path]) => alive.has(path)))
      const diff = diffFolderFiles(watch, scan.data.files)
      updateWatch(courseId, {
        lastScanAt: new Date().toISOString(),
        error: null,
        failed,
        oversized: scan.data.oversized ?? 0,
        changedPaths: diff.changed.map((file) => file.relativePath),
        missingPaths: diff.missing,
      })
      if ((scan.data.oversized ?? 0) > 0) {
        if (!folderSkippedNotified.current.has(watch.folder)) {
          folderSkippedNotified.current.add(watch.folder)
          notify('info', `这个文件夹里有 ${scan.data.oversized} 份文件超过 50 MB，已跳过自动导入，不会再反复重试；需要的话请压缩或拆分后再放进来。`)
        }
      } else {
        folderSkippedNotified.current.delete(watch.folder)
      }
      if (diff.changed.length > 0) {
        if (!manual && !folderChangedNotified.current.has(courseId)) {
          folderChangedNotified.current.add(courseId)
          notify('info', `同步文件夹里有 ${diff.changed.length} 份课件内容改过了；为了不覆盖旧课堂，没有自动重导。点「立即同步」可以更新。`)
        }
      } else {
        folderChangedNotified.current.delete(courseId)
      }
      const targets = manual ? [...diff.added, ...diff.changed] : diff.added
      if (targets.length === 0) return
      if (manual && diff.changed.length > 0 && confirmChanged) {
        const ok = window.confirm(
          `有 ${diff.changed.length} 份课件内容改过了，重新导入会生成新版本，旧课堂和旧素材不会被删。\n继续同步吗？`,
        )
        if (!ok) return
      }
      if (!manual) notify('info', `文件夹里新加了 ${targets.length} 份课件，正在自动导入素材库`)
      let imported = 0
      for (const file of targets) {
        if (await importFolderFile(courseId, file)) imported += 1
      }
      updateWatch(courseId, { lastScanAt: new Date().toISOString() })
      if (imported > 0) {
        notify('good', manual
          ? `已同步 ${imported} 份课件；解析完成后会出现在素材库，点「备课」再开讲`
          : `已自动收下 ${imported} 份新课件；解析完成后会出现在素材库，不会自动花 token`)
      }
    } finally {
      syncingFolders.current.delete(courseId)
    }
  }

  async function importFolder(courseId: string): Promise<void> {
    if (!api) return
    if (pendingRef.current.some((item) => item.courseId === courseId)) {
      notify('info', '这个课程还有文件在导入／解析，等它跑完再选文件夹')
      return
    }
    const scan = await api.documents.scanFolder({})
    if (!scan.ok) {
      notify('bad', scan.error.message)
      return
    }
    if (scan.data.cancelled || !scan.data.folder) return
    const existing = folderWatchesRef.current.find((item) => item.courseId === courseId)
    const sameFolder = existing?.folder === scan.data.folder
    const known: Record<string, FolderKnownFile> = sameFolder ? { ...existing.known } : {}
    if (!sameFolder) {
      const existingNames = new Set(assets.filter((item) => item.courseId === courseId).map((item) => item.name))
      for (const file of scan.data.files) {
        if (existingNames.has(file.name)) known[file.relativePath] = { sizeBytes: file.sizeBytes, modifiedMs: file.modifiedMs }
      }
    }
    const folderName = scan.data.folder.split(/[\\/]/).pop() ?? ''
    const watch: FolderWatch = {
      courseId,
      folder: scan.data.folder,
      folderName,
      enabled: true,
      known,
      failed: sameFolder ? { ...(existing?.failed ?? {}) } : {},
      oversized: sameFolder ? (existing?.oversized ?? 0) : 0,
      lastScanAt: existing?.lastScanAt ?? null,
      error: null,
      changedPaths: [],
      missingPaths: [],
    }
    const diff = diffFolderFiles(watch, scan.data.files)
    const skippedNote = scan.data.skipped > 0 ? `\n另有 ${scan.data.skipped} 个不支持或隐藏的文件会跳过。` : ''
    const oversizedNote = (scan.data.oversized ?? 0) > 0
      ? `\n另有 ${scan.data.oversized} 个文件超过 50 MB，自动同步会跳过它们，不再反复导入。`
      : ''
    const summary = scan.data.files.length === 0
      ? `「${folderName}」里现在还没有能导入的课件。要把它设为自动同步文件夹吗？以后放进去的课件会自动进来。${oversizedNote}`
      : sameFolder
        ? `「${folderName}」已经在这个课程里同步：${diff.added.length} 份新增，${diff.changed.length} 份内容有更新。\n继续同步吗？${oversizedNote}`
        : `选中「${folderName}」，找到 ${scan.data.files.length} 份课件。\n以后直接往这个文件夹里放新课件，寒窗会自动导入，不用重新选。\n只导入素材、不自动备课，不花 token。${skippedNote}${oversizedNote}`
    if (!window.confirm(summary)) return
    const next = upsertFolderWatch(folderWatchesRef.current, watch)
    folderWatchesRef.current = next
    setFolderWatches(next)
    setAssets((prev) => {
      let changed = false
      const migrated = prev.map((asset) => {
        if (asset.courseId !== courseId || asset.relativePath) return asset
        const file = scan.data.files.find((item) => item.name === asset.name)
        if (!file) return asset
        changed = true
        return { ...asset, sourcePath: file.path, relativePath: file.relativePath }
      })
      if (!changed) return prev
      saveAssets(migrated)
      return migrated
    })
    if (scan.data.files.length > 0 && diff.added.length + diff.changed.length > 0) {
      await syncCourseFolder(courseId, true, false)
    } else {
      notify('good', `已设为自动同步：以后往「${folderName}」里放课件就会自动进来`)
    }
  }

  function prepAsset(courseId: string, documentVersionId: string, name: string): void {
    if (!ensureModel()) return
    setAssets((prev) => {
      const next = dropAsset(prev, courseId, documentVersionId)
      saveAssets(next)
      return next
    })
    onPrep({ courseId, dvid: documentVersionId, name, prep: true })
  }

  function removeAsset(courseId: string, documentVersionId: string): void {
    setAssets((prev) => {
      const next = dropAsset(prev, courseId, documentVersionId)
      saveAssets(next)
      return next
    })
    notify('info', '已从素材里移出；课件还在文档库，随时可以再点「＋ 上传课件」重新导入')
  }

  function resumeSync(courseId: string): void {
    const watch = folderWatchesRef.current.find((item) => item.courseId === courseId)
    if (!watch) return
    if (!watch.enabled) {
      const next = upsertFolderWatch(folderWatchesRef.current, { ...watch, enabled: true, error: null })
      folderWatchesRef.current = next
      setFolderWatches(next)
    }
    void syncCourseFolder(courseId, true)
  }

  function stopFolder(courseId: string): void {
    const watch = folderWatchesRef.current.find((item) => item.courseId === courseId)
    updateWatch(courseId, { enabled: false })
    notify('info', watch ? `已停止自动同步「${watch.folderName}」；素材和课堂都保留` : '已停止自动同步')
  }

  syncFolderRef.current = syncCourseFolder

  useEffect(() => {
    if (!api) return
    const tick = (): void => {
      for (const watch of folderWatchesRef.current) {
        if (watch.enabled) void syncFolderRef.current(watch.courseId, false)
      }
    }
    const timer = window.setInterval(tick, 15_000)
    const kick = window.setTimeout(tick, 1_000)
    const onFocus = (): void => tick()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(kick)
      window.removeEventListener('focus', onFocus)
    }
  }, [api])

  return {
    pending,
    assets,
    folderWatches,
    assetCosts,
    fileInputRef,
    fileAccept: FILE_ACCEPT,
    notePrep,
    forgetCourse,
    upload,
    importFiles,
    importFolder,
    prepAsset,
    removeAsset,
    resumeSync,
    stopFolder,
    onFilePicked(files: File[]) {
      const courseId = uploadTarget.current
      if (courseId && files.length > 0) void importFiles(courseId, files)
    },
  }
}
