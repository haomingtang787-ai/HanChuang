import type { StudyArtifact, StudyLayout, StudyMessage, StudySessionDetail, StudyUnit } from '../../shared/study'
import type { SearchHit } from '../../shared/search'
import type { FolderFile } from '../../shared/contract'
import { estimateCallCostYuan, isPeakTime } from '../../shared/pricing'

/** 一段已经讲过的课：本地揭示进度，重启后从 localStorage 恢复。 */
export type Reveal = { unitOrdinal: number; segmentIndex: number; at: number }

export type TimelineItem =
  | { kind: 'message'; at: number; message: StudyMessage }
  | { kind: 'lecture'; at: number; reveal: Reveal }
  | { kind: 'artifact'; at: number; artifact: StudyArtifact }

export function totalSegments(units: StudyUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.segments.length, 0)
}

/** 按讲序、段序找下一段没讲过的；全讲完返回 null。 */
export function nextSegment(units: StudyUnit[], revealed: Reveal[]): { unitOrdinal: number; segmentIndex: number } | null {
  const done = new Set(revealed.map((item) => `${item.unitOrdinal}:${item.segmentIndex}`))
  const ordered = [...units].sort((a, b) => a.ordinal - b.ordinal)
  for (const unit of ordered) {
    for (let index = 0; index < unit.segments.length; index += 1) {
      if (!done.has(`${unit.ordinal}:${index}`)) return { unitOrdinal: unit.ordinal, segmentIndex: index }
    }
  }
  return null
}

/** 当前讲到哪一讲：追问时把它作为上下文单元。 */
export function currentUnitOrdinal(units: StudyUnit[], revealed: Reveal[]): number | null {
  if (revealed.length > 0) return revealed[revealed.length - 1].unitOrdinal
  const ordered = [...units].sort((a, b) => a.ordinal - b.ordinal)
  return ordered[0]?.ordinal ?? null
}

/** 聊天流 = 持久化消息 + 本地讲课卡片 + 工具生成物，按时间合并。 */
export function buildTimeline(detail: StudySessionDetail, revealed: Reveal[]): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const message of detail.messages) {
    items.push({ kind: 'message', at: Date.parse(message.createdAt), message })
  }
  for (const reveal of revealed) {
    items.push({ kind: 'lecture', at: reveal.at, reveal })
  }
  for (const artifact of detail.artifacts) {
    items.push({ kind: 'artifact', at: Date.parse(artifact.updatedAt), artifact })
  }
  items.sort((a, b) => a.at - b.at)
  return items
}

/**
 * 发送瞬间先把学生自己的话挂进会话，不能让界面等模型整轮返回才显示。
 * 服务端回复到达后用完整 detail 覆盖，这条临时消息自然被替换成入库消息。
 */
export function withPendingUserMessage(
  detail: StudySessionDetail,
  content: string,
  unitOrdinal: number | null,
  now = new Date(),
): StudySessionDetail {
  const message: StudyMessage = {
    id: `pending-${now.getTime()}`,
    sessionId: detail.sessionId,
    role: 'user',
    unitOrdinal,
    content,
    citations: [],
    createdAt: now.toISOString(),
  }
  return { ...detail, messages: [...detail.messages, message] }
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}

/** 主行动按钮文案：一条路走到黑，学生永远知道下一步点什么。 */
export function primaryLabel(revealedCount: number, total: number, layout: StudyLayout = 'lecture'): string {
  if (total === 0) return '这份课件还没有讲稿'
  if (layout === 'continuous') {
    if (revealedCount === 0) return '开始上课'
    if (revealedCount < total) return '继续 · 下一段'
    return '讲完了 · 总结这一课'
  }
  if (revealedCount === 0) return '开始上课'
  if (revealedCount < total) return `继续上课 · 第 ${revealedCount + 1}/${total} 段`
  return '讲完了 · 总结这一讲'
}

/** 从「第 3 页」「第 3–5 页」里取出页码区间；连续讲的顶栏只报页，不报第几讲。 */
export function pageRangeOf(source: string): { start: number; end: number } | null {
  const match = /第\s*(\d+)\s*(?:[–-]\s*(\d+)\s*)?页/.exec(source)
  if (!match) return null
  const start = Number(match[1])
  if (!Number.isFinite(start) || start <= 0) return null
  const end = match[2] ? Number(match[2]) : start
  return { start, end: Number.isFinite(end) && end >= start ? end : start }
}

/** DeepSeek 官方牌价（元/百万 tokens，2026-11 核实）：flash 闲时 0.02 / 1 / 4，高峰 0.04 / 2 / 8；
 * pro 闲时 0.15 / 4.5 / 13.5，高峰 0.3 / 9 / 27。按调用发生时间区分峰谷，历史调用不要用当前价重算。
 * 具体的价目和北京时间峰谷判断在 shared/pricing.ts，main 进程统计历史用量时共用同一套。 */
export function estimateCostYuan(
  model: string,
  promptTokens: number,
  cachedTokens: number,
  completionTokens: number,
  at: Date = new Date(),
): number {
  return estimateCallCostYuan(model, promptTokens, cachedTokens, completionTokens, at)
}

export function formatYuan(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '¥0'
  if (value < 0.01) return '不足 1 分钱'
  return `约 ¥${value.toFixed(2)}`
}

const STUDY_DAYS_KEY = 'hc.studydays.v1'

export function todayKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function loadStudyDays(): string[] {
  try {
    const raw = localStorage.getItem(STUDY_DAYS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** 连续学习天数：今天学过算到今天，今天还没学算到昨天（不逼用户打卡）。 */
export function streakOf(days: string[], today: string): number {
  const set = new Set(days)
  const cursor = new Date(`${today}T12:00:00`)
  if (!set.has(today)) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (set.has(todayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function touchStudyDay(): number {
  const days = loadStudyDays()
  const today = todayKey()
  if (!days.includes(today)) {
    days.push(today)
    try {
      localStorage.setItem(STUDY_DAYS_KEY, JSON.stringify(days.slice(-400)))
    } catch {
      // 存储满了也不影响上课
    }
  }
  return streakOf(days, today)
}

/** 备课三个阶段的界面文案；主区域和侧栏都用它，免得两处写法不一致。 */
export function prepPhaseLabel(phase: 'vision' | 'reading' | 'planning'): string {
  if (phase === 'vision') return '读图'
  if (phase === 'reading') return '读原文'
  return '设计讲稿'
}

/** 文件夹导入的「素材」：已解析入库、但还没花 token 备课的课件。 */
export type AssetItem = {
  courseId: string
  documentVersionId: string
  name: string
  addedAt: string
  /** 选中的同步文件夹里的绝对路径；手动上传的素材没有。 */
  sourcePath?: string
  /** 相对同步文件夹的路径，用来在左栏还原子目录。 */
  relativePath?: string
}

const ASSETS_KEY = 'hc.assets.v1'
const FOLDER_WATCHES_KEY = 'hc.folderWatches.v1'

/** 读素材索引：任何坏数据都回落成空数组，不拖垮界面。 */
export function readAssets(raw: string | null): AssetItem[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const items: AssetItem[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const courseId = typeof row.courseId === 'string' ? row.courseId : ''
    const documentVersionId = typeof row.documentVersionId === 'string' ? row.documentVersionId : ''
    const name = typeof row.name === 'string' ? row.name : ''
    const addedAt = typeof row.addedAt === 'string' ? row.addedAt : ''
    if (courseId === '' || documentVersionId === '' || name === '') continue
    const key = `${courseId}:${documentVersionId}`
    if (seen.has(key)) continue
    seen.add(key)
    const sourcePath = typeof row.sourcePath === 'string' && row.sourcePath !== '' ? row.sourcePath : undefined
    const relativePath = typeof row.relativePath === 'string' && row.relativePath !== '' ? row.relativePath : undefined
    items.push({
      courseId,
      documentVersionId,
      name,
      addedAt: addedAt === '' ? new Date().toISOString() : addedAt,
      ...(sourcePath ? { sourcePath } : {}),
      ...(relativePath ? { relativePath } : {}),
    })
  }
  return items
}

export function assetListOf(items: AssetItem[], courseId: string): AssetItem[] {
  return items.filter((item) => item.courseId === courseId)
}

/** 同一份文档只留一条：重复导入同一个文件时更新名字与时间，不堆两行。 */
export function upsertAsset(items: AssetItem[], entry: AssetItem): AssetItem[] {
  const rest = items.filter((item) => !(item.courseId === entry.courseId && item.documentVersionId === entry.documentVersionId))
  return [...rest, entry]
}

export function dropAsset(items: AssetItem[], courseId: string, documentVersionId: string): AssetItem[] {
  return items.filter((item) => !(item.courseId === courseId && item.documentVersionId === documentVersionId))
}

export function loadAssets(): AssetItem[] {
  try {
    return readAssets(localStorage.getItem(ASSETS_KEY))
  } catch {
    return []
  }
}

/** 一门课绑定的同步文件夹；文件签名放在 known 里，用来区分「新增」和「已经导入过」。 */
export type FolderKnownFile = { sizeBytes: number; modifiedMs: number }
export type FolderWatch = {
  courseId: string
  folder: string
  folderName: string
  enabled: boolean
  known: Record<string, FolderKnownFile>
  lastScanAt: string | null
  error: string | null
  changedPaths: string[]
  missingPaths: string[]
}

function objectOf(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

function knownOf(raw: unknown): Record<string, FolderKnownFile> {
  const source = objectOf(raw)
  if (!source) return {}
  const known: Record<string, FolderKnownFile> = {}
  for (const [key, value] of Object.entries(source)) {
    const row = objectOf(value)
    if (!row) continue
    const sizeBytes = typeof row.sizeBytes === 'number' && Number.isFinite(row.sizeBytes) ? row.sizeBytes : null
    const modifiedMs = typeof row.modifiedMs === 'number' && Number.isFinite(row.modifiedMs) ? row.modifiedMs : null
    if (key === '' || sizeBytes === null || modifiedMs === null) continue
    known[key] = { sizeBytes, modifiedMs }
  }
  return known
}

function stringListOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string' && value !== '') : []
}

/** 读同步文件夹索引；坏条目跳过，不影响其它课程。 */
export function readFolderWatches(raw: string | null): FolderWatch[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const items: FolderWatch[] = []
  for (const entry of parsed) {
    const row = objectOf(entry)
    if (!row) continue
    const courseId = typeof row.courseId === 'string' ? row.courseId : ''
    const folder = typeof row.folder === 'string' ? row.folder : ''
    const folderName = typeof row.folderName === 'string' && row.folderName !== '' ? row.folderName : folder.split(/[\\/]/).pop() ?? ''
    if (courseId === '' || folder === '' || seen.has(courseId)) continue
    seen.add(courseId)
    items.push({
      courseId,
      folder,
      folderName,
      enabled: row.enabled !== false,
      known: knownOf(row.known),
      lastScanAt: typeof row.lastScanAt === 'string' && row.lastScanAt !== '' ? row.lastScanAt : null,
      error: typeof row.error === 'string' && row.error !== '' ? row.error : null,
      changedPaths: stringListOf(row.changedPaths),
      missingPaths: stringListOf(row.missingPaths),
    })
  }
  return items
}

export function saveFolderWatches(items: FolderWatch[]): void {
  try {
    localStorage.setItem(FOLDER_WATCHES_KEY, JSON.stringify(items))
  } catch {
    // 存储满了不影响上课；下次启动最多重新扫一遍。
  }
}

export function loadFolderWatches(): FolderWatch[] {
  try {
    return readFolderWatches(localStorage.getItem(FOLDER_WATCHES_KEY))
  } catch {
    return []
  }
}

export function upsertFolderWatch(items: FolderWatch[], entry: FolderWatch): FolderWatch[] {
  const rest = items.filter((item) => item.courseId !== entry.courseId)
  return [...rest, entry]
}

export function dropFolderWatch(items: FolderWatch[], courseId: string): FolderWatch[] {
  return items.filter((item) => item.courseId !== courseId)
}

/** 用一次扫描结果更新已知签名；只更新成功导入/已确认的文件。 */
export function rememberFiles(known: Record<string, FolderKnownFile>, files: FolderFile[]): Record<string, FolderKnownFile> {
  const next = { ...known }
  for (const file of files) next[file.relativePath] = { sizeBytes: file.sizeBytes, modifiedMs: file.modifiedMs }
  return next
}

export type FolderDiff = { added: FolderFile[]; changed: FolderFile[]; missing: string[] }

/** 对比上次索引：新增才自动入库；改内容只提示，等用户手动同步。 */
export function diffFolderFiles(watch: FolderWatch, files: FolderFile[]): FolderDiff {
  const added: FolderFile[] = []
  const changed: FolderFile[] = []
  const seen = new Set<string>()
  for (const file of files) {
    seen.add(file.relativePath)
    const known = watch.known[file.relativePath]
    if (!known) {
      added.push(file)
      continue
    }
    if (known.sizeBytes !== file.sizeBytes || known.modifiedMs !== file.modifiedMs) changed.push(file)
  }
  const missing = Object.keys(watch.known).filter((path) => !seen.has(path))
  return { added, changed, missing }
}

/** 素材按相对路径还原成目录树；没有 relativePath 的老素材留在根上。 */
export type AssetTreeNode = { name: string; path: string; assets: AssetItem[]; folders: AssetTreeNode[] }

function emptyNode(name: string, path: string): AssetTreeNode {
  return { name, path, assets: [], folders: [] }
}

function folderChild(node: AssetTreeNode, name: string): AssetTreeNode {
  const childPath = node.path === '' ? name : `${node.path}/${name}`
  let child = node.folders.find((item) => item.name === name)
  if (!child) {
    child = emptyNode(name, childPath)
    node.folders.push(child)
  }
  return child
}

/** 只按路径建树，不依赖导入顺序；根目录文件排在最前。 */
export function assetTreeOf(items: AssetItem[]): AssetTreeNode {
  const root = emptyNode('', '')
  for (const item of items) {
    const segments = (item.relativePath ?? '').replace(/\\/g, '/').split('/').filter((part) => part !== '')
    let node = root
    for (const segment of segments.slice(0, -1)) node = folderChild(node, segment)
    node.assets.push(item)
  }
  const sortNode = (node: AssetTreeNode): void => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    node.assets.sort((a, b) => (a.relativePath ?? a.name).localeCompare(b.relativePath ?? b.name, 'zh'))
    for (const child of node.folders) sortNode(child)
  }
  sortNode(root)
  return root
}


export function saveAssets(items: AssetItem[]): void {
  try {
    localStorage.setItem(ASSETS_KEY, JSON.stringify(items.slice(-500)))
  } catch {
    // 存储满了只是素材列表不落盘，不影响课件本身
  }
}

/** 原文抽屉定位：优先用命中本课文档的第一条页码，没有就回第 1 页。 */
export function pageForQuote(hits: SearchHit[], documentVersionId: string): number {
  for (const hit of hits) {
    if (hit.documentVersionId !== documentVersionId) continue
    if (typeof hit.pageNumber === 'number' && hit.pageNumber > 0) return hit.pageNumber
  }
  return 1
}

/** 搜索结果第二行：有页码就显示页，DOCX/代码这类没有页概念的就写全文。 */
export function hitSubtitle(hit: SearchHit): string {
  return typeof hit.pageNumber === 'number' && hit.pageNumber > 0 ? `第 ${hit.pageNumber} 页` : '全文'
}

/** 价格区间的人话写法：不到一分钱就说不到一分钱，不写成「¥0.00–¥0.00」。 */
export function formatYuanRange(low: number, high: number): string {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0) return '¥0'
  if (high < 0.01) return '不到 1 分钱'
  const from = Math.max(low, 0.01).toFixed(2)
  const to = Math.max(high, 0.01).toFixed(2)
  return from === to ? `约 ¥${to}` : `¥${from}–${to}`
}

/* ---------- 备课前的费用预估 ---------- */

export type PrepEstimate = {
  pages: number
  readsImages: boolean
  tokensLow: number
  tokensHigh: number
  yuanLow: number
  yuanHigh: number
  /** 当前时段是否是高峰，界面上说明「闲时/高峰」。 */
  peak: boolean
}

/** 混合计价的粗估：约八成输入、两成输出，按 flash 官方牌价、当前峰谷时段折算。 */
function yuanOf(tokens: number, at: Date): number {
  return estimateCallCostYuan('deepseek-flash', Math.round(tokens * 0.8), 0, Math.round(tokens * 0.2), at)
}

/**
 * 备课一次要花多少：只读本地已有的页数/块数，不调用模型。
 * 依据是实测：82 页 PDF 备 4 讲实际约 4 万 tokens（规划 2.5 万 + 读图 1.6 万）。
 */
export function estimatePrepCost(format: string, pageCount: number, blockCount: number, at: Date = new Date()): PrepEstimate {
  const pages = Math.max(0, Math.round(pageCount))
  const blocks = Math.max(0, Math.round(blockCount))
  const textTokens = Math.max(1200, Math.max(pages * 220, blocks * 45))
  const planOutput = Math.min(6000, 900 + pages * 26)
  const readsImages = ['pdf', 'pptx', 'png', 'jpeg'].includes(format)
  const visionTokens = readsImages ? Math.max(1, Math.ceil(pages / 20)) * 3200 : 0
  const base = textTokens + planOutput + visionTokens
  const tokensLow = Math.round(base * 0.85)
  const tokensHigh = Math.round(base * 1.3)
  return {
    pages,
    readsImages,
    tokensLow,
    tokensHigh,
    yuanLow: yuanOf(tokensLow, at),
    yuanHigh: yuanOf(tokensHigh, at),
    peak: isPeakTime(at),
  }
}

/* ---------- 左侧原件面板的偏好（开关 + 占宽比例） ----------
 * 用「比例」而不是像素：窗口拉大/全屏时，课件和对话仍然一半一半，不用手动再拖。
 */
export type PanePref = { open: boolean; ratio: number }

export const PANE_RATIO_MIN = 0.28
export const PANE_RATIO_MAX = 0.62
export const PANE_RATIO_DEFAULT = 0.5
const PANE_KEY = 'hc.pane.v2'

export function clampPaneRatio(value: number): number {
  if (!Number.isFinite(value)) return PANE_RATIO_DEFAULT
  const rounded = Math.round(value * 1000) / 1000
  return Math.min(PANE_RATIO_MAX, Math.max(PANE_RATIO_MIN, rounded))
}

export function readPanePref(raw: string | null): PanePref {
  const fallback: PanePref = { open: false, ratio: PANE_RATIO_DEFAULT }
  if (!raw) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
  const row = parsed as Record<string, unknown>
  // 旧版存的是 width(px)，没有 ratio —— 一律回到「对半」，不再按像素算
  return {
    open: row.open === true,
    ratio: typeof row.ratio === 'number' ? clampPaneRatio(row.ratio) : PANE_RATIO_DEFAULT,
  }
}

export function loadPanePref(): PanePref {
  try {
    return readPanePref(localStorage.getItem(PANE_KEY))
  } catch {
    return { open: false, ratio: PANE_RATIO_DEFAULT }
  }
}

export function savePanePref(pref: PanePref): void {
  try {
    localStorage.setItem(PANE_KEY, JSON.stringify({ open: pref.open, ratio: clampPaneRatio(pref.ratio) }))
  } catch {
    // 存储满了只是偏好不落盘，不影响翻页
  }
}

/* ---------- 左栏课程树的收起状态 ---------- */
const SIDEBAR_KEY = 'hc.sidebar.v1'

/** 没存过返回 null（交给界面决定默认值：宽屏默认展开）。 */
export function loadSidebarOpen(): boolean | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY)
    if (raw === '0') return false
    if (raw === '1') return true
    return null
  } catch {
    return null
  }
}

export function saveSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0')
  } catch {
    // 落不了盘不影响本次使用
  }
}

/* ---------- 备课怎么拆：连续讲（默认）、按页拆、按主干（1–4 讲） ---------- */
export type PrepMode = 'overview' | 'page' | 'continuous'

const PREP_MODE_KEY = 'hc.prepMode.v1'

export function readPrepMode(raw: string | null): PrepMode {
  // 默认连续讲：没主动选过别的，就从头到尾按内容一段一段讲（1.6.0 起）。
  if (raw === 'overview') return 'overview'
  if (raw === 'page') return 'page'
  return 'continuous'
}

export function loadPrepMode(): PrepMode {
  try {
    return readPrepMode(localStorage.getItem(PREP_MODE_KEY))
  } catch {
    return 'continuous'
  }
}

export function savePrepMode(mode: PrepMode): void {
  try {
    localStorage.setItem(PREP_MODE_KEY, mode)
  } catch {
    // 偏好存不下只影响下次默认值
  }
}

