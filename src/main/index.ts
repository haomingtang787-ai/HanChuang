import { app, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DocumentService, type DeskEvents, type NativeDialogs } from '../documents/service'
import { CODE_EXTENSIONS } from '../shared/contract'
import { AiService } from '../ai/service'
import { BudgetService } from '../ai/budget'
import { ImageService } from '../images/service'
import { ForkWorker } from '../providers/forkWorker'
import { LocalOfficeGateway } from '../providers/officeGateway'
import { SettingsStore } from '../providers/settings'
import { probeLibreOffice } from '../providers/libreoffice'
import { clearOfficeEvidence, recordSandboxEvidence } from '../providers/isolation'
import { runSandboxSelfTest, sandboxHelperPath } from '../providers/sandbox'
import { IpcChannel } from '../shared/ipc'
import { AppDatabase } from '../storage/database'
import { migrate } from '../storage/migrate'
import { Store } from '../storage/store'
import { StudyStore } from '../storage/studyStore'
import { TeachingService } from '../teaching/service'
import { TeacherService } from '../teaching/teacherService'
import { DEFAULT_HABITS } from '../teaching/habits'
import { StudyService } from '../study/service'
import { AppInfoService } from '../app/info'
import { registerIpc } from './ipc'
import { handleAppResource } from './protocol'
import { scheduleSmoke } from './smoke'

const here = import.meta.dirname

// 寒窗沿用旧数据目录：%APPDATA%/desk-teacher-agent/library 里是用户已有的课程、课件、对话和用量。
// 锁定内部应用名，产品名改成「寒窗」也不会让 userData 迁移、丢数据。
app.setName('desk-teacher-agent')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-resource',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
])

let service: DocumentService | null = null

function workerEntry(): string {
  const candidates = [
    path.join(app.getAppPath(), 'out', 'worker', 'documentWorker.mjs'),
    path.join(here, '..', 'worker', 'documentWorker.mjs'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('找不到文档工作进程。请先运行 npm run build:worker。')
}

function createWindow(library: DocumentService): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 640,
    show: false,
    title: '寒窗',
    icon: path.join(here, '../resources/icon.png'),
    backgroundColor: '#F7F8FA',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => library.dropWindow(String(win.id)))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  const smokeView = process.env.DESK_SMOKE_VIEW
  const smokeHelp = process.env.DESK_SMOKE_HELP
  const queryParams = new URLSearchParams()
  if (smokeView === 'class' || smokeView === 'review') queryParams.set('view', smokeView)
  if (smokeHelp) queryParams.set('help', smokeHelp)
  const query = queryParams.size ? Object.fromEntries(queryParams) : undefined
  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL
    void win.loadURL(query ? `${base}?${queryParams.toString()}` : base)
  } else {
    void win.loadFile(path.join(here, '../renderer/index.html'), query ? { query } : undefined)
  }
  scheduleSmoke(win, library)
  return win
}

// Two pieces of evidence, in order, and both are thrown away first: a sandbox
// self-test that has to actually deny an escape read and a network connection,
// then one real DOCX through LibreOffice inside the same container. Until both
// land, Office page conversion stays closed. Nothing here reads settings,
// IPC or the environment to decide it.
async function verifyOfficeIsolation(settings: SettingsStore): Promise<void> {
  clearOfficeEvidence()
  const roots = app.isPackaged
    ? [process.resourcesPath]
    : [path.join(app.getAppPath(), 'resources'), process.resourcesPath]
  const helper = sandboxHelperPath(roots)
  const evidence = await runSandboxSelfTest(helper ?? '')
  recordSandboxEvidence(evidence)
  if (!evidence.ok) {
    console.log('[office] 沙箱自检未通过：', evidence.reason)
    return
  }
  console.log('[office] 沙箱自检通过：', evidence.containerSid)
  const description = await new LocalOfficeGateway().describe(settings.load())
  if (!description.fileFound || !description.path) {
    console.log('[office] 没有可探测的 LibreOffice，转换证据留空。')
    return
  }
  const probe = await probeLibreOffice(description.path, helper)
  console.log('[office] 转换证据：', probe.ok ? '已取得' : probe.message)
}

async function boot(): Promise<void> {
  // ⚠️ 用户数据目录：文稿、课程、对话、用量都在这里（Windows 默认 %APPDATA%/灯下/library）。
  // 更新时只替换应用文件，绝不要删除或清空这个目录；产品名「灯下」也必须保持稳定，
  // 否则 userData 会迁移到新名字目录，旧数据就找不到了。
  const root = path.join(app.getPath('userData'), 'library')
  fs.mkdirSync(root, { recursive: true })
  const db = AppDatabase.open(path.join(root, 'library.sqlite'))
  migrate(db)
  const store = new Store(db)
  const settings = new SettingsStore(path.join(root, 'settings.json'))
  const dialogs: NativeDialogs = {
    async pickDocuments(windowId) {
      const smokeFile = process.env.DESK_SMOKE_IMPORT
      if (smokeFile) {
        const stat = await fs.promises.stat(smokeFile)
        return { cancelled: false, files: [{ path: smokeFile, name: path.basename(smokeFile), sizeBytes: stat.size }] }
      }
      const parent = BrowserWindow.fromId(Number(windowId)) ?? undefined
      const result = parent
      ? await dialog.showOpenDialog(parent, {
        title: '选择要导入的文稿',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '文稿', extensions: ['pptx', 'docx', 'pdf', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg'] },
          { name: '代码与文本', extensions: [...CODE_EXTENSIONS] },
          { name: '旧版 Office（会被拒绝并给出另存说明）', extensions: ['ppt', 'doc'] },
        ],
      })
      : await dialog.showOpenDialog({
        title: '选择要导入的文稿',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '文稿', extensions: ['pptx', 'docx', 'pdf', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg'] },
          { name: '代码与文本', extensions: [...CODE_EXTENSIONS] },
          { name: '旧版 Office（会被拒绝并给出另存说明）', extensions: ['ppt', 'doc'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true, files: [] }
      const files = []
      for (const filePath of result.filePaths) {
        const stat = await fs.promises.stat(filePath)
        files.push({ path: filePath, name: path.basename(filePath), sizeBytes: stat.size })
      }
      return { cancelled: false, files }
    },
    async pickExecutable(windowId) {
      const parent = BrowserWindow.fromId(Number(windowId)) ?? undefined
      const result = parent
      ? await dialog.showOpenDialog(parent, {
        title: '选择本机 LibreOffice 的 soffice 可执行文件',
        properties: ['openFile'],
      })
      : await dialog.showOpenDialog({
        title: '选择本机 LibreOffice 的 soffice 可执行文件',
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return { cancelled: true, path: null }
      return { cancelled: false, path: result.filePaths[0] }
    },
    async pickDirectory(windowId, title) {
      const parent = BrowserWindow.fromId(Number(windowId)) ?? undefined
      const options = { title, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return null
      return result.filePaths[0]
    },
  }
  const events: DeskEvents = {
    jobsChanged(event) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IpcChannel.jobsChanged, event)
      }
    },
    focus(windowId, target) {
      const win = BrowserWindow.fromId(Number(windowId))
      if (!win || win.isDestroyed()) return false
      win.webContents.send(IpcChannel.previewFocus, target)
      return true
    },
  }
  service = new DocumentService({
    db,
    root,
    worker: new ForkWorker(workerEntry()),
    office: new LocalOfficeGateway(),
    dialogs,
    events,
    settings,
    recheckIsolation: () => verifyOfficeIsolation(settings),
    version: () => app.getVersion(),
    restart: () => {
      app.relaunch()
      setTimeout(() => app.exit(0), 200)
    },
  })
  protocol.handle('app-resource', (request) => handleAppResource(store, root, request))
  const dev = Boolean(process.env.ELECTRON_RENDERER_URL)
  const csp = dev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' app-resource: data:; connect-src 'self' ws://127.0.0.1:43123 http://127.0.0.1:43123; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' app-resource: data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  const teaching = new TeachingService({ db })
  const teacher = new TeacherService({ db })
  const budget = new BudgetService(db, settings)
  const ai = new AiService({ settings, teaching, budget })
  // 读图/查证也记 token 用量，和开课用量一起落到 ai_usage，课堂界面可以看到真实花费。
  const usageStore = new StudyStore(db)
  const images = new ImageService({
    store,
    root,
    settings,
    budget,
    onUsage: (kind, usage, documentVersionId) => {
      try {
        usageStore.insertUsage({
          sessionId: null,
          documentVersionId,
          kind,
          promptTokens: usage.promptTokens,
          cachedTokens: usage.cachedTokens,
          cacheMissTokens: usage.cacheMissTokens,
          completionTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens,
          providerReported: usage.providerReported,
          model: usage.model,
          createdAt: new Date().toISOString(),
        })
      } catch {
        // 用量统计不许影响读图。
      }
    },
  })
  const study = new StudyService({
    db,
    settings,
    images,
    budget,
    habits: () => {
      const result = teaching.habits()
      return result.ok ? result.data : DEFAULT_HABITS
    },
    teacher,
    onProgress: (progress) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IpcChannel.studyProgress, progress)
      }
    },
  })
  const appInfo = new AppInfoService()
  registerIpc(ipcMain, service, teaching, ai, images, study, teacher, appInfo)
  createWindow(service)
  const runAutoBackup = () => {
    void service?.autoBackup().then((result) => {
      if (result.ok && !result.data.skipped) console.log('[backup] 自动备份：', result.data.path)
    })
  }
  setTimeout(runAutoBackup, 1500)
  setInterval(runAutoBackup, 6 * 60 * 60 * 1000).unref()
  void verifyOfficeIsolation(settings).catch((error) => {
    console.error('[office] 隔离自检异常：', error)
  })
}

app.whenReady().then(boot).catch((error) => {
  console.error(error)
  app.quit()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  void service?.close()
})
