/** WPS 各组件可执行文件；没装 WPS 时全为 null，调用方回退系统默认程序。 */
export type WpsExes = {
  writer: string | null
  presentation: string | null
  spreadsheet: string | null
  pdf: string | null
}

export type OfficeKind = 'writer' | 'presentation' | 'spreadsheet' | 'pdf'
export type OfficeLaunch = { kind: OfficeKind; exe: string }

const EXT_KIND: Record<string, OfficeKind> = {
  doc: 'writer', docx: 'writer', wps: 'writer', rtf: 'writer',
  ppt: 'presentation', pptx: 'presentation', dps: 'presentation',
  xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet', et: 'spreadsheet',
  pdf: 'pdf',
}

/** 只按扩展名判断：代码、纯文本、图片一律返回 null，交给系统默认程序。 */
export function planOfficeLaunch(filePath: string, exes: WpsExes): OfficeLaunch | null {
  const name = filePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  const kind = EXT_KIND[name.slice(dot + 1).toLowerCase()]
  if (!kind) return null
  if (kind === 'pdf') {
    if (exes.pdf) return { kind: 'pdf', exe: exes.pdf }
    if (exes.writer) return { kind: 'writer', exe: exes.writer }
    return null
  }
  const exe = exes[kind]
  return exe ? { kind, exe } : null
}
