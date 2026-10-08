// 「这个文件支持哪些语言服务特性」那张表的判据（`src/lspPerFileCapabilities.ts`）。
//
// 上游依据（本轮逐条打开核对过，路径与行号都在参考树里存在）：
//   · `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:58`
//     声明 `isSupportedForFile(file)`，`:62-63` 在 `getHighlightings()` 的**第一行**问它，
//     不过就 `return emptyList()` —— 所以"先查表再发"是发请求**之前**的一步，不是拿到失败结果之后的补救；
//   · `platform/lsp-impl/src/impl/LspClientImpl.kt:425-509` 那 17 个 `supports*(file)`：每条都是
//     「服务器级 capabilities」**或**「这条能力的动态注册命中了这个文件」
//     （`:612-615` → `:617-620` → `:623-626`，注释 `:622` 写明没有 documentSelector 的注册匹配任何文件）
//     —— **两种粒度不能混**，本文件第 6 条判据钉的就是这一条；
//   · `platform/lang-impl/src/com/intellij/codeInsight/daemon/impl/analysis/HighlightingSettingsPerFile.java:45-53`
//     把"这个文件跑不跑分析"按 URL 存成一张表，`:200-202` 的 `shouldHighlight` 是本仓
//     「逐文件高亮级别 = 无」那道闸的上游原型。
//
// 判据的口径（派单点名的那条陷阱）：**不止测表本身**。每一条都驱动一个真实出口
// （假 request 的往返计数、Code Vision 通道的抓取、两个编辑器控制器的接线位置），
// 所以"表写错了"必然表现为"多发/少发了请求、旧装饰没撤"，而不是只有一个布尔值变了。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  lspFileFeatures,
  lspLanguageOfPath,
  PerFileFeatureTable,
} from '../src/lspPerFileCapabilities.ts'
import { clearAllLspCaches, lspCacheCount } from '../src/lspPerFileCache.ts'
import { clearHighlightLevels, setHighlightLevelForPath } from '../src/highlightSettingsPerFile.ts'
import { createCodeVisionLocalChannel } from '../src/cvLocalVision.ts'

/** 宿主 `Session::language_for`（`native/lsp_session.cpp:20-38`）里的 `if (extension == "x") return "y";`。 */
/** @returns {Map<string,string>} 扩展名 → 语言 id */
function hostLanguageTable() {
  const source = readFileSync('native/lsp_session.cpp', 'utf8')
  const start = source.indexOf('std::string Session::language_for')
  assert.ok(start >= 0, 'native/lsp_session.cpp 里必须还有 Session::language_for')
  const body = source.slice(start, source.indexOf('\n}', start))
  const found = new Map()
  for (const match of body.matchAll(/extension == "([^"]+)"\) return "([^"]+)"/g)) found.set(match[1], match[2])
  assert.ok(found.size >= 15, `只解析出 ${found.size} 条，解析方式一定漂了`)
  return found
}

/** 一条宿主形状的拒绝（`src/bridge.ts:893` 把 `reply.error.code` 装进 `BridgeError.code`）。 */
const declined = (message = '服务器未声明该 provider') => Object.assign(new Error(message), { code: 'LSP_UNSUPPORTED' })
const withCode = code => Object.assign(new Error(code), { code })

/** 真正发出去的次数 = 表放行的次数（这就是"行为"，不是表的布尔值）。 */
function counter() {
  const sent = []
  return {
    sent,
    count: kind => (kind ? sent.filter(entry => entry === kind).length : sent.length),
    execute(kind, behavior) {
      sent.push(kind)
      const value = behavior()
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
    },
  }
}

test.after(clearHighlightLevels)

test('1 能力表里没登记的特性：一道闸都到不了服务器', async () => {
  const table = new PerFileFeatureTable()
  const fake = counter()
  const blocked = table.plan('noSuchHighlightingFeature', 'src/Alpha.java')
  assert.equal(blocked.ask, false)
  assert.equal(blocked.skip, 'featureNotDeclared')
  const attempt = await table.ask('noSuchHighlightingFeature', 'src/Alpha.java',
    () => fake.execute('noSuchHighlightingFeature', () => ({ available: true })))
  assert.equal(attempt.asked, false, '没登记的特性名也被发出去了')
  assert.equal(fake.count(), 0, '表拦下了却还是有往返 —— 计数判据不成立')
})

test('2 逐文件高亮级别「无」⇒ 画在这个文件上的两族不再发请求；导航类照发', async () => {
  const table = new PerFileFeatureTable()
  const fake = counter()
  setHighlightLevelForPath('src/Alpha.java', 'none')
  for (const kind of ['documentHighlight', 'inlayHint']) {
    const attempt = await table.ask(kind, 'src/Alpha.java', () => fake.execute(kind, () => ({ available: true })))
    assert.equal(attempt.asked, false, `${kind} 在「无」档文件上仍被问`)
    assert.equal(attempt.skip, 'fileExcluded')
  }
  assert.equal(fake.count(), 0, '「无」档的文件还在发装饰类请求 ⇒ 级别设置等于没生效')
  // 结构/导航不在这一档：上游的 NONE 只停高亮与检查（`HighlightingSettingsPerFile.java:200-209`）。
  assert.equal(table.plan('documentSymbol', 'src/Alpha.java').ask, true)
  await table.ask('documentSymbol', 'src/Alpha.java', () => fake.execute('documentSymbol', () => ({ available: true })))
  assert.deepEqual(fake.sent, ['documentSymbol'])
  setHighlightLevelForPath('src/Alpha.java', 'inspections')
  assert.equal(table.plan('documentHighlight', 'src/Alpha.java').ask, true, '改回默认档之后必须重新能问')
})

test('3 服务器显式拒过一次（LSP_UNSUPPORTED）⇒ 同语言的每个文件都不再问，换语言照问', async () => {
  const table = new PerFileFeatureTable()
  const fake = counter()
  const ask = (path) => table.ask('inlayHint', path, () => fake.execute('inlayHint', () => declined()))
  const first = await ask('src/Alpha.java')
  assert.equal(first.asked, true, '第一次必须真的发出去（不然是靠猜而不是靠回包记账）')
  assert.equal(first.ok, false)
  assert.equal(fake.count(), 1)
  const second = await ask('src/Beta.java')
  assert.equal(second.asked, false)
  assert.equal(second.skip, 'serverDeclined')
  assert.equal(fake.count(), 1, '同语言的第二个文件又撞了一次同一扇关着的门')
  // 服务器级那一格的键是**语言**：`.ts` 走另一台服务器，必须还能问。
  await ask('src/app.ts')
  assert.equal(fake.count('inlayHint'), 2, 'typescript 那台服务器被 java 那台的拒绝连坐了')
  assert.equal(table.plan('documentSymbol', 'src/Alpha.java').ask, true, '同一台服务器只关了这一族，别的特性不该跟着停')
})

test('4 嵌套能力用回包说「不支持」（{available:false,supported:false}）也算一次确定的拒绝', async () => {
  const table = new PerFileFeatureTable()
  const fake = counter()
  const ask = (path) => table.ask('prepareRename', path,
    () => fake.execute('prepareRename', () => ({ available: false, supported: false })))
  const first = await ask('src/Alpha.java')
  assert.equal(first.ok, true, '这条回包本身是成功回包，调用方还要读它')
  assert.equal(fake.count(), 1)
  await ask('src/Beta.java')
  assert.equal(fake.count(), 1, '宿主用 `supported:false` 表达过的拒绝没被记下（见 lsp_session_kinds.cpp:83-85 那一条路径）')
})

test('5 只有"确定的拒绝"才记：失败/文档没开/服务器没起都必须下一拍再问', async () => {
  for (const code of ['LSP_FAILED', 'LSP_CLOSED', 'LSP_UNAVAILABLE', 'DESKTOP_REQUIRED']) {
    const table = new PerFileFeatureTable()
    const fake = counter()
    const ask = () => table.ask('inlayHint', 'src/Alpha.java', () => fake.execute('inlayHint', () => withCode(code)))
    await ask()
    await ask()
    assert.equal(fake.count(), 2, `${code} 被当成能力拒绝了 —— 一次抖动就把这条能力判死到下次重启`)
  }
})

test('6 粒度不混：重启清掉服务器级记忆，但动不了用户的逐文件级别', () => {
  const table = new PerFileFeatureTable()
  table.noteServerDeclined('inlayHint', 'src/Alpha.java')
  setHighlightLevelForPath('src/Beta.java', 'none')
  assert.equal(table.plan('inlayHint', 'src/Alpha.java').ask, false)
  assert.equal(table.plan('documentHighlight', 'src/Beta.java').ask, false)
  table.clearCache()
  assert.equal(table.plan('inlayHint', 'src/Alpha.java').ask, true, '重启之后必须重新问一次这台新服务器')
  assert.equal(table.plan('documentHighlight', 'src/Beta.java').ask, false,
    '重启把用户的「这个文件不显示任何高亮」也清了 —— 那是工程级设置，跟客户端生命周期无关')
  clearHighlightLevels()
})

test('7 批量作废的接线：构造即登记，clearAllLspCaches() 真的清到这一张表', async () => {
  const table = new PerFileFeatureTable()
  const fake = counter()
  table.noteServerDeclined('inlayHint', 'src/Alpha.java')
  assert.ok(lspCacheCount() >= 1, '这张表没参与整批作废的注册')
  assert.ok(clearAllLspCaches() >= 1)
  const attempt = await table.ask('inlayHint', 'src/Alpha.java', () => fake.execute('inlayHint', () => ({ available: true })))
  assert.equal(attempt.asked, true,
    '语言服务重启 / 服务器发 workspace/…/refresh 之后还端着"这台不支持"的旧结论 —— 新服务器给的答案被永久挡掉')
  assert.equal(fake.count(), 1)
})

test('8 语言镜像与宿主那张表逐条一致（键记错等于没记）', () => {
  for (const [extension, language] of hostLanguageTable()) {
    assert.equal(lspLanguageOfPath(`src/dir/File.${extension}`), language, `.${extension} 该走 ${language} 那台服务器`)
  }
  assert.equal(lspLanguageOfPath('readme.md'), 'md', '认不出的扩展名按扩展名本身（宿主同一条兜底）')
  assert.equal(lspLanguageOfPath('src\\Alpha.java'), 'java', 'Windows 分隔符也得认（本仓路径口径是 /，但输入不保证）')
  assert.equal(lspLanguageOfPath(''), '', '空路径不该凭空造出一台服务器')
})

test('9 端到端（Code Vision 通道）：第一次被拒之后，第二轮一次都不问', async () => {
  const calls = []
  const request = async (_method, params) => {
    calls.push(params.kind)
    if (params.kind === 'documentSymbol') throw declined()
    return { available: false }
  }
  lspFileFeatures.clearCache()
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Gamma.java' })
  await channel.refresh()
  assert.deepEqual(calls, ['documentSymbol'], '第一轮就该问一次结构符号')
  await channel.refresh()
  assert.equal(calls.length, 1, `被拒之后第二轮又问了 ${calls.length - 1} 次 —— 这次拒绝没进表`)
  assert.deepEqual(channel.entries(), [], '没问到事实就不该凭空有条目')
})

test('10 端到端（Code Vision 通道）：「无」档不影响导航类请求，问到的计数照样成条目', async () => {
  const calls = []
  const request = async (_method, params) => {
    calls.push(params.kind)
    if (params.kind === 'documentSymbol') {
      return { available: true, symbols: [{ name: 'Gamma', kind: 5, startLine: 0, startChar: 6, endLine: 4, endChar: 1 }] }
    }
    if (params.kind === 'references') return { available: true, refs: [{ path: 'src/Other.java', line: 3, character: 2 }] }
    return { available: false }
  }
  lspFileFeatures.clearCache()
  setHighlightLevelForPath('src/Gamma.java', 'none')
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Gamma.java' })
  await channel.refresh()
  clearHighlightLevels()
  assert.equal(calls.filter(kind => kind === 'documentSymbol').length, 1, '结构符号是导航类，不该被高亮级别停掉')
  assert.equal(calls.filter(kind => kind === 'references').length, 1, '用法数同理')
  assert.ok(channel.entries().length >= 1, '问到了计数就必须有条目（挡错方向会把 Code Vision 整族弄没）')
})

test('11 两个编辑器控制器把闸装在发请求之前，并且被拦下那一支撤旧装饰', () => {
  const cases = [
    ['src/editorSymbolHighlight.ts', 'documentHighlight'],
    ['src/editorInlayHints.ts', 'inlayHint'],
  ]
  for (const [file, kind] of cases) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /from '\.\/lspPerFileCapabilities\.ts'/, `${file} 没接这张表`)
    assert.ok(source.includes(`lspFileFeatures.ask<`), `${file} 里没找到 lspFileFeatures.ask(...)`)
    assert.ok(source.includes(`'${kind}'`), `${file} 没登记 ${kind} 这一族`)
    assert.ok(source.indexOf(`ask<`) < source.indexOf(`'lsp.request'`), `${file}：查表必须在发请求之前`)
    // 被拦下那一支（asked:false）必须撤掉已画的装饰，留着就是一条"这个文件不要、屏幕上还画着"的旧标记。
    assert.match(source, /if \(!attempt\.asked\) \{[\s\S]{0,200}?clear\(\)/, `${file}：被表拦下时没撤掉已画的装饰`)
  }
})

test('12 Code Vision 的抓取层四处都走这一张表（不是只在一处挡）', () => {
  const source = readFileSync('src/cvLocalVision.ts', 'utf8')
  assert.match(source, /from '\.\/lspPerFileCapabilities\.ts'/)
  // 必须是**活的那一行**（行首只有缩进）在调 ask，注释掉的副本不算接上。
  for (const [kind, reply] of [['documentSymbol', 'OutlineReply'], ['references', 'LocationReply'],
    ['prepareTypeHierarchy', 'HierarchyReply'], ['typeHierarchySubtypes', 'HierarchyReply']]) {
    assert.match(source, new RegExp(`^\\s*(?:const|let)\\s+\\w+\\s*=\\s*await lspFileFeatures\\.ask<${reply}>\\('${kind}'`, 'm'),
      `${kind} 那一跳没走表`)
  }
})
