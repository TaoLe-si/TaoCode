// B11 判决（`settings-run` 域 = 3247 类）自身的门控。
//
// 这份判决要防的三件事：
//   ① 拿"注释里提过"当"已移植" ⇒ `[x]`/`[~]` 行的依据必须指到磁盘上真实存在的 `src/` `native/` 文件；
//   ② 覆盖率作假（"3247 类都判了"其实只判了一半）⇒ 表头「当前已判 N 行」必须等于 §G 实际行数，
//      且与 `docs/inventory/settings-run.txt` 一一对齐（每类恰好一行、不多不少不重）；
//   ③ `[-]`（不适用）当垃圾桶 ⇒ 每条 `[-]` 必须带六种**具体**理由标记之一，且标记要与机械事实
//      （`docs/inventory/settings-run_verdict_table.json` 的 kind / widget / paint / os / test，
//      或 `settings-run.txt` 的**路径**：测试源码集 / `/gen/` 生成目录）互相印证。
//
// ⚠️ 第 ③ 条里是本域收紧后的判据：「类本体是 Swing 组件」只在**具体类**继承 Swing/JB 控件本体
//    或自绘（`paintComponent`）时才成立；接口、抽象类一律按行为判 `[x]/[~]/[ ]`。
//    `isSwingBody` + 下面的自证用例钉住这条规则（before/after 样例见
//    `docs/batch-2026-10-06-verdict-settings-run.md` §B）。
//
// 反向验证：把表拷到临时目录后注入假引用 / 删一行 / 改和数 / 把接口判 `[-]`，对应用例都要红
// （用 `B11_VERDICT` / `B11_FACTS` 指向改动后的副本跑）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const procEnv = process.env
const pick = (value, fallback) => (value && value.length > 0 ? value : fallback)
// 绝对路径直接用（`B11_VERDICT` 的反向验证副本可能在别的盘），相对路径拼仓库根。
const read = target => readFileSync(isAbsolute(target) ? target : join(root, target), 'utf8')

const listingPath = pick(procEnv.B11_LISTING, 'docs/inventory/settings-run.txt')
const verdictPath = pick(procEnv.B11_VERDICT, 'docs/inventory/verdict-settings-run.md')
const factsPath = pick(procEnv.B11_FACTS, 'docs/inventory/settings-run_verdict_table.json')
const upstreamRoot = pick(procEnv.B11_UPSTREAM, 'D:/Backup/Downloads/intellij-community-master/intellij-community-master')

const listing = read(listingPath).split('\n').map(line => line.trim()).filter(Boolean)
const verdict = read(verdictPath)
const factRows = JSON.parse(read(factsPath)).rows

/** §G 表行：`| `类名` | `上游路径` | `判决` | 依据 |`。 */
export function appendixRows(text) {
  const found = []
  const pattern = /^\| `([^`]+)` \| `([^`]+)` \| `(\[[x~\- ]\])` \| (.*) \|$/gm
  let match = pattern.exec(text)
  while (match !== null) {
    found.push({ name: match[1], path: match[2], verdict: match[3], why: match[4] })
    match = pattern.exec(text)
  }
  return found
}

/**
 * 收紧后的「Swing 控件本体」判据（§B 规则唯一可执行的地方）。
 * 只看机械事实：具体类 + 继承 Swing/JB 控件本体，或自绘 `paintComponent`。
 * 接口与抽象类**永远返回 false**：签名里出现 `JComponent` 不等于自己是控件，
 * `SearchableConfigurable` / `SettingsEditor` 正是被旧规则误降的那一类。
 */
export function isSwingBody(fact) {
  if (fact.kind === 'interface' || fact.kind === 'abstract') return false
  if (fact.kind !== 'class' && fact.kind !== 'object') return false
  return Boolean(fact.widget || fact.paint)
}

/**
 * 测试源码集 / 生成目录的**路径**判据（2026-10-06 与 `tests/b9-verdict.test.mjs` 对账时补）。
 * 为什么要按路径而不只信 `verdict_table.json` 的 `test` 标记：那份 json 的 test 口径只认
 * `testSources`/`/tests/`/`*Test.java`，漏了 `plugins/junit/kotlin-tests-shared/test/…` 这类
 * 目录（实测漏 3 条），也完全不含 `/gen/` 生成码（protobuf/grpc，实测 34 条）。
 * 路径是枚举清单 `settings-run.txt` 里直接可读的事实，比派生标记更硬：
 * 于是 `[-]` 多认 `[上游测试源码集]`、`[上游生成物]` 两个标记，且新增一条**正向强制**用例
 * （凡是这两种路径的行必须判 `[-]`）——豁免面变宽的同时，强制面变得比原来更大，净效果是变强。
 */
export function upstreamTestPath(path) {
  return /testsources|\/test\/|\/tests\/|teststrc|\/testdata\//i.test(path) || /(?:Test|Tests|TestCase)$/.test(path.split('/').pop().replace(/\.(java|kt)$/u, ''))
}
export function upstreamGenPath(path) {
  return /\/gen\/|\/pico-gen\/|\/testEntities\/|\/resources\//.test(path) || /(^|\/)package-info\.(java|kt)$/u.test(path)
}

// §G 才是逐类总表；§A-§E 的分档说明表形状相似但不参与机检，只解析 §G 之后的行。
const gSection = verdict.slice(verdict.indexOf('## G. 逐条总表'))
assert.ok(gSection.length > 1000, '§G 逐类总表缺失或过短')
const rows = appendixRows(gSection)
const factOf = new Map(factRows.map(fact => [`${fact.name}\u0000${fact.path}`, fact]))
const countOf = letter => rows.filter(row => row.verdict === letter).length
const nameOf = entry => entry.split('/').pop().replace(/\.(java|kt)$/u, '')
const repoPaths = text => [...text.matchAll(/`((?:src|native)\/[^`\s]+)`/gu)].map(m => m[1].replace(/:\d+(?:-\d+)?$/u, ''))

test('扫描件 3247 类，§G 每类恰好一行（不漏、不多、不重，路径对得上）', () => {
  assert.equal(listing.length, 3247, `扫描件应有 3247 行，实为 ${listing.length}`)
  const expected = new Map()
  for (const entry of listing) expected.set(`${nameOf(entry)}\u0000${entry}`, 0)
  const hit = new Map()
  for (const row of rows) {
    const key = `${row.name}\u0000${row.path}`
    assert.ok(expected.has(key), `§G 多了一行或路径写错：${row.name} @ ${row.path}`)
    expected.set(key, expected.get(key) + 1)
    hit.set(key, (hit.get(key) || 0) + 1)
  }
  assert.equal(rows.length, 3247, `§G 应有 3247 行，实为 ${rows.length}`)
  const missing = [...expected.entries()].filter(([, times]) => times === 0).map(([key]) => key.split('\u0000')[0])
  assert.deepEqual(missing, [], `§G 漏了这些类：${missing.slice(0, 20).join(', ')}（共 ${missing.length} 个）`)
  const doubled = [...expected.entries()].filter(([, times]) => times > 1).map(([key]) => key.split('\u0000')[0])
  assert.deepEqual(doubled, [], `§G 有重复行：${doubled.join(', ')}`)
})

test('表头「当前已判 N 行」与四档和数都等于 §G 真实行数（不许提前写死 3247）', () => {
  const judged = verdict.match(/当前已判 \*\*(\d+)\*\* 行/)
  assert.ok(judged, '表头必须写「当前已判 **N** 行」')
  assert.equal(Number(judged[1]), rows.length, `表头写 ${judged[1]} 行，§G 实为 ${rows.length} 行`)
  const total = verdict.match(/四档合计 \*\*\[x\] (\d+) \+ \[~\] (\d+) \+ \[ \] (\d+) \+ \[-\] (\d+) = (\d+)\*\*/)
  assert.ok(total, '缺「四档合计 **[x] a + [~] b + [ ] c + [-] d = N**」那行')
  assert.equal(Number(total[1]), countOf('[x]'), '`[x]` 计数与 §G 不符')
  assert.equal(Number(total[2]), countOf('[~]'), '`[~]` 计数与 §G 不符')
  assert.equal(Number(total[3]), countOf('[ ]'), '`[ ]` 计数与 §G 不符')
  assert.equal(Number(total[4]), countOf('[-]'), '`[-]` 计数与 §G 不符')
  assert.equal(Number(total[5]), rows.length, '四档相加不等于已判行数')
  assert.equal(
    Number(total[1]) + Number(total[2]) + Number(total[3]) + Number(total[4]),
    Number(total[5]),
    '四档相加不等于表头总数',
  )
})

test('每个 [x]/[~] 行指到真实存在的 src/ 或 native/ 文件（防"注释里提过就算移植"）', () => {
  const referenced = []
  for (const row of rows) {
    if (row.verdict !== '[x]' && row.verdict !== '[~]') continue
    const paths = repoPaths(row.why)
    assert.ok(paths.length > 0, `${row.name} 判了 ${row.verdict} 却没指到任何实现文件`)
    referenced.push(...paths)
    if (row.verdict === '[~]') {
      assert.ok(/缺：|还差/u.test(row.why), `${row.name} 判 [~] 但没写「缺：」——部分移植要说清差哪一环`)
    }
  }
  const judgedBehavior = rows.filter(row => row.verdict === '[x]' || row.verdict === '[~]').length
  assert.ok(judgedBehavior >= 40, `本域只有 ${judgedBehavior} 条按行为判的 [x]/[~]，覆盖太薄（in_code 114 类应当多数落在这里）`)
  assert.ok(referenced.length >= judgedBehavior, `被检查的引用（${referenced.length}）比 [x]/[~] 行数（${judgedBehavior}）还少`)
  const ghost = referenced.filter(path => !existsSync(join(root, path)))
  assert.deepEqual(ghost, [], `判决引用了不存在的文件：${[...new Set(ghost)].join(', ')}`)
})

test('每条 [ ] 都写明缺哪一环（模型/校验/UI 行/宿主）', () => {
  const offenders = rows.filter(row => row.verdict === '[ ]' && !/缺：/u.test(row.why))
  assert.deepEqual(offenders.slice(0, 5).map(row => row.name), [], `这些 [ ] 行没写「缺：」：${offenders.length} 条`)
})

test('每条 [-] 都带具体理由标记，且标记与机械事实对得上', () => {
  const marker = /\[(上游测试类|上游测试源码集|上游生成物|控件本体|平台专属|无声明体 package-info)([^\]]{0,60})\]/u
  const offenders = []
  for (const row of rows) {
    if (row.verdict !== '[-]') continue
    const fact = factOf.get(`${row.name}\u0000${row.path}`)
    assert.ok(fact, `${row.name} 在机械事实表里没有行（无法核对 [-] 的理由）`)
    const found = row.why.match(marker)
    if (!found) {
      offenders.push(row.name)
      continue
    }
    const kind = found[1]
    if (kind === '上游测试类' || kind === '上游测试源码集') {
      // 「上游测试源码集」是 2026-10-06 与 b9 对账时补的标记：`test` 标记漏了
      // `plugins/junit/kotlin-tests-shared/test/...` 这类目录（实测 3 条），路径才是硬事实。
      // 两个标记都要机械事实认账：json 的 test 为真 **或** 枚举路径确在测试源码集里。
      assert.ok(
        fact.test === true || upstreamTestPath(row.path),
        `${row.name} 拿「${kind}」当理由，但既不在 json 的测试标记里，路径也不在测试源码集里`,
      )
    } else if (kind === '上游生成物') {
      // 生成码同样按磁盘事实核：路径在生成目录 **且** 基准树里那个文件确实带着生成器横幅。
      assert.ok(upstreamGenPath(row.path), `${row.name} 拿「上游生成物」当理由，但路径不在 /gen/ 一类的生成目录里`)
      const upstreamFile = join(upstreamRoot, row.path.split('/').join('\\'))
      assert.ok(existsSync(upstreamFile), `${row.name} 说是生成物，但基准树里没有 ${row.path}`)
      const head = readFileSync(upstreamFile, 'utf8').slice(0, 2000)
      // 生成器横幅有两种形态：protoc 的注释横幅（`Generated by the protocol buffer compiler` /
      // `DO NOT EDIT`）与 grpc 桩的导入面（`io.grpc` + `com.google.protobuf`，DaemonGrpc.java、
      // ProcessMediatorProtoGrpcKt.kt 属于后者）。两者都是磁盘上可读的结构事实，不是「不适用」三个字。
      assert.ok(
        /Generated by the protocol buffer compiler|DO NOT EDIT|javax\.annotation\.Generated|gRPC proto compiler|@generated|Code generated by|com\.google\.protobuf|io\.grpc\./iu.test(head),
        `${row.name} 说是生成物，但 ${row.path} 的前 2000 字里既没有生成器横幅也没有 protobuf/grpc 桩的导入面`,
      )
    } else if (kind === '无声明体 package-info') {
      assert.equal(fact.name, 'package-info', `${row.name} 不是 package-info，不能用这条理由`)
      assert.equal(fact.kind, 'unknown', `${row.name} 有类型声明，不能用「无声明体」这条理由`)
    } else if (kind === '控件本体') {
      assert.ok(isSwingBody(fact), `${row.name} 拿「控件本体」当理由，但 ${fact.kind} 不是 Swing 控件本体（§B 收紧后的判据）`)
      assert.ok(/本仓 DOM 落点/u.test(row.why), `${row.name} 判控件本体，必须写清行为由本仓哪个 DOM 落点承担`)
      const dom = repoPaths(row.why)
      assert.ok(dom.length > 0, `${row.name} 的 DOM 落点没有指到真实文件`)
      for (const path of dom) assert.ok(existsSync(join(root, path)), `${row.name} 的 DOM 落点不存在：${path}`)
    } else {
      assert.ok(fact.os === true, `${row.name} 拿「平台专属」当理由，但机械信号里没有 OS 专属证据`)
    }
    assert.ok(row.why.length >= 24, `${row.name} 的 [-] 理由太短：${row.why}`)
  }
  assert.deepEqual(offenders.slice(0, 10), [], `这些 [-] 行没有理由标记：${offenders.join(', ')}`)
})

test('§B 判据在全表生效：接口与抽象类（非测试）一律不许判 [-]', () => {
  const wrong = []
  for (const row of rows) {
    if (row.verdict !== '[-]') continue
    const fact = factOf.get(`${row.name}\u0000${row.path}`)
    // 豁免面 2026-10-06 起按路径扩到「测试源码集 / 生成目录」全集：
    // 这两类是机械硬标记（见 upstreamTestPath/upstreamGenPath 的注释与上一条用例的正向强制），
    // 不是「它是接口所以不适用」那种降级，所以放行它们不会让 §B 的收紧失效；
    // 反向验证：把 `SearchableConfigurable`（接口、非测试路径）改成 [-] → 本用例仍红。
    if (!fact || fact.test || upstreamTestPath(row.path) || upstreamGenPath(row.path)) continue
    if (fact.kind === 'interface' || fact.kind === 'abstract') wrong.push(`${row.name}(${fact.kind})`)
  }
  assert.deepEqual(wrong, [], `这些契约被「Swing 本体」旧规则误降为 [-]：${wrong.slice(0, 10).join(', ')}`)
})

test('上游测试源码集里的类一律 [-]', () => {
  const tests = factRows.filter(fact => fact.test)
  assert.ok(tests.length >= 100, `机械信号里 testSources 类应有 100 以上，实为 ${tests.length}`)
  for (const fact of tests) {
    const row = rows.find(candidate => candidate.name === fact.name && candidate.path === fact.path)
    assert.ok(row, `${fact.name} 在 §G 里没有行`)
    assert.equal(row.verdict, '[-]', `${fact.name} 是上游测试类，必须判 [-]`)
  }
})

test('路径即机械事实：测试源码集与生成目录里的每一行都必须判 [-]', () => {
  // 与 `tests/b9-verdict.test.mjs` 的同名口径合并到这一条：上面那条只覆盖 json 打了 test 的
  // 子集（实测 126 条），这里按**枚举清单里的路径**覆盖全集（126 + 漏的 3 + 生成码 34 + …）。
  // 这是新增的正向强制，不是放松：任何一行漏判都会红。
  const forced = rows.filter(row => upstreamTestPath(row.path) || upstreamGenPath(row.path))
  assert.ok(forced.length >= 150, `按路径算出的强制 [-] 只有 ${forced.length} 条，判据空转`)
  const wrong = forced.filter(row => row.verdict !== '[-]')
  assert.deepEqual(
    wrong.slice(0, 10).map(row => `${row.name} @ ${row.path} 判了 ${row.verdict}`),
    [],
    `这些上游测试源码/生成码没有判 [-]：共 ${wrong.length} 条`,
  )
})

test('§B 自证：把接口喂进「Swing 本体」判据，必须不被判 [-]', () => {
  const searchable = { name: 'SearchableConfigurable', kind: 'interface', widget: true, paint: false, test: false, os: false }
  const editor = { name: 'SettingsEditor', kind: 'interface', widget: true, paint: false, test: false, os: false }
  const abstract = { name: 'RunnerAndConfigurationSettingsEditor', kind: 'abstract', widget: true, paint: true, test: false, os: false }
  assert.equal(isSwingBody(searchable), false, '接口只是签名里引用 JComponent，不能算控件本体')
  assert.equal(isSwingBody(editor), false, 'SettingsEditor 是设置页契约，不能算控件本体')
  assert.equal(isSwingBody(abstract), false, '抽象类按行为判，不算控件本体')
  const realPanel = { name: 'MethodListDlg', kind: 'class', widget: true, paint: false, test: false, os: false }
  const painted = { name: 'Some自绘', kind: 'class', widget: false, paint: true, test: false, os: false }
  assert.equal(isSwingBody(realPanel), true, '具体类继承 JPanel 就是控件本体')
  assert.equal(isSwingBody(painted), true, '具体类自绘 paintComponent 就是控件本体')
  // 真表里那两条被误降的契约要站回行为档
  for (const name of ['SearchableConfigurable', 'SettingsEditor']) {
    const row = rows.find(candidate => candidate.name === name)
    assert.ok(row, `§G 缺 ${name} 行`)
    assert.notEqual(row.verdict, '[-]', `${name} 又被判成 [-] 了：§B 的收紧白做`)
  }
})

test('§C 的上游依据都能指到基准树的真实行号', () => {
  const start = verdict.indexOf('## C.')
  assert.ok(start >= 0, '缺 §C')
  const end = verdict.indexOf('## D.', start)
  assert.ok(end > start, '§C 后面没有 §D')
  const section = verdict.slice(start, end)
  const cites = [...section.matchAll(/`([A-Za-z0-9_\-./]+?\.(?:java|kt)):(\d+)(?:-\d+)?`/gu)]
  assert.ok(cites.length >= 20, `§C 的上游引文只有 ${cites.length} 条，太薄`)
  for (const cite of cites) {
    const file = join(upstreamRoot, cite[1].split('/').join('\\'))
    if (!existsSync(file)) {
      assert.ok(/无法核实/u.test(section), `§C 引了不存在的上游文件 ${cite[1]}，又没写「无法核实」`)
      continue
    }
    const lines = readFileSync(file, 'utf8').split('\n').length
    assert.ok(Number(cite[2]) <= lines, `§C 的行号越界：${cite[1]}:${cite[2]}（该文件 ${lines} 行）`)
  }
  assert.match(section, /缺键补默认|缺键补默认值/u, '§C 要写明持久化口径：新增设置为缺失键补默认值，不按键数判存档损坏')
  assert.match(section, /无法核实/u, '§C 要如实标出核实不了的条目')
})

test('七个必备小节齐全（§0 机械信号 / §A-D 分档 / §E 诚实未做 / §G 逐类表）', () => {
  for (const heading of [
    '## 0. 机械信号总账',
    '## A. 已移植',
    '## B. 部分移植',
    '## C. 未移植与缺失设置项',
    '## D. 不适用',
    '## E. 诚实未做',
    '## G. 逐条总表',
  ]) {
    assert.ok(verdict.includes(heading), `缺小节：${heading}`)
  }
  const d = verdict.slice(verdict.indexOf('## D.'), verdict.indexOf('## E.'))
  for (const tag of ['[上游测试类]', '[上游测试源码集]', '[上游生成物]', '[控件本体', '[平台专属', '[无声明体 package-info]']) assert.ok(d.includes(tag), `§D 的判据目录缺理由标记 ${tag}`)
  const e = verdict.slice(verdict.indexOf('## E.'), verdict.indexOf('## G.'))
  assert.match(e, /未做|不做/u)
  assert.ok(e.split('\n').filter(line => line.startsWith('- ')).length >= 2, '§E 至少写清两条如实不做/未做的部分')
})
