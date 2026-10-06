// 用自定义折叠标记包围选区（上游 `CustomFoldingSurroundDescriptor.java`，
// 即「Surround With」列表里的那一族：`:217-227` 每个 provider 一行）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { java } from '@codemirror/lang-java'
import { customFoldingSurrounder, customFoldingSurrounders, surroundWithRegion } from '../src/customFoldingSurround.ts'
import { CUSTOM_FOLDING_PROVIDERS } from '../src/customFoldingProviders.ts'
import { regionEntries } from '../src/customFoldingRegions.ts'
import { editingCommands } from '../src/editorCommands.ts'

const JAVA = { line: '//', block: ['/*', '*/'] }
const CSS = { block: ['/*', '*/'] }
const NONE = {}
const region = customFoldingSurrounder('').provider
const netbeans = customFoldingSurrounder('NetBeansCustomFoldingProvider').provider

test('列表 = 每个 provider 一行，顺序与标题都取 provider 表（:217-227 + getDescription()）', () => {
  assert.deepEqual(customFoldingSurrounders().map(item => item.title), CUSTOM_FOLDING_PROVIDERS.map(p => p.description))
  assert.deepEqual(customFoldingSurrounders().map(item => item.id),
    ['NetBeansCustomFoldingProvider', 'VisualStudioCustomFoldingProvider', ''])
})

test('标记形状照 :306-307，并且先插尾部再插头部（:308-311）', () => {
  const result = surroundWithRegion('one();\ntwo();', 0, 13, region, JAVA)
  assert.equal(result.text, '//<region Description>\none();\ntwo();\n//</region>')
  assert.deepEqual(result.edits.map(edit => edit.from), [13, 0])
})

test('选区吸附到整行：半行也包整行；选到换行符为止只算上一行（:57-63 的空白回退）', () => {
  assert.equal(surroundWithRegion('aaa;\nbbb;', 2, 3, region, JAVA).text, '//<region Description>\naaa;\n//</region>\nbbb;')
  assert.equal(surroundWithRegion('aaa;\nbbb;', 2, 5, region, JAVA).text, '//<region Description>\naaa;\n//</region>\nbbb;')
  assert.equal(surroundWithRegion('aaa;\nbbb;', 2, 9, region, JAVA).text, '//<region Description>\naaa;\nbbb;\n//</region>')
})

test('两行标记沿用选区首行的缩进（:295 的 startIndent）', () => {
  const text = 'class A {\n    int x;\n}\n'
  const from = text.indexOf('int x;')
  assert.equal(
    surroundWithRegion(text, from, from + 6, region, JAVA).text,
    'class A {\n    //<region Description>\n    int x;\n    //</region>\n}\n',
  )
})

test('`?` 换成 Description 并把那段选上，且跳过注释前缀（:298-304 + :313）', () => {
  const result = surroundWithRegion('x();', 0, 4, region, JAVA)
  assert.equal(result.text.slice(result.selection.from, result.selection.to), 'Description')
  assert.equal(result.selection.from, 10, '//<region 之后正好落在 Description 上')
  const net = surroundWithRegion('x();', 0, 4, netbeans, JAVA)
  assert.ok(net.text.startsWith('//<editor-fold desc="Description">'), net.text)
  assert.equal(net.text.slice(net.selection.from, net.selection.to), 'Description')
})

test('没有行注释时用块注释那一对（:275-289 的 fallback）', () => {
  assert.equal(surroundWithRegion('a: 1;', 0, 5, region, CSS).text, '/*<region Description>*/\na: 1;\n/*</region>*/')
})

test('两种注释都没有 ⇒ 不动手（:52-56 的 Commenter 门槛）；空选区同样（:51）', () => {
  assert.equal(surroundWithRegion('x\n', 0, 1, region, NONE), null)
  assert.equal(surroundWithRegion('x\n', 0, 0, region, JAVA), null)
  // 选区里没有任何实际元素 ⇒ 不动手：上游 `:56-61` 把首尾的空白元素各挪一个兄弟，
  // 挪完首尾是同一个空白 token 就返回空数组。本仓这条路径由 `snapToLines` 的
  // `end <= snappedFrom`（空白一路剥到底后正好贴在行尾）挡住 —— 本轮加的「整段都是空白」显式判据
  // 实测不可达、已删，留这条断言钉住**行为**（不是钉住某一行代码）。
  assert.equal(surroundWithRegion('a\n \n \nb', 2, 6, region, JAVA), null)
  assert.equal(surroundWithRegion('a\nb\nc', 2, 3, region, JAVA).text, 'a\n//<region Description>\nb\n//</region>\nc')
})

// 三个 provider 各包围一次：生成出来的标记要能被**同一张表**认回一个区域
// （`getSurrounders()` 的每一项都来自 `CustomFoldingProvider.getAllProviders()`，
// 而折叠侧 `CustomFoldingBuilder.java:164-187` 问的是同一批 provider）⇒ 生成与识别不许分家。
test('三种 provider 的包围都能被折叠识别认回，且占位就是被选中的 Description', () => {
  for (const item of customFoldingSurrounders()) {
    const result = surroundWithRegion('one();\ntwo();', 0, 13, item.provider, JAVA)
    assert.ok(result, `${item.title} 该能包围`)
    const regions = regionEntries(result.text)
    assert.equal(regions.length, 1, `${item.title} 只该配出一个区域（异族不互收）`)
    assert.equal(regions[0].label, 'Description', item.title)
    assert.equal(result.text.slice(result.selection.from, result.selection.to), 'Description', item.title)
  }
})

test('包围出来的标记正是折叠识别认的那一族（与 src/editorFolding.ts 同一处规则）', () => {
  const regions = regionEntries(surroundWithRegion('one();\ntwo();', 0, 13, region, JAVA).text)
  assert.equal(regions.length, 1)
  assert.equal(regions[0].label, 'Description')
})

test('命令层：fold.surroundRegion 在 Java 语言数据下真的落地，空选区不吞键', () => {
  let state = EditorState.create({ doc: 'one();\ntwo();\n', selection: { anchor: 0, head: 13 }, extensions: [java()] })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(editingCommands['fold.surroundRegion'](view), true)
  assert.match(state.doc.toString(), /^\/\/<region Description>\n/)
  state = EditorState.create({ doc: 'one();\n', selection: { anchor: 3 }, extensions: [java()] })
  const empty = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(editingCommands['fold.surroundRegion'](empty), false)
})

test('菜单行在编辑菜单里（合并行那一族之后，实现在 src/menus/editMenu.ts）', () => {
  const menu = readFileSync('src/menus/editMenu.ts', 'utf8')
  assert.match(menu, /editable\('fold\.surroundRegion'/)
  assert.match(menu, /editable\('paragraph\.fill'/)
  assert.match(menu, /editable\('block\.startSelect'/)
})
