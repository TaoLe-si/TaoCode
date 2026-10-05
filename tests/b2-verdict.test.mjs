// B2 判决（`toolwindow` + `openapi/wm` = 350 类）自身的门控。
//
// 这份判决要防的事只有一件：**拿"注释里提过"当"已移植"**。所以本文件不看散文，只看 §G 那张
// 逐条表：① 350 类一个不多一个不少；② `[x]`/`[~]` 行的依据必须指到磁盘上真实存在的 `src/` 文件；
// ③ 四档计数必须自己加得起来；④ 上游测试类一律 `[-]`。
//
// 扫描件 `docs/inventory/toolwindow_scan.md` 是枚举基准（`scripts/enumerate_inventory.py` 的产物），
// 判决覆盖它才算闭合。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const listing = read('docs/inventory/toolwindow.txt')
  .split('\n').map(line => line.trim()).filter(Boolean)
const verdict = read('docs/inventory/verdict-toolwindow-openapi.md')

/** §G 表：`| \`类名\` | \`源码路径\` | \`[x]\` | 依据 |`。 */
export function appendixRows(text) {
  const rows = []
  const pattern = /^\| `([^`]+)` \| `([^`]+)` \| `(\[[x~\- ]\])` \| (.*) \|$/gm
  let match
  while ((match = pattern.exec(text)) !== null) {
    rows.push({ name: match[1], path: match[2], verdict: match[3], why: match[4] })
  }
  return rows
}

const rows = appendixRows(verdict)

test('扫描件是 350 类，且 §G 逐条覆盖（名字与路径都对得上）', () => {
  assert.equal(listing.length, 350, `扫描件应有 350 行，实为 ${listing.length}`)
  assert.equal(rows.length, 350, `§G 应有 350 行，实为 ${rows.length}`)
  const expected = new Map()
  for (const entry of listing) {
    const name = entry.split('/').pop().replace(/\.(java|kt)$/, '')
    expected.set(`${name}\u0000${entry}`, false)
  }
  for (const row of rows) {
    const key = `${row.name}\u0000${row.path}`
    assert.ok(expected.has(key), `§G 多了一行/路径不对：${row.name} @ ${row.path}`)
    expected.set(key, true)
  }
  const missing = [...expected.entries()].filter(([, seen]) => !seen).map(([key]) => key.split('\u0000')[0])
  assert.deepEqual(missing, [], `§G 漏了这些类：${missing.join(', ')}`)
})

// 计数随批次变化（2026-10-04 本轮：`StatusBarEditorBasedWidgetFactory` / `WidgetRegistry` 两条
// 复核后改判 `[x]` —— 缺的是形态差异不是行为，判据 `tests/status-widgets-registry.test.mjs`；
// 此前为 17 + 99 + 0 + 234 = 350）。
// 这里盯的是**自洽**：每档数字与总数对得上，且判决表自己写的和数一致。
test('四档计数自己加得起来（19 + 97 + 0 + 234 = 350）', () => {
  const count = letter => rows.filter(row => row.verdict === letter).length
  assert.equal(count('[x]'), 19)
  assert.equal(count('[~]'), 97)
  assert.equal(count('[ ]'), 0)
  assert.equal(count('[-]'), 234)
  assert.equal(count('[x]') + count('[~]') + count('[ ]') + count('[-]'), 350)
  assert.match(verdict, /四档合计 \*\*19 \+ 97 \+ 0 \+ 234 = 350\*\*/, '文档头部的和数也要跟着改')
})

test('每个 [x]/[~] 行的依据必须指到真实存在的 src/ 或 native/ 文件（防"注释里提过就算移植"）', () => {
  const referenced = []
  for (const row of rows) {
    if (row.verdict !== '[x]' && row.verdict !== '[~]') continue
    // 实现点可以是前端模块，也可以是宿主侧（窗口标题就是 `native/main.cpp` 写的）。
    const paths = [...row.why.matchAll(/`((?:src|native)\/[^`]+)`/g)].map(match => match[1].replace(/:\d+(?:-\d+)?$/, ''))
    assert.ok(paths.length > 0, `${row.name} 判了 ${row.verdict} 却没指到任何实现文件`)
    referenced.push(...paths)
  }
  // 这条判据自身要有意义：被检查的引用不能只有一两条。
  assert.ok(referenced.length >= 60, `只检查到 ${referenced.length} 条引用，覆盖太薄`)
  const missing = referenced.filter(path => !existsSync(join(root, path)))
  assert.deepEqual(missing, [], `判决引用了不存在的文件：${[...new Set(missing)].join(', ')}`)
})

test('§D 的四条理由必须真的写在文件里', () => {
  const section = verdict.split('## D. 不适用')[1].split('## E.')[0]
  assert.match(section, /customFrameDecorations/, '缺「自绘无边框窗口一族」的理由')
  assert.match(section, /平台专属窗口效果/, '缺「平台专属窗口效果」的理由')
  assert.match(section, /Swing 专属构件/, '缺「Swing 专属构件」的理由')
  assert.match(section, /多窗口 \/ 浮动 \/ 无头/, '缺「多窗口/浮动/无头」的理由')
})

test('上游测试类（testSources）一律判 [-]', () => {
  const tests = listing.filter(entry => entry.includes('/testSources/'))
  assert.equal(tests.length, 9, `扫描件里的 testSources 类应为 9 个，实为 ${tests.length}`)
  for (const entry of tests) {
    const name = entry.split('/').pop().replace(/\.(java|kt)$/, '')
    const row = rows.find(candidate => candidate.name === name && candidate.path === entry)
    assert.ok(row, `${name} 在 §G 里没有行`)
    assert.equal(row.verdict, '[-]', `${name} 是上游测试类，必须判 [-]`)
  }
})

test('判决文件把「三条如实不做」和「最有价值的下一条」都写明了', () => {
  const section = verdict.split('## E. 本批如实不做的三条')[1].split('## F.')[0]
  assert.match(section, /customFrameDecorations/, '缺 customFrameDecorations 那条')
  assert.match(section, /FLOATING/, '缺浮动/独立窗口那条')
  assert.match(section, /tabInEditor/, '缺 tabInEditor 那条')
  // §C 里必须标出"最有价值的下一条"，且它得是同一个口径的结构性缺口（"加一个要改宿主"）。
  // 状态栏注册表（`StatusBarWidgetFactory`）第三十批落地、第三十六批补判；现标在工具窗口注册机制上。
  const c = verdict.split('## C. 未移植')[1].split('## D.')[0]
  assert.match(c, /StatusBarWidgetFactory/, '§C 缺 StatusBarWidgetFactory')
  assert.match(c, /最有价值的一条/, '最有价值的下一条没有标出来')
  assert.ok(/最有价值的一条[^|]{10,}/.test(c), '那一行要就地说明理由（不是只挂一个标签）')
})
