// B4 判决（`docs/inventory/verdict-folding.md`）自身的门控。与 B1/B2/B3 同一套要求：
//   ① 覆盖面从**扫描件重新推导**（不信判决表自己写的行数）；
//   ② `[x]`/`[~]` 行的依据必须指到磁盘上真实存在的文件；
//   ③ §D 的四类理由必须真的写在文件里；
//   ④ 四档计数自洽（且与表尾那句一致）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const verdict = readFileSync(join(root, 'docs/inventory/verdict-folding.md'), 'utf8')
const scan = readFileSync(join(root, 'docs/inventory/editor_scan.md'), 'utf8')
const list = readFileSync(join(root, 'docs/inventory/folding.txt'), 'utf8').split('\n').filter(Boolean)

/** 扫描件里属于本域的行（判据自己重推一遍，不拿判决表当基准）。 */
function scopedClasses() {
  const out = []
  for (const line of scan.split('\n')) {
    const m = /^\| `([A-Za-z0-9_]+)` \| `([^`]+)` \|/.exec(line)
    if (!m) continue
    const [, name, path] = m
    if (!path.includes('/codeInsight/folding/')) continue
    // 测试源码集不算（本地清单同样排除了它们：`testSources` / `testFramework` / `tests`）。
    if (path.includes('/testSources/') || path.includes('/testFramework/') || path.includes('/tests/')) continue
    out.push({ name, path })
  }
  return out
}

/** §G 表的行：| \`类\` | \`路径\` | \`判决\` | 依据 | */
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
  // 清单文件与推导结果一致（判据的基准是同一份，防止判决表偷偷改清单）
  assert.deepEqual(list.slice().sort(), scoped.map(entry => entry.path).sort(),
    'docs/inventory/folding.txt 与扫描件推导出来的清单不一致')
})

test('§G 里没有多余的类（域内 69 类，不多不少）', () => {
  assert.equal(verdictRows().length, 69, '本域 69 类')
})

test('[x]/[~] 行的依据必须指到真实存在的文件', () => {
  const referenced = []
  for (const row of verdictRows()) {
    if (row.verdict !== '[x]' && row.verdict !== '[~]') continue
    // 引用来路可以是 `src/x.ts` 或 `src/x.ts:34`（后者更精确）—— 判存在时去掉行号后缀。
    const paths = [...row.why.matchAll(/`((?:src|native)\/[^`]+)`/g)]
      .map(m => m[1].replace(/:\d+(-\d+)?$/, ''))
    assert.ok(paths.length > 0, `${row.name} 判了 ${row.verdict} 却没指到任何实现文件`)
    referenced.push(...paths)
  }
  assert.ok(referenced.length >= 8, `只检查到 ${referenced.length} 条引用，覆盖太薄`)
  const missing = [...new Set(referenced)].filter(path => !existsSync(join(root, path)))
  assert.deepEqual(missing, [], `判决引用了不存在的文件：${missing.join('、')}`)
})

test('§D 的四类理由必须真的写在文件里', () => {
  const section = verdict.split('## D. 不适用')[1].split('## E.')[0]
  assert.match(section, /语言侧 builder/, '缺「语言侧 builder」的理由')
  assert.match(section, /语义签名/, '缺「语义签名族」的理由')
  assert.match(section, /注入片段/, '缺「注入片段」的理由')
  assert.match(section, /打开期提示的宿主/, '缺「Swing/打开期提示宿主」的理由')
})

test('四档计数自洽，且与表尾那句一致', () => {
  const rows = verdictRows()
  const count = letter => rows.filter(row => row.verdict === letter).length
  // 2026-10-04 两轮改判后：`CollapseExpandDocCommentsHandler` 与 `CodeFoldingPass`/`FoldingUpdate`
  // 三条 `[~]` → `[x]`，四档从 1/39/0/29 变成 3/37/0/29（表尾那句同步改过）。
  // 2026-10-06 第三轮（fold3 lane）：选区作用域（`BaseFoldingHandler`/`CollapseAllRegionsAction`/
  // `ExpandAllRegionsAction`）、`ApplyDefaultStateMode` 三档（`UpdateFoldRegionsOperation`）、
  // 按偏移查询的公开面（`CodeFoldingManager`/`CodeFoldingManagerImpl`）、逐条轻签名替身
  // （`DocumentFoldingInfo`）共 7 条 `[~]` → `[x]`，四档从 3/37/0/29 变成 10/30/0/29。
  assert.equal(count('[x]'), 10)
  assert.equal(count('[~]'), 30)
  assert.equal(count('[ ]'), 0)
  assert.equal(count('[-]'), 29)
  assert.equal(count('[x]') + count('[~]') + count('[ ]') + count('[-]'), 69)
  assert.match(verdict, /四档合计\*\*：`\[x\]` 10 \+ `\[~\]` 30 \+ `\[ \]` 0 \+ `\[-\]` 29 = 69/,
    '表尾的和数要与逐条表一致')
})

test('§C 记下了下一批该做的条目（按用户可见度）', () => {
  const section = verdict.split('## C. 下一批该做的条目')[1].split('## D.')[0]
  for (const item of ['动作族', 'CodeFoldingSettings', '持久化', '全部收起']) {
    assert.ok(section.includes(item), `§C 缺下一批该做的条目：${item}`)
  }
})
