// B5 判决（`docs/inventory/verdict-bookmarks.md`）自身的门控。与 B1..B4 同一套要求：
//   ① 覆盖面从**扫描件重新推导**（不信判决表自己写的行数）；
//   ② `[x]`/`[~]` 行的依据必须指到磁盘上真实存在的文件；
//   ③ 四档计数自洽（且与表尾那句一致）。
// B5 这一域没有 `[-]`、也没有 `[ ]`（5 类全部 `[~]`），所以没有 §D 那一组检查。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const verdict = readFileSync(join(root, 'docs/inventory/verdict-bookmarks.md'), 'utf8')
const scan = readFileSync(join(root, 'docs/inventory/projectviews_scan.md'), 'utf8')
const list = readFileSync(join(root, 'docs/inventory/bookmarks.txt'), 'utf8').split('\n').filter(Boolean)

/** 扫描件里属于本域的行（判据自己重推一遍，不拿判决表当基准）。 */
function scopedClasses() {
  const out = []
  for (const line of scan.split('\n')) {
    const m = /^\| `([A-Za-z0-9_]+)` \| `([^`]+)` \|/.exec(line)
    if (!m) continue
    const [, name, path] = m
    if (!path.includes('com/intellij/ide/bookmarks/')) continue
    if (path.includes('/testSources/') || path.includes('/testFramework/') || path.includes('/tests/')) continue
    out.push({ name, path })
  }
  return out
}

/** §G 表的行：| `类` | `路径` | `判决` | 依据 | */
function verdictRows() {
  const section = verdict.split('## G. 逐条总表')[1]
  assert.ok(section, '缺 §G 逐条总表')
  const rows = []
  for (const line of section.split('\n')) {
    const m = /^\| `([A-Za-z0-9_]+)` \| `([^`]+)` \| `(\[[x~\- ]\])` \| (.+) \|$/.exec(line)
    if (m) rows.push({ name: m[1], path: m[2], verdict: m[3], why: m[4] })
  }
  return rows
}

test('覆盖率：扫描件推导出的每一类在 §G 里恰有一行', () => {
  const scoped = scopedClasses()
  const rows = verdictRows()
  assert.equal(rows.length, scoped.length, `§G 行数 ${rows.length} ≠ 域内类数 ${scoped.length}`)
  const byKey = new Map(rows.map(row => [`${row.name}\u0000${row.path}`, row]))
  const missing = []
  for (const entry of scoped) {
    if (!byKey.has(`${entry.name}\u0000${entry.path}`)) missing.push(`${entry.name}(${entry.path})`)
  }
  assert.deepEqual(missing, [], `§G 漏了/写错路径：${missing.join('、')}`)
  assert.deepEqual(list.slice().sort(), scoped.map(entry => entry.path).sort(),
    'docs/inventory/bookmarks.txt 与扫描件推导出来的清单不一致')
})

test('§G 里没有多余的类（域内 5 类，不多不少）', () => {
  assert.equal(verdictRows().length, 5, '本域 5 类')
})

test('[x]/[~] 行的依据必须指到真实存在的文件', () => {
  const referenced = []
  for (const row of verdictRows()) {
    if (row.verdict !== '[x]' && row.verdict !== '[~]') continue
    const paths = [...row.why.matchAll(/`((?:src|native)\/[^`]+)`/g)]
      .map(m => m[1].replace(/:\d+(-\d+)?$/, ''))
    assert.ok(paths.length > 0, `${row.name} 判了 ${row.verdict} 却没指到任何实现文件`)
    referenced.push(...paths)
  }
  assert.ok(referenced.length >= 4, `只检查到 ${referenced.length} 条引用，覆盖太薄`)
  const missing = [...new Set(referenced)].filter(path => !existsSync(join(root, path)))
  assert.deepEqual(missing, [], `判决引用了不存在的文件：${missing.join('、')}`)
})

test('四档计数自洽，且与表尾那句一致', () => {
  const rows = verdictRows()
  const count = letter => rows.filter(row => row.verdict === letter).length
  // 2026-10-04 本轮第二次：BookmarkItem 从 [~] 改判 [x]（speedSearchText / allowedToRemove /
  // removed 三条落地，判据 tests/bookmark-item.test.mjs）。
  // 2026-10-06（b1b7verdict lane 第二轮）：BookmarksListener [~] → [x] —— 上游 MessageBus Topic
  // 的前端等价物落地（src/bookmarkListener.ts 的 EP + 四条同名回调 + 订阅/注销 + 差异分派，
  // 生产消费点 src/bookmarkActions.ts:82 的 watch），判据 tests/bookmarks-listener.test.mjs。
  assert.equal(count('[x]'), 4)
  assert.equal(count('[~]'), 1)
  assert.equal(count('[ ]'), 0)
  assert.equal(count('[-]'), 0)
  assert.equal(count('[x]') + count('[~]') + count('[ ]') + count('[-]'), 5)
  assert.match(verdict, /四档合计\*\*：`\[x\]` 4 \+ `\[~\]` 1 \+ `\[ \]` 0 \+ `\[-\]` 0 = 5/,
    '表尾的和数要与逐条表一致')
})

test('§C 记下了下一批该做的条目（按用户可见度）', () => {
  const section = verdict.split('## C. 下一批该做的条目')[1].split('## G.')[0]
  for (const item of ['对账', '自动描述', '书签类型', '列表项的富渲染']) {
    assert.ok(section.includes(item), `§C 缺下一批该做的条目：${item}`)
  }
})
