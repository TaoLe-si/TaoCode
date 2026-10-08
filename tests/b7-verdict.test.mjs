// B7 判决书（`docs/inventory/verdict-find-diff.md`）的自门控。
//
// 这条门控的立场：判决书不能是"写完就算"。它得能从扫描产物里重新推出覆盖面，
// 还得保证每一条 `[x]` / `[~]` 都指着一个**磁盘上真实存在**的本仓文件 ——
// 否则"已对标"就只是一句没有落点的话。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(join(root, rel), 'utf8')
// 文档是 CRLF，Node 不会替我们去掉 \r，行尾的 ` |` 会匹配不上。
const lines = rel => read(rel).split('\n').map(l => l.replace(/\r$/, ''))

const verdict = read('docs/inventory/verdict-find-diff.md')
const signals = JSON.parse(read('docs/inventory/find-diff_signals.json'))
const slice = read('docs/inventory/find-diff.txt')

/** §G 逐条总表 → 行对象数组。 */
function verdictRows() {
  const at = verdict.indexOf('## G. 逐条总表')
  assert.ok(at > 0, '缺 §G 逐条总表')
  const section = verdict.slice(at)
  const rows = []
  for (const line of section.split('\n').map(l => l.replace(/\r$/, ''))) {
    // 类名允许连字符（上游有 package-info），路径里有 / 和点。
    const m = /^\| `([A-Za-z0-9_-]+)` \| `([^`]+)` \| `(\[[x~\- ]\])` \| (.+) \|$/.exec(line)
    if (m) rows.push({ name: m[1], path: m[2], verdict: m[3], why: m[4] })
  }
  return rows
}

const rows = verdictRows()

test('§G 逐条覆盖切片里的每一个类，且不引入切片外的类', () => {
  const fromSlice = new Set(
    slice.split('\n').map(l => l.trim()).filter(Boolean).map(p => p.split('/').pop().replace(/\.[^.]+$/, ''))
  )
  const fromSignals = new Set(signals.rows.map(r => r.name))
  // 两条来源必须一致，否则说明 signals 与 slice 已经漂了。
  assert.deepEqual([...fromSlice].sort(), [...fromSignals].sort(), 'find-diff.txt 与 find-diff_signals.json 类集不一致')

  const judged = new Set(rows.map(r => r.name))
  const missing = [...fromSignals].filter(n => !judged.has(n))
  const extra = [...judged].filter(n => !fromSignals.has(n))
  assert.deepEqual(missing, [], '§G 漏判：%r', missing)
  assert.deepEqual(extra, [], '§G 判了切片里没有的类：%r', extra)
})

test('§G 恰好 630 行', () => {
  assert.equal(rows.length, 630)
})

test('每条 [x]/[~] 都指着一个真实存在的本仓文件', () => {
  let refs = 0
  const bad = []
  for (const row of rows) {
    if (row.verdict !== '[x]' && row.verdict !== '[~]') continue
    // 反引号包里形如 src/xxx.ts:12 或 native/yyy.cpp 的路径段。
    const paths = [...row.why.matchAll(/`((?:src|native)\/[A-Za-z0-9_./-]+?)(?::[\d,-]+)?`/g)].map(m => m[1])
    if (paths.length === 0) bad.push(`${row.name} 没指到任何本仓文件`)
    for (const p of paths) {
      if (!existsSync(join(root, p))) bad.push(`${row.name} → ${p} 不存在`)
      else refs++
    }
  }
  assert.deepEqual(bad, [], '引用没落地：%r', bad)
  assert.ok(refs >= 20, `本仓文件引用只有 ${refs} 处，太少，判决书多半在空转`)
})

test('上游测试源码一律 [-]', () => {
  const tests = signals.rows.filter(r => r.test)
  assert.equal(tests.length, 13)
  for (const t of tests) {
    const row = rows.find(r => r.path === t.path)
    assert.ok(row, `${t.name} 没判`)
    assert.equal(row.verdict, '[-]', `${t.name} 是上游测试源码，不该判 ${row.verdict}`)
  }
})

test('四档算术与页脚一致', () => {
  const count = v => rows.filter(r => r.verdict === v).length
  const x = count('[x]'), part = count('[~]'), no = count('[ ]'), skip = count('[-]')
  assert.equal(x + part + no + skip, 630, '四档加起来不是 630')
  const footer = /合计 630 类：`\[x\]` (\d+)、`\[~\]` (\d+)、`\[ \]` (\d+)、`\[-\]` (\d+)。/
    .exec(verdict.replace(/\r\n/g, '\n'))
  assert.ok(footer, '缺页脚合计句')
  assert.deepEqual(
    [Number(footer[1]), Number(footer[2]), Number(footer[3]), Number(footer[4])],
    [x, part, no, skip],
    '页脚与实际行数对不上'
  )
})

// 455 条 `[ ]` 已在第一百一十七批逐族清扫完毕（`[ ]` 归零）；本轮又把 9 条 `[~]` 判成 `[x]`（§A9–A14），
// 2026-10-04 再改判 `FindInPathAction`：入口（Edit 菜单 Ctrl+Shift+F → 搜索工具窗）与最近搜索
// （`src/findInProjectRecents.ts`）两条缺口都已落地，`[~]` → `[x]`（30 + 353）。
// 2026-10-04 VCS lane 再改判 `CombinedDiffSearch`：差异视图内部查找整条落地
// （`src/diffSearch.ts` + `src/components/DiffView.vue`，判据 `tests/diff-search.test.mjs`），
// `[~]` → `[x]`（31 + 352）。
// 2026-10-06 fold3 lane 再改判 `ApplyNonConflictsAction`：「应用所有不冲突的更改」整条链落地
// （`src/mergeResolve.ts:408` 的 onlyNonConflicts 档 + `src/mergeResolveHost.ts:43` +
// `src/changesMenuActions.ts:67` 入口 + `src/components/SourceControl.vue:227`，判据 `tests/merge-resolve.test.mjs`；
// 上游 `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt:31`/`:35` 逐行核过），
// `[~]` → `[x]`（32 + 351）。
// 2026-10-06 b1b7verdict lane 再改判 `HighlightPolicy`（行内高亮五档全落 + 三条正交派生语义，
// 判据 `tests/diff-policy-combo.test.mjs`），`[~]` → `[x]`（33 + 350）。
// 同批再复判查找栏九个叶子动作（Add/Remove/Next/PrevOccurrenceAction、SwitchToFind/SwitchToReplace、
// ToggleMatchCase/ToggleWholeWordsOnlyAction/ToggleFindInSelectionAction）：上游都只是 session 转发，
// 本仓命令/键位/菜单/行为四层同果、原判词无缺口记录，`[~]` → `[x]`（42 + 341）。
// 这组数是此刻的账。以后改判必然要动这里 —— 这正是这条断言存在的意义：改判是动作，不是漂移。
test('本轮清扫后的四档计数已冻结', () => {
  const count = v => rows.filter(r => r.verdict === v).length
  assert.deepEqual(
    [count('[x]'), count('[~]'), count('[ ]'), count('[-]')],
    [42, 341, 0, 247],
    '四档与清扫结果不一致：改了判决就把这组数与页脚一起改'
  )
})

// `[-]` 不能是一句「平台专属」了事：理由里必须有上游 文件:行号 与那一行的符号。
test('每条 [-] 都带上游 文件:行号 依据', () => {
  const bad = rows.filter(r => r.verdict === '[-]' && !/`[^`]+\.(java|kt):\d+`/.test(r.why))
  assert.deepEqual(bad.map(r => r.name), [], '这些 [-] 行没有上游 file:line 依据：%r', bad.map(r => r.name))
})

test('src/diffAlign.ts 引的上游行号没有漂', () => {
  const align = read('src/diffAlign.ts')
  const cited = [
    'Diff.kt:29-41', 'Diff.kt:118-127', 'Diff.kt:129-141', 'Diff.kt:64-75', 'Diff.kt:96-101',
    'Enumerator.kt:16-25', 'MyersLCS.kt:10-11', 'MyersLCS.kt:38-42', 'MyersLCS.kt:64-70',
    'MyersLCS.kt:96-190', 'MyersLCS.kt:175-186', 'MyersLCS.kt:186-188', 'DiffConfig.kt:10',
    'TextDiffSettingsHolder.kt:47', 'IgnorePolicy.java:29-35', 'TrimUtil.kt:53-55',
    'DiffBundle.properties:277',
  ]
  const missing = cited.filter(c => !align.includes(c))
  assert.deepEqual(missing, [], '这些上游引用在 src/diffAlign.ts 里找不到了：%r', missing)
})

test('§E 差异表没有缩水，且第 1 条必须说清 Patience', () => {
  const at = verdict.indexOf('## E.')
  const to = verdict.indexOf('## F.')
  assert.ok(at > 0 && to > at, '缺 §E 差异表')
  const section = verdict.slice(at, to)
  const entries = section.split('\n').filter(l => /^\| \d+ \|/.test(l.replace(/\r$/, '')))
  assert.ok(entries.length >= 5, `§E 只有 ${entries.length} 条`)
  assert.match(entries[0], /Patience/, '§E 第 1 条必须落在那个没做的退路上')
  assert.match(section, /TRIM_WHITESPACES|IGNORE_WHITESPACES/, '§E 必须记下非默认比较策略没做')
})

test('§0 的机械信号与扫描产物一致', () => {
  const ledger = verdict.slice(verdict.indexOf('## 0.'), verdict.indexOf('## A.'))
  for (const key of ['total', 'unreadable', 'test', 'swing', 'platform', 'in_code', 'in_comment_only', 'never']) {
    const m = new RegExp(`\\| ${key} \\| (\\d+) \\|`).exec(ledger)
    assert.ok(m, `§0 缺 ${key} 行`)
    assert.equal(Number(m[1]), signals.counts[key], `§0 的 ${key} 与扫描产物不一致`)
  }
  // 这条是给下一个人立的规矩：in_code 是子串匹配，会误报，别拿它当判决。
  assert.match(ledger, /子串匹配|误报/, '§0 必须点明 in_code 的误报风险')
})
