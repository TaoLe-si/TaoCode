// B6 判决（`docs/inventory/verdict-actions.md`）自身的门控。与 B1..B5 同一套要求：
//   (1) 覆盖面从**扫描件重新推导**（不信判决表自己写的行数）；
//   (2) `[x]`/`[~]` 行的依据必须指到磁盘上真实存在的文件；
//   (3) 12 个 `testSources` 类必须判 `[-]`；
//   (4) 四档计数自洽（且与表尾那句一致）；
//   (5) §A-2 那四个上游常量不许被改（默认必须关）。
// 覆盖面从 `actions_signals.json` 推（它由 `scripts/verdict_signals.py` 生成，
// 里面每个类都带 name+path+行数+swing/platform/test 标记），并与 `actions.txt` 的路径清单交叉核对。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(join(root, rel), 'utf8')
// 文档是 CRLF，Node 不会替我们去掉 \r，行尾的 ` |` 会匹配不上。
const lines = rel => read(rel).split('\n').map(l => l.replace(/\r$/, ''))

const verdict = read('docs/inventory/verdict-actions.md')
const signals = JSON.parse(read('docs/inventory/actions_signals.json'))
const list = lines('docs/inventory/actions.txt').filter(Boolean)

// §G 表的行：| `类` | `路径` | `判决` | 依据 |
function verdictRows() {
  const section = verdict.split('## G. 逐条总表')[1]
  assert.ok(section, '缺 §G 逐条总表')
  const rows = []
  for (const line of section.split('\n').map(l => l.replace(/\r$/, ''))) {
    // 类名允许连字符（上游有 package-info）。
    const m = /^\| `([A-Za-z0-9_-]+)` \| `([^`]+)` \| `(\[[x~\- ]\])` \| (.+) \|$/.exec(line)
    if (m) rows.push({ name: m[1], path: m[2], verdict: m[3], why: m[4] })
  }
  return rows
}

test('覆盖率：扫描件推导出的每一类在 §G 里恰有一行', () => {
  const scoped = signals.rows.map(r => ({ name: r.name, path: r.path }))
  const rows = verdictRows()
  assert.equal(rows.length, scoped.length, `§G 行数 ${rows.length} != 域内类数 ${scoped.length}`)
  const byKey = new Map(rows.map(row => [row.name + ' ' + row.path, row]))
  const missing = []
  for (const entry of scoped) {
    if (!byKey.has(entry.name + ' ' + entry.path)) missing.push(entry.name + '(' + entry.path + ')')
  }
  assert.deepEqual(missing, [], `§G 漏了/写错路径：${missing.join('、')}`)
  assert.deepEqual(list.slice().sort(), scoped.map(e => e.path).sort(),
    'docs/inventory/actions.txt 与扫描件推导出来的清单不一致')
})

test('§G 里没有多余的类（域内 317 类，不多不少）', () => {
  assert.equal(verdictRows().length, 317, '本域 317 类')
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
  assert.ok(referenced.length >= 40, `只检查到 ${referenced.length} 条引用，覆盖太薄`)
  const missing = [...new Set(referenced)].filter(path => !existsSync(join(root, path)))
  assert.deepEqual(missing, [], `判决引用了不存在的文件：${missing.join('、')}`)
})

test('12 个 testSources 类必须判 [-]', () => {
  const tests = signals.rows.filter(r => r.test)
  assert.equal(tests.length, 12, '扫描件里应有 12 个测试类')
  const byKey = new Map(verdictRows().map(r => [r.name + ' ' + r.path, r]))
  for (const t of tests) {
    const row = byKey.get(t.name + ' ' + t.path)
    assert.ok(row, `${t.name} 不在 §G`)
    assert.equal(row.verdict, '[-]', `${t.name} 是上游测试类，应判 [-]`)
  }
})

test('四档计数自洽，且与表尾那句一致', () => {
  const rows = verdictRows()
  const count = letter => rows.filter(row => row.verdict === letter).length
  // 第八十九批把四类从 `[ ]` 改判到 `[~]`/`[-]`（随处搜索的空态文案、作用域选择、预览开关，
  // 以及一个复核发现上游根本没有实现的重排服务），数字随判决一起更新。
  assert.equal(count('[x]'), 12)
  assert.equal(count('[~]'), 40)
  assert.equal(count('[ ]'), 2)
  assert.equal(count('[-]'), 263)
  assert.equal(count('[x]') + count('[~]') + count('[ ]') + count('[-]'), 317)
  assert.match(verdict, /四档合计\*\*：`\[x\]` 12 \+ `\[~\]` 40 \+ `\[ \]` 2 \+ `\[-\]` 263 = \*\*317\*\*/,
    '表尾的和数要与逐条表一致')
})

test('Smith-Waterman 的四个上游常量不许漂移', () => {
  const fuzzy = read('src/fuzzyMatch.ts')
  assert.match(fuzzy, /MAX_FUZZY_WEIGHT = 9999/, 'MAX_FUZZY_WEIGHT 必须是 9999（SeFuzzyFileSearchItem.kt:38）')
  assert.match(fuzzy, /FUZZY_FILES_MIN_SCORE = 6500/, 'min score 必须是 6500（SeFuzzyFileSearchProvider.kt:141）')
  const se = read('src/searchEverywhere.ts')
  assert.match(se, /START_MATCH_WEIGHT = 10000/, 'START_MATCH_WEIGHT 必须是 10000')
  assert.match(se, /FUZZY_FILES_ENABLED_DEFAULT = false/,
    '默认必须关：上游 search.everywhere.fuzzy.files.enabled 默认 false（SeFuzzyFileSearchProviderFactory.kt:28-31）')
})

test('native 两侧都登记了 fuzzyFileSearch（跨语言边界的新设置必须两侧都有）', () => {
  assert.match(read('native/settings_schema.hpp'), /"fuzzyFileSearch"/,
    'GENERAL_SETTING_KEYS 缺 fuzzyFileSearch，apply 会被判 INVALID_SETTINGS')
  assert.match(read('native/settings_schema.cpp'), /\{"fuzzyFileSearch", false\}/,
    'general_defaults_impl 缺 fuzzyFileSearch 的默认值')
  assert.match(read('src/bridge.ts'), /key === 'fuzzyFileSearch'/,
    'bridge 的 general 补丁白名单漏了这个键')
})
