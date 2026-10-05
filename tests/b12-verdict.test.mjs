// B12 判决门控：`editor` 域 = `docs/inventory/editor.txt` 的逐类判决表
// `docs/inventory/verdict-editor.md` 的 §G。形状照 `tests/b2-verdict.test.mjs`，
// 判据在 B2/B8 的四条之上多加了本批抓出来的两类真缺陷：
//
//   ① 「先造一个完整生成器 / 攒着最后一次性写」都会让磁盘上没有自洽产物 —— 所以覆盖率是
//      **动态**的：§G 已判多少行就按多少行核，表尾的「当前已判 N 行」必须与实数一致，
//      头部四档的和数必须与 §G 逐条统计一致，四档相加必须等于已判行数（不预先写死 2551）。
//   ② **机械降级**：把「类是接口/抽象类/契约」当成「不适用」。这条由
//      `test('接口/抽象/契约不得因为「是接口」就判 [-]')` 拦住 —— `[-]` 的理由里出现
//      接口/抽象/契约/形状 这类词时，必须同时点名**控件本体**（哪个 Swing/JB 控件）
//      或上游测试/生成物/平台专属的硬标记，否则就是降级判错。
//   ③ 「只在注释里出现过」不等于已移植 —— `[x]`/`[~]` 必须指到磁盘上真实存在的
//      `src/` 或 `native/` 文件，且该文件剥掉注释后仍有真实代码（不是空壳）。
//
// 负验证：本文件支持 `B12_VERDICT` / `B12_LISTING` 两个环境变量指向替代文本，
// 用来把「造假引用 / 删一行 / 四档不自洽」三种破坏喂进来，确认各自变红（见批次报告）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// B12_LISTING / B12_VERDICT 只为**反向验证**存在：把改坏过的副本（绝对路径）喂进来，
// 确认「造假引用 / 删一行 / 四档不自洽 / 形状降级 / 同上」各自都能变红。默认路径是仓库里的真表。
const read = relative => readFileSync(isAbsolute(relative) ? relative : join(root, relative), 'utf8')

const LISTING_REL = process.env.B12_LISTING || 'docs/inventory/editor.txt'
const VERDICT_REL = process.env.B12_VERDICT || 'docs/inventory/verdict-editor.md'

const listing = read(LISTING_REL).split('\n').map(line => line.trim()).filter(Boolean)
const verdict = process.env.B12_VERDICT_TEXT || read(VERDICT_REL)

/** §G 表的一行：`| \`类名\` | \`源码路径\` | \`[x]\` | 依据 |`。 */
export function appendixRows(text) {
  const rows = []
  const pattern = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`\[(x|~|-| )\]`\s*\|\s*(.*?)\|\s*$/gm
  let match
  while ((match = pattern.exec(text)) !== null) {
    rows.push({ name: match[1], path: match[2], verdict: '[' + match[3] + ']', why: match[4] })
  }
  return rows
}

const rows = appendixRows(verdict)
const upstreamName = entry => entry.split('/').pop().replace(/\.(java|kt)$/, '')
const keyOf = (name, path) => name + ' ' + path

const counts = { '[x]': 0, '[~]': 0, '[ ]': 0, '[-]': 0 }
for (const row of rows) counts[row.verdict] = (counts[row.verdict] || 0) + 1
const judged = counts['[x]'] + counts['[~]'] + counts['[ ]'] + counts['[-]']

/** 上游测试源码 / 生成物 / 微基准：这些一律 `[-]`，是硬标记不是判断。 */
const isForcedNA = entry =>
  /\/tests\/|testSources|\/gen\/|_test\.kt$/.test(entry) ||
  /(?:Test|Tests|TestCase|Benchmark)$/.test(upstreamName(entry))

const forced = listing.filter(isForcedNA)

test('§G 逐条覆盖：编辑器域每个上游类恰好一行，不多不漏不重', () => {
  assert.ok(listing.length === 2551, 'editor.txt 应是 2551 类，实为 ' + listing.length)
  assert.ok(rows.length > 0, '§G 一行都没有')
  assert.equal(judged, rows.length, '有四档之外的行？逐类统计与总行数对不上')
  const expected = new Map()
  for (const entry of listing) expected.set(keyOf(upstreamName(entry), entry), false)
  const extra = []
  const dup = []
  for (const row of rows) {
    const key = keyOf(row.name, row.path)
    if (!expected.has(key)) extra.push(key)
    else if (expected.get(key)) dup.push(key)
    else expected.set(key, true)
  }
  assert.deepEqual(extra, [], '§G 里有 editor.txt 之外的行：' + extra.slice(0, 8).join(', '))
  assert.deepEqual(dup, [], '§G 里重复出现的行：' + dup.slice(0, 8).join(', '))
  const missing = [...expected.entries()].filter(([, seen]) => !seen).map(([k]) => k.split(' ')[0])
  assert.ok(missing.length === 0,
    '§G 漏了 ' + missing.length + ' 个类：' + missing.slice(0, 12).join(', '))
})

test('四档自洽：逐条统计 == 头部和数 == 表尾「当前已判 N 行」', () => {
  const sum = counts['[x]'] + counts['[~]'] + counts['[ ]'] + counts['[-]']
  assert.equal(sum, rows.length, '四档相加必须等于 §G 已判行数')
  const header = verdict.match(/四档合计 \*\*(\d+) \+ (\d+) \+ (\d+) \+ (\d+) = (\d+)\*\*/)
  assert.ok(header, '文档头部要写「四档合计 **a + b + c + d = N**」')
  const declared = [Number(header[1]), Number(header[2]), Number(header[3]), Number(header[4])]
  const actual = [counts['[x]'], counts['[~]'], counts['[ ]'], counts['[-]']]
  assert.deepEqual(declared, actual,
    '头部四档数字与 §G 实数不一致：头部 ' + declared.join(' + ') + '，实为 ' + actual.join(' + '))
  assert.equal(Number(header[5]), sum, '头部和数与实数对不上')
  const tail = verdict.match(/当前已判\s*(\d+)\s*行/)
  assert.ok(tail, '表尾要写「当前已判 N 行」（不预先写死总数）')
  assert.equal(Number(tail[1]), rows.length, '表尾「当前已判 N 行」与 §G 实数不一致')
})

test('每条 [x]/[~] 都指到磁盘上真实存在的 src/ 或 native/ 文件（防「注释里提过就算移植」）', () => {
  const orphans = []
  const referenced = []
  for (const row of rows) {
    if (row.verdict !== '[x]' && row.verdict !== '[~]') continue
    const paths = [...row.why.matchAll(/`((?:src|native)\/[^`]+?)`/g)]
      .map(match => match[1].replace(/:\d+(?:-\d+)?$/, ''))
    if (!paths.length) orphans.push(row.name + ' @ ' + row.path)
    referenced.push(...paths)
  }
  assert.deepEqual(orphans, [],
    '判了 [x]/[~] 却没指到任何实现文件：' + orphans.slice(0, 10).join(', '))
  assert.ok(referenced.length >= 400,
    '被核对的本仓引用只有 ' + referenced.length + ' 条，覆盖太薄（这条判据自身会空转）')
  const missing = referenced.filter(path => !existsSync(join(root, path)))
  assert.deepEqual(missing, [],
    '判决引用了不存在的文件：' + [...new Set(missing)].slice(0, 12).join(', '))
})

test('[x]/[~] 指到的落点文件剥掉注释后仍有真实代码（空壳注释文件不算落点）', () => {
  const hollow = []
  for (const row of rows) {
    if (row.verdict !== '[x]' && row.verdict !== '[~]') continue
    for (const match of row.why.matchAll(/`((?:src|native)\/[^`]+?)`/g)) {
      const rel = match[1].replace(/:\d+(?:-\d+)?$/, '')
      if (!existsSync(join(root, rel))) continue
      const src = readFileSync(join(root, rel), 'utf8')
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(line => !/^\s*(\/\/|#include\s*<.*>|<?xml|Rem\b)/.test(line))
        .join('\n')
        .replace(/\s+/g, '')
      if (code.length < 40) hollow.push(row.name + ' -> ' + rel)
    }
  }
  assert.deepEqual(hollow, [], '这些落点文件剥掉注释后基本是空的：' + hollow.slice(0, 8).join(', '))
})

test('每条 [-] 都带具体理由（不接受空串、「同上」或光秃秃的「不适用」）', () => {
  const thin = rows
    .filter(row => row.verdict === '[-]')
    .filter(row => row.why.replace(/[^一-龥A-Za-z0-9]/g, '').length < 18)
    .filter(row => !/(Test|Tests|TestCase|Benchmark)$/.test(row.name))
    .map(row => row.name)
  assert.deepEqual(thin, [], '这些 [-] 行的理由太短：' + thin.slice(0, 10).join(', '))
  const lazy = rows
    .filter(row => row.verdict === '[-]')
    .filter(row => /^同上|^同前|^见上/.test(row.why.trim()))
    .map(row => row.name)
  assert.deepEqual(lazy, [], '这些 [-] 行只写了「同上」，要把理由就地写全：' + lazy.slice(0, 10).join(', '))
})

/**
 * 本批的核心门禁：**接口/抽象类/契约/模型/持久化类不许因为「它是个接口」就判 [-]**。
 * 只有类本体真的是 Swing/JB 控件实现（继承 JComponent/JPanel/JList…、或 paintComponent/
 * Graphics2D 自绘）才允许 [-]，且理由必须点名「哪个控件本体 + 行为由本仓哪个 DOM 落点承担」。
 * 这里用文本可判的形状实现：理由里出现「接口/抽象/契约/形状/监听器接口」这类词时，
 * 必须同时给出控件本体点名或硬标记（测试源码/生成物/微基准/平台专属）。
 */
test('接口/抽象/契约不得因为「是接口」就判 [-]（机械降级守卫）', () => {
  const SHAPE_WORDS = /接口|抽象|契约|值对象|形状|multicast|listener 接口/i
  const CONTROL_BODY = /JComponent|JPanel|JList|JTree|JButton|JLabel|JScrollBar|JTextComponent|JEditorPane|JBPopup|JBList|CellRenderer|paintComponent|Graphics2D|FontMetrics|控件本体|自绘|Swing 构件|Swing 件/
  const HARD_MARKER = /testSources|测试源码|上游测试|生成物|微基准|JMH|Benchmark|平台专属|x11|win32|darwin|Headless|CustomFrameDecoration|语言侧|PSI|资源束|消息目录|NLS|mock 夹具/i
  const offenders = []
  for (const row of rows) {
    if (row.verdict !== '[-]') continue
    if (isForcedNA(row.path)) continue
    if (!SHAPE_WORDS.test(row.why)) continue
    if (CONTROL_BODY.test(row.why) || HARD_MARKER.test(row.why)) continue
    offenders.push(row.name + ' | ' + row.why.slice(0, 60))
  }
  assert.deepEqual(offenders, [],
    '这些 [-] 只给了「它是接口/抽象类」这类形状理由，按行为判应为 [x]/[~]/[ ]：' + offenders.slice(0, 12).join(' ;; '))
})

test('上游测试源码 / 生成物 / 微基准一律判 [-]', () => {
  assert.ok(forced.length >= 40, 'editor.txt 里的测试/生成物条目少于预期（枚举变了？）')
  const wrong = []
  for (const entry of forced) {
    const name = upstreamName(entry)
    const row = rows.find(candidate => candidate.name === name && candidate.path === entry)
    if (!row) wrong.push(name + ' 无行')
    else if (row.verdict !== '[-]') wrong.push(name + ' 判了 ' + row.verdict)
  }
  assert.deepEqual(wrong, [], '测试/生成物被判成了产品行为：' + wrong.slice(0, 10).join(', '))
})

test('文档把四档口径、三态口径与「无法核实」的处理都写明', () => {
  assert.match(verdict, /真实代码引用[\s\S]{0,40}注释[\s\S]{0,40}从未出现|三态/, '要交代三态口径')
  assert.match(verdict, /无法核实/, '要交代指不到源码时怎么写')
  assert.match(verdict, /接口、抽象类、契约\/模型\/持久化类[\s\S]{0,40}按行为判|按行为判/, '要写明接口不按机械降级')
  const sections = ['## 0.', '## A.', '## B.', '## C.', '## D.', '## E.', '## G.']
  for (const s of sections) assert.ok(verdict.includes(s), '判决表缺章节 ' + s)
})

test('§C 未移植要有「按用户可见度排序的待办前 20 条」，§E 要有诚实未做', () => {
  const c = verdict.split(/^## C\./m)[1] || ''
  const cBody = c.split(/^## D\./m)[0]
  assert.match(cBody, /按用户可见度排序的待办前 20 条/, '§C 要有那一张排序表')
  const ranked = [...cBody.matchAll(/^\|\s*(\d+)\s*\|(.*)\|$/gm)]
  assert.ok(ranked.length >= 20, '排序表不足 20 条，实为 ' + ranked.length)
  for (const [text, num, body] of ranked) {
    assert.match(body, /[A-Za-z0-9_/]+\.(java|kt|xml)(:\d+)?/, '第 ' + num + ' 条没有上游依据（相对路径）：' + body.slice(0, 40))
    assert.match(body, /(?:src|native)\/[^\s,;，；|]+|新(组件|模块|src)/, '第 ' + num + ' 条没有本仓建议落点：' + body.slice(0, 40))
  }
  const e = (verdict.split(/^## E\./m)[1] || '').split(/^## F|^## G/m)[0]
  assert.ok(e.length > 200, '§E 诚实未做几乎是空的')
})
