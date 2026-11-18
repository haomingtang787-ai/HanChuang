import { useEffect, useState } from 'react'
import type { AiConfigView } from '../../shared/ai'
import type { Result, StorageUsage } from '../../shared/contract'
import type { AppSettingsView } from '../../shared/data'
import type { HabitsView } from '../../shared/teaching'
import type { TeacherMemoryKind, TeacherOverview } from '../../shared/teacher'

type Props = {
  onClose: () => void
  notify: (tone: 'info' | 'bad' | 'good', text: string) => void
  onAiSaved: (config: AiConfigView) => void
  onTeacherSaved: () => void
}

type Tab = 'model' | 'teacher' | 'habits' | 'data'

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
  const [settings, setSettings] = useState<AppSettingsView | null>(null)
  const [storage, setStorage] = useState<StorageUsage | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!api) return
      try {
        const [ai, overview, habitView, appSettings, storageUsage] = await Promise.all([
          api.ai.status(), api.teacher.overview(), api.teaching.habits.get(), api.data.settings(), api.data.storage(),
        ])
        if (!alive) return
        if (ai.ok) {
          setAiForm({ baseUrl: ai.data.baseUrl || 'https://api.deepseek.com/v1', model: ai.data.model || 'deepseek-chat', visionModel: ai.data.visionModel, apiKey: '' })
          setHasKey(ai.data.hasKey)
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
      } catch (error) {
        props.notify('bad', error instanceof Error ? error.message : '设置加载失败')
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
              <div className="hc-form-note">备课时老师按这些习惯拆课、选例子。改完下一门新课生效。</div>
              <label>怎么称呼你</label>
              <input value={habits.name} onChange={(event) => setHabits({ ...habits, name: event.target.value })} />
              <label>节奏</label>
              <select value={habits.pace} onChange={(event) => setHabits({ ...habits, pace: event.target.value as HabitsView['pace'] })}>
                <option value="slow">慢一点，掰开揉碎</option>
                <option value="steady">正常节奏</option>
                <option value="exam">冲刺应试</option>
              </select>
              <label>讲法</label>
              <select value={habits.style} onChange={(event) => setHabits({ ...habits, style: event.target.value as HabitsView['style'] })}>
                <option value="story">多打比方、讲故事</option>
                <option value="define">先定义再例子</option>
                <option value="ask">多提问引导我</option>
              </select>
              <label>一坐多久</label>
              <select value={habits.minutes} onChange={(event) => setHabits({ ...habits, minutes: Number(event.target.value) as HabitsView['minutes'] })}>
                <option value={15}>15 分钟</option>
                <option value={25}>25 分钟</option>
                <option value={40}>40 分钟</option>
              </select>
              <label>常用时段</label>
              <select value={habits.window} onChange={(event) => setHabits({ ...habits, window: event.target.value as HabitsView['window'] })}>
                <option value="morning">上午</option>
                <option value="afternoon">下午</option>
                <option value="evening">晚上</option>
                <option value="night">深夜</option>
              </select>
              <label>要避开</label>
              <select value={habits.avoid} onChange={(event) => setHabits({ ...habits, avoid: event.target.value as HabitsView['avoid'] })}>
                <option value="formula">堆公式</option>
                <option value="long">长篇大论</option>
                <option value="noexample">没有例子</option>
              </select>
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}