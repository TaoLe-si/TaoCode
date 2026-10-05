// hover 文档整形与缓存（`src/hoverDocumentation.ts`）：
// 上游 `LspDocumentationData` 的代码围栏拆分 + `HoverResultCache` 的按位置缓存/文档失效。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  convertLineSeparators, createHoverCache, createHoverDocumentation, formatHoverPlainText,
  parseLeadingCodeFence, trimIndent,
} from '../src/hoverDocumentation.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('代码围栏：语言、代码与其余描述；未闭合/不足三反引号不认', () => {
  const fence = parseLeadingCodeFence('```java\nclass A {}\n```\n说明文字。')
  assert.deepEqual(fence, { language: 'java', code: 'class A {}', rest: '\n说明文字。' })
  const longer = parseLeadingCodeFence('````ts\nconst a = 1\n`````\nrest')
  assert.equal(longer.code, 'const a = 1', '闭合围栏可以比开围栏长')
  assert.equal(parseLeadingCodeFence('```java\nclass A {}\n'), null, '未闭合不认')
  assert.equal(parseLeadingCodeFence('``java\nx\n``'), null, '两个反引号不是围栏')
  assert.equal(parseLeadingCodeFence('普通文本\n```\nx\n```'), null, '围栏必须在开头')
  const noLanguage = parseLeadingCodeFence('```\nplain\n```\nrest')
  assert.equal(noLanguage.language, null)
  assert.equal(noLanguage.code, 'plain')
})

test('trimIndent：去掉非空行最小公共缩进，空行原样', () => {
  assert.equal(trimIndent('    a\n      b\n\n    c'), 'a\n  b\n\nc')
  assert.equal(trimIndent(''), '')
  assert.equal(trimIndent('  \n  '), '  \n  ', '全空行不缩进')
})

test('文档整形：markdown 围栏拆成签名 + 描述，无围栏保持原文', () => {
  const data = createHoverDocumentation('```java\r\n    class A {}\r\n```\r\n\r\n第一段。')
  assert.equal(data.definitionCodeBlock, 'class A {}')
  assert.equal(data.definitionLanguage, 'java')
  assert.equal(data.markup, 'markdown')
  assert.match(data.description, /第一段。/)
  assert.equal(convertLineSeparators('a\r\nb\rc'), 'a\nb\nc')
  const plain = createHoverDocumentation('就是一段文档')
  assert.equal(plain.definitionCodeBlock, null)
  assert.equal(plain.description, '就是一段文档')
  assert.equal(plain.markup, 'plain')
})

test('弹层纯文本：签名在前、描述在后，不再显示反引号围栏', () => {
  const noFence = formatHoverPlainText(createHoverDocumentation('就是一段文档'))
  assert.equal(noFence, '就是一段文档', '没有围栏时与现在显示一致')
  const withFence = formatHoverPlainText(createHoverDocumentation('```java\nclass A {}\n```\n说明'))
  assert.equal(withFence, 'class A {}\n\n说明')
  const codeOnly = formatHoverPlainText(createHoverDocumentation('```java\nclass A {}\n```'))
  assert.equal(codeOnly, 'class A {}')
})

test('缓存：同位置同标记命中，位置/标记不同不命中', () => {
  const cache = createHoverCache()
  assert.equal(cache.get('a.ts', '1:2', 'v1:clean'), undefined)
  cache.put('a.ts', '1:2', 'v1:clean', { contents: 'doc' })
  assert.equal(cache.get('a.ts', '1:2', 'v1:clean').contents, 'doc')
  assert.equal(cache.get('a.ts', '1:3', 'v1:clean'), undefined, '位置不同不命中')
  assert.equal(cache.get('a.ts', '1:2', 'v2:clean'), undefined, '版本变化整文件失效')
  assert.equal(cache.get('b.ts', '1:2', 'v1:clean'), undefined, '路径不同不命中')
  cache.put('a.ts', '1:2', 'v2:clean', { contents: 'new' })
  assert.equal(cache.get('a.ts', '1:2', 'v2:clean').contents, 'new')
})

test('缓存：转脏标记失效、invalidate/clear、每文件 LRU 上限', () => {
  const cache = createHoverCache(2)
  cache.put('a.ts', '1:0', 'v1:clean', { contents: 'one' })
  cache.put('a.ts', '1:1', 'v1:dirty', { contents: 'two' })
  assert.equal(cache.get('a.ts', '1:0', 'v1:clean'), undefined, '标记变（clean → dirty）旧条目不命中')
  assert.equal(cache.size(), 1)
  const small = createHoverCache(2)
  small.put('a.ts', 'p1', 's', { contents: '1' })
  small.put('a.ts', 'p2', 's', { contents: '2' })
  small.put('a.ts', 'p3', 's', { contents: '3' })
  assert.equal(small.size(), 2, '超出上限淘汰最旧')
  assert.equal(small.get('a.ts', 'p1', 's'), undefined)
  assert.equal(small.get('a.ts', 'p3', 's').contents, '3')
  small.invalidate('a.ts')
  assert.equal(small.size(), 0)
  small.put('a.ts', 'p1', 's', { contents: 'x' })
  small.clear()
  assert.equal(small.size(), 0)
})

test('接线：Ctrl+Q 走整形与缓存', () => {
  // 围栏拆分与缓存读取已经搬进 `src/quickDocHost.ts`（`DocumentationManager` 那一层）：
  // 取 hover → 查缓存 → 围栏拆分 → 摆弹层，全在宿主里（quickDocHost.ts:89-104）。
  // `editorFileOps.ts` 只建那张缓存再注入（`:96`/`:105`）—— playbook §7：搬走实现要把
  // 断言的 read 路径一起改指，断言体本身一字不动。
  const fileOps = readFileSync(join(root, 'src/editorFileOps.ts'), 'utf8')
  const host = readFileSync(join(root, 'src/quickDocHost.ts'), 'utf8')
  // 取文档那一格（查缓存 → 发 hover）已经从宿主搬到 `src/docHoverContent.ts`
  // （两条入口共用一个注入面）—— playbook §7：改指 read 路径，断言体一字不动。
  const hover = readFileSync(join(root, 'src/docHoverContent.ts'), 'utf8')
  assert.match(fileOps, /createHoverCache\(\)/, '没有建 hover 缓存')
  assert.match(host, /createHoverDocumentation\(contents\)/, 'hover 原文没有过围栏拆分')
  assert.match(hover, /cache\.get\(position\.path, key, position\.stamp\)/, '取文档没有先查缓存')
})
