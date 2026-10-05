// 上游引用的**内容锚点**门控 —— 比 tests/source-citations.test.mjs 再严一层。
//
// 为什么还要这一层（`docs/handoff-2026-10-05-agent-protocol.md` §5.4 的待办）：
// `verifyCitations` 只核「参考树里有这个文件 + 行号 ≤ 文件长度」。所以把
// `Foo.java:120-133` 手滑改成 `Foo.java:300-313`（同一个文件里的另一个方法），
// 老门控**全绿** —— 而按图索骥的人扑的是空。这一层要抓的就是「悄悄改指到别处」。
//
// 做法：**锚点快照** `docs/inventory/citation-anchors.json` —— 每条已核过的引用记下
// 被引区间的内容特征（规范化正文的 FNV-1a 哈希 + 区间里的关键标识符）。门控断言：
//   ① 快照里每条引用**仍然逐字存在于仓里**（改了行号 / 删了引用 ⇒ 红）；
//   ② 它的被引区间**内容仍与快照一致**（上游那段变了、或引用挪到了同文件别处 ⇒ 红）；
//   ③ 新增的引用不入快照 ⇒ 只报数不拦（否则 18 个 agent 同时补判词就会天天假红）；
//      但快照整体塌掉（少于 MIN_ANCHORS）说明扫描本身坏了，那要拦。
//
// 参考树不在本机时与老门控一致：**跳过而不是失败**。
// 重算快照（唯一会写盘的入口，必须显式点名，`npm test` 永远不会改它）：
//   PowerShell  $env:TAOCODE_CITATION_ANCHORS='update'; node --test tests/source-citation-anchors.test.mjs
//   bash        TAOCODE_CITATION_ANCHORS=update node --test tests/source-citation-anchors.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// 复用老门控的解析器与参考树读取，不复制一份（复制出来的两份口径一定会漂）。
import { citationsOf, refLineReader } from './source-citations.test.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const SNAPSHOT = join(root, 'docs', 'inventory', 'citation-anchors.json')
/** 与老门控同一批查证点；不扫 tests/ —— 本文件里必须放几条**假**引用才能自证门控会响。 */
const DIRS = ['src', 'native', 'docs']
const SKIP = new Set(['node_modules', 'dist', 'build', 'build-validation'])
const EXT = /\.(ts|vue|css|cpp|hpp|mjs|md)$/
const KEY_TOKENS = 8
/** 快照塌到个位数 = 扫描器或目录清单坏了，门控正在空转。 */
const MIN_ANCHORS = 150
const UPDATE = process.env.TAOCODE_CITATION_ANCHORS === 'update'

const REFRESH_HINT = "重算快照：$env:TAOCODE_CITATION_ANCHORS='update'; "
  + 'node --test tests/source-citation-anchors.test.mjs'

// update 档在**加载阶段**就把快照重算掉，然后照常跑一遍门控自证「写出来的快照读得回去」。
// `npm test` 不带这个环境变量 ⇒ 这一段永远不执行，测试进程对磁盘只读。
if (UPDATE) {
  if (!existsSync(REF)) {
    console.log('update 档需要参考树在位，本次没有重算：' + REF)
  } else {
    const regenerated = buildAnchors(liveCitations(), refTextReader(REF))
    writeFileSync(SNAPSHOT, snapshotText(regenerated), 'utf8')
    console.log(`锚点快照已重算：${regenerated.length} 条 → docs/inventory/citation-anchors.json`)
  }
}

/** 一条锚点的身份 = 本仓文件 + 上游文件 + 行区间。行号变了就是**另一条**锚点，这条就没了。 */
export function anchorId(file, path, from, to) {
  return `${file}|${path}|${from}-${to}`
}

/** 区间正文：逐行压掉缩进与行尾空白、丢空行 —— 只留内容，不让上游的缩进改动误报。 */
export function rangeBody(text, from, to) {
  return text.split('\n').slice(from - 1, to)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line !== '')
    .join('\n')
}

/** FNV-1a 32bit：只求「同一份输入 → 同一个值」，不当防伪。 */
export function hash32(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

/** 区间里的关键标识符（≥5 字符，长的优先、同长字典序，取前 8）—— 把失败信息说成人话用的。 */
export function keyTokens(body) {
  const found = new Set()
  for (const match of body.matchAll(/[A-Za-z_$][A-Za-z0-9_$]{4,}/g)) found.add(match[0])
  return [...found].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)).slice(0, KEY_TOKENS)
}

/** 区间的可核对特征。`body` 只在核对时用来拼诊断，不进快照。 */
export function featureOf(text, from, to) {
  const body = rangeBody(text, from, to)
  return { h: hash32(body), t: keyTokens(body), lines: body === '' ? 0 : body.split('\n').length, body }
}

/** 读参考树里某个文件的全文；读不到返回 null。与 `refLineReader` 同一个「行按 \n 数」的口径。 */
export function refTextReader(refRoot) {
  const cache = new Map()
  return path => {
    if (cache.has(path)) return cache.get(path)
    const file = join(refRoot, path)
    const text = existsSync(file) ? readFileSync(file, 'utf8') : null
    cache.set(path, text)
    return text
  }
}

function sourceFiles(dir, out) {
  const collected = out || []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(rel, collected)
    else if (EXT.test(entry.name)) collected.push(rel.replace(/\\/g, '/'))
  }
  return collected
}

/** 仓里当前**逐字存在**的引用（带所在文件），按锚点身份去重。 */
export function liveCitations() {
  const map = new Map()
  for (const dir of DIRS) {
    for (const file of sourceFiles(dir, [])) {
      for (const item of citationsOf(readFileSync(join(root, file), 'utf8'))) {
        const id = anchorId(file, item.path, item.from, item.to)
        if (!map.has(id)) map.set(id, { id, file, path: item.path, from: item.from, to: item.to })
      }
    }
  }
  return [...map.values()]
}

/** 从活引用重算锚点表。只有 update 档会把它写盘。 */
export function buildAnchors(live, readText) {
  const anchors = []
  for (const item of live) {
    const text = readText(item.path)
    if (text === null) continue // 参考树里没有的文件由老门控报，这里不伪造特征
    const feature = featureOf(text, item.from, item.to)
    anchors.push({ f: item.file, p: item.path, a: item.from, b: item.to, h: feature.h, t: feature.t })
  }
  return anchors.sort(byAnchorOrder)
}

/** 稳定排序：本仓文件 → 上游路径 → 行号，快照的 `git diff` 才指得出漂了哪条。 */
function byAnchorOrder(x, y) {
  if (x.f !== y.f) return x.f < y.f ? -1 : 1
  if (x.p !== y.p) return x.p < y.p ? -1 : 1
  return x.a - y.a || x.b - y.b
}

/**
 * 核对：快照锚点 ↔ 仓里活引用 ↔ 参考树里的区间内容。
 * 四个入参都可注入，所以下面的自证用例在**没有参考树**的机器上也跑得动。
 */
export function audit(anchors, live, readText, readLines) {
  const liveIds = new Set(live.map(item => item.id))
  const anchorIds = new Set(anchors.map(a => anchorId(a.f, a.p, a.a, a.b)))
  const problems = []
  let empty = 0
  for (const anchor of anchors) {
    const id = anchorId(anchor.f, anchor.p, anchor.a, anchor.b)
    if (!liveIds.has(id)) {
      problems.push({ kind: 'moved', id,
        why: '快照里有这条引用，仓里已经指不到它了（行号被改 / 整条被删 / 搬进了别的文件）' })
      continue
    }
    const lines = readLines(anchor.p)
    if (lines === null || anchor.b > lines) continue // 文件没了 / 行号越界：老门控那条已经会报
    const feature = featureOf(readText(anchor.p), anchor.a, anchor.b)
    if (feature.lines === 0) empty++
    if (feature.h === anchor.h && feature.t.join('\n') === anchor.t.join('\n')) continue
    const lost = anchor.t.filter(token => !feature.body.includes(token))
    problems.push({ kind: 'drift', id,
      why: feature.lines === 0
        ? '被引区间现在是空的（上游那段没了，或行号指到了空行）'
        : `区间内容变了：快照记 ${anchor.h}／关键标识符 ${anchor.t.join('、') || '（无）'}，`
          + `现在读到 ${feature.h}／${feature.t.join('、') || '（无）'}`
          + (lost.length ? `；快照里的这些词已经不在区间里：${lost.join('、')}` : '') })
  }
  return { problems, uncovered: live.filter(item => !anchorIds.has(item.id)), empty }
}

/** 快照正文：一条锚点一行，`git diff` 才指得出漂了哪条引用。 */
export function snapshotText(anchors) {
  const meta = JSON.stringify({ version: 1, refRoot: REF,
    note: '由 tests/source-citation-anchors.test.mjs 的 update 档生成，勿手改' })
  const lines = ['{', `  "meta": ${meta},`, '  "anchors": [']
  anchors.forEach((anchor, index) => {
    lines.push(`    ${JSON.stringify(anchor)}${index + 1 === anchors.length ? '' : ','}`)
  })
  lines.push('  ]', '}', '')
  return lines.join('\n')
}

const READOUT = [
  '这些引用要么被悄悄改指到了同文件的别处，要么上游区间内容变了而快照没跟着更新。',
  '先确认引用指对了没有（指错了 → 改回正确区间并让判词重新核过），再来重算快照：',
  `  ${REFRESH_HINT}`,
].join('\n')

test('锚点特征：同一段正文给同一个特征，漂到同文件别的方法上必须给另一个特征', () => {
  const text = ['class A {', '  void getPrefixMatcher() {', '    return prefix;', '  }', '}',
    '  void unrelatedMethodHere() {', '    throw new Error();', '  }'].join('\n')
  const first = featureOf(text, 2, 4)
  assert.equal(first.h, featureOf(text, 2, 4).h, '同样输入给不同哈希 = 快照每次重算都自相矛盾')
  assert.equal(first.lines, 3, '区间行数不对，规范化把行吃掉了')
  assert.deepEqual(first.t, ['getPrefixMatcher', 'prefix', 'return'], '关键标识符没抓出来，失败信息会是空话')
  const other = featureOf(text, 6, 8)
  assert.notEqual(other.h, first.h, '反证：漂到同文件另一个方法上哈希必须变，不然这一层就是空转')
  assert.ok(!other.t.includes('getPrefixMatcher'), '反证：别的方法里不该有区间里的那个标识符')
  assert.equal(featureOf(text, 99, 100).lines, 0, '越界区间要落成空正文（门控据此报「区间为空」）')
})

test('锚点门控要真的会红：行号被改、区间内容被改，两种都拦得住（不需要参考树）', () => {
  const fake = new Map([['platform/x/Real.java',
    ['l1 head', 'l2 getPrefixMatcher target', 'l3 tail', 'l4 otherThing here'].join('\n')]])
  const readText = path => (fake.has(path) ? fake.get(path) : null)
  const readLines = path => (fake.has(path) ? fake.get(path).split('\n').length : null)
  const anchors = [
    { f: 'src/a.ts', p: 'platform/x/Real.java', a: 2, b: 2, h: hash32('l2 getPrefixMatcher target'), t: ['getPrefixMatcher', 'target'] },
    { f: 'src/b.ts', p: 'platform/x/Real.java', a: 4, b: 4, h: 'ffffffff', t: ['goneAwayToken'] },
  ]
  const live = [
    { id: anchorId('src/a.ts', 'platform/x/Real.java', 3, 3), file: 'src/a.ts', path: 'platform/x/Real.java', from: 3, to: 3 },
    { id: anchorId('src/b.ts', 'platform/x/Real.java', 4, 4), file: 'src/b.ts', path: 'platform/x/Real.java', from: 4, to: 4 },
  ]
  const { problems, uncovered } = audit(anchors, live, readText, readLines)
  assert.deepEqual(problems.map(p => p.kind).sort(), ['drift', 'moved'],
    `反证：一条改了行号 + 一条内容对不上，必须两条都被判出来，实际 ${JSON.stringify(problems.map(p => p.kind))}`)
  assert.equal(problems.find(p => p.kind === 'moved').id, 'src/a.ts|platform/x/Real.java|2-2',
    '改了行号的那条要按快照里的旧身份报出来（报成新身份就说明匹配用错了键）')
  assert.equal(problems.find(p => p.kind === 'drift').id, 'src/b.ts|platform/x/Real.java|4-4')
  assert.match(problems.find(p => p.kind === 'drift').why, /区间内容变了/)
  assert.equal(uncovered.length, 1, 'src/a.ts 的新行号是没入快照的引用：拦不得，但必须看得见')
  // 正证：区间没变、行号没变 ⇒ 一条都不能报。
  const honest = [{ f: 'src/b.ts', p: 'platform/x/Real.java', a: 4, b: 4,
    h: hash32('l4 otherThing here'), t: ['otherThing'] }]
  const clean = audit(honest, [live[1]], readText, readLines)
  assert.deepEqual(clean.problems, [], '反证用错素材：这一条本该完全成立')
})

test('锚点门控拦得住「区间被上游改掉」这一类：内容变了快照没跟着更新 ⇒ 红', () => {
  const before = ['x', 'void alphaMethod() {}', 'y'].join('\n')
  const after = ['x', 'void betaMethod() {}', 'y'].join('\n')
  const anchor = { f: 'src/a.ts', p: 'platform/x/Real.java', a: 2, b: 2,
    h: hash32('void alphaMethod() {}'), t: ['alphaMethod'] }
  const live = [{ id: anchorId('src/a.ts', 'platform/x/Real.java', 2, 2),
    file: 'src/a.ts', path: 'platform/x/Real.java', from: 2, to: 2 }]
  const readLines = () => 3
  assert.deepEqual(audit([anchor], live, () => before, readLines).problems, [], '同内容必须全绿')
  const drifted = audit([anchor], live, () => after, readLines).problems
  assert.equal(drifted.length, 1, '上游区间改了而快照没更新 ⇒ 必须红')
  assert.equal(drifted[0].kind, 'drift')
  assert.match(drifted[0].why, /alphaMethod/, '诊断要点出区间里丢掉的词')
})

test('快照形状：不是空表，每条锚点都带得上核对的字段（不依赖参考树）', () => {
  assert.ok(existsSync(SNAPSHOT), `缺锚点快照 docs/inventory/citation-anchors.json。${REFRESH_HINT}`)
  const parsed = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
  assert.equal(parsed.meta.version, 1, '快照版本不认识')
  assert.ok(Array.isArray(parsed.anchors), '快照的 anchors 不是数组')
  assert.ok(parsed.anchors.length >= MIN_ANCHORS,
    `快照只有 ${parsed.anchors.length} 条锚点（< ${MIN_ANCHORS}）：多半是 DIRS/EXT 清单坏了，门控正在空转`)
  const malformed = parsed.anchors.filter(a => typeof a.f !== 'string' || typeof a.p !== 'string'
    || !Number.isInteger(a.a) || !Number.isInteger(a.b) || a.a < 1 || a.b < a.a
    || typeof a.h !== 'string' || !Array.isArray(a.t))
  assert.deepEqual(malformed, [], '快照里有形状不对的锚点，这一层核不住任何东西')
  const ids = parsed.anchors.map(a => anchorId(a.f, a.p, a.a, a.b))
  assert.equal(new Set(ids).size, ids.length, '快照里有重复锚点，比对结果会看运气')
})

test('已入快照的每条引用，被引区间内容必须仍与快照一致（参考树在时）', () => {
  if (!existsSync(REF)) return // 与 tests/source-citations.test.mjs 同口径：树不在就跳过
  const live = liveCitations()
  assert.ok(live.length >= MIN_ANCHORS, `仓里只扫到 ${live.length} 条可核引用：正则或目录清单坏了`)
  const parsed = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
  const { problems, uncovered, empty } = audit(parsed.anchors, live, refTextReader(REF), refLineReader(REF))
  console.log(`锚点核对：快照 ${parsed.anchors.length} 条 / 仓里活引用 ${live.length} 条 / `
    + `未入快照 ${uncovered.length} 条 / 区间为空 ${empty} 条`)
  if (uncovered.length) {
    console.log('  未入快照的引用（不拦，下次重算会把它们收进去）：')
    for (const item of uncovered.slice(0, 8)) console.log(`    ${item.id}`)
    if (uncovered.length > 8) console.log(`    …另有 ${uncovered.length - 8} 条`)
  }
  assert.deepEqual(problems.map(p => `${p.kind} :: ${p.id} —— ${p.why}`), [],
    `${READOUT}\n共 ${problems.length} 条${byFileSummary(problems)}`)
})

/** 失败信息按本仓文件归并一句：一份判词书被整体重写时会一次报几十条，归并了才看得出是同一件事。 */
function byFileSummary(problems) {
  const counts = new Map()
  for (const p of problems) {
    const file = p.id.split('|')[0]
    counts.set(file, (counts.get(file) || 0) + 1)
  }
  if (counts.size < 2) return ''
  const parts = [...counts].sort((a, b) => b[1] - a[1])
    .map(([file, n]) => `${file} ${n} 条`)
  return `（按文件：${parts.join('、')}）`
}
