// 「严重度分桶」只能有一份 —— 请求 `docs/wiring-requests-2026-10-06-prob3.md` **R1** 的钉桩。
//
// 本仓唯一一处「哪些级别算错误/警告/信息」的定义在 `src/highlightLevels.ts` 的 `levelForSeverity`
// （`<= 1` 全归 ERROR），计数走 `src/problemsView.ts` 的 `problemCounts`。
// 状态栏那一格（`src/App.vue` 的 `status-problems`）此前一直**就地再数一遍**
// `allProblems.filter(p => p.severity === 1).length` —— 那是第二把尺；2026-10-06 R1 已改读 `problemCounts`。
// 上游不是这么做的：状态栏那一格的数字来自计数对象本身
// （`platform/lang-impl/src/com/intellij/codeInsight/daemon/impl/TrafficLightRenderer.kt:383`
// 用 `severity.getCountMessage(count)`，`count` 取自 `status.errorCounts`；
// 「哪一级折进哪一格」由级别对象自己说，`platform/analysis-api/src/com/intellij/lang/annotation/HighlightSeverity.java:176-179`）。
// `src/App.vue` 是保留文件 ⇒ R1 只能以请求的形式交出去。这条门禁做两件事：
//   ① 第二把尺**不许再多**（新增一处就地重数就红）；
//   ② 那条请求**不许悄悄过期**（R1 落地后不摘掉登记也红）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'

// 就地按数字重数一遍的形状：`.filter(x => x.severity === <数字>).length`。
const RECOUNT = /\.\s*filter\(\s*\w+\s*=>\s*\w*\.?severity\s*===\s*\d+\s*\)\s*\.length/g

// 已登记的第二把尺（R1 的现场）。命中数必须逐字对上，多一条少一条都红。
// 2026-10-06：R1 已落地（`src/App.vue` 的状态栏那一格改读 `problemCounts`）⇒ 登记表清空。
// 表**留着**：下面那条「未登记的字段就地重数就红」的循环全靠它区分「已知欠账」与「新写的第二把尺」。
const PINNED = []

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|vue)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(path)
  }
  return out
}

function recountHits() {
  const found = new Map()
  for (const file of sourceFiles('src')) {
    const matches = readFileSync(file, 'utf8').match(RECOUNT) ?? []
    if (matches.length) found.set(file, matches.length)
  }
  return found
}

test('就地重数严重度的地方必须与登记逐字对上（新增就红、修好不摘登记也红）', () => {
  const found = recountHits()
  for (const pin of PINNED) {
    const actual = found.get(pin.file) ?? 0
    assert.equal(actual, pin.hits,
      `${pin.file} 的就地重数从 ${pin.hits} 条变成 ${actual} 条（${pin.reason}）—— `
      + 'R1 落地了就把这个条目从 PINNED 删掉；多出来了就是又写了第二把尺')
    if (actual > 0) {
      assert.match(readFileSync(pin.file, 'utf8'), pin.sample,
        `${pin.file} 里那 ${pin.hits} 条的**形状变了**：登记写的是老现场，请把 R1 的请求与这条一起更新`)
    }
  }
  const pinnedFiles = new Set(PINNED.map(pin => pin.file))
  for (const [file, hits] of found) {
    assert.ok(pinnedFiles.has(file),
      `${file} 出现 ${hits} 处就地按 severity 数字重数 —— 「哪些级别算错误」只许有一份`
      + '（src/highlightLevels.ts 的 levelForSeverity，计数走 src/problemsView.ts 的 problemCounts）')
  }
})

test('problemCounts 仍然有生产消费方（不许退回只过自己测试）', async () => {
  const consumers = sourceFiles('src')
    .filter(file => !file.endsWith('problemsView.ts') && !file.endsWith('highlightLevels.ts'))
    .filter(file => readFileSync(file, 'utf8').includes('problemCounts('))
  assert.deepEqual(consumers, ['src/App.vue', 'src/components/ProblemsPanel.vue'],
    'problemCounts 的生产消费方清单变了（R1 落地后这里应当多出 src/App.vue）')
})

test('两把尺在现网取值（1..4）上一致，在域外不一致 —— 这就是只许留一份的理由', async () => {
  const { problemCounts } = await import('../src/problemsView.ts')
  const row = severity => ({ path: 'src/a.ts', line: 0, character: 0, severity, message: 'm' })
  const onTheDomain = [row(1), row(1), row(2), row(3), row(4)]
  const inline = rows => ({
    errors: rows.filter(p => p.severity === 1).length,
    warnings: rows.filter(p => p.severity === 2).length,
  })
  assert.deepEqual(problemCounts(onTheDomain), { errors: 2, warnings: 1, infos: 2 })
  assert.deepEqual(inline(onTheDomain), { errors: problemCounts(onTheDomain).errors, warnings: problemCounts(onTheDomain).warnings },
    'LSP 那四级（1..4）上两把尺必须同数，否则今天的界面就已经错了')
  // 域外：级别函数把 `<= 1` 全归 ERROR（上游 `HighlightSeverity.java:176-179` 的折法同源），
  // 就地 `=== 1` 会把这些行漏掉 —— 两条通道迟早漂就在这里，不是假想。
  const outside = [row(0), row(-1), row(2.5)]
  assert.deepEqual(problemCounts(outside), { errors: 2, warnings: 0, infos: 1 })
  assert.deepEqual(inline(outside), { errors: 0, warnings: 0 },
    '域外必须能测出两把尺的差别（这条红了就说明分桶规则已经并入就地 filter，登记可以摘了）')
})
