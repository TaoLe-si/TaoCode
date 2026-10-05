// B10 判决（`vcs` 域 = 1783 类）自身的门控。
//
// 这份判决要防的三件事：
//   ① 拿"名字在注释里提过"当"已移植" —— 所以 `[x]`/`[~]` 行的依据必须指到**磁盘上真实存在**的本仓文件；
//   ② 拿"不适用"三个字糊弄过去 —— 所以 `[-]` 行必须给**具体**理由（够长、且引用了东西）；
//   ③ 表还没写完就被切断，留下一份自相矛盾的产物 —— 所以 §G 的行数、四档和数、文档头部声明的
//      「当前已判 N 行」三者必须时刻一致（写满 1783 时才追加"逐类闭合"这条硬判据）。
//
// 枚举基准：`docs/inventory/vcs.txt`（`scripts/enumerate_inventory.py` 的产物，1783 行）。
// 机检信号：`docs/inventory/vcs_signals.json`（`python scripts/verdict_signals.py vcs`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const TOTAL = 1783
const listing = read('docs/inventory/vcs.txt')
  .split('\n').map(line => line.trim()).filter(Boolean)
const verdict = read('docs/inventory/verdict-vcs.md')

/** §G 逐类表行：`| \`类名\` | \`上游路径\` | \`[x]\` | 依据 |`。 */
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

/** 机械计数行：`<!-- B10GATE judged=.. x=.. tilde=.. todo=.. na=.. -->`。 */
function declared() {
  const match = verdict.match(/<!--\s*B10GATE judged=(\d+) x=(\d+) tilde=(\d+) todo=(\d+) na=(\d+)\s*-->/)
  assert.ok(match, '§0 缺少 B10GATE 计数行（四档与已判行数要写在文档里，不能只靠口算）')
  return { judged: +match[1], x: +match[2], tilde: +match[3], todo: +match[4], na: +match[5] }
}

/** 测试源码集 / 生成码 / 夹具 —— 这些一律不许判成"已移植"。 */
const isTestish = path => {
  const name = path.split('/').pop().replace(/\.(java|kt)$/, '')
  return path.includes('/test/')
    || path.includes('/testSources/')
    || path.includes('/vcs-tests/')
    || path.includes('/gen/')
    || /Tests?$/.test(name)
    || name.endsWith('TestCase')
}

const bucket = letter => rows.filter(row => row.verdict === letter)

test('枚举基准本身是 1783 类', () => {
  assert.equal(listing.length, TOTAL, `vcs.txt 应有 ${TOTAL} 行，实为 ${listing.length}`)
})

test('§G 每行至多一条、路径必须真实存在于枚举里（防造假引用）', () => {
  const expected = new Map()
  for (const entry of listing) {
    const name = entry.split('/').pop().replace(/\.(java|kt)$/, '')
    expected.set(`${name}\u0000${entry}`, false)
  }
  const seen = new Map()
  for (const row of rows) {
    const key = `${row.name}\u0000${row.path}`
    assert.ok(expected.has(key), `§G 有一行的类名/路径对不上枚举：${row.name} @ ${row.path}`)
    seen.set(key, (seen.get(key) || 0) + 1)
    expected.set(key, true)
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key.split('\u0000')[0])
  assert.deepEqual(dup, [], `§G 里这些类出现了多行：${dup.join(', ')}`)
})

test('§G 行数 == 文档声明的「当前已判 N 行」（随时可被切断，产物必须自洽）', () => {
  const decl = declared()
  assert.equal(decl.judged, rows.length, `声明已判 ${decl.judged} 行，§G 实际 ${rows.length} 行`)
  assert.ok(rows.length <= TOTAL, `§G 行数 ${rows.length} 超过枚举总数 ${TOTAL}`)
})

test('四档计数自洽：声明的 A+B+C+D 必须等于已判行数，且与 §G 逐行数的一致', () => {
  const decl = declared()
  assert.equal(decl.x + decl.tilde + decl.todo + decl.na, decl.judged,
    `声明的四档 ${decl.x}+${decl.tilde}+${decl.todo}+${decl.na} 加不出 ${decl.judged}`)
  assert.equal(bucket('[x]').length, decl.x, '[x] 数与声明不符')
  assert.equal(bucket('[~]').length, decl.tilde, '[~] 数与声明不符')
  assert.equal(bucket('[ ]').length, decl.todo, '[ ] 数与声明不符')
  assert.equal(bucket('[-]').length, decl.na, '[-] 数与声明不符')
  assert.equal(bucket('[x]').length + bucket('[~]').length + bucket('[ ]').length + bucket('[-]').length,
    rows.length, '四档相加必须等于 §G 行数')
  // 头部那句人读的计数也要跟着改（防"改了表没改结论"）。
  const head = new RegExp(`四档合计 \\*\\*${decl.x} \\+ ${decl.tilde} \\+ ${decl.todo} \\+ ${decl.na} = ${decl.judged}\\*\\*`)
  assert.ok(head.test(verdict), `头部「四档合计 **${decl.x} + ${decl.tilde} + ${decl.todo} + ${decl.na} = ${decl.judged}**」这句要与计数行同步`)
})

test('写满 1783 行时必须逐类闭合（一个不多一个不少）', () => {
  if (rows.length < TOTAL) return // 半途状态由上一条判据保证自洽
  const covered = new Set(rows.map(row => row.path))
  const missing = listing.filter(entry => !covered.has(entry))
  assert.deepEqual(missing, [], `§G 漏了 ${missing.length} 个类，例如 ${missing.slice(0, 5).join(', ')}`)
})

test('每个 [x]/[~] 行的依据必须指到磁盘上真实存在的本仓文件（防"注释里提过就算移植"）', () => {
  const scored = bucket('[x]').concat(bucket('[~]'))
  const referenced = []
  for (const row of scored) {
    const paths = [...row.why.matchAll(/`((?:src|native|tests|docs)\/[^`]+?)`/g)]
      .map(match => match[1].replace(/:\d+(?:-\d+)?$/, '').replace(/[#§].*$/, ''))
    assert.ok(paths.length > 0, `${row.name} 判了 ${row.verdict} 却没指到任何本仓实现文件`)
    assert.ok(/:\d+/.test(row.why) || row.why.includes('无法核实'),
      `${row.name} 判了 ${row.verdict} 但依据里没有行号坐标（也没写「无法核实」）`)
    referenced.push(...paths)
  }
  if (referenced.length > 0) {
    assert.ok(referenced.length >= 30, `只检查到 ${referenced.length} 条实现点引用，这条判据覆盖太薄`)
    const missing = referenced.filter(path => !existsSync(join(root, path)))
    assert.deepEqual(missing, [], `判决引用了不存在的文件：${[...new Set(missing)].join(', ')}`)
  }
})

test('[-] 必须给具体理由（"不适用"三个字不算）', () => {
  for (const row of bucket('[-]')) {
    const why = row.why.trim()
    assert.ok(why.length >= 24, `${row.name} 的 [-] 理由太短（${why.length} 字）：${why}`)
    assert.ok(why.includes('`'), `${row.name} 的 [-] 理由没有引用任何文件/符号：${why}`)
    assert.ok(!/^(不适用|无|—|-)$/.test(why), `${row.name} 的 [-] 理由是空话`)
  }
})

test('[ ] 行也要写清缺什么，不是留白', () => {
  for (const row of bucket('[ ]')) {
    assert.ok(row.why.trim().length >= 12, `${row.name} 判 [ ] 但没写缺什么`)
  }
})

test('测试源码集 / 生成码 / 夹具一律判 [-]', () => {
  const inListing = listing.filter(entry => isTestish(entry))
  assert.ok(inListing.length > 0, '枚举里应有测试源码集/生成码，一条都没有说明判据空转')
  const testish = rows.filter(row => isTestish(row.path))
  for (const row of testish) {
    assert.equal(row.verdict, '[-]', `${row.name} @ ${row.path} 是测试/生成码，必须判 [-]`)
  }
})

test('文档骨架完整：§0 机械信号总账 / §A–§D 分档 / §E 未做 / §G 逐类表都在', () => {
  for (const heading of ['## 0', '## A', '## B', '## C', '## D', '## E', '## G']) {
    assert.ok(verdict.includes(heading + '.'), `缺 ${heading} 一节`)
  }
  assert.match(verdict, /机械信号总账/)
  assert.match(verdict, /真实代码引用|真实代码/)
  assert.match(verdict, /git CLI/, 'VCS 域必须写清"本仓直接用 git CLI"这条口径')
  const d = verdict.split('## D.')[1].split('## E.')[0]
  assert.match(d, /测试|生成码/, '§D 缺「上游测试源码集/生成码」的理由')
  assert.match(d, /Swing|VcsContextFactory|per-file|抽象/, '§D 缺「IDE 内部 VCS 抽象 / Swing」的理由')
})
