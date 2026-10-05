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

test('四档计数自洽：§G 实数 == 头部那句 == 表尾那句，且和数凑满 317', () => {
  const rows = verdictRows()
  const count = letter => rows.filter(row => row.verdict === letter).length
  const x = count('[x]'), partial = count('[~]'), todo = count('[ ]'), na = count('[-]')
  assert.equal(x + partial + todo + na, 317, `四档相加 ${x + partial + todo + na} != 317`)
  // 原来这里把四档写死成 13/41/0/263（那是 2026-10-04 的一版计划），文档没跟着动 ⇒ 门禁与文档
  // 一起失真，而头部那句「12 + 36 + 6 + 263 = 317」四档分布全错却照样凑满总数（audit-docs 复核
  // 报的就是这一类）。现在实数由 §G 反推，再要求头部与表尾两处散文**逐档**等于实数：
  // 「分布谎报、总数自洽」从此拦得住（反向验证：把头部任一数字 ±1 → 本用例红）。
  const head = verdict.match(/§A 讲已移植的 (\d+) 条，§B 讲部分移植 (\d+) 条，§C 讲未移植 (\d+) 条，§D 讲不适用 (\d+) 条[^\n]*?四档合计 (\d+) \+ (\d+) \+ (\d+) \+ (\d+) = (\d+)/)
  assert.ok(head, '头部缺「§A 讲已移植的 a 条…四档合计 a + b + c + d = 317」那句')
  assert.deepEqual([+head[1], +head[2], +head[3], +head[4]], [x, partial, todo, na],
    `头部 §A–§D 的条数与 §G 实数不符：头部 ${head[1]}/${head[2]}/${head[3]}/${head[4]}，实为 ${x}/${partial}/${todo}/${na}`)
  assert.deepEqual([+head[5], +head[6], +head[7], +head[8]], [x, partial, todo, na],
    `头部「四档合计」那串与 §G 实数不符：${head[5]}+${head[6]}+${head[7]}+${head[8]} vs ${x}+${partial}+${todo}+${na}`)
  assert.equal(+head[9], 317, `头部总数写的是 ${head[9]}，本域是 317 类`)
  const tail = verdict.match(/四档合计\*\*：`\[x\]` (\d+) \+ `\[~\]` (\d+) \+ `\[ \]` (\d+) \+ `\[-\]` (\d+) = \*\*(\d+)\*\*/)
  assert.ok(tail, '表尾缺「四档合计：`[x]` a + …」那句')
  assert.deepEqual([+tail[1], +tail[2], +tail[3], +tail[4]], [x, partial, todo, na],
    `表尾的和数没跟着逐类表改：表尾 ${tail[1]}+${tail[2]}+${tail[3]}+${tail[4]}，实为 ${x}+${partial}+${todo}+${na}`)
  assert.equal(+tail[5], 317, '表尾总数不是 317')
  // 2026-10-04 那条「AnActionListener 从 [~] 改判 [x]」的意图改成按类锚定（ aggregate 数字拦不住它）：
  // before/after 的全量广播确实已在 `src/actionEvents.ts:30-51` 落地（接口 + 注册/注销 + 两圈 fire）。
  const listener = rows.find(row => row.name === 'AnActionListener')
  assert.ok(listener, '§G 缺 AnActionListener 行')
  assert.equal(listener.verdict, '[x]', 'AnActionListener 的 before/after 广播管道已落地，必须是 [x]')
  assert.match(listener.why, /`src\/actionEvents\.ts/, 'AnActionListener 的 [x] 依据必须指到 src/actionEvents.ts')
  assert.ok(existsSync(join(root, 'src/actionEvents.ts')), 'src/actionEvents.ts 不在磁盘上')
  // 每个 [ ] 都要写清缺哪一环：原来断的是 `count('[ ]') === 0`（过期口径 —— 本域现有 2 条真未移植，
  // 死数 0 只会拦住诚实判词）。改成逐行验内容，拦截面比「必须为 0」更大。
  const thin = rows.filter(row => row.verdict === '[ ]' && !/缺|没有|要做得先有|暂不做|无 /.test(row.why)).map(row => row.name)
  assert.deepEqual(thin, [], `这些 [ ] 行没写清缺哪一环：${thin.join('、')}`)
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
  // 2026-10-05 模块化体检：这段 general 补丁白名单随「浏览器预览内存桩」搬到了
  // src/bridgePreview.ts（bridge.ts 贴着机检上限）。查的键一个字没变，只换了锚点。
  assert.match(read('src/bridgePreview.ts'), /key === 'fuzzyFileSearch'/,
    'bridge 的 general 补丁白名单漏了这个键')
})
