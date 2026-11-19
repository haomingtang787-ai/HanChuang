import { useEffect, useState } from 'react'
import type { AiConfigView } from '../../shared/ai'
import type { UpdateCheckResult, UpdateDownloadProgress } from '../../shared/app'
import type { Result, StorageUsage, LibraryStats } from '../../shared/contract'
import type { AppSettingsView, ClearScope } from '../../shared/data'
import type { HabitsView } from '../../shared/teaching'
import type { TeacherMemoryKind, TeacherOverview } from '../../shared/teacher'
import { loadPrepMode, savePrepMode, type PrepMode } from './logic'

type Props = {
  onClose: () => void
  notify: (tone: 'info' | 'bad' | 'good', text: string) => void
  onAiSaved: (config: AiConfigView) => void
  onTeacherSaved: () => void
}

type Tab = 'model' | 'teacher' | 'habits' | 'data' | 'about'

const KIND_LABEL: Record<TeacherMemoryKind, string> = {
  goal: '目标',
  mastery: '掌握',
  misconception: '误解',
  preference: '偏好',
  strategy: '策略',
  constraint: '限制',
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

/** 设置一页搞定：模型、老师人格与记忆、我的习惯、预算与数据。 */
export function SettingsPanel(props: Props) {
  const api = window.desk
  const [tab, setTab] = useState<Tab>('model')
  const [aiForm, setAiForm] = useState({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', visionModel: '', apiKey: '' })
  const [hasKey, setHasKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [teacher, setTeacher] = useState<TeacherOverview | null>(null)
  const [persona, setPersona] = useState({ name: '', pronoun: 'she' as 'she' | 'they', tone: '', boundaries: '' })
  const [profile, setProfile] = useState({ goal: '', level: '', subjects: '', weeklyMinutes: 300, notes: '' })
  const [habits, setHabits] = useState<HabitsView | null>(null)
  const [prepMode, setPrepMode] = useState<PrepMode>(() => loadPrepMode())
  const [settings, setSettings] = useState<AppSettingsView | null>(null)
  const [storage, setStorage] = useState<StorageUsage | null>(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearScope, setClearScope] = useState<ClearScope>('content')
  const [clearBackup, setClearBackup] = useState(true)
  const [clearWord, setClearWord] = useState('')
  const [clearing, setClearing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [download, setDownload] = useState<UpdateDownloadProgress | null>(null)
  const [installedPath, setInstalledPath] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!api) return
      try {
        const [ai, overview, habitView, appSettings, storageUsage, libraryStats] = await Promise.all([
          api.ai.status(), api.teacher.overview(), api.teaching.habits.get(), api.data.settings(), api.data.storage(), api.data.stats(),
        ])
        if (!alive) return
        if (ai.ok) {
          setAiForm({ baseUrl: ai.data.baseUrl || 'https://api.deepseek.com/v1', model: ai.data.model || 'deepseek-chat', visionModel: ai.data.visionModel, apiKey: '' })
          setHasKey(ai.data.hasKey)
          // 打开设置就从接口拉一次真实模型列表，别让用户看到写死的名字。
          if (ai.data.hasKey) {
            const list = await api.ai.models()
            if (alive && list.ok) setModels(list.data.models)
          }
        }
        if (overview.ok) {
          setTeacher(overview.data)
          setPersona({
            name: overview.data.persona.name,
            pronoun: overview.data.persona.pronoun,
            tone: overview.data.persona.tone,
            boundaries: overview.data.persona.boundaries.join('\n'),
          })
          setProfile({
            goal: overview.data.profile.goal,
            level: overview.data.profile.level,
            subjects: overview.data.profile.subjects.join('，'),
            weeklyMinutes: overview.data.profile.weeklyMinutes,
            notes: overview.data.profile.notes,
          })
        }
        if (habitView.ok) setHabits(habitView.data)
        if (appSettings.ok) setSettings(appSettings.data)
        if (storageUsage.ok) setStorage(storageUsage.data)
        if (libraryStats.ok) setStats(libraryStats.data)
      } catch (error) {
        props.notify('bad', error instanceof Error ? error.message : '设置加载失败')
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!api) return
    void api.app.info().then((result) => {
      if (result.ok) setVersion(result.data.version)
    })
  }, [api])

  useEffect(() => {
    if (!api) return
    const off = api.app.onUpdateProgress((progress) => setDownload(progress))
    return () => { off() }
  }, [api])

  useEffect(() => {
    if (!api || !clearOpen) return
    let alive = true
    void (async () => {
      try {
        const [usage, counts] = await Promise.all([api.data.storage(), api.data.stats()])
        if (!alive) return
        if (usage.ok) setStorage(usage.data)
        if (counts.ok) setStats(counts.data)
      } catch {
        /* 数量读不到就不显示，不挡住清除入口 */
      }
    })()
    return () => { alive = false }
  }, [api, clearOpen])

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      props.notify('bad', error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  if (!api) return null

  /** 清除本机数据：默认先备份，成功后重载界面，避免残留内存里的旧课件。 */
  async function clearNow(): Promise<void> {
    if (!api) return
    setClearing(true)
    try {
      const result = unwrap(await api.data.clear({ scope: clearScope, backup: clearBackup }))
      const mb = (result.freedBytes / 1024 / 1024).toFixed(1)
      const backupName = result.backupPath ? result.backupPath.split(/[\\/]/).pop() : null
      props.notify(
        'good',
        `已清除：课件 ${result.removed.documents} 份 · 页 ${result.removed.pages} · 课堂 ${result.removed.sessions} 讲，释放 ${mb} MB` +
          (backupName ? `；清前备份 ${backupName}` : ''),
      )
      setClearOpen(false)
      setClearWord('')
      window.setTimeout(() => window.location.reload(), 800)
    } catch (error) {
      props.notify('bad', error instanceof Error ? error.message : '清除失败')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="hc-modal-mask" onClick={props.onClose}>
      <div className="hc-modal" onClick={(event) => event.stopPropagation()}>
        <div className="hc-modal-head">
          <div className="hc-modal-title">设置</div>
          <button onClick={props.onClose}>✕</button>
        </div>
        <div className="hc-tabs">
          <button className={tab === 'model' ? 'active' : ''} onClick={() => setTab('model')}>模型</button>
          <button className={tab === 'teacher' ? 'active' : ''} onClick={() => setTab('teacher')}>老师</button>
          <button className={tab === 'habits' ? 'active' : ''} onClick={() => setTab('habits')}>我的习惯</button>
          <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>预算与数据</button>
          <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>关于与更新</button>
        </div>

        <div className="hc-modal-body">
          {tab === 'model' && (
            <div className="hc-form">
              <label>接口地址（OpenAI 兼容，默认 DeepSeek）</label>
              <input value={aiForm.baseUrl} onChange={(event) => setAiForm({ ...aiForm, baseUrl: event.target.value })} />
              <label>讲课模型</label>
              <input value={aiForm.model} onChange={(event) => setAiForm({ ...aiForm, model: event.target.value })} />
              {models.length > 0 && (
                <div className="hc-model-chips">
                  {models.map((model) => (
                    <button key={model} onClick={() => setAiForm({ ...aiForm, model })}>{model}</button>
                  ))}
                </div>
              )}
              <label>读图模型（可选，扫描件/图片课件用）</label>
              <input value={aiForm.visionModel} placeholder="留空则用 Windows 自带离线 OCR" onChange={(event) => setAiForm({ ...aiForm, visionModel: event.target.value })} />
              <label>API Key</label>
              <input
                type="password"
                value={aiForm.apiKey}
                placeholder={hasKey ? '已保存。留空表示沿用旧密钥' : 'sk-…'}
                onChange={(event) => setAiForm({ ...aiForm, apiKey: event.target.value })}
              />
              <div className="hc-form-note">密钥只存在本机主进程，不进界面代码，也不上传任何服务器。</div>
              <div className="hc-form-actions">
                <button className="hc-primary" disabled={busy} onClick={() => void run(async () => {
                  const view = unwrap(await api.ai.saveConfig(aiForm))
                  setHasKey(view.hasKey)
                  props.onAiSaved(view)
                  props.notify('good', '模型配置已保存')
                })}>保存配置</button>
                <button disabled={busy} onClick={() => void run(async () => {
                  const result = unwrap(await api.ai.test({ baseUrl: aiForm.baseUrl, model: aiForm.model, apiKey: aiForm.apiKey }))
                  props.notify('good', `连接成功：${result.reply.slice(0, 60)}`)
                })}>测试连接</button>
                <button disabled={busy} onClick={() => void run(async () => {
                  const list = unwrap(await api.ai.models({ baseUrl: aiForm.baseUrl, apiKey: aiForm.apiKey }))
                  setModels(list.models)
                  props.notify('info', `拉到 ${list.models.length} 个模型，点一下即可选用`)
                })}>拉取模型列表</button>
              </div>
            </div>
          )}

          {tab === 'teacher' && teacher && (
            <div className="hc-form">
              <div className="hc-section-title">老师人格</div>
              <label>名字</label>
              <input value={persona.name} onChange={(event) => setPersona({ ...persona, name: event.target.value })} />
              <label>称呼</label>
              <select value={persona.pronoun} onChange={(event) => setPersona({ ...persona, pronoun: event.target.value as 'she' | 'they' })}>
                <option value="she">她</option>
                <option value="they">TA</option>
              </select>
              <label>语气风格</label>
              <textarea rows={2} value={persona.tone} onChange={(event) => setPersona({ ...persona, tone: event.target.value })} />
              <label>边界（每行一条，老师不会越过）</label>
              <textarea rows={2} value={persona.boundaries} onChange={(event) => setPersona({ ...persona, boundaries: event.target.value })} />
              <div className="hc-form-actions">
                <button className="hc-primary" disabled={busy} onClick={() => void run(async () => {
                  unwrap(await api.teacher.savePersona({
                    name: persona.name.trim(),
                    pronoun: persona.pronoun,
                    tone: persona.tone,
                    boundaries: persona.boundaries.split('\n').map((item) => item.trim()).filter((item) => item !== ''),
                  }))
                  props.onTeacherSaved()
                  props.notify('good', '老师人格已更新')
                })}>保存人格</button>
              </div>

              <div className="hc-section-title">学生档案（老师按这个因材施教）</div>
              <label>目标</label>
              <input value={profile.goal} placeholder="如：期末不挂科 / CSP 认证" onChange={(event) => setProfile({ ...profile, goal: event.target.value })} />
              <label>当前水平</label>
              <input value={profile.level} placeholder="如：大二，基础薄弱" onChange={(event) => setProfile({ ...profile, level: event.target.value })} />
              <label>科目（逗号分隔）</label>
              <input value={profile.subjects} onChange={(event) => setProfile({ ...profile, subjects: event.target.value })} />
              <label>每周可学分钟数</label>
              <input type="number" value={profile.weeklyMinutes} onChange={(event) => setProfile({ ...profile, weeklyMinutes: Number(event.target.value) || 0 })} />
              <label>备注</label>
              <textarea rows={2} value={profile.notes} onChange={(event) => setProfile({ ...profile, notes: event.target.value })} />
              <div className="hc-form-actions">
                <button className="hc-primary" disabled={busy} onClick={() => void run(async () => {
                  unwrap(await api.teacher.saveProfile({
                    goal: profile.goal,
                    level: profile.level,
                    subjects: profile.subjects.split(/[,，]/).map((item) => item.trim()).filter((item) => item !== ''),
                    weeklyMinutes: profile.weeklyMinutes,
                    notes: profile.notes,
                  }))
                  props.onTeacherSaved()
                  props.notify('good', '学生档案已更新')
                })}>保存档案</button>
              </div>

              <div className="hc-section-title">老师对你的记忆（{teacher.memories.length} 条）</div>
              <div className="hc-form-note">勾选「确认」的记忆才会进入讲课提示词；观察和推测由你把关。</div>
              {teacher.memories.length === 0 && <div className="hc-muted">下课后老师会提炼观察，来这里确认。</div>}
              {teacher.memories.map((memory) => (
                <div key={memory.id} className="hc-memory">
                  <div className="hc-memory-text">
                    <span className="hc-memory-kind">{KIND_LABEL[memory.kind]}</span>
                    {memory.statement}
                  </div>
                  <div className="hc-memory-actions">
                    <label>
                      <input
                        type="checkbox"
                        checked={memory.userConfirmed}
                        disabled={busy}
                        onChange={() => void run(async () => {
                          unwrap(await api.teacher.saveMemory({
                            id: memory.id,
                            kind: memory.kind,
                            subject: memory.subject,
                            concept: memory.concept,
                            statement: memory.statement,
                            evidence: memory.evidence,
                            confidence: memory.confidence,
                            userConfirmed: !memory.userConfirmed,
                          }))
                          const overview = unwrap(await api.teacher.overview())
                          setTeacher(overview)
                          props.onTeacherSaved()
                        })}
                      />
                      确认
                    </label>
                    <button disabled={busy} onClick={() => void run(async () => {
                      unwrap(await api.teacher.deleteMemory({ id: memory.id }))
                      const overview = unwrap(await api.teacher.overview())
                      setTeacher(overview)
                      props.onTeacherSaved()
                    })}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'habits' && habits && (
            <div className="hc-form">
              <div className="hc-form-note">不用一条条选：想怎么写就怎么写，留空也行。老师照你写的这段教；没写的按默认来，上完课他自己会把观察到的东西记进「老师记忆」。</div>
              <label>备课怎么拆</label>
              <select
                value={prepMode}
                onChange={(event) => {
                  const next: PrepMode = event.target.value === 'page' ? 'page' : 'overview'
                  setPrepMode(next)
                  savePrepMode(next)
                }}
              >
                <option value="page">按页拆（一页至少一讲，一点一点讲）</option>
                <option value="overview">按主干拆（1–4 讲，先搭框架）</option>
              </select>
              <div className="hc-form-note">
                {prepMode === 'page'
                  ? '按页拆：每页单独备课、单独上课，页数多时讲数就是页数量级，备课费用和时间会更高；封面、目录、致谢这类页会自动跳过。'
                  : '按主干拆：整份材料合并成 1–4 讲，先搭主干，细节留到你追问。'}
              </div>
              <label>怎么称呼你</label>
              <input value={habits.name} maxLength={16} onChange={(event) => setHabits({ ...habits, name: event.target.value })} />
              <label>想让我怎么教（可以不填）</label>
              <textarea
                rows={5}
                maxLength={160}
                value={habits.note ?? ''}
                placeholder="例：我数学底子薄，公式一多就晕；一次最多坐半小时；喜欢先看例子再看定义。"
                onChange={(event) => setHabits({ ...habits, note: event.target.value })}
              />
              <div className="hc-form-note">{(habits.note ?? '').trim().length}/160 字。写具体的事，比写形容词有用。</div>
              <div className="hc-form-actions">
                <button className="hc-primary" disabled={busy} onClick={() => void run(async () => {
                  const saved = unwrap(await api.teaching.habits.save(habits))
                  setHabits(saved)
                  props.notify('good', '学习习惯已保存')
                })}>保存习惯</button>
              </div>
            </div>
          )}

          {tab === 'data' && (
            <div className="hc-form">
              <div className="hc-section-title">每月 token 预算</div>
              {settings && (
                <>
                  <label>上限（0 = 不限制）</label>
                  <input
                    type="number"
                    value={settings.budget.monthlyTokens}
                    onChange={(event) => setSettings({ ...settings, budget: { ...settings.budget, monthlyTokens: Number(event.target.value) || 0 } })}
                  />
                  <label className="hc-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.budget.hardStop}
                      onChange={(event) => setSettings({ ...settings, budget: { ...settings.budget, hardStop: event.target.checked } })}
                    />
                    到上限就拦住 AI 调用（否则只提醒）
                  </label>
                  <div className="hc-form-note">
                    本月已用 {settings.budgetStatus.used.toLocaleString()} tokens
                    {settings.budgetStatus.limit > 0 ? ` / ${settings.budgetStatus.limit.toLocaleString()}（${settings.budgetStatus.percent}%）` : ''}
                    {settings.budgetStatus.estimated ? '，含未返回用量的估算调用' : ''}
                  </div>
                  <div className="hc-form-actions">
                    <button className="hc-primary" disabled={busy} onClick={() => void run(async () => {
                      const saved = unwrap(await api.data.saveSettings({ budget: settings.budget }))
                      setSettings(saved)
                      props.notify('good', '预算已保存')
                    })}>保存预算</button>
                  </div>
                </>
              )}
              <div className="hc-section-title">本机数据</div>
              {storage && (
                <div className="hc-form-note">
                  课件 {storage.documents} 份 · 页 {storage.pages} · 占用 {(storage.totalBytes / 1024 / 1024).toFixed(1)} MB
                </div>
              )}
              <div className="hc-form-actions">
                <button disabled={busy} onClick={() => void run(async () => {
                  const result = unwrap(await api.data.backupNow())
                  props.notify('good', `已备份到 ${result.path}`)
                })}>立即备份</button>
                <button disabled={busy} onClick={() => void run(async () => {
                  const preview = unwrap(await api.data.restoreLatest())
                  const confirmed = window.confirm(
                    `发现备份：${preview.sourcePath}\n课件 ${preview.counts.documents} 份、卡片 ${preview.counts.cards} 张、错题 ${preview.counts.misses} 条。\n恢复会覆盖当前数据，确定？`,
                  )
                  if (!confirmed) return
                  unwrap(await api.data.applyRestore({ token: preview.token }))
                  props.notify('good', '恢复完成，正在重启寒窗…')
                })}>从备份恢复</button>
              </div>
              <div className="hc-form-actions">
                <button disabled={busy} onClick={() => void run(async () => {
                  const result = unwrap(await api.data.backup())
                  props.notify('good', `已备份到 ${result.path}`)
                })}>备份到文件夹…</button>
                <button disabled={busy} onClick={() => void run(async () => {
                  const preview = unwrap(await api.data.inspectRestore())
                  const confirmed = window.confirm(
                    `发现备份：${preview.sourcePath}\n课件 ${preview.counts.documents} 份、卡片 ${preview.counts.cards} 张、错题 ${preview.counts.misses} 条。\n恢复会覆盖当前数据，确定？`,
                  )
                  if (!confirmed) return
                  unwrap(await api.data.applyRestore({ token: preview.token }))
                  props.notify('good', '恢复完成，正在重启寒窗…')
                })}>从文件夹恢复…</button>
              </div>

              <div className="hc-danger-zone">
                <div className="hc-danger-zone-head">
                  <span>清除数据</span>
                  {!clearOpen && (
                    <button
                      className="hc-danger"
                      disabled={busy}
                      onClick={() => {
                        setClearOpen(true)
                        setClearWord('')
                        // 展开后确认行会落到折叠线下面：直接滚到底，让人一眼看到输入框和按钮
                        window.setTimeout(() => {
                          const body = document.querySelector('.hc-modal-body')
                          if (body) body.scrollTop = body.scrollHeight
                        }, 60)
                      }}
                    >清除本机数据…</button>
                  )}
                </div>
                {!clearOpen && (
                  <div className="hc-form-note">
                    课件与页面图删掉就没了，要重新导入；模型设置与 API Key 不动。清之前会自动留一份备份，后悔了能恢复。
                  </div>
                )}
                {clearOpen && (
                  <div className="hc-danger-panel">
                    <div className="hc-danger-count">
                      将删除：课件 {storage?.documents ?? 0} 份 · 页 {storage?.pages ?? 0} · 课堂 {stats?.sessions ?? 0} 讲 ·
                      复习卡 {(stats?.manualCards ?? 0) + (stats?.cards ?? 0)} 张 · 错题 {stats?.misses ?? 0} 条 ·
                      占用 {((storage?.totalBytes ?? 0) / 1024 / 1024).toFixed(1)} MB
                    </div>
                    <label className="hc-choice">
                      <input
                        type="radio"
                        name="hc-clear-scope"
                        checked={clearScope === 'content'}
                        onChange={() => setClearScope('content')}
                      />
                      <span>
                        只清课件与课堂
                        <em>课程分组、我的习惯、老师人格与记忆都保留</em>
                      </span>
                    </label>
                    <label className="hc-choice">
                      <input
                        type="radio"
                        name="hc-clear-scope"
                        checked={clearScope === 'all'}
                        onChange={() => setClearScope('all')}
                      />
                      <span>
                        全部清空
                        <em>连课程分组、习惯、老师记忆一起清，等于从头开始</em>
                      </span>
                    </label>
                    <label className="hc-checkbox">
                      <input
                        type="checkbox"
                        checked={clearBackup}
                        onChange={(event) => setClearBackup(event.target.checked)}
                      />
                      清除前先自动备份一份（推荐）
                    </label>
                    <div className="hc-danger-confirm">
                      <input
                        value={clearWord}
                        placeholder="输入「清除」两个字确认"
                        onChange={(event) => setClearWord(event.target.value)}
                      />
                      <button
                        className="hc-danger"
                        disabled={clearing || clearWord.trim() !== '清除'}
                        onClick={() => void clearNow()}
                      >{clearing ? '正在清除…' : '确认清除'}</button>
                      <button disabled={clearing} onClick={() => { setClearOpen(false); setClearWord('') }}>取消</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'about' && (
            <div className="hc-form">
              <div className="hc-section-title">寒窗 {version ? `v${version}` : ''}</div>
              <div className="hc-form-note">
                本地 AI 授课老师。课件、对话、API Key 都只在你本机；检查更新只读 GitHub 的 release 信息（api.github.com 的接口，不抓网页、不登录、不上传任何数据）。
              </div>
              <div className="hc-form-actions">
                <button
                  className="hc-primary"
                  disabled={busy || checking}
                  onClick={() => void (async () => {
                    setChecking(true)
                    setInstalledPath('')
                    setDownload(null)
                    try {
                      setUpdate(unwrap(await api.app.checkUpdate()))
                    } catch (error) {
                      props.notify('bad', error instanceof Error ? error.message : '检查更新失败')
                    } finally {
                      setChecking(false)
                    }
                  })()}
                >{checking ? '检查中…' : '检查更新'}</button>
                {update?.url && (
                  <button disabled={busy} onClick={() => void run(async () => {
                    unwrap(await api.app.openUrl({ url: update.url as string }))
                  })}>打开发布页</button>
                )}
              </div>
              {update && (
                <div className={`hc-update-box is-${update.status}`}>
                  <div className="hc-update-line">{update.message}</div>
                  {update.status === 'update-available' && update.assetUrl && update.assetName && !installedPath && (
                    <>
                      <div className="hc-form-note">
                        安装包 {update.assetName}
                        {update.assetSize ? `，约 ${(update.assetSize / 1024 / 1024).toFixed(0)} MB` : ''}
                        。运行安装包即可覆盖安装，课程、对话、错题都不动。
                      </div>
                      <div className="hc-form-actions">
                        <button disabled={busy || Boolean(download && download.percent < 100)} onClick={() => void run(async () => {
                          const assetUrl = update.assetUrl as string
                          const assetName = update.assetName as string
                          setDownload({ received: 0, total: update.assetSize ?? 0, percent: 0 })
                          const result = unwrap(await api.app.downloadUpdate({ assetUrl, assetName, assetSize: update.assetSize }))
                          setInstalledPath(result.filePath)
                          props.notify('good', `安装包已下载：${result.filePath}`)
                        })}>{download && download.percent < 100 ? `下载中 ${download.percent}%` : '下载安装包'}</button>
                      </div>
                      {download && download.percent < 100 && (
                        <div className="hc-update-bar"><span style={{ width: `${Math.max(2, download.percent)}%` }} /></div>
                      )}
                    </>
                  )}
                  {installedPath && (
                    <>
                      <div className="hc-form-note">已下载到 {installedPath}。点「运行安装包」会自动关掉寒窗再安装，装完重新打开就是新版。</div>
                      <div className="hc-form-actions">
                        <button className="hc-primary" disabled={busy} onClick={() => void run(async () => {
                          unwrap(await api.app.openUpdate({ filePath: installedPath }))
                          props.notify('info', '安装程序已启动，装完再打开寒窗就是新版')
                        })}>运行安装包</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {!update && version && (
                <div className="hc-form-note">当前已是最新检查点：还没点过「检查更新」。点一下会去向 GitHub 问一次最新版本，正常情况一两秒。</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}