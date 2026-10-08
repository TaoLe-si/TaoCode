// 「快速定义」（IDEA `QuickImplementations`，Ctrl+Shift+I）—— 纯逻辑 + 接线。
//
// 两半：① `src/quickDefinition.ts` 的 hover 文本 → 全限定名、候选回退、摘录；② 接线 ——
// 编辑器命令 + 键位（$default.xml:162-164）+ 菜单行 + 弹层存在，以及"工程内有定义就跳那个文件、
// 没有才走库源码"这两条路。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { excerptAt, qualifierCandidates, qualifierFromHoverText, quickDefinitionTitle, resolveQuickDefinition, wordAtPosition, wordOf } from '../src/quickDefinition.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const editor = read('src/components/CodeEditor.vue')
// 动作表与常驻 keymap 2026-10-06 搬进 src/editorKeymap.ts（CodeEditor.vue 贴着机检上限）；
// 「快速定义」的菜单动作与键位都在那里，宿主那一半（建宿主、挂弹层）仍在 CodeEditor.vue。
const keymap = read('src/editorKeymap.ts')
const menu = read('src/menus/navigateMenu.ts')
const popup = read('src/components/QuickDefinitionPopup.vue')
const host = read('src/quickDefinitionHost.ts')

test('hover 文本里取全限定名（JDT 真机回包的真实形状）', () => {
  // 真机实测（AE2 工程 · net.minecraftforge.common.config.Configuration）：
  const real = 'net.minecraftforge.common.config.Configuration\n\nThis class offers advanced configurations capabilities, allowing to provide various categories for configuration variables.'
  assert.equal(qualifierFromHoverText(real), 'net.minecraftforge.common.config.Configuration')
  assert.equal(qualifierFromHoverText('java.util.Map<K, V>\n\nA map.'), 'java.util.Map', '泛型要削掉')
  assert.equal(qualifierFromHoverText('public void com.example.Greeter.hello()\n\njavadoc'), 'com.example.Greeter.hello', '成员引用取所属类型那一级由候选回退处理')
  assert.equal(qualifierFromHoverText('String\n\nno package here'), null, '单个词不算全限定名')
  assert.equal(qualifierFromHoverText(''), null)
})

test('候选逐级回退：成员引用退到所属类型', () => {
  assert.deepEqual(qualifierCandidates('a.b.C'), ['a.b.C', 'a.b'])
  assert.deepEqual(qualifierCandidates('com.example.Greeter.hello'), ['com.example.Greeter.hello', 'com.example.Greeter', 'com.example'])
  assert.deepEqual(qualifierCandidates('a.b'), ['a.b'], '两段就是最短，不再退')
})

test('摘录只取目标行上下若干行，并给出目标行下标', () => {
  const content = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
  const excerpt = excerptAt(content, 20, 3)
  assert.deepEqual(excerpt.lines, ['line 18', 'line 19', 'line 20', 'line 21', 'line 22', 'line 23', 'line 24'])
  assert.equal(excerpt.lines[excerpt.target], 'line 21', '目标行（0 基 20）落在摘录中间')
  const head = excerptAt(content, 0, 3)
  assert.equal(head.from, 0)
  assert.equal(head.lines[head.target], 'line 1')
})

test('光标处的词：取光标前后两段标识符，不把后面的行带进来', () => {
  assert.equal(wordAtPosition('Sample self;', 3), 'Sample', '光标在词中间')
  assert.equal(wordAtPosition('    Sample other;', 10), 'Sample')
  assert.equal(wordAtPosition('    Sample other;', 4), 'Sample', '光标在词首')
  assert.equal(wordAtPosition('package demo;', 7), 'package')
  assert.equal(wordAtPosition('', 0), '')
})

test('标题与取词', () => {
  assert.equal(quickDefinitionTitle('Greeter', '', false), '快速定义 Greeter')
  assert.equal(quickDefinitionTitle('', 'class Greeter {', false), '快速定义 class Greeter {', '没有词时退到那一行的原文')
  assert.equal(quickDefinitionTitle('Configuration', '', true), '快速定义 Configuration（库源码）')
  assert.equal(wordOf('package com.example;'), 'package')
  assert.equal(wordOf('  '), '')
})

test('工程内有定义 → 直接用那个文件，不碰库源码', async () => {
  const calls = []
  const source = await resolveQuickDefinition({
    readBuffer: () => null,
    readFile: async path => { calls.push(['read', path]); return 'a\nb\nTARGET\n' },
    request: async (_, params) => { calls.push(['request', params.kind]); return { available: true, locations: [{ path: 'src/Target.java', line: 2, character: 0 }] } },
    librarySource: async () => { calls.push(['library']); return { available: false } },
  }, { path: 'src/Main.java', line: 1, character: 2, word: 'Target' })
  assert.equal(source?.library, false)
  assert.equal(source?.path, 'src/Target.java')
  assert.equal(source?.line, 2)
  assert.deepEqual(calls.map(call => call[1] ?? call[0]), ['definition', 'src/Target.java'], '只问 definition，不查 jar')
})

test('没有位置 → hover 取全限定名，逐级回退问库源码并命中', async () => {
  const asked = []
  const source = await resolveQuickDefinition({
    readBuffer: () => null,
    readFile: async () => '',
    request: async (_, params) => params.kind === 'definition'
      ? { available: false }
      : { available: true, contents: 'com.example.Greeter.hello()\n\njavadoc' },
    librarySource: async qualifier => { asked.push(qualifier); return qualifier === 'com.example.Greeter'
      ? { available: true, jar: 'D:/lib/demo-sources.jar', entry: 'com/example/Greeter.java', content: 'package com.example;\npublic class Greeter {}\n' }
      : { available: false } },
  }, { path: 'src/Main.java', line: 3, character: 4, word: 'hello' })
  assert.deepEqual(asked, ['com.example.Greeter.hello', 'com.example.Greeter'], '先按原样问，再退到所属类型')
  assert.equal(source?.library, true)
  assert.equal(source?.path, 'demo-sources.jar!com/example/Greeter.java')
  assert.match(source?.title ?? '', /库源码/)
})

test('两路都没有就返回 null（不弹空壳）', async () => {
  const none = await resolveQuickDefinition({
    readBuffer: () => null, readFile: async () => '',
    request: async (_, params) => params.kind === 'definition' ? { available: false } : { available: false },
    librarySource: async () => ({ available: false }),
  }, { path: 'a.java', line: 0, character: 0, word: 'x' })
  assert.equal(none, null)
})

test('接线：编辑器命令 + Ctrl+Shift+I + 菜单行 + 弹层三件齐', () => {
  // 动作名在 src/editorKeymap.ts（2026-10-06 从 CodeEditor.vue 搬出）；Ctrl+Shift+I 那把键挂在
  // lspExtensions() 里（与 quickDefinitionCommand 的语言服务门同处），仍在 CodeEditor.vue。两处都钉。
  assert.match(keymap, /quickDefinition: editor => quickDefinitionCommand\(editor\)/, '编辑器命令表里有这一条（菜单与键位共用同一个函数）')
  assert.match(editor, /\{ key: 'Ctrl-Shift-i', preventDefault: true, run: editor => quickDefinitionCommand\(editor\) \}/, '$default.xml:162-164 的键位')
  assert.match(menu, /id: 'navigate\.quickDefinition', title: '快速定义', keys: 'Ctrl Shift I'/)
  assert.match(popup, /<div ref="box" class="quick-definition" role="dialog" aria-label="快速定义"/)
  assert.match(editor, /const \{ quickDefinition, command: quickDefinitionCommand \} = createQuickDefinitionHost\(/, '编辑器里只建一次宿主')
  assert.match(host, /return \{ quickDefinition, show, command \}/, '宿主导出命令与状态')
  assert.match(editor, /<QuickDefinitionPopup :source="quickDefinition\.source"/, '弹层挂在编辑器里（Teleport 到 body）')
})
