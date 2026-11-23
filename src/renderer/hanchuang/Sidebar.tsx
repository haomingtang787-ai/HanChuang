import { useState, type ReactElement } from 'react'
import type { StudyCourseTree } from '../../shared/study'
import { LIMITS } from '../../shared/constants'
import { assetTreeEntries, assetTreeOf, type AssetItem, type AssetTreeNode, type FolderWatch } from './logic'
import { BrandMark } from './BrandMark'

export type PendingUpload = { courseId: string; name: string; stage: string; dvid?: string }

type Props = {
  courses: StudyCourseTree | null
  activeSessionId: string | null
  expanded: Set<string>
  pending: PendingUpload[]
  assets: AssetItem[]
  folderWatches: FolderWatch[]
  /** 每份素材备课一次的预估花费（按页数本地估，不调模型）。 */
  assetCosts: Record<string, string>
  missCount: number
  reviewActive: boolean
  onToggle: (courseId: string) => void
  onOpenSession: (sessionId: string) => void
  onUpload: (courseId: string) => void
  onImportFolder: (courseId: string) => void
  /** 立即扫一次；已停止的文件夹也会顺带恢复。 */
  onSyncFolder: (courseId: string) => void
  onStopFolder: (courseId: string) => void
  onPrepAsset: (courseId: string, documentVersionId: string, name: string) => void
  onRemoveAsset: (courseId: string, documentVersionId: string) => void
  onDropFiles: (courseId: string, files: File[]) => void
  onCreateCourse: (name: string) => void
  onRenameCourse: (courseId: string, name: string) => void
  onDeleteCourse: (courseId: string) => void
  onDeleteSession: (sessionId: string) => void
  onOpenReview: () => void
  onOpenSettings: () => void
  /** 收起左栏，把地方让给课件和对话（顶栏 ≡ 也能再打开）。 */
  onCollapse: () => void
}

function folderWatchText(watch: FolderWatch): string {
  if (watch.error) return '文件夹找不到'
  if (!watch.enabled) return '自动同步已停止'
  const parts: string[] = []
  if (watch.changedPaths.length > 0) parts.push(`${watch.changedPaths.length} 份内容有更新`)
  if (watch.oversized > 0) parts.push(`${watch.oversized} 份太大，已跳过`)
  const failed = Object.keys(watch.failed).length
  if (failed > 0) parts.push(`${failed} 份失败，已暂停重试`)
  if (watch.missingPaths.length > 0) parts.push(`${watch.missingPaths.length} 个已移走`)
  if (parts.length > 0) return `${parts.join(' · ')} · 自动同步`
  return `${Object.keys(watch.known).length} 份已收 · 自动同步`
}

function folderWatchDetail(watch: FolderWatch): string {
  const lines: string[] = [watch.folder]
  if (watch.oversized > 0) {
    lines.push(`${watch.oversized} 份文件超过 ${Math.round(LIMITS.autoImportFileBytes / 1024 / 1024)} MB，自动同步不会导入它们。`)
  }
  for (const [path, item] of Object.entries(watch.failed)) lines.push(`${path}：${item.reason}`)
  return lines.join('\n')
}

/** 左栏只做一件事：课程 → 课件。上传入口就在课程里面，不再满屏找按钮。 */
export function Sidebar(props: Props) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())
  const items = props.courses?.items ?? []

  function toggleFolder(key: string): void {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function countAssets(node: AssetTreeNode): number {
    return node.assets.length + node.folders.reduce((sum, child) => sum + countAssets(child), 0)
  }

  function renderAsset(asset: AssetItem): ReactElement {
    return (
      <div key={`a${asset.documentVersionId}`} className="hc-session-row asset">
        <span className="hc-session-main">
          <span className="hc-session-title" title={asset.relativePath ?? asset.name}>{asset.name}</span>
          {props.assetCosts[asset.documentVersionId] && (
            <span className="hc-asset-cost" title="按当前时段官方价本地预估；高峰时段约为闲时的两倍，实际以备课后的真实用量为准">
              预估 {props.assetCosts[asset.documentVersionId]}
            </span>
          )}
        </span>
        <span className="hc-row-actions" onClick={(event) => event.stopPropagation()}>
          <button
            className="hc-asset-prep"
            title="让老师读这份课件并排成一门课"
            onClick={() => props.onPrepAsset(asset.courseId, asset.documentVersionId, asset.name)}
          >
            备课
          </button>
          <button
            title="从素材里移出（课件仍在文档库，不删文件）"
            onClick={() => props.onRemoveAsset(asset.courseId, asset.documentVersionId)}
          >
            ✕
          </button>
        </span>
      </div>
    )
  }

  function renderEntries(node: AssetTreeNode, courseId: string, parentDepth: number): ReactElement[] {
    return assetTreeEntries(node).map((entry) => entry.kind === 'folder'
      ? renderFolder(entry.node, courseId, parentDepth + 1)
      : renderAsset(entry.asset))
  }

  function renderFolder(node: AssetTreeNode, courseId: string, depth: number): ReactElement {
    if (depth === 0) {
      return (
        <div className="hc-asset-tree">
          {renderEntries(node, courseId, 0)}
        </div>
      )
    }
    const key = `${courseId}:${node.path}`
    const open = openFolders.has(key)
    return (
      <div key={`f${key}`} className="hc-asset-folder" style={{ marginLeft: depth === 1 ? 0 : 8 }}>
        <button className="hc-asset-folder-head" onClick={() => toggleFolder(key)}>
          <span className="hc-caret">{open ? '▾' : '▸'}</span>
          <span className="hc-asset-folder-name" title={node.path}>{node.name}</span>
          <span className="hc-asset-folder-count">{countAssets(node)}</span>
        </button>
        {open && (
          <div className="hc-asset-folder-body" style={{ paddingLeft: 10 }}>
            {renderEntries(node, courseId, depth)}
          </div>
        )}
      </div>
    )
  }

  function submitNew(): void {
    const name = newName.trim()
    if (name === '') return
    props.onCreateCourse(name)
    setNewName('')
  }

  return (
    <aside className="hc-sidebar">
      <div className="hc-brand">
        <BrandMark />
        <div className="hc-brand-text">
          <div className="hc-brand-name">寒窗</div>
          <div className="hc-brand-sub">AI 授课老师</div>
        </div>
        <button className="hc-sidebar-collapse" onClick={props.onCollapse} title="收起左栏，课件和对话平分整屏">«</button>
      </div>

      <div className="hc-new-course">
        <input
          value={newName}
          placeholder="新建课程，如：数据结构"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submitNew() }}
        />
        <button className="hc-new-course-btn" disabled={newName.trim() === ''} onClick={submitNew}>＋</button>
      </div>

      <div className="hc-course-list">
        {items.length === 0 && <div className="hc-sidebar-empty">还没有课程。先建一门课，再把课件丢进去。</div>}
        {items.map((course) => {
          const open = props.expanded.has(course.courseId)
          const coursePending = props.pending.filter((item) => item.courseId === course.courseId)
          const courseAssets = props.assets.filter((item) => item.courseId === course.courseId)
          const watch = props.folderWatches.find((item) => item.courseId === course.courseId)
          const assetTree = assetTreeOf(courseAssets)
          return (
            <div
              key={course.courseId}
              className={`hc-course${dragId === course.courseId ? ' drag' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragId(course.courseId) }}
              onDragLeave={() => setDragId((current) => (current === course.courseId ? null : current))}
              onDrop={(event) => {
                event.preventDefault()
                setDragId(null)
                const files = Array.from(event.dataTransfer.files)
                if (files.length > 0) props.onDropFiles(course.courseId, files)
              }}
            >
              {editingId === course.courseId ? (
                <div className="hc-course-edit">
                  <input
                    value={editName}
                    autoFocus
                    onChange={(event) => setEditName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && editName.trim() !== '') {
                        props.onRenameCourse(course.courseId, editName.trim())
                        setEditingId(null)
                      }
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <button onClick={() => { if (editName.trim() !== '') props.onRenameCourse(course.courseId, editName.trim()); setEditingId(null) }}>存</button>
                </div>
              ) : (
                <div className="hc-course-row" onClick={() => props.onToggle(course.courseId)}>
                  <span className="hc-caret">{open ? '▾' : '▸'}</span>
                  <span className="hc-course-name">{course.name}</span>
                  <span className="hc-course-count">{course.sessions.length}</span>
                  <span className="hc-row-actions" onClick={(event) => event.stopPropagation()}>
                    <button title="重命名" onClick={() => { setEditingId(course.courseId); setEditName(course.name) }}>✎</button>
                    <button title="删除课程" onClick={() => props.onDeleteCourse(course.courseId)}>✕</button>
                  </span>
                </div>
              )}
              {open && (
                <div className="hc-session-list">
                  {course.sessions.map((session) => (
                    <div
                      key={session.sessionId}
                      className={`hc-session-row${session.sessionId === props.activeSessionId ? ' active' : ''}`}
                      onClick={() => props.onOpenSession(session.sessionId)}
                    >
                      <span className="hc-session-title">{session.title}</span>
                      <span className="hc-session-meta">
                        {session.status === 'finished' ? '已下课' : `${session.unitCount} ${session.layout === 'continuous' ? '段' : '讲'}`}
                      </span>
                      <span className="hc-row-actions" onClick={(event) => event.stopPropagation()}>
                        <button title="删除这份课件的课堂" onClick={() => props.onDeleteSession(session.sessionId)}>✕</button>
                      </span>
                    </div>
                  ))}
                  {coursePending.map((item, index) => (
                    <div key={`p${index}`} className="hc-session-row pending">
                      <span className="hc-session-title">{item.name}</span>
                      <span className="hc-session-meta">{item.stage}</span>
                    </div>
                  ))}
                  {courseAssets.length > 0 && (
                    <div className="hc-asset-head">素材 · 未备课（点「备课」才花 token）</div>
                  )}
                  {renderFolder(assetTree, course.courseId, 0)}
                  {watch && (
                    <div className={`hc-folder-watch${watch.error ? ' error' : ''}`} title={watch.folder}>
                      <span className={`hc-folder-watch-dot${watch.enabled && !watch.error ? ' on' : ''}`} />
                      <span className="hc-folder-watch-text">
                        <span className="hc-folder-watch-name">{watch.folderName}</span>
                        <span className="hc-folder-watch-meta" title={folderWatchDetail(watch)}>
                          {folderWatchText(watch)}
                        </span>
                      </span>
                      <span className="hc-folder-watch-actions" onClick={(event) => event.stopPropagation()}>
                        {watch.enabled && (
                          <button title="马上扫一次；内容改过的课件会先问你" onClick={() => props.onSyncFolder(course.courseId)}>同步</button>
                        )}
                        {watch.enabled
                          ? <button title="停止自动同步，素材和课堂都保留" onClick={() => props.onStopFolder(course.courseId)}>停</button>
                          : <button title="恢复自动同步并马上扫一次" onClick={() => props.onSyncFolder(course.courseId)}>恢复</button>}
                        <button title="换一个同步文件夹" onClick={() => props.onImportFolder(course.courseId)}>换</button>
                      </span>
                    </div>
                  )}
                  <button className="hc-upload-btn" onClick={() => props.onUpload(course.courseId)}>＋ 上传课件 / 拖到这里</button>
                  {!watch && (
                    <button
                      className="hc-folder-btn"
                      title="选一次，以后直接往这个文件夹里放课件就会自动同步"
                      onClick={() => props.onImportFolder(course.courseId)}
                    >
                      ＋ 导入整个文件夹
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="hc-sidebar-foot">
        <button className={props.reviewActive ? 'active' : ''} onClick={props.onOpenReview}>
          复习错题{props.missCount > 0 ? <span className="hc-badge">{props.missCount}</span> : null}
        </button>
        <button onClick={props.onOpenSettings}>设置</button>
      </div>
    </aside>
  )
}