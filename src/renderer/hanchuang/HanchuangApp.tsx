import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiConfigView } from '../../shared/ai'
import type { JobChangedEvent } from '../../shared/contract'
import type {
  StudyCourseTree, StudyProgress, StudyQuizAnswer, StudySessionDetail, StudySessionListItem, StudyToolKind, StudyUsageAudit,
} from '../../shared/study'
import { ChatStream } from './ChatStream'
import { BrandMark } from './BrandMark'
import { Composer } from './Composer'
import { ReviewPanel } from './ReviewPanel'
import { SettingsPanel } from './SettingsPanel'
import { Sidebar, type PendingUpload } from './Sidebar'
import { SourcePane } from './SourcePane'
import { SourceSearch } from './SourceSearch'
import { CODE_EXTENSIONS } from '../../shared/contract'
import {
  currentUnitOrdinal, dropAsset, estimateCostYuan, estimatePrepCost, formatYuan, formatYuanRange, loadAssets, loadPanePref,
  loadPrepMode, loadSidebarOpen, loadStudyDays, nextSegment, prepPhaseLabel, saveAssets, savePanePref, saveSidebarOpen, streakOf, todayKey,
  totalSegments, touchStudyDay, upsertAsset,
  type AssetItem, type PanePref, type Reveal,
} from './logic'

type Tone = 'info' | 'bad' | 'good'
type Toast = { id: number; tone: Tone; text: string }
type Busy = null | 'create' | 'send' | 'tool' | 'check' | 'grade' | 'finish'
type JobMeta = { courseId: string; dvid: string; name: string; prep: boolean }
/** 左侧原件面板要显示什么：哪份课件、停在哪一页、老师引出的是哪句。 */
type PreviewState = { documentVersionId: string; title: string; quote: string; page?: number }

const REVEAL_KEY = 'hc.revealed.v1'

function loadRevealed(): Record<string, Reveal[]> {
  try {
    const raw = localStorage.getItem(REVEAL_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, Reveal[]> : {}
  } catch {
    return {}
  }
}

export function HanchuangApp() {
  const api = window.desk

  const [courses, setCourses] = useState<StudyCourseTree | null>(null)
  const [sessions, setSessions] = useState<StudySessionListItem[]>([])
  const [detail, setDetail] = useState<StudySessionDetail | null>(null)
  const [ai, setAi] = useState<AiConfigView | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [teacherName, setTeacherName] = useState('老师')
  const [revealedMap, setRevealedMap] = useState<Record<string, Reveal[]>>(loadRevealed)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [assets, setAssets] = useState<AssetItem[]>(loadAssets)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [progress, setProgress] = useState<StudyProgress | null>(null)
  const [view, setView] = useState<'chat' | 'review'>('chat')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => loadSidebarOpen() ?? true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [missCount, setMissCount] = useState(0)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usageAudit, setUsageAudit] = useState<StudyUsageAudit | null>(null)
  const [welcomeName, setWelcomeName] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('hc.theme.v1') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  const [streak, setStreak] = useState(() => streakOf(loadStudyDays(), todayKey()))
  const [pane, setPane] = useState<PanePref>(loadPanePref)
  const [assetCosts, setAssetCosts] = useState<Record<string, string>>({})

  const detailRef = useRef<StudySessionDetail | null>(null)
  const sessionsRef = useRef<StudySessionListItem[]>([])
  const coursesRef = useRef<StudyCourseTree | null>(null)
  const aiRef = useRef<AiConfigView | null>(null)
  const jobMeta = useRef<Map<string, JobMeta>>(new Map())
  const createQueue = useRef<JobMeta[]>([])
  const creating = useRef(false)
  const toastSeq = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadTarget = useRef<string | null>(null)

  function toggleTheme(): void {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light'
      try { localStorage.setItem('hc.theme.v1', next) } catch { /* 存储满了也不影响 */ }
      return next
    })
  }

  const notify = useCallback((tone: Tone, text: string) => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts((prev) => [...prev.slice(-3), { id, tone, text }])
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 4500)
  }, [])

  const applyDetail = useCallback((next: StudySessionDetail | null) => {
    detailRef.current = next
    setDetail(next)
  }, [])

  const applyCourses = useCallback((next: StudyCourseTree) => {
    coursesRef.current = next
    setCourses(next)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(REVEAL_KEY, JSON.stringify(revealedMap))
    } catch {
      // 存储满了也不影响上课
    }
  }, [revealedMap])

  // 原课件面板的开关与占宽比例落盘：下次打开还在原位，窗口大小变了比例也不变。
  useEffect(() => {
    savePanePref(pane)
  }, [pane])

  // 左栏课程树的收起状态落盘。
  useEffect(() => {
    saveSidebarOpen(sidebarOpen)
  }, [sidebarOpen])

  // 每份素材的备课预估价：只读本地的页数/块数，不调用模型、不花钱。
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

  const refreshCourses = useCallback(async () => {
    if (!api) return
    const [courseResult, listResult] = await Promise.all([api.study.courses(), api.study.list()])
    if (courseResult.ok) applyCourses(courseResult.data)
    if (listResult.ok) {
      sessionsRef.current = listResult.data.items
      setSessions(listResult.data.items)
    }
  }, [api, applyCourses])

  const refreshMissCount = useCallback(async () => {
    if (!api) return
    const result = await api.study.reviewSummary()
    if (result.ok) setMissCount(result.data.misses)
  }, [api])

  const openSession = useCallback(async (sessionId: string) => {
    if (!api) return
    const result = await api.study.get({ sessionId })
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    applyDetail(result.data)
    setView('chat')
    setUsageOpen(false)
    setUsageAudit(null)
    // 窄屏（左栏是浮层）打开课堂就顺手收起；宽屏左栏是一列，不该跟着消失
    if (window.innerWidth <= 980) setSidebarOpen(false)
    const courseId = result.data.courseId
    if (courseId) setExpanded((prev) => new Set(prev).add(courseId))
  }, [api, applyDetail, notify])

  const beginSession = useCallback(async (meta: JobMeta) => {
    if (!api) return
    const existing = sessionsRef.current.find((item) => item.documentVersionId === meta.dvid)
    if (existing) {
      notify('info', `《${meta.name}》已经开过课，直接打开`)
      await openSession(existing.sessionId)
      return
    }
    // 备课前先把价说清楚：只读本地页数，不调模型。
    const prepMode = loadPrepMode()
    const info = await api.documents.get({ documentVersionId: meta.dvid })
    if (info.ok) {
      const est = estimatePrepCost(info.data.format, info.data.pageCount, info.data.blockCount)
      const tokens = `${Math.round(est.tokensLow / 1000)}k–${Math.round(est.tokensHigh / 1000)}k tokens`
      const money = formatYuanRange(est.yuanLow, est.yuanHigh)
      const size = est.pages > 0 ? `${est.pages} 页` : `${Math.max(1, info.data.blockCount)} 段原文`
      const modeLine = prepMode === 'continuous'
        ? `连续讲：不分讲，老师按内容把 ${est.pages > 0 ? est.pages : '这些'} 页并成若干段，一段一段往下讲（约 ${Math.max(3, Math.ceil((est.pages || info.data.blockCount) / 3))} 段）；备课调用比导览多，费用会比上面的估价更高。`
        : prepMode === 'page'
          ? `按页拆：每页至少一讲，约 ${Math.max(1, est.pages || info.data.blockCount)} 讲；备课调用比导览多，费用会比上面的估价更高。`
          : '按主干拆：合并成 1–4 讲，先搭框架。'
      const confirmed = window.confirm(
        `《${meta.name}》共 ${size}，备课一次预计 ${tokens}（${money}${est.readsImages ? '，含读图' : ''}）。\n`
        + `${modeLine}\n`
        + '讲稿一次生成，之后逐段上课、反复「继续上课」都不再花钱；只有你追问、出题、总结才另算。\n'
        + '继续备课？（拆法可以在设置 → 我的习惯里改）',
      )
      if (!confirmed) {
        notify('info', '已取消备课，没有花 token')
        return
      }
    }
    setBusy('create')
    setProgress(null)
    setView('chat')
    const result = await api.study.create({
      requestId: crypto.randomUUID(),
      documentVersionId: meta.dvid,
      title: meta.name,
      courseId: meta.courseId,
      granularity: prepMode,
    })
    if (!result.ok) {
      notify('bad', result.error.message)
      setBusy(null)
      setProgress(null)
      return
    }
    applyDetail(result.data)
    const courseId = result.data.courseId ?? meta.courseId
    setExpanded((prev) => new Set(prev).add(courseId))
    await refreshCourses()
    setBusy(null)
    setProgress(null)
    notify('good', result.data.layout === 'continuous'
      ? `老师备好了 ${result.data.units.length} 段，点「开始上课」，之后点继续就往下讲`
      : `老师备好了 ${result.data.units.length} 讲，点「开始上课」`)
  }, [api, applyDetail, notify, openSession, refreshCourses])

  const drainCreate = useCallback(async () => {
    if (creating.current) return
    const next = createQueue.current.shift()
    if (!next) return
    creating.current = true
    try {
      await beginSession(next)
    } finally {
      creating.current = false
      void drainCreate()
    }
  }, [beginSession])

  const queueCreate = useCallback((meta: JobMeta) => {
    createQueue.current.push(meta)
    void drainCreate()
  }, [drainCreate])

  // 启动加载：课程、会话、模型配置、老师名字、错题数。
  useEffect(() => {
    let alive = true
    void (async () => {
      if (!api) return
      const [courseResult, listResult, aiResult, teacherResult, missResult] = await Promise.all([
        api.study.courses(), api.study.list(), api.ai.status(), api.teacher.overview(), api.study.reviewSummary(),
      ])
      if (!alive) return
      if (courseResult.ok) applyCourses(courseResult.data)
      if (listResult.ok) {
        sessionsRef.current = listResult.data.items
        setSessions(listResult.data.items)
      }
      if (aiResult.ok) {
        aiRef.current = aiResult.data
        setAi(aiResult.data)
        if (!aiResult.data.configured) setSettingsOpen(true)
        if (aiResult.data.configured) {
          const modelList = await api.ai.models()
          if (alive && modelList.ok) setModels(modelList.data.models)
          if (alive && !modelList.ok) notify('bad', `模型列表没拉下来：${modelList.error.message}`)
        }
      }
      if (teacherResult.ok) setTeacherName(teacherResult.data.persona.name)
      if (missResult.ok) setMissCount(missResult.data.misses)
    })()
    return () => { alive = false }
  }, [api, applyCourses])

  // 备课进度事件：主区域常驻进度条 + 侧栏对应那一行跟着变。
  useEffect(() => {
    if (!api) return
    return api.study.onProgress((next) => {
      setProgress(next)
      if (!next.documentVersionId) return
      const stage = next.total > 0 ? `${prepPhaseLabel(next.phase)} ${next.done}/${next.total}` : prepPhaseLabel(next.phase)
      setPending((prev) => prev.map((item) =>
        item.dvid === next.documentVersionId ? { ...item, stage } : item,
      ))
    })
  }, [api])

  // 解析任务事件：完成 → 需要上课的自动备课；只入库的进「素材」，一个 token 都不花。
  useEffect(() => {
    if (!api) return
    const finishJob = (meta: JobMeta, state: string, message?: string): void => {
      setPending((prev) => prev.filter((item) => !(item.courseId === meta.courseId && item.name === meta.name)))
      if (state !== 'succeeded' && state !== 'partial') {
        notify('bad', `《${meta.name}》解析失败：${message ?? state}`)
        return
      }
      if (meta.prep) {
        queueCreate(meta)
        return
      }
      setAssets((prev) => {
        const next = upsertAsset(prev, {
          courseId: meta.courseId,
          documentVersionId: meta.dvid,
          name: meta.name,
          addedAt: new Date().toISOString(),
        })
        saveAssets(next)
        return next
      })
    }
    const off = api.jobs.onChanged((event: JobChangedEvent) => {
      const meta = jobMeta.current.get(event.jobId)
      if (!meta) return
      if (event.state === 'queued' || event.state === 'running') {
        setPending((prev) => prev.map((item) =>
          item.courseId === meta.courseId && item.name === meta.name
            ? { ...item, stage: event.total ? `解析中 ${event.completed}/${event.total}` : '解析中' }
            : item,
        ))
        return
      }
      if (!jobMeta.current.delete(event.jobId)) return
      finishJob(meta, event.state)
    })
    return () => { off() }
  }, [api, notify, queueCreate])

  function upload(courseId: string): void {
    if (!aiRef.current?.configured) {
      notify('info', '先配置模型和 API Key，老师才能备课')
      setSettingsOpen(true)
      return
    }
    uploadTarget.current = courseId
    fileInputRef.current?.click()
  }

  /**
   * 导入一批课件。prep=true 是原有的「上传即备课」；prep=false 用于整个文件夹：
   * 只解析入库并放进课程素材，等用户点「备课」才真正调用模型。
   */
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
          queueCreate(meta)
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
      // 小文件可能在监听注册前就跑完了：直接查一次兜底，delete 保证只处理一遍。
      const job = await api.jobs.get({ jobId: result.data.jobId })
      if (job.ok && job.data.state !== 'queued' && job.data.state !== 'running') {
        if (jobMeta.current.delete(result.data.jobId)) {
          setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === file.name)))
          if (job.data.state === 'succeeded' || job.data.state === 'partial') {
            if (prep) {
              queueCreate(meta)
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

  /** 文件夹导入：先扫清单，确认后只解析入库；备课完全由用户点选触发。 */
  async function importFolder(courseId: string): Promise<void> {
    if (!api) return
    if (pending.some((item) => item.courseId === courseId)) {
      notify('info', '这个课程还有文件在导入／解析，等它跑完再选文件夹')
      return
    }
    const scan = await api.documents.scanFolder({})
    if (!scan.ok) {
      notify('bad', scan.error.message)
      return
    }
    if (scan.data.cancelled || scan.data.files.length === 0) {
      if (!scan.data.cancelled) notify('info', `这个文件夹里没有能导入的课件${scan.data.skipped > 0 ? `（跳过 ${scan.data.skipped} 个不支持或隐藏的文件）` : ''}`)
      return
    }
    const folderName = scan.data.folder ? scan.data.folder.split(/[\\/]/).pop() ?? '' : ''
    const skippedNote = scan.data.skipped > 0 ? `\n另有 ${scan.data.skipped} 个不支持或隐藏的文件会跳过。` : ''
    const ok = window.confirm(
      `在「${folderName}」里找到 ${scan.data.files.length} 份课件，全部导入素材库？\n`
      + '导入只做本地解析，不调用模型、不花 token；要讲哪份，再点它后面的「备课」。'
      + skippedNote,
    )
    if (!ok) return
    for (const file of scan.data.files) {
      setPending((prev) => [...prev, { courseId, name: file.name, stage: '正在导入' }])
      const result = await api.documents.importPath({ path: file.path, requestId: crypto.randomUUID() })
      if (!result.ok) {
        setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === file.name)))
        notify('bad', `《${file.name}》：${result.error.message}`)
        continue
      }
      const meta: JobMeta = { courseId, dvid: result.data.documentVersionId, name: file.name, prep: false }
      if (result.data.duplicate) {
        setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === file.name)))
        setAssets((prev) => {
          const next = upsertAsset(prev, { courseId, documentVersionId: meta.dvid, name: meta.name, addedAt: new Date().toISOString() })
          saveAssets(next)
          return next
        })
        continue
      }
      jobMeta.current.set(result.data.jobId, meta)
      const job = await api.jobs.get({ jobId: result.data.jobId })
      if (job.ok && job.data.state !== 'queued' && job.data.state !== 'running' && jobMeta.current.delete(result.data.jobId)) {
        setPending((prev) => prev.filter((item) => !(item.courseId === courseId && item.name === file.name)))
        if (job.data.state === 'succeeded' || job.data.state === 'partial') {
          setAssets((prev) => {
            const next = upsertAsset(prev, { courseId, documentVersionId: meta.dvid, name: meta.name, addedAt: new Date().toISOString() })
            saveAssets(next)
            return next
          })
        } else {
          notify('bad', `《${file.name}》解析失败：${job.data.error?.message ?? job.data.state}`)
        }
      }
    }
    notify('good', '文件夹已导入素材库，点「备课」再开讲')
  }

  function prepAsset(courseId: string, documentVersionId: string, name: string): void {
    if (!aiRef.current?.configured) {
      notify('info', '先配置模型和 API Key，老师才能备课')
      setSettingsOpen(true)
      return
    }
    setAssets((prev) => {
      const next = dropAsset(prev, courseId, documentVersionId)
      saveAssets(next)
      return next
    })
    queueCreate({ courseId, dvid: documentVersionId, name, prep: true })
  }

  function removeAsset(courseId: string, documentVersionId: string): void {
    setAssets((prev) => {
      const next = dropAsset(prev, courseId, documentVersionId)
      saveAssets(next)
      return next
    })
    notify('info', '已从素材里移出；课件还在文档库，随时可以再点「＋ 上传课件」重新导入')
  }

  /** 单段详细讲：直接用对话层已经支持的「详细讲这一段」意图，讲完自动回到本讲脉络。 */
  function explainDetail(unit: { segments: { source: string }[] }, segmentIndex: number): void {
    const segment = unit.segments[segmentIndex]
    if (!segment) return
    void send(`详细讲这一段：${segment.source}`)
  }

  function openPreview(quote: string): void {
    if (!detailRef.current?.documentVersionId) {
      notify('info', '这堂课找不到对应的课件原文')
      return
    }
    setPreview({
      documentVersionId: detailRef.current.documentVersionId,
      title: detailRef.current.title,
      quote,
    })
    setPane((prev) => ({ ...prev, open: true }))
  }

  /** 搜索结果点开：不依赖当前课堂，直接翻那份课件的那一页。 */
  function openSearchHit(hit: { documentVersionId: string; displayName: string; pageNumber: number | null }): void {
    setPreview({
      documentVersionId: hit.documentVersionId,
      title: hit.displayName,
      quote: '',
      page: typeof hit.pageNumber === 'number' && hit.pageNumber > 0 ? hit.pageNumber : undefined,
    })
    setPane((prev) => ({ ...prev, open: true }))
  }

  async function createCourse(name: string): Promise<string | null> {
    if (!api) return null
    const before = new Set((coursesRef.current?.items ?? []).map((item) => item.courseId))
    const result = await api.study.courseCreate({ name })
    if (!result.ok) {
      notify('bad', result.error.message)
      return null
    }
    applyCourses(result.data)
    const created = result.data.items.find((item) => !before.has(item.courseId))
    if (created) setExpanded((prev) => new Set(prev).add(created.courseId))
    return created?.courseId ?? null
  }

  async function renameCourse(courseId: string, name: string): Promise<void> {
    if (!api) return
    const result = await api.study.courseRename({ courseId, name })
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    applyCourses(result.data)
  }

  async function deleteCourse(courseId: string): Promise<void> {
    if (!api) return
    const course = coursesRef.current?.items.find((item) => item.courseId === courseId)
    if (!course) return
    if (!window.confirm(`删除课程「${course.name}」？其中 ${course.sessions.length} 份课件的课堂记录会一起删除。`)) return
    const result = await api.study.courseDelete({ courseId })
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    applyCourses(result.data)
    if (detailRef.current?.courseId === courseId) applyDetail(null)
    await refreshCourses()
    notify('info', '课程已删除')
  }

  async function deleteSession(sessionId: string): Promise<void> {
    if (!api) return
    if (!window.confirm('删除这份课件的课堂？对话、作答和总结会一起删除，课件原稿保留。')) return
    const result = await api.study.delete({ sessionId })
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    sessionsRef.current = result.data.items
    setSessions(result.data.items)
    if (detailRef.current?.sessionId === sessionId) applyDetail(null)
    await refreshCourses()
  }

  function primaryAction(): void {
    const current = detailRef.current
    if (!current || busy !== null) return
    const revealed = revealedMap[current.sessionId] ?? []
    const next = nextSegment(current.units, revealed)
    if (next) {
      const entry: Reveal = { ...next, at: Date.now() }
      setRevealedMap((prev) => ({ ...prev, [current.sessionId]: [...(prev[current.sessionId] ?? []), entry] }))
      setStreak(touchStudyDay())
      return
    }
    if (totalSegments(current.units) > 0) void runTool('summary')
  }

  /** 「详细讲这一讲」：把当前这一讲从导览展开成细讲，复用对话层已有的展开规则。 */
  function expandCurrentUnit(): void {
    const current = detailRef.current
    if (!current || busy !== null) return
    const ordinal = currentUnitOrdinal(current.units, revealedMap[current.sessionId] ?? [])
    const unit = current.units.find((item) => item.ordinal === ordinal)
    const label = unit?.title ? `「${unit.title}」` : '这一讲'
    void send(`这一讲${label}刚才只讲了导览版，请把它展开讲细：先讲这一段最关键的理解门槛，再讲最容易误解的地方，最后补一个具体例子；不要一次把整份材料倒完。`)
  }

  async function send(text: string): Promise<void> {
    const current = detailRef.current
    if (!api || !current || busy !== null) return
    setBusy('send')
    const result = await api.study.send({
      sessionId: current.sessionId,
      content: text,
      unitOrdinal: currentUnitOrdinal(current.units, revealedMap[current.sessionId] ?? []),
      mode: 'direct',
      skill: 'auto',
    })
    setBusy(null)
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    applyDetail(result.data)
    setStreak(touchStudyDay())
  }

  async function answerCheck(unitOrdinal: number, segmentIndex: number, answer: string): Promise<void> {
    const current = detailRef.current
    if (!api || !current || busy !== null) return
    setBusy('check')
    const result = await api.study.check({ sessionId: current.sessionId, unitOrdinal, segmentIndex, answer })
    setBusy(null)
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    applyDetail(result.data)
    notify('good', '回答已记录，下课时会进学习总结')
  }

  async function runTool(tool: StudyToolKind): Promise<void> {
    const current = detailRef.current
    if (!api || !current || busy !== null) return
    setBusy('tool')
    const result = await api.study.tool({
      sessionId: current.sessionId,
      tool,
      unitOrdinal: currentUnitOrdinal(current.units, revealedMap[current.sessionId] ?? []),
    })
    setBusy(null)
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    applyDetail(result.data)
    if (tool === 'quiz') notify('info', '题测出好了，在聊天流里作答')
  }

  async function gradeQuiz(answers: StudyQuizAnswer[]): Promise<void> {
    const current = detailRef.current
    if (!api || !current || busy !== null) return
    setBusy('grade')
    const result = await api.study.tool({
      sessionId: current.sessionId,
      tool: 'quiz-grade',
      answers,
      unitOrdinal: currentUnitOrdinal(current.units, revealedMap[current.sessionId] ?? []),
    })
    setBusy(null)
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    applyDetail(result.data)
    await refreshMissCount()
  }

  async function finish(): Promise<void> {
    const current = detailRef.current
    if (!api || !current || busy !== null) return
    if (!window.confirm('下课会生成学习总结和老师手记，之后这门课不能再追问。确定下课？')) return
    setBusy('finish')
    const result = await api.study.finish({ sessionId: current.sessionId })
    setBusy(null)
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    applyDetail(result.data)
    notify('good', '已下课，学习总结在聊天流底部')
  }

  async function changeModel(model: string): Promise<void> {
    if (!api || !aiRef.current) return
    const result = await api.ai.saveConfig({ baseUrl: aiRef.current.baseUrl, model, apiKey: '' })
    if (!result.ok) {
      notify('bad', result.error.message)
      return
    }
    aiRef.current = result.data
    setAi(result.data)
    notify('good', `已切换到 ${model}`)
  }

  async function openUsage(): Promise<void> {
    const current = detailRef.current
    if (!api || !current) return
    setUsageOpen(true)
    setUsageAudit(null)
    const result = await api.study.usageAudit({ sessionId: current.sessionId })
    if (!result.ok) {
      notify('bad', result.error.message)
      setUsageOpen(false)
      return
    }
    setUsageAudit(result.data)
  }

  async function reloadTeacher(): Promise<void> {
    if (!api) return
    const result = await api.teacher.overview()
    if (result.ok) setTeacherName(result.data.persona.name)
  }

  /** 把这一讲的「停一下」问题做成复习卡：正面问题，背面讲解，摘录原文。 */
  async function makeCards(unitOrdinal: number): Promise<void> {
    const current = detailRef.current
    if (!api || !current) return
    const unit = current.units.find((candidate) => candidate.ordinal === unitOrdinal)
    if (!unit) return
    const targets = unit.segments.filter((segment) => segment.check !== '')
    if (targets.length === 0) {
      notify('info', '这一讲没有「停一下」问题，换一讲试试')
      return
    }
    let made = 0
    for (const segment of targets) {
      const result = await api.teaching.cardCreate({
        front: segment.check.slice(0, 500),
        back: segment.explain.slice(0, 1000),
        quote: segment.source.slice(0, 500),
      })
      if (result.ok) made += 1
    }
    notify(made > 0 ? 'good' : 'bad', made > 0 ? `已做成 ${made} 张复习卡，去「复习错题」里练` : '复习卡创建失败')
  }

  if (!api) {
    return <div className="hc-noapi">请在寒窗桌面应用里打开本页面（浏览器直接访问没有本机能力）。</div>
  }

  const latestSession = [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
  const courseName = detail?.courseId
    ? courses?.items.find((item) => item.courseId === detail.courseId)?.name ?? '课程'
    : '寒窗'
  const revealed = detail ? revealedMap[detail.sessionId] ?? [] : []
  const statusText = busy === 'create' ? '备课中'
    : detail?.status === 'finished' ? '已下课'
      : revealed.length > 0 ? '讲课中' : '待上课'

  return (
    <div className={`hc-app${sidebarOpen ? ' sidebar-open' : ''}`} data-theme={theme}>
      <Sidebar
        courses={courses}
        activeSessionId={detail?.sessionId ?? null}
        expanded={expanded}
        pending={pending}
        assets={assets}
        assetCosts={assetCosts}
        missCount={missCount}
        reviewActive={view === 'review'}
        onToggle={(courseId) => setExpanded((prev) => {
          const next = new Set(prev)
          if (next.has(courseId)) next.delete(courseId)
          else next.add(courseId)
          return next
        })}
        onOpenSession={(sessionId) => void openSession(sessionId)}
        onUpload={(courseId) => upload(courseId)}
        onImportFolder={(courseId) => void importFolder(courseId)}
        onPrepAsset={(courseId, documentVersionId, name) => prepAsset(courseId, documentVersionId, name)}
        onRemoveAsset={(courseId, documentVersionId) => removeAsset(courseId, documentVersionId)}
        onDropFiles={(courseId, files) => void importFiles(courseId, files)}
        onCreateCourse={(name) => void createCourse(name)}
        onRenameCourse={(courseId, name) => void renameCourse(courseId, name)}
        onDeleteCourse={(courseId) => void deleteCourse(courseId)}
        onDeleteSession={(sessionId) => void deleteSession(sessionId)}
        onOpenReview={() => { setView('review'); setSidebarOpen(false) }}
        onOpenSettings={() => setSettingsOpen(true)}
        onCollapse={() => setSidebarOpen(false)}
      />

      <main className="hc-main">
        <div className="hc-header">
          <button
            className="hc-menu-btn"
            title={sidebarOpen ? '收起课程栏，给课件和对话腾地方' : '展开课程栏'}
            onClick={() => setSidebarOpen((value) => !value)}
          >
            {sidebarOpen ? '«' : '≡'}
          </button>
          <div className="hc-crumb">
            {view === 'review' ? '复习' : detail ? `${courseName} / ${detail.title}` : '把课件交给老师'}
          </div>
          {detail && view === 'chat' && <span className="hc-teacher-chip">{teacherName} · {statusText}</span>}
          <SourceSearch onPick={(hit) => openSearchHit(hit)} />
          <button
            className={`hc-theme-btn${pane.open && preview ? ' active' : ''}`}
            title="原课件左侧常驻，边讲边看"
            onClick={() => {
              if (pane.open && preview) {
                setPreview(null)
                setPane((prev) => ({ ...prev, open: false }))
                return
              }
              if (preview) {
                setPane((prev) => ({ ...prev, open: true }))
                return
              }
              if (!detail) {
                notify('info', '先打开一堂课，或在上面的搜索框里搜课件原文')
                return
              }
              const ordinal = currentUnitOrdinal(detail.units, revealed) ?? 0
              openPreview(detail.units[ordinal]?.source ?? '')
            }}
          >
            原课件
          </button>
          {streak > 0 && <span className="hc-streak" title="连续学习天数">连续 {streak} 天</span>}
          <button className="hc-theme-btn" onClick={toggleTheme} title="切换日间 / 夜间">{theme === 'light' ? '夜间' : '日间'}</button>
        </div>

        {progress && (
          <div className="hc-prep-banner">
            <span className="hc-prep-banner-text">
              老师正在备课{progress.title ? `《${progress.title}》` : ''} · {prepPhaseLabel(progress.phase)}
            </span>
            {progress.total > 0 && (
              <span className="hc-prep-banner-bar">
                <span style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }} />
              </span>
            )}
            {progress.total > 0 && <span className="hc-prep-banner-count">{progress.done}/{progress.total}</span>}
          </div>
        )}

        <div className="hc-work">
          {pane.open && preview && (
            <SourcePane
              documentVersionId={preview.documentVersionId}
              title={preview.title}
              quote={preview.quote}
              initialPage={preview.page}
              ratio={pane.ratio}
              onRatioChange={(ratio) => setPane((prev) => ({ ...prev, ratio }))}
              onClose={() => {
                setPreview(null)
                setPane((prev) => ({ ...prev, open: false }))
              }}
              onToast={notify}
            />
          )}
          <div className="hc-chat-col">
        {view === 'review' ? (
          <ReviewPanel onBack={() => setView('chat')} notify={notify} onReviewed={() => void refreshMissCount()} />
        ) : detail ? (
          <>
            <ChatStream
              detail={detail}
              revealed={revealed}
              busy={busy}
              progress={progress}
              teacherName={teacherName}
              onAnswerCheck={(unitOrdinal, segmentIndex, answer) => void answerCheck(unitOrdinal, segmentIndex, answer)}
              onGradeQuiz={(answers) => void gradeQuiz(answers)}
              onMakeCards={(unitOrdinal) => void makeCards(unitOrdinal)}
              onExplainDetail={(unit, segmentIndex) => explainDetail(unit, segmentIndex)}
              onPreview={(unit, segmentIndex) => openPreview(unit.segments[segmentIndex]?.source ?? unit.source)}
            />
            {usageOpen && (
              <div className="hc-usage-pop">
                <div className="hc-usage-head">
                  <span>本课真实用量</span>
                  <button onClick={() => setUsageOpen(false)}>✕</button>
                </div>
                {usageAudit ? (
                  <div className="hc-usage-body">
                    <div>调用 {usageAudit.usage.calls} 次 · 输入 {usageAudit.usage.promptTokens.toLocaleString()}（缓存命中 {usageAudit.usage.cachedTokens.toLocaleString()}）· 输出 {usageAudit.usage.completionTokens.toLocaleString()}</div>
                    {usageAudit.kinds.map((kind) => (
                      <div key={kind.kind} className="hc-usage-kind">
                        {kind.kind}：{kind.calls} 次 · {(kind.promptTokens + kind.completionTokens).toLocaleString()} tokens
                      </div>
                    ))}
                    {ai && (
                      <div className="hc-usage-cost">
                        {formatYuan(estimateCostYuan(ai.model, usageAudit.usage.promptTokens, usageAudit.usage.cachedTokens, usageAudit.usage.completionTokens))}
                        <span className="hc-muted">（DeepSeek 牌价估算，闲时更便宜）</span>
                      </div>
                    )}
                    {usageAudit.balance && usageAudit.balance.map((item, index) => (
                      <div key={index} className="hc-usage-balance">DeepSeek 余额：{item.totalBalance} {item.currency}</div>
                    ))}
                    {usageAudit.balanceError && <div className="hc-muted">余额查询失败：{usageAudit.balanceError}</div>}
                    <div className="hc-muted">{usageAudit.officialNote}</div>
                  </div>
                ) : (
                  <div className="hc-muted">统计中…</div>
                )}
              </div>
            )}
            <Composer
              detail={detail}
              revealed={revealed}
              ai={ai}
              models={models}
              busy={busy}
              onPrimary={primaryAction}
              onExpand={expandCurrentUnit}
              onSend={(text) => void send(text)}
              onTool={(tool) => void runTool(tool)}
              onFinish={() => void finish()}
              onModelChange={(model) => void changeModel(model)}
              onUsageClick={() => void openUsage()}
            />
          </>
        ) : (
          <div className="hc-welcome">
            <div
              className="hc-welcome-card"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const files = Array.from(event.dataTransfer.files)
                if (files.length === 0) return
                void (async () => {
                  const courseId = await createCourse('随手课件')
                  if (courseId) await importFiles(courseId, files)
                })()
              }}
            >
              <BrandMark />
              <div className="hc-welcome-brand">寒窗</div>
              <p className="hc-welcome-sub">把课件交给老师，一段一段讲给你听。<br />会提问、会总结、会出题，还记得你的学习习惯。</p>
              {!ai?.configured ? (
                <button className="hc-primary" onClick={() => setSettingsOpen(true)}>第一步：配置模型（DeepSeek API Key）</button>
              ) : (
                <div className="hc-welcome-actions">
                  {latestSession && (
                    <button className="hc-primary" onClick={() => void openSession(latestSession.sessionId)}>
                      继续上次：{latestSession.title}
                    </button>
                  )}
                  <div className="hc-welcome-new">
                    <input
                      value={welcomeName}
                      placeholder="课程名，如：数据结构"
                      onChange={(event) => setWelcomeName(event.target.value)}
                    />
                    <button
                      className="hc-primary"
                      disabled={welcomeName.trim() === ''}
                      onClick={() => {
                        const name = welcomeName.trim()
                        void (async () => {
                          const courseId = await createCourse(name)
                          if (courseId) {
                            setWelcomeName('')
                            upload(courseId)
                          }
                        })()
                      }}
                    >
                      新建课程并上传课件
                    </button>
                  </div>
                  <div className="hc-welcome-steps">
                    <div><b>1 上传</b><span>PPTX / DOCX / PDF / 代码 / 图片，拖进来就行</span></div>
                    <div><b>2 上课</b><span>原文 → 讲解 → 停一下，随时插嘴进度不丢</span></div>
                    <div><b>3 巩固</b><span>出题判分、错题本、复习卡、学习总结</span></div>
                  </div>
                  <div className="hc-form-note">备课只花一次钱，逐段上课不额外调用模型。也可以直接把课件拖到这张卡片上。</div>
                </div>
              )}
            </div>
          </div>
        )}
          </div>
        </div>
      </main>

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          notify={notify}
          onAiSaved={(config) => {
            aiRef.current = config
            setAi(config)
            if (config.configured) {
              void (async () => {
                const list = await api.ai.models()
                if (list.ok) setModels(list.data.models)
                else notify('bad', `模型列表没拉下来：${list.error.message}`)
              })()
            }
          }}
          onTeacherSaved={() => void reloadTeacher()}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={['.pptx', '.docx', '.pdf', '.txt', '.md', '.markdown', '.png', '.jpg', '.jpeg', ...CODE_EXTENSIONS.map((ext) => `.${ext}`)].join(',')}
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          const courseId = uploadTarget.current
          event.target.value = ''
          if (courseId && files.length > 0) void importFiles(courseId, files)
        }}
      />

      <div className="hc-toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`hc-toast ${toast.tone}`}>{toast.text}</div>
        ))}
      </div>
    </div>
  )
}