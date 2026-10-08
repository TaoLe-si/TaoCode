// 用自定义折叠标记包围选区（上游 `CustomFoldingSurroundDescriptor.java`，
// 即「Surround With」列表里的那一族：`:217-227` 每个 provider 一行）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { java } from '@codemirror/lang-java'
import { customFoldingSurrounder, customFoldingSurrounders, surroundRowForFile, surroundWithRegion } from '../src/customFoldingSurround.ts'
import { CUSTOM_FOLDING_PROVIDERS } from '../src/customFoldingProviders.ts'
import { commentStyleFor } from '../src/commentStyles.ts'
import { surroundTemplates, wrapSelection } from '../src/surround.ts'
import { regionEntries } from '../src/customFoldingRegions.ts'
import { editingCommands } from '../src/editorCommands.ts'

const JAVA = { line: '//', block: ['/*', '*/'] }
const CSS = { block: ['/*', '*/'] }
const NONE = {}
const region = customFoldingSurrounder('').provider
const netbeans = customFoldingSurrounder('NetBeansCustomFoldingProvider').provider

// 列表里的折叠行由 provider 表生成 ⇒ 认行认的是 `getDescription()` 那三个标题（`:244-246`）。
const providerDescriptions = new Set(CUSTOM_FOLDING_PROVIDERS.map(provider => provider.description))
const byTitle = title => surroundTemplates.find(template => template.title === title)
// 语言中立那 13 行（if / if-else / for / while / do-while / try×3 / 代码块 / 文档注释 /
// 行注释 / 括号 / 方括号；前九项逐条对上 `java/java-impl/src/com/intellij/codeInsight/generation/
// surroundWith/JavaStatementsSurroundDescriptor.java:26-40` 那张 SURROUNDERS 表）。
// 加一行非折叠模板要同时改这个数 —— 这一行是「折叠行是不是只有 provider 表那几条」的门。
const SURROUND_BASE_ROWS = 13

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

// ── 「Surround With」列表里的那几行（本批补的一层：CUSTOMFOLD lane，2026-10-06） ────────
//
// 上游那张列表 = **每个 provider 一行**（`CustomFoldingSurroundDescriptor.java:217-227`），
// 标题 = `provider.getDescription()`（`:244-246`），而标记文字是拿**这门语言的 `Commenter`**
// 包出来的（`:275-289` 行注释优先、退到块注释那一对；`:306-307` 的两串形状）。
// 上一版在 `src/surround.ts` 里表外手写了四行、注释前缀一律 `//` ⇒ 在 `#` / `--` 注释的语言里
// 插进去的是不成注释的裸文本。下面这几条钉的就是这一层。
const rows = () => surroundTemplates.filter(template => providerDescriptions.has(template.title))

test('列表里的折叠行 = provider 表的条数（三个 provider 三行，不再是表外手写的四行）', () => {
  assert.equal(surroundTemplates.length, SURROUND_BASE_ROWS + CUSTOM_FOLDING_PROVIDERS.length)
  assert.deepEqual(rows().map(template => template.title), CUSTOM_FOLDING_PROVIDERS.map(p => p.description))
  // 手写那四行的名字不再出现（`//region` 与 `#region` 是同一个 VisualStudio provider，一行）。
  for (const stale of ['折叠区域 //region', '折叠区域 #region', '折叠区域 <editor-fold>'])
    assert.ok(!surroundTemplates.some(template => template.title === stale), `${stale} 是表外手写的行，该删`)
  for (const template of rows()) {
    assert.ok(template.block, `${template.title} 是整块包围`)
    assert.match(template.keywords, /region/)
    assert.match(template.keywords, /折叠区域/)
  }
})

test('Python 文件里插的是 `#` 那一族的标记，不是 `//`（:275-289 用目标语言的 Commenter）', () => {
  const style = commentStyleFor(undefined, 'src/app.py')
  assert.equal(style.line, '#')
  for (const template of rows()) {
    const row = surroundRowForFile(template, style)
    if (!row) continue
    assert.ok(!row.prefix.includes('//'), `${row.title} 在 Python 里不该带 // 前缀：${row.prefix}`)
    assert.ok(!row.suffix.includes('//'), `${row.title} 的收尾标记同理：${row.suffix}`)
  }
  const vs = surroundRowForFile(byTitle('region…endregion 注释'), style)
  assert.equal(vs.prefix, '#region Description')
  assert.equal(vs.suffix, '#endregion')
  const netbeans = surroundRowForFile(byTitle('<editor-fold…> 注释'), style)
  assert.equal(netbeans.prefix, '#<editor-fold desc="Description">')
  assert.equal(netbeans.suffix, '#</editor-fold>')
})

test('包围出来的每一行在**它自己那门口类**里都能被折叠识别认回一个区域（生成↔识别同一张表）', () => {
  for (const path of ['a.java', 'a.py', 'a.sql', 'a.css']) {
    const style = commentStyleFor(undefined, path)
    for (const template of rows()) {
      const row = surroundRowForFile(template, style)
      if (!row) continue
      const wrapped = wrapSelection(row, 'one();', '', '  ')
      const found = regionEntries(wrapped.text)
      assert.equal(found.length, 1, `${row.title} 在 ${path} 里该配出一个区域：\n${wrapped.text}`)
      assert.equal(found[0].label, 'Description', `${row.title} 在 ${path}：占位是 :299-302 换进去的那段`)
    }
  }
})

test('只有块注释的语言（CSS）留得下两个真 provider，`<region ?>` 那一族包不出可认的标记 ⇒ 摘掉这一行', () => {
  const style = commentStyleFor(undefined, 'site.css')
  assert.equal(style.line, undefined)
  assert.equal(surroundRowForFile(byTitle('<editor-fold…> 注释'), style).prefix, '/*<editor-fold desc="Description">*/')
  assert.equal(surroundRowForFile(byTitle('<editor-fold…> 注释'), style).suffix, '/*</editor-fold>*/')
  assert.equal(surroundRowForFile(byTitle('region…endregion 注释'), style).prefix, '/*region Description*/')
  // `<region ?>` 的 provider 在社区树里不存在（`commentMarkerBody` 认不了 `/*<region …>*/`），
  // 插进去折不起来 ⇒ 列表里不给这一行，而不是给一条死控件。
  assert.equal(surroundRowForFile(byTitle('折叠区域 //<region>'), style), null)
})

test('这门语言没有注释词法（上游 :52-56 那道门）⇒ 折叠行一条都不给，别的行原样留着', () => {
  const style = commentStyleFor(undefined, 'README.txt')
  assert.equal(style, null)
  for (const template of rows()) assert.equal(surroundRowForFile(template, style), null)
  const plain = byTitle('if 条件')
  assert.equal(surroundRowForFile(plain, style), plain)
  assert.equal(surroundRowForFile(plain, null), plain)
})

test('列表只会比静态表短，不会变长（App.vue 那句 choices.length/templates.length 不许溢出）', () => {
  const paths = ['a.java', 'a.py', 'a.sql', 'a.css', 'a.html', 'a.ini', 'a.txt', 'a.lua', 'Makefile', 'noext']
  for (const path of paths) {
    const style = commentStyleFor(undefined, path)
    const shown = surroundTemplates.map(row => surroundRowForFile(row, style)).filter(row => row !== null)
    assert.ok(shown.length <= surroundTemplates.length, `${path}：${shown.length} > ${surroundTemplates.length}`)
    assert.ok(shown.length >= surroundTemplates.length - CUSTOM_FOLDING_PROVIDERS.length, `${path}：不该把非折叠行也摘掉`)
  }
})
