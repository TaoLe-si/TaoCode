// 桶 7b（2026-10-06）：把 `docs/inventory/verdict-find-diff.md` 的 §G 逐类总表**恢复成已清扫的那一版**。
//
// 背景：第一百一十七批的清扫产物是 `build/b7rows.json`（630 行逐类判决，脚本 build/b7-sweep/sweep.mjs
// 生成时逐条验过：`[~]`/`[x]` 理由里的 `src/` `native/` 路径 existsSync、`[-]` 理由带上游 `文件:行号`），
// 判词写进 DOC 后又被 2026-10-05 的一次「按快照重写」打回了清扫前的 455 条 `[ ]` 状态。
// 这条命令做的是**把判决按已复核的产物重新落回判词文件**，不是新判决：
//   · 逐行只换「判决 + 理由」两格，行序与类集一个字不动（跑之前先断言 630 行逐行对齐）；
//   · 再补两条有据可查的改判（`FindInPathAction`、`CombinedDiffSearch`），依据是磁盘上真实的落点；
//   · 页脚那句合计按实际行数重写，与 `tests/b7-verdict.test.mjs` 的两条计数断言同源。
// 默认只打印将要发生什么；`--write` 才落盘。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOC = join(root, 'docs/inventory/verdict-find-diff.md')
const ROWS = join(root, 'build/b7rows.json')

// 两条 2026-10-04 的改判：第一百一十七批之后各自整条落地，判词随代码一起改（依据 = 磁盘上的真实落点）。
const AFTER_SWEEP = [
  {
    name: 'FindInPathAction',
    verdict: '[x]',
    why: 'Find in Path 入口 + 最近搜索两条缺口都已落地：Edit 菜单「在文件中查找」`Ctrl+Shift+F` 开工程内查找工具窗'
      + '（`src/menus/editMenu.ts:96`，本仓工程内查找面板 = `src/components/SearchPanel.vue`），'
      + '最近搜索按上游 `FindInProjectSettingsBase` 的两张 300 上限表落在 `src/findInProjectRecents.ts`，'
      + '面板在 `src/components/SearchPanel.vue:122` 记录、`:601-602` 打开时用最近一条预填。',
  },
  {
    name: 'CombinedDiffSearch',
    verdict: '[x]',
    why: '差异视图内部查找整条落地：规则在 `src/diffSearch.ts`（命中收集 / 只在改动侧搜索 = 上游 '
      + '`SearchInDiffChangesProvider` 的 `ENABLE_SEARCH_IN_CHANGES` / 命中片段高亮 / 折叠区自动展开），'
      + '接线在 `src/components/DiffView.vue:171` 的 `searchMatches` 与 `:230-247` 的查找条，'
      + '判据 `tests/diff-search.test.mjs`。',
  },
]

const rows = JSON.parse(readFileSync(ROWS, 'utf8'))
const raw = readFileSync(DOC, 'utf8')
const lines = raw.split('\n')
const start = lines.findIndex(l => l.startsWith('## G. 逐条总表'))
if (start < 0) throw new Error('缺 §G 逐条总表')

// 与 b7-verdict.test.mjs 同一把正则，逐行对齐后才允许落笔。
const RE = /^\| `([A-Za-z0-9_-]+)` \| `([^`]+)` \| `(\[[x~\- ]\])` \| (.+) \|$/
let i = 0
const tally = { '[x]': 0, '[~]': 0, '[ ]': 0, '[-]': 0 }
const changed = []
for (let n = start; n < lines.length; n++) {
  const m = RE.exec(lines[n].replace(/\r$/, ''))
  if (!m) continue
  const cr = lines[n].endsWith('\r') ? '\r' : ''
  const body = lines[n].slice(0, lines[n].length - cr.length)
  const src = rows[i++]
  if (src[0] !== m[1] || src[1] !== m[2]) throw new Error(`第 ${i} 行类集漂移：${m[1]} vs ${src[0]}`)
  let verdict = src[2], why = src[3]
  const after = AFTER_SWEEP.find(a => a.name === src[0])
  if (after) { verdict = after.verdict; why = after.why }
  tally[verdict]++
  // 清扫产物里每条 [-] 必须带上游 文件:行号，每条 [x]/[~] 必须指着本仓真实文件 —— 落盘前自己再验一遍。
  if (verdict === '[-]' && !/`[^`]+\.(java|kt):\d+`/.test(why)) throw new Error(`${src[0]} 的 [-] 没有上游 file:line`)
  if (verdict === '[x]' || verdict === '[~]') {
    const paths = [...why.matchAll(/`((?:src|native)\/[A-Za-z0-9_./-]+?)(?::[\d,-]+)?`/g)].map(x => x[1])
    if (paths.length === 0) throw new Error(`${src[0]} 的 ${verdict} 没指到任何本仓文件`)
    for (const p of paths) if (!existsSync(join(root, p))) throw new Error(`${src[0]} → ${p} 不存在`)
  }
  const next = `| \`${src[0]}\` | \`${src[1]}\` | \`${verdict}\` | ${why} |`
  if (next !== body) changed.push(`${m[1]}: ${m[3]} -> ${verdict}`)
  lines[n] = next + cr
}
if (i !== rows.length) throw new Error(`§G 只匹配到 ${i} 行，产物有 ${rows.length} 行`)

const total = tally['[x]'] + tally['[~]'] + tally['[ ]'] + tally['[-]']
const footer = `合计 630 类：\`[x]\` ${tally['[x]']}、\`[~]\` ${tally['[~]']}、\`[ ]\` ${tally['[ ]']}、\`[-]\` ${tally['[-]']}。`
const before = raw.match(/合计 630 类：[^\n]*/)[0]
lines[lines.findIndex(l => l.startsWith('合计 630 类：'))] = footer

console.log(`改了 ${changed.length} 行；四档 ${JSON.stringify(tally)}（合计 ${total}）`)
console.log(`页脚 before: ${before}`)
console.log(`页脚 after : ${footer}`)
if (total !== 630) throw new Error(`四档加起来 ${total}，不是 630`)
if (process.argv.includes('--write')) {
  writeFileSync(DOC, lines.join('\n'))
  console.log('已写回', DOC)
} else {
  console.log('（未落盘；--write 才写）')
}
