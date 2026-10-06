// 替换模板的先验校验与 `\xNNNN` 的 Java 解析口径。
//
// 上游依据（本机参考树，行号是逐行数出来的）：
//   · `platform/lang-impl/src/com/intellij/find/impl/RegExReplacementBuilder.java:76-78`
//     —— `validate(Pattern, String)`：只拿**组数**跑一遍展开器；
//   · 同文件 `:56-61` —— 校验模式里 `group(n)` 越界 ⇒ `No group n`；`:51-54` + `:71` —— 组名**不**查存在性；
//   · 同文件 `:119-128` —— `\xNNNN` 走 `Integer.parseInt(s,16)`，解析失败时 cursor 不前进，
//     那 4 位随后按普通字符走；Java 那次解析允许一个前导 `+`/`-`，`(char)code` 取低 16 位；
//   · 同文件 `:164-176` —— `$n` 取最长的**合法**组号；越界的那一位留给字面；
//   · 调用点 `platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java:1548`
//     —— Find in Files 按下替换按钮时校验，失败 ⇒ `find.replace.invalid.replacement.string`
//     （`platform/analysis-impl/resources/messages/FindBundle.properties:96`）。
//
// 宿主那一侧跑的是同一趟（`native/search.cpp` 的 `validate_replacement`，判据
// `native/search_test.cpp` 的 "a malformed replacement template refuses before writing anything"）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { captureGroupCount, createReplacement, replacementFromMatch, validateReplacement } from '../src/regexReplacement.ts'

test('validateReplacement 挡住上游会挡的写法，放过上游会放过的写法', () => {
  // 合法：`$0` 是整段命中、`${name}` 不查存在性（`RegExReplacementBuilder.java:71`）。
  assert.equal(validateReplacement('[$0-$1]', 2), null)
  assert.equal(validateReplacement('${whatever}', 0), null)
  assert.equal(validateReplacement('a\\nb\\t\\x0041\\U$1\\E', 1), null)
  // 越界组号：两个组的模式里写 `$3` ⇒ `No group 3`（`:58-59`）。
  assert.equal(validateReplacement('$3', 2), 'No group 3')
  // `$&` 不是组引用（`:165` 的 refNum 上界），JS `String.replace` 那侧却把它当整段命中 —— 正是要挡的形状。
  assert.equal(validateReplacement('$&', 2), 'Illegal group reference')
  assert.equal(validateReplacement('abc$', 2), 'Illegal group reference: group index is missing')
  assert.equal(validateReplacement('abc\\', 2), 'character to be escaped is missing')
  assert.equal(validateReplacement('${}', 2), 'named capturing group has 0 length name')
  assert.equal(validateReplacement('${ab', 2), "named capturing group is missing trailing '}'")
  assert.equal(validateReplacement('${1x}', 2), 'capturing group name {1x} starts with digit character')
})

test('validateReplacement 不影响替换那侧的既有口径（缺组仍按空串）', () => {
  // 这条由 tests/editor-find-options.test.mjs:114 钉着，这里只保证**默认参数**没被改坏。
  assert.equal(createReplacement('$9', ['m', 'A']), '')
  assert.equal(replacementFromMatch('$9', /x/.exec('x')), '')
})

test('captureGroupCount 数的是捕获组，不算 (?:…) 与字符类里的括号', () => {
  assert.equal(captureGroupCount('([a-z]+)([0-9])'), 2)
  assert.equal(captureGroupCount('(?:(a)|b)'), 1)
  assert.equal(captureGroupCount('[(]'), 0)
  assert.equal(captureGroupCount('\\('), 0)
  assert.equal(captureGroupCount('(?<year>[0-9]{4})'), 1)
  assert.equal(captureGroupCount('a|b'), 0)
})

test('\\xNNNN 按 Integer.parseInt(s,16) 的口径解析（带符号也算，0x 前缀不算）', () => {
  assert.equal(createReplacement('\\x0041', ['m']), 'A')
  // Java 的 parseInt 允许一个前导符号 ⇒ `+123` 是 0x123，`(char)` 之后是 'ā'。
  assert.equal(createReplacement('\\x+123', ['m']), String.fromCharCode(0x123))
  assert.equal(createReplacement('\\x-1a2', ['m']), String.fromCharCode((-0x1a2) & 0xffff))
  // `0x12` 在 Java 那一侧抛 NumberFormatException ⇒ 不前进 cursor，那 4 位按普通字符走。
  assert.equal(createReplacement('\\x0x12', ['m']), '0x12')
  assert.equal(createReplacement('\\x 123', ['m']), ' 123')
})

// —— 面板接线：那道门必须挂在**两个替换入口**上，不是只在按钮外观上 ——

test('全局搜索面板把校验接进了两个替换入口，并把「正则」档传进模型', () => {
  const panel = readFileSync(new URL('../src/components/SearchPanel.vue', import.meta.url), 'utf8')
  // `regexMode` = 上游 `model.isRegularExpressions()`（`FindPopupPanel.java:1520`），是校验的门，不是装饰。
  assert.match(panel, /createStructuralSearchModel\(\{[^)]*regexMode/, '「正则」档要真的传进模型')
  assert.match(panel, /if \(blockedByReplaceGuard\(\)\) return/)
  // 逐条替换与「全部替换」两条路径都要挡（只挡一条会留下"半数已改写"的那种事故）。
  assert.equal((panel.match(/blockedByReplaceGuard\(\)/g) ?? []).length, 3, '一处定义 + 两处入口')
  assert.doesNotMatch(panel, /canSearch = computed\([^)]*replaceGuard/,
    '这道门属替换字段（上游挂在 myReplaceComponent 上），不许把查找本身也挡了')
})
