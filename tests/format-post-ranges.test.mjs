// csi/formatter ④ 与 `lp/formatting` 的「后处理只跑启用段」判据。
//
// 上游出处（本轮逐行读过，路径按参考树根 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · `platform/code-style-impl/src/com/intellij/psi/impl/source/codeStyle/CoreCodeStyleUtil.java:121-142`
//     —— `postProcessText` 在 `FORMATTER_TAGS_ENABLED` 为真时走 `postProcessEnabledRanges`，
//     每个启用段单独处理、后面的段按前面累计的长度差平移；
//   · `platform/code-style-api/src/com/intellij/psi/codeStyle/CodeStyleSettings.java:468`
//     —— `FORMATTER_TAGS_ENABLED = true`（默认就是「标记生效」）；
//   · `platform/code-style-impl/src/com/intellij/formatting/service/CoreFormattingService.java:68-74`
//     —— 重排完再对**本次重排的区间**做后处理（区间靠 `RangeFormatInfo` 的智能指针在改动后重取）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enabledRanges, hasFormatterTags } from '../src/formatterTags.ts'
import { enabledProcessingRanges, postFormatRegions, processFormattedText, processLineCommentAddSpace, shiftRangesThroughEdits } from '../src/postFormatProcessors.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = name => readFileSync(join(here, '..', 'src', name), 'utf8')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const refLines = path => readFileSync(join(REF, path), 'utf8').split('\n')

/** 后处理设置：补空格开着、空行上限放到很大（这一族只测「启用段」这一件事）。 */
const SETTINGS = { lineCommentAddSpaceOnReformat: true, keepBlankLines: 99, lineCommentPrefixes: ['//'] }

// ---------------------------------------------------------------- 上游锚点（能失败：行号漂了就用例红）

test('上游锚点：后处理只跑启用段那一段仍然在 CoreCodeStyleUtil.java:121-142', async () => {
  const ref = join(REF, 'platform/code-style-impl/src/com/intellij/psi/impl/source/codeStyle/CoreCodeStyleUtil.java')
  if (!existsSync(ref)) return  // 参考树不在本机 ⇒ 与 tests/source-citations.test.mjs 同样跳过
  const body = (await import('node:fs')).readFileSync(ref, 'utf8').split('\n')
  assert.match(body[120], /postProcessText\(/, ':121 必须还是 postProcessText')
  assert.match(body[122], /FORMATTER_TAGS_ENABLED/, ':123 仍按标记开关分岔')
  assert.match(body[126], /postProcessEnabledRanges/, ':127 开关为真时走启用段那一支')
  assert.match(body[134], /getEnabledRanges/, ':135 仍是 FormatterTagHandler.getEnabledRanges')
  assert.match(body[139], /processedRange\.getLength\(\) - enabledRange\.getLength\(\)/, ':140 仍是 delta 平移')
  const settings = body.length ? refLines('platform/code-style-api/src/com/intellij/psi/codeStyle/CodeStyleSettings.java') : []
  assert.match(settings[467], /FORMATTER_TAGS_ENABLED = true/, ':468 默认仍是 true')
})

// ---------------------------------------------------------------- enabledProcessingRanges

test('enabledProcessingRanges：文件里没有标记时按整份文本（上游 !FORMATTER_TAGS_ENABLED 同效）', () => {
  const text = 'const a = 1\nconst b = 2\n'
  assert.equal(hasFormatterTags(text), false)
  assert.deepEqual(enabledProcessingRanges(text, []), [{ start: 0, end: text.length }])
})

test('enabledProcessingRanges：只给出启用段，禁用段一个字节都不在结果里', () => {
  const text = ['// 头部', 'let a = 1', '// @formatter:off', 'let   b   = 2', '// @formatter:on', 'let c = 3', ''].join('\n')
  const off = text.indexOf('// @formatter:off')
  const on = text.indexOf('// @formatter:on')
  const parts = enabledProcessingRanges(text, [])
  assert.equal(parts.length, 2)
  assert.equal(parts[0].start, 0)
  assert.equal(parts[0].end, off)                       // 第一段止于 off 行的行首
  assert.equal(parts[1].start, on)                      // 第二段从 on 行的行首重新开始
  assert.equal(parts[1].end, text.length)
  assert.equal(parts.every(part => part.end <= off || part.start >= on), true)
})

test('enabledProcessingRanges：待重排区间与启用段取交集（选区只覆盖半个文件时）', () => {
  const text = ['let a = 1', '// @formatter:off', 'let b = 2', '// @formatter:on', 'let c = 3', ''].join('\n')
  const on = text.indexOf('// @formatter:on')
  const selection = { start: text.indexOf('let a'), end: text.indexOf('let b = 2') + 6 }
  const parts = enabledProcessingRanges(text, [selection])
  // 选区里唯一仍可格式化的那一截 = 文件头到 off 行行首
  assert.deepEqual(parts, [{ start: selection.start, end: text.indexOf('// @formatter:off') }])
  assert.equal(parts[0].end < on, true)
})

test('enabledProcessingRanges：整段落在禁用区里 ⇒ 空数组（后处理什么都不能改）', () => {
  const text = ['// @formatter:off', 'let   a   = 1', 'let   b   = 2', '// @formatter:on', ''].join('\n')
  const inside = { start: text.indexOf('let   a'), end: text.indexOf('let   b') + 11 }
  assert.deepEqual(enabledProcessingRanges(text, [inside]), [])
})

// ---------------------------------------------------------------- 后处理落在禁用段上（本轮修掉的真实缺陷）

test('processFormattedText：@formatter:off 段里的行注释不补空格，段外的照补（:121-142）', () => {
  const text = ['//one', '// @formatter:off', '//two', '// @formatter:on', '//three', ''].join('\n')
  const result = processFormattedText(text, [], SETTINGS, { line: '//' })
  assert.equal(result.inserted, 2, '只该补段外那两条（//one 与 //three）')
  assert.equal(result.text.split('\n')[0], '// one')
  assert.equal(result.text.split('\n')[2], '//two', '禁用段里的那条必须一个字没变')
  assert.equal(result.text.split('\n')[4], '// three')
})

test('processFormattedText：注入违规可检 —— 不切启用段就直接改到禁用段', () => {
  const text = ['// @formatter:off', '//keep', '// @formatter:on', ''].join('\n')
  // 本轮之前的口径：调用方把整份文本的区间交给处理器（`processLineCommentAddSpace(next, {0, len})`）。
  // 这一条钉的是「那个入口已经没了」+「现在这个入口切段」，两者缺一即红。
  const naive = processLineCommentAddSpace(text, { start: 0, end: text.length }, SETTINGS)
  assert.equal(naive.inserted, 1, '整份文本一遍扫会补到禁用段里那条注释')
  assert.notEqual(naive.text, text)
  const gated = processFormattedText(text, [], SETTINGS, { line: '//' })
  assert.equal(gated.inserted, 0)
  assert.equal(gated.text, text)
})

test('processFormattedText：多段各自处理，靠前的段不受后面段的长度变化影响（:136-140 的 delta）', () => {
  const text = ['//a', '', '// @formatter:off', '// ignored', '// @formatter:on', '//b', '', '//c', ''].join('\n')
  const settings = { ...SETTINGS, keepBlankLines: 0 }
  const result = processFormattedText(text, [], settings, { line: '//' })
  const lines = result.text.split('\n')
  assert.equal(lines[0], '// a')                        // 第一段：补了空格
  assert.ok(result.text.indexOf('// ignored') > 0, '禁用段原样保留')
  assert.ok(result.text.indexOf('// a') < result.text.indexOf('// @formatter:off'))
  assert.equal(result.inserted, 3, '//a、//b、//c 三条段内注释都补了空格')
  // 只有「两侧都有内容行」的那一段空行被并掉；第一段末尾那条空行右边是禁用段（不在启用段内）⇒ 保守不动
  assert.equal(result.collapsed, 1)
  assert.equal(lines[1], '', '启用段边界上的空行仍在（没被后一段的删除波及）')
})

test('processFormattedText：设置全关时原样返回（默认 LINE_COMMENT_ADD_SPACE_ON_REFORMAT = false）', () => {
  const text = '//x\n// @formatter:off\n//y\n'
  const result = processFormattedText(text, [], { ...SETTINGS, lineCommentAddSpaceOnReformat: false, keepBlankLines: 99 }, { line: '//' })
  assert.deepEqual(result, { text, inserted: 0, collapsed: 0, leading: 0 })
})

// ---------------------------------------------------------------- 区间换算（没有智能指针的等价物）

test('postFormatRegions / shiftRangesThroughEdits：插入把区间整体右移，删除把区间缩短', () => {
  const text = 'let a = 1\nlet b = 2\nlet c = 3\n'
  const region = { start: text.indexOf('let b'), end: text.length }
  // 服务器在文件头插了 6 个字符（`\r` 无关），区间端点得跟着右移
  const inserted = [{ startLine: 0, startChar: 0, endLine: 0, endChar: 0, text: '/* x */\n' }]
  const shifted = shiftRangesThroughEdits(text, inserted, [region])
  assert.deepEqual(shifted, [{ start: region.start + 8, end: text.length + 8 }])
  // 删掉第一条语句 ⇒ 区间起点跟着被删区间的起点走，终点左移
  const deleted = [{ startLine: 0, startChar: 0, endLine: 1, endChar: 0, text: '' }]
  const after = shiftRangesThroughEdits(text, deleted, [region])
  assert.deepEqual(after, [{ start: 0, end: text.length - 10 }])
})

test('shiftRangesThroughEdits：端点落在被替换区间内部时夹到区间起点（那段内容已经不在了）', () => {
  const text = 'aaa bbb ccc'
  const edit = [{ startLine: 0, startChar: 4, endLine: 0, endChar: 7, text: 'B' }]
  assert.deepEqual(shiftRangesThroughEdits(text, edit, [{ start: 0, end: 5 }]), [{ start: 0, end: 4 }])
  assert.deepEqual(shiftRangesThroughEdits(text, edit, [{ start: 6, end: 11 }]), [{ start: 4, end: 9 }])
})

test('postFormatRegions：不传区间 = 整份文本换算到改动后坐标系', () => {
  const text = 'one\ntwo\n'
  const regions = postFormatRegions(text, [], [])
  assert.deepEqual(regions, [{ start: 0, end: text.length }])
  const edits = [{ startLine: 0, startChar: 3, endLine: 0, endChar: 4, text: '' }]   // 删掉 'e'
  assert.deepEqual(postFormatRegions(text, edits, []), [{ start: 0, end: text.length - 1 }])
})

// ---------------------------------------------------------------- 接线（消费链路真的在）

test('接线：runFormatting 走 processFormattedText，并把本次重排的区间换算过去', () => {
  const source = read('semanticActions.ts')
  assert.match(source, /import \{ postFormatRegions, processFormattedText \} from '\.\/postFormatProcessors\.ts'/)
  assert.match(source, /const processed = processFormattedText\(next, regions, postFormatSettings\.value, commentStyleFor\(undefined, file\.path\)\)/)
  assert.match(source, /postFormatRegions\(base, edits, range \? \(subRanges\.length \? subRanges : \[range\]\) : \[\]/)
  // 旧的整份文本一遍扫必须彻底消失（那正是本轮修的缺陷）
  assert.equal(source.includes('processLineCommentAddSpace(next, { start: 0, end: next.length }'), false)
})

test('接线：保存时格式化那条链也走同一套本地闸（准入 + 禁用段 + 后处理）', () => {
  const source = read('actionsOnSave.ts')
  assert.match(source, /if \(formattingRestrictionFor\(input\.path, \{ patterns: input\.excludedPatterns \}\)\) return \{ content: input\.content, changed: false \}/)
  assert.match(source, /const edits = filterFormatEdits\(input\.content, file\.textEdits\)/)
  assert.match(source, /processFormattedText\(\s*applied, \[\],\s*input\.postFormat \?\? postFormatSettings\.value, commentStyleFor\(undefined, input\.path\),?\s*\)/)
  // 不许留「直接 applyTextEdits(input.content, file.textEdits)」那条旧路径
  assert.equal(source.includes('applyTextEdits(input.content, file.textEdits)'), false)
})

test('接线：两条链共用同一份后处理实现（不出现第二份规则）', () => {
  const consumers = ['semanticActions.ts', 'actionsOnSave.ts'].filter(name => read(name).includes('processFormattedText('))
  assert.deepEqual(consumers, ['semanticActions.ts', 'actionsOnSave.ts'])
  // 规则只在 postFormatProcessors.ts 里有一份实现
  const source = read('postFormatProcessors.ts')
  assert.equal((source.match(/export function processFormattedText/g) ?? []).length, 1)
})

// ---------------------------------------------------------------- 越过被改短的文本：行扫描器的收口
//
// refactor1 临终那句「行扫描器在范围越过被改短的文本时会无限循环」——**本轮自己复现了，是真的**，
// 但触发条件与收口位置都要按实测写清（坐标与探针都在下）：
//   · HEAD（`git show HEAD:src/postFormatProcessors.ts` 的 `nextLineStart`，越界时返回**常量**
//     `text.length + 1`）：一旦 `range.end >= text.length + 1`，`position` 就停在那个常量上不再前进，
//     `for (position <= range.end)` 永不收口 ⇒ **真无限循环**。
//     探针（本轮实跑，不靠嘴说）：`text = '//a\n//b\n\n\n\nc\n'`（13 字节）、`end = text.length + 2`
//     时迭代 200 万轮仍未停；`end = text.length` 时 3 轮就停 ⇒ 旧调用点（整份文本）碰不到，
//     越界才碰得到 —— 「潜伏」二字是准确的，缺陷本身不是。
//   · 工作区里 refactor1 已把收口值改成「严格前进」（`from + 1`）：**会停**，但端点越界多少个偏移
//     就空转多少轮 ⇒ `end = 1e8` 是「名义有限、实际挂死」。这只算半修。
//   · 根因不在收口值，在**扫描上界取了调用方的 `range.end`**：`lineCommentInsertOffsets` 现在把上界
//     钳到 `text.length`（`processLineCommentAddSpace` 是**导出**入口，`processFormattedText` 之外
//     没人保证端点合法）。越界那几轮本来就产不出偏移（`rest` 是空串 ⇒ 任何前缀都不匹配），
//     钳完**输出逐字节不变** —— 这一点由下面四档「越界 == 合法端点」的等式钉住。
//
// 判据为什么走 **worker 线程 + 硬预算**：这几档在旧实现下是「挂死」而不是「返回错值」，放在测试
// 主线程里跑会把整条测试链一起带走（本轮实测：HEAD 那版在 `end = text.length + 2` 上跑 200 万轮
// 仍不停）。worker 可以 `terminate()` —— 它能打断正在死循环的 JS，所以预算到点就把这一档判红，
// 测试机自己不会挂。探针同时要输出八档结果，主线程逐字段比 ⇒ 不是「没挂就算过」。
const SCANNER_PROBE_TEXT = '//a\n//b\n\n\n\nc\n'
const SCANNER_PROBE_SOURCE = [
  "import { parentPort } from 'node:worker_threads'",
  // 子线程里不能用相对路径（没有「本文件」这个 baseURL），把 .ts 的绝对 file URL 写死进去。
  `const m = await import(${JSON.stringify(new URL('../src/postFormatProcessors.ts', import.meta.url).href)})`,
  "const text = '//a\\n//b\\n\\n\\n\\nc\\n'",
  // 链内那一档：`processFormattedText` 里「空行上限」先把文本改短，随后「补空格」拿到的还是
  // **改短之前**的区间 —— 这就是 HEAD 版扫描器挂死的真入口（本轮实测：整份测试文件 40 秒出不来）。
  "const chained = ['//a', '', '// @formatter:off', '// ignored', '// @formatter:on', '//b', '', '//c', ''].join('\\n')",
  "const settings = { lineCommentAddSpaceOnReformat: true, keepBlankLines: 2, lineCommentPrefixes: ['//'] }",
  "const zeroKeep = { lineCommentAddSpaceOnReformat: true, keepBlankLines: 0, lineCommentPrefixes: ['//'] }",
  "const style = { line: '//' }",
  'parentPort.postMessage({',
  '  chainedZeroKeep: m.processFormattedText(chained, [], zeroKeep, style),',
  '  addSpaceRef: m.processLineCommentAddSpace(text, { start: 0, end: text.length }, settings),',
  '  addSpaceJustPast: m.processLineCommentAddSpace(text, { start: 0, end: text.length + 2 }, settings),',
  '  addSpaceFarPast: m.processLineCommentAddSpace(text, { start: 0, end: 1e8 }, settings),',
  '  addSpaceStartPast: m.processLineCommentAddSpace(text, { start: text.length + 4, end: 1e8 }, settings),',
  '  blanksRef: m.processKeepBlankLines(text, { start: 0, end: text.length }, 2, null),',
  '  blanksFarPast: m.processKeepBlankLines(text, { start: 0, end: 1e8 }, 2, null),',
  '  formattedRef: m.processFormattedText(text, [{ start: 0, end: text.length }], settings, style),',
  '  formattedFarPast: m.processFormattedText(text, [{ start: 0, end: 1e8 }], settings, style),',
  '})',
].join('\n')

/** 在 worker 里跑探针；`budgetMs` 内没回消息就 terminate 掉并回报超时。 */
function scannerProbe(budgetMs) {
  return new Promise(resolve => {
    const worker = new Worker(SCANNER_PROBE_SOURCE, { type: 'module', eval: true })
    // 挂死保护的真正来源是 **worker + terminate()**（能打断正在死循环的 JS，本轮实测：预算 4 秒到点
    // 就把这一档判红，进程 4.2 秒收尾），`unref()` 只是补一刀：主线程不等这个线程退出就能收工。
    // 留档一句实测过程：一开始这条判据在「HEAD 那版」上确实把整个测试文件拖到 60 秒不退出 ——
    // 但挂的**不是**这条判据，是同文件里那条**在主线程**跑 `processFormattedText` 的旧用例
    // （「多段各自处理」，它正好经过上面那个「区间越过被改短的文本」的路径）；
    // 补上 `processFormattedText` 里的那道重算闸之后，同一退回档 4.2 秒就全红了。
    worker.unref()
    let settled = false
    const stop = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate().catch(() => undefined)
      resolve(value)
    }
    const timer = setTimeout(() => stop({ timedOut: true }), budgetMs)
    worker.once('message', message => stop({ message }))
    worker.once('error', error => stop({ error: String(error?.message ?? error) }))
  })
}

test('行扫描器：区间越过被改短的文本时收得住口，也不为空内容转圈（worker + 4 秒硬预算）', async () => {
  const probe = await scannerProbe(4000)
  assert.equal(probe.error, undefined, `探针 worker 自己报错了：${probe.error}`)
  assert.equal(probe.timedOut, undefined,
    '探针 worker 4 秒没跑完 ⇒ 扫描器在越界区间上收不了口（HEAD 的常量收口 = 真无限循环；'
    + '只把收口改成「严格前进」的半修 = 一亿轮空转，两种都走这一支）')
  const out = probe.message
  // ⓪ 链内那一档（真入口）：`processFormattedText` 里空行先改短文本、补空格后跑 —— 这一档在
  //    HEAD 的扫描器上是**挂死**的那一条，现在必须跑完并且给出正确结果。
  assert.deepEqual(out.chainedZeroKeep, {
    text: '// a\n\n// @formatter:off\n// ignored\n// @formatter:on\n// b\n// c\n',
    inserted: 3, collapsed: 1, leading: 0,
  }, '禁用段原样、段外三条补空格、只并掉「两侧都有内容行」的那一处空行')
  // ① 逐字节：每一档越界写法都**等于**同一份文本的合法端点写法 —— 不存在的内容一个字都不许多改。
  assert.deepEqual(out.addSpaceJustPast, out.addSpaceRef, 'end = text.length + 2（HEAD 的死循环触发档）')
  assert.deepEqual(out.addSpaceFarPast, out.addSpaceRef, 'end = 1e8（半修之后仍要空转一亿轮的档）')
  assert.deepEqual(out.addSpaceStartPast, { text: SCANNER_PROBE_TEXT, inserted: 0 }, 'start 也在文本外 ⇒ 原文原样返回')
  assert.deepEqual(out.blanksFarPast, out.blanksRef, '空行那一族同样收得住口')
  assert.deepEqual(out.formattedFarPast, out.formattedRef, '总入口（启用段 + 两条规则）同样收得住口')
  // ② 结果本身也要钉死（①只比了两档相等，两边一起错就查不出来）：合法端点确实补了两个空格、
  //   合并了一处空行，而不是越界之后什么都不干。
  assert.deepEqual(out.addSpaceRef, { text: '// a\n// b\n\n\n\nc\n', inserted: 2 })
  assert.deepEqual(out.blanksRef, { text: '//a\n//b\n\n\nc\n', removed: 1, leading: 0 })
  assert.deepEqual(out.formattedFarPast, { text: '// a\n// b\n\n\nc\n', inserted: 2, collapsed: 1, leading: 0 })
})

test('行扫描器收口的形状：上界取自文本，收口值不是常量（旧写法一回归这条就红）', () => {
  const source = read('postFormatProcessors.ts')
  const raw = source.slice(source.indexOf('function lineCommentInsertOffsets'), source.indexOf('function lineBreakAt'))
  assert.ok(raw.length > 200, '找不到行注释扫描器')
  // 负判据在**剥掉整行注释**之后的代码上跑：这个模块的注释里写着头上那两条旧写法
  // （`for (position <= range.end)` / `return text.length + 1`）作为留痕，连着注释一起判就红了。
  // 剥完仍然是逐字符比对，没有放松成 includes/存在性。
  const body = raw.replace(/^\s*\/\/.*$/gm, '')
  // 扫描上界 = min(调用方的 end, 文本长度)；循环条件用的是它，不是 `range.end`。
  assert.match(body, /const scanEnd = Math\.min\(range\.end, text\.length\)/)
  assert.match(body, /for \(let position = scanStart; position <= scanEnd; position = nextLineStart\(text, position\)\)/)
  assert.equal(/position <= range\.end/.test(body), false, '循环条件不许再直接拿调用方的 range.end 当上界')
  // 收口值不许写成常量（HEAD 那一版就是把越界档写成 `text.length + 1`，与 `from` 相等时永不前进）。
  const scanner = source.slice(source.indexOf('function nextLineStart')).replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/return text\.length \+ 1/.test(scanner), false, 'nextLineStart 越界档必须返回 from + 1（严格前进）')
  assert.match(scanner, /if \(from >= text\.length\) return from \+ 1/)
  // 第二道闸（链内）：`processFormattedText` 把「空行上限」改短之后的端点重算一遍再交给补空格。
  // 摘掉它 ⇒ 上面那些 `processFormattedText` 用例立刻红（本轮实测：摘掉它、留着扫描器那道闸，
  // 12 pass / 5 fail；两道都摘掉 = HEAD，6 fail，没有一条靠挂死来报信）。
  const entry = source.slice(source.indexOf('export function processFormattedText'))
  assert.match(entry, /const spacing = current\.end > next\.length\s*\?\s*\{ start: Math\.min\(current\.start, next\.length\), end: next\.length \}\s*:\s*current/)
  assert.match(entry, /processLineCommentAddSpace\(next, spacing, settings\)/)
  assert.equal(/processLineCommentAddSpace\(next, current, settings\)/.test(entry), false,
    '不许再把改短之前的 `current` 直接递给行注释扫描器')
})
