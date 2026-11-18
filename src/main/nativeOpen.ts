import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import { planOfficeLaunch, type WpsExes } from '../shared/office'
import type { OpenNativeResult } from '../shared/contract'

let cached: WpsExes | null = null

function readAppPath(): string | null {
  const keys = [
    ['HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\wps.exe'],
    ['HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\wps.exe'],
    ['HKLM', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\wps.exe'],
  ]
  for (const [hive, key] of keys) {
    try {
      const out = execFileSync('reg', ['query', `${hive}\\${key}`, '/ve'], { encoding: 'utf8', windowsHide: true })
      const match = /REG_SZ\s+(.+\.exe)/i.exec(out)
      if (match && fs.existsSync(match[1].trim())) return match[1].trim()
    } catch {
      // 没这个键就继续找下一个
    }
  }
  return null
}

/** 从 wps.exe 所在目录找同版本的 wpp/et/wpspdf；找不到返回 null。 */
function exesFromWriter(writerExe: string): WpsExes {
  const dir = path.dirname(writerExe)
  const local = (name: string): string | null => {
    const candidate = path.join(dir, name)
    return fs.existsSync(candidate) ? candidate : null
  }
  return {
    writer: writerExe,
    presentation: local('wpp.exe'),
    spreadsheet: local('et.exe'),
    pdf: local('wpspdf.exe'),
  }
}

function scanInstallDirs(): WpsExes | null {
  const roots = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Kingsoft', 'WPS Office'),
    path.join(process.env.ProgramFiles ?? '', 'WPS Office'),
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'WPS Office'),
    path.join(os.homedir(), 'AppData', 'Local', 'Kingsoft', 'WPS Office'),
  ]
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue
    const versions = fs.readdirSync(root).sort().reverse()
    for (const version of versions) {
      const writer = path.join(root, version, 'office6', 'wps.exe')
      if (fs.existsSync(writer)) return exesFromWriter(writer)
    }
  }
  return null
}

export function detectWps(): WpsExes {
  if (cached) return cached
  const fromReg = readAppPath()
  const found = fromReg ? exesFromWriter(fromReg) : scanInstallDirs()
  cached = found ?? { writer: null, presentation: null, spreadsheet: null, pdf: null }
  return cached
}

/**
 * 打开原件：Office 文档优先用 WPS 对应组件，代码/文本/图片走系统默认程序。
 * dryRun 只算方案不真启动，供自测断言用。
 */
export async function openOriginal(filePath: string, options: { dryRun?: boolean } = {}): Promise<OpenNativeResult> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { opened: false, mode: 'none', kind: null, exe: null, note: '原件不在资料目录里了' }
  }
  const plan = planOfficeLaunch(filePath, detectWps())
  if (plan) {
    if (!options.dryRun) {
      spawn(plan.exe, [filePath], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
    }
    return { opened: true, mode: 'wps', kind: plan.kind, exe: plan.exe, note: options.dryRun ? '已选好 WPS 组件（未实际启动）' : '已用 WPS 打开' }
  }
  if (options.dryRun) {
    return { opened: true, mode: 'system', kind: null, exe: null, note: '交给系统默认程序（未实际启动）' }
  }
  const error = await shell.openPath(filePath)
  if (error !== '') {
    return { opened: false, mode: 'none', kind: null, exe: null, note: `打不开：${error}` }
  }
  return { opened: true, mode: 'system', kind: null, exe: null, note: '已用系统默认程序打开' }
}
