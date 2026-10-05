// B3 判决（`docs/inventory/verdict-vcs-commit.md`）自身的门控。与 B1/B2 同一套要求：
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
const verdict = readFileSync(join(root, 'docs/inventory/verdict-vcs-commit.md'), 'utf8')
const scan = readFileSync(join(root, 'docs/inventory/vcs_scan.md'), 'utf8')
const list = readFileSync(join(root, 'docs/inventory/vcs-commit.txt'), 'utf8').split('\n').filter(Boolean)

/** 扫描件里属于本域的行（判据自己重推一遍，不拿判决表当基准）。 */
function scopedClasses() {
  const out = []
  for (const line of scan.split('\n')) {
    const m = /^\| `([A-Za-z0-9_]+)` \| `([^`]+)` \|/.exec(line)
    if (!m) continue
    const [, name, path] = m
    if (!['/vcs/commit/', '/openapi/vcs/actions/commit/', '/openapi/vcs/ex/commit/'].some(s => path.includes(s))) continue
    assert.ok(!path.includes('vcs-log'), 'vcs-log 的详情面板不属于本域')
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
    'docs/inventory/vcs-commit.txt 与扫描件推导出来的清单不一致')
})

test('§G 里没有多余的类（域内 78 类，不多不少）', () => {
  assert.equal(verdictRows().length, 78, '本域 78 类')
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
  assert.ok(referenced.length >= 40, `只检查到 ${referenced.length} 条引用，覆盖太薄`)
  const missing = [...new Set(referenced)].filter(path => !existsSync(join(root, path)))
  assert.deepEqual(missing, [], `判决引用了不存在的文件：${missing.join('、')}`)
})

test('§D 的四类理由必须真的写在文件里', () => {
  const section = verdict.split('## D. 不适用')[1].split('## E.')[0]
  assert.match(section, /变更列表/, '缺「变更列表专属」的理由')
  assert.match(section, /插件扩展点/, '缺「插件扩展点 / 遥测上报」的理由')
  assert.match(section, /Swing/, '缺「Swing 自绘构件」的理由')
  assert.match(section, /空对象/, '缺「空对象」的理由')
})

test('四档计数自洽，且与表尾那句一致', () => {
  const rows = verdictRows()
  const count = letter => rows.filter(row => row.verdict === letter).length
  // 2026-10-04 本轮：CommitChecksProgressIndicatorTooltip 从 [~] 改判 [x]；VCS lane 再把
  // CommitOptions/CommitOptionsPanel/CommitChecks/PostCommitChecksHandler 四条改判 [x]
  // （选项存档层 + 慢检查推后开关 + 提交后检查，判据 tests/commit-options.test.mjs）。
  assert.equal(count('[x]'), 18)
  assert.equal(count('[~]'), 43)
  assert.equal(count('[ ]'), 0)
  assert.equal(count('[-]'), 17)
  assert.equal(count('[x]') + count('[~]') + count('[ ]') + count('[-]'), 78)
  assert.match(verdict, /四档合计\*\*：`\[x\]` 18 \+ `\[~\]` 43 \+ `\[ \]` 0 \+ `\[-\]` 17 = 78/,
    '表尾的和数要与逐条表一致')
})

test('§E 记下了"没有留白的 TODO"，并列出下一批该做的四条', () => {
  const section = verdict.split('## E. 未移植')[1].split('## F.')[0]
  assert.match(section, /0 类/, '§E 要写明本域没有 `[ ]`')
  for (const item of ['RunCommitChecksExecutor', 'CommitToAmend.Resolved', 'SaveCommittingDocumentsVetoer', 'CommitExecutor']) {
    assert.ok(section.includes(item), `§E 缺下一批该做的条目：${item}`)
  }
  // 这四条在 §G 里都有对应的行（判决与叙述不许脱节）
  const rows = verdictRows()
  for (const name of ['RunCommitChecksExecutor', 'SaveCommittingDocumentsVetoer']) {
    assert.ok(rows.some(row => row.name === name), `§G 缺 ${name}`)
  }
})
