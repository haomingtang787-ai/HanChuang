import { useState } from 'react'
import type { StudyCourseTree } from '../../shared/study'
import type { AssetItem } from './logic'
import { BrandMark } from './BrandMark'

export type PendingUpload = { courseId: string; name: string; stage: string; dvid?: string }

type Props = {
  courses: StudyCourseTree | null
  activeSessionId: string | null
  expanded: Set<string>
  pending: PendingUpload[]
  assets: AssetItem[]
  /** 每份素材备课一次的预估花费（按页数本地估，不调模型）。 */
  assetCosts: Record<string, string>
  missCount: number
  reviewActive: boolean
  onToggle: (courseId: string) => void
  onOpenSession: (sessionId: string) => void
  onUpload: (courseId: string) => void
  onImportFolder: (courseId: string) => void
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

/** 左栏只做一件事：课程 → 课件。上传入口就在课程里面，不再满屏找按钮。 */
export function Sidebar(props: Props) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const items = props.courses?.items ?? []

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
                        {session.status === 'finished' ? '已下课' : `${session.unitCount} 讲`}
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
                  {courseAssets.map((asset) => (
                    <div key={`a${asset.documentVersionId}`} className="hc-session-row asset">
                      <span className="hc-session-main">
                        <span className="hc-session-title" title={asset.name}>{asset.name}</span>
                        {props.assetCosts[asset.documentVersionId] && (
                          <span className="hc-asset-cost" title="按页数本地预估，实际以备课后的真实用量为准">
                            预估 {props.assetCosts[asset.documentVersionId]}
                          </span>
                        )}
                      </span>
                      <span className="hc-row-actions" onClick={(event) => event.stopPropagation()}>
                        <button
                          className="hc-asset-prep"
                          title="让老师读这份课件并排成一门课"
                          onClick={() => props.onPrepAsset(course.courseId, asset.documentVersionId, asset.name)}
                        >
                          备课
                        </button>
                        <button
                          title="从素材里移出（课件仍在文档库，不删文件）"
                          onClick={() => props.onRemoveAsset(course.courseId, asset.documentVersionId)}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                  <button className="hc-upload-btn" onClick={() => props.onUpload(course.courseId)}>＋ 上传课件 / 拖到这里</button>
                  <button className="hc-folder-btn" onClick={() => props.onImportFolder(course.courseId)}>＋ 导入整个文件夹</button>
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