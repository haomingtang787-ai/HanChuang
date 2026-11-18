import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './helpers/app'

const apps: Harness[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.cleanup()
})

describe('寒窗 一键备份与一键恢复', () => {
  it('backupNow 不弹对话框，写到库旁 backups，manifest 品牌为寒窗', async () => {
    const app = await createHarness()
    apps.push(app)
    const result = await app.service.backupNow()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.path).toContain(`${path.sep}backups${path.sep}`)
    expect(path.basename(result.data.path).startsWith('寒窗备份-')).toBe(true)
    const manifest = JSON.parse(fs.readFileSync(path.join(result.data.path, 'manifest.json'), 'utf8')) as { product?: string }
    expect(manifest.product).toBe('寒窗')
  })

  it('restoreLatest 取最新备份并校验哈希；applyRestore 真换库', async () => {
    const app = await createHarness({ restart: () => undefined })
    apps.push(app)
    const backed = await app.service.backupNow()
    expect(backed.ok).toBe(true)
    if (!backed.ok) return
    const preview = await app.service.restoreLatest()
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.data.sourcePath).toBe(backed.data.path)
    expect(preview.data.verification).toBe('sha256')
    const applied = await app.service.applyRestore({ token: preview.data.token })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.restored).toBe(true)
    expect(fs.existsSync(path.join(app.root, 'library.sqlite'))).toBe(true)
  })

  it('旧灯下备份仍可恢复（品牌兼容）', async () => {
    const app = await createHarness()
    apps.push(app)
    const backed = await app.service.backupNow()
    expect(backed.ok).toBe(true)
    if (!backed.ok) return
    const manifestFile = path.join(backed.data.path, 'manifest.json')
    // 只改品牌字段、保持其余字节不变（manifest 自身大小参与校验）。
    const text = fs.readFileSync(manifestFile, 'utf8')
    fs.writeFileSync(manifestFile, text.replace(/"product":\s*"寒窗"/, '"product": "灯下"'))
    const preview = await app.service.restoreLatest()
    expect(preview.ok).toBe(true)
  })

  it('没有备份时 restoreLatest 给出可读冲突而不是崩溃', async () => {
    const app = await createHarness()
    apps.push(app)
    const preview = await app.service.restoreLatest()
    expect(preview.ok).toBe(false)
    if (preview.ok) return
    expect(preview.error.code).toBe('CONFLICT')
  })
})