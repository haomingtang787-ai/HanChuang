import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'

const dbPath = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'desk-teacher-agent', 'library', 'library.sqlite')
const db = new DatabaseSync(dbPath, { readOnly: true })

const price = { miss: 1, hit: 0.02, out: 2 }

function cost(prompt, cached, completion) {
  return (Math.max(0, prompt - cached) * price.miss + cached * price.hit + completion * price.out) / 1_000_000
}
const fmt = (v) => (v < 0.01 ? '<1 分' : `¥${v.toFixed(3)}`)

const byKind = db.prepare(`SELECT kind, COUNT(*) AS calls, SUM(prompt_tokens) AS p, SUM(cached_tokens) AS c, SUM(completion_tokens) AS o
  FROM ai_usage GROUP BY kind ORDER BY (SUM(prompt_tokens)+SUM(completion_tokens)) DESC`).all()
console.log('== 按用途（全库累计）==')
let total = 0
for (const row of byKind) {
  const yuan = cost(row.p, row.c, row.o)
  total += yuan
  console.log(`${String(row.kind).padEnd(16)} 调用 ${String(row.calls).padStart(3)} 次  输入 ${String(row.p).padStart(8)}  (命中 ${row.c})  输出 ${String(row.o).padStart(7)}  ≈ ${fmt(yuan)}`)
}
console.log(`全库合计 ≈ ${fmt(total)}`)

console.log('\n== 按课件 ==')
const byDoc = db.prepare(`SELECT document_version_id AS dvid, COUNT(*) AS calls, SUM(prompt_tokens) AS p, SUM(cached_tokens) AS c, SUM(completion_tokens) AS o
  FROM ai_usage WHERE document_version_id IS NOT NULL GROUP BY document_version_id ORDER BY (SUM(prompt_tokens)+SUM(completion_tokens)) DESC LIMIT 8`).all()
for (const row of byDoc) {
  const name = db.prepare(`SELECT d.display_name AS display_name,
      (SELECT COUNT(*) FROM pages WHERE document_version_id = ?) AS pages
    FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ?`).get(row.dvid, row.dvid)
  const yuan = cost(row.p, row.c, row.o)
  console.log(`${name?.display_name ?? row.dvid}  页数 ${name?.pages ?? '?'}  调用 ${row.calls}  输入 ${row.p} (命中 ${row.c})  输出 ${row.o}  ≈ ${fmt(yuan)}`)
}

console.log('\n== 备课阶段（plan/digest/vision）单份平均 ==')
const prep = db.prepare(`SELECT kind, COUNT(*) AS calls, SUM(prompt_tokens) AS p, SUM(cached_tokens) AS c, SUM(completion_tokens) AS o
  FROM ai_usage WHERE kind IN ('plan','digest','vision','material') GROUP BY kind`).all()
for (const row of prep) {
  console.log(`${row.kind}  调用 ${row.calls}  输入 ${row.p}  输出 ${row.o}  ≈ ${fmt(cost(row.p, row.c, row.o))}`)
}
db.close()
