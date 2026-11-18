import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { scanFolderFiles } from '../src/documents/service'

function tempTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-scan-'))
  fs.writeFileSync(path.join(root, '第一讲.pptx'), 'pptx')
  fs.writeFileSync(path.join(root, 'note.txt'), 'txt')
  fs.writeFileSync(path.join(root, 'code.c'), 'int main(){}')
  fs.writeFileSync(path.join(root, '图片.png'), 'png')
  fs.writeFileSync(path.join(root, 'README'), 'no ext')
  fs.writeFileSync(path.join(root, '~$临时.docx'), 'tmp')
  fs.writeFileSync(path.join(root, '.hidden.pdf'), 'pdf')
  fs.writeFileSync(path.join(root, 'old.doc'), 'doc')
  fs.mkdirSync(path.join(root, '第二章'))
  fs.writeFileSync(path.join(root, '第二章', '内存.pdf'), 'pdf')
  fs.mkdirSync(path.join(root, '第二章', '深一层'))
  fs.writeFileSync(path.join(root, '第二章', '深一层', '也扫.txt'), 'txt')
  fs.mkdirSync(path.join(root, '第二章', '深一层', '第三层'))
  fs.writeFileSync(path.join(root, '第二章', '深一层', '第三层', '不扫.md'), 'md')
  return root
}

describe('文件夹扫描', () => {
  test('只收受支持的课件，忽略隐藏文件与 Office 临时文件', () => {
    const root = tempTree()
    const scan = scanFolderFiles(root)
    const names = scan.files.map((file) => file.name)
    expect(names).toContain('第一讲.pptx')
    expect(names).toContain('note.txt')
    expect(names).toContain('code.c')
    expect(names).toContain('图片.png')
    expect(names).toContain('内存.pdf')
    expect(names).toContain('也扫.txt')
    expect(names).not.toContain('README')
    expect(names).not.toContain('~$临时.docx')
    expect(names).not.toContain('.hidden.pdf')
    expect(names).not.toContain('old.doc')
    expect(names).not.toContain('不扫.md')
    expect(scan.skipped).toBeGreaterThanOrEqual(4)
  })

  test('每个文件都带绝对路径与字节数，方便直接 importPath', () => {
    const root = tempTree()
    const scan = scanFolderFiles(root)
    for (const file of scan.files) {
      expect(path.isAbsolute(file.path)).toBe(true)
      expect(file.sizeBytes).toBeGreaterThanOrEqual(0)
    }
  })

  test('超过上限时截断并如实报告跳过数', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-scan-cap-'))
    for (let index = 0; index < 12; index += 1) {
      fs.writeFileSync(path.join(root, `第${index}讲.txt`), 'x')
    }
    const scan = scanFolderFiles(root, 5)
    expect(scan.files).toHaveLength(5)
    expect(scan.skipped).toBe(7)
  })
})
