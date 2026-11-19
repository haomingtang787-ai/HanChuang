import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SAMPLE_TXT } from './helpers/builders'
import { createHarness, writeTemp, type Harness } from './helpers/app'

const apps: Harness[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.cleanup()
})

describe('清除本机数据', () => {
  it('只清内容：课件、页面、原文都清掉，课程与设置保留，清前自动备份', async () => {
    const app = await createHarness()
    apps.push(app)
    const file = writeTemp('清除测试.txt', SAMPLE_TXT)
    const imported = await app.importFile(file)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    await app.service.settle()

    app.db.run(
      'INSERT INTO study_courses (id, name, sort_order, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      'course-keep',
      '计基',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    const before = app.service.stats()
    expect(before.ok && before.data.documents).toBe(1)

    const cleared = await app.service.clearData({ scope: 'content', backup: true })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.data.scope).toBe('content')
    expect(cleared.data.removed.documents).toBe(1)
    expect(cleared.data.removed.courses).toBe(0)
    expect(cleared.data.backupPath).toBeTruthy()
    expect(fs.existsSync(cleared.data.backupPath as string)).toBe(true)

    const after = app.service.stats()
    expect(after.ok && after.data.documents).toBe(0)
    expect(after.ok && after.data.pages).toBe(0)
    expect(after.ok && after.data.blocks).toBe(0)
    expect(fs.readdirSync(path.join(app.root, 'originals'))).toHaveLength(0)
    const artifacts = path.join(app.root, 'artifacts')
    const artifactsLeft = fs.existsSync(artifacts) ? fs.readdirSync(artifacts).length : 0
    expect(artifactsLeft).toBe(0)

    const courses = app.db.get<{ total: number }>('SELECT COUNT(*) AS total FROM study_courses')
    expect(Number(courses?.total ?? 0)).toBe(1)
  })

  it('全部清空连课程一起清，且可以关掉自动备份', async () => {
    const app = await createHarness()
    apps.push(app)
    const file = writeTemp('清空测试.txt', SAMPLE_TXT)
    const imported = await app.importFile(file)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    await app.service.settle()
    app.db.run(
      'INSERT INTO study_courses (id, name, sort_order, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      'course-gone',
      '数据结构',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    const cleared = await app.service.clearData({ scope: 'all', backup: false })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.data.scope).toBe('all')
    expect(cleared.data.backupPath).toBeNull()
    expect(cleared.data.removed.courses).toBe(1)
    // 临时库里本来就只有几百字节，VACUUM 之后可能一点没省；这里只验它是合法的非负数。
    expect(cleared.data.freedBytes).toBeGreaterThanOrEqual(0)

    const courses = app.db.get<{ total: number }>('SELECT COUNT(*) AS total FROM study_courses')
    expect(Number(courses?.total ?? 0)).toBe(0)
    const docs = app.db.get<{ total: number }>('SELECT COUNT(*) AS total FROM documents')
    expect(Number(docs?.total ?? 0)).toBe(0)
    // 库还能继续用：清完再导入一份不报错。
    const again = await app.importFile(writeTemp('再导入.txt', SAMPLE_TXT))
    expect(again.ok).toBe(true)
  })

  it('清空的库仍能通过 stats/storage 正常读出零值', async () => {
    const app = await createHarness()
    apps.push(app)
    const cleared = await app.service.clearData({ scope: 'content' })
    expect(cleared.ok).toBe(true)
    const stats = app.service.stats()
    expect(stats.ok && stats.data.documents).toBe(0)
    const storage = app.service.storage()
    expect(storage.ok).toBe(true)
    if (!storage.ok) return
    expect(storage.data.documents).toBe(0)
    expect(storage.data.totalBytes).toBeGreaterThanOrEqual(0)
  })
})
