// 主菜单档位表 + 「窗口 › 布局」子菜单的行构造：2026-10-06 从 src/App.vue 逐字搬出的两条纯规则。
//
// 这一族用例钉的是**搬动前后的行为等价**：档位顺序/标签、布局菜单每条行的 id、文案、键位、
// `checked` 的判据、以及「出厂默认时没有重命名/删除」这一支。断言写的是搬走之前 App.vue 里
// 那段代码的输出，所以把搬过去的函数改坏就会红（反向验证见 docs/batch-2026-10-06-appvue.md）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createMainMenuGroups } from '../src/appMainMenu.ts'
import { createLayoutMenuRows } from '../src/appLayoutMenu.ts'
import { emptyLayoutStore, saveLayout } from '../src/toolLayout.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 十档各给一个可辨认的数组，好检查「档位 ↔ 行」没有接错。 */
const rowsFor = id => [{ id, title: id, run: () => {} }]
const allRows = () => ({
  fileMenuRows: rowsFor('file'), editMenuRows: rowsFor('edit'), viewMenuRows: rowsFor('view'),
  navigateMenuRows: rowsFor('navigate'), codeMenuRows: rowsFor('code'), refactorMenuRows: rowsFor('refactor'),
  buildMenuRows: rowsFor('build'), runMenuRows: rowsFor('run'), gitMenuRows: rowsFor('git'), helpMenuRows: rowsFor('help'),
})

test('顶层档位的顺序与文案就是搬走之前那张表（静态十档，不含工具与窗口）', () => {
  assert.deepEqual(createMainMenuGroups(allRows()).map(group => [group.menu, group.label]), [
    ['file', '文件'], ['edit', '编辑'], ['view', '视图'], ['navigate', '导航'], ['code', '代码'],
    ['refactor', '重构'], ['build', '构建'], ['run', '运行'], ['git', 'Git'], ['help', '帮助'],
  ])
})

test('每一档拿到的是自己那一族的行，没有错位', () => {
  // 只比内容：`rowsFor` 每次新建一个 `run` 闭包，deepEqual 会按引用比函数而误报。
  for (const group of createMainMenuGroups(allRows()))
    assert.deepEqual(group.rows.map(row => `${row.id}:${row.title}`), [`${group.menu}:${group.menu}`], `${group.menu} 档接错了行`)
})

test('档位表把「分析」留在外面（上游 MainMenu 没有这一档）', () => {
  assert.ok(!createMainMenuGroups(allRows()).some(group => group.menu === 'analyze'), '主菜单里又出现了分析档')
})

test('出厂默认档下：布局子菜单没有重命名与删除，其余六条按原顺序', () => {
  const store = emptyLayoutStore()
  const hit = []
  const rows = createLayoutMenuRows(store, {
    useFactoryToolLayout: () => hit.push('factory'),
    applyNamedToolLayout: name => hit.push(`apply:${name}`),
    restoreCurrentToolLayout: () => hit.push('restore'),
    storeCurrentToolLayout: () => hit.push('store'),
    openLayoutNameDialog: mode => hit.push(`dialog:${mode}`),
    deleteCurrentToolLayout: () => hit.push('delete'),
  })
  assert.deepEqual(rows.map(row => row.id), ['window.layouts'], '布局组仍是一条带 children 的父行')
  const children = rows[0].children
  assert.deepEqual(children.map(row => row.id), [
    'window.factoryLayout', 'window.ruleLayoutsList', 'window.ruleLayoutsActions',
    'window.restoreLayout', 'window.storeLayout', 'window.storeLayoutAs',
  ])
  assert.equal(children.find(row => row.id === 'window.restoreLayout').keys, 'Shift F12')
  assert.equal(children.find(row => row.id === 'window.factoryLayout').checked(), true, '出厂默认应当被勾上')
  children.find(row => row.id === 'window.storeLayoutAs').run()
  assert.deepEqual(hit, ['dialog:newLayout'], '另存为打开的是新建布局的名字框')
})

test('存过一个布局之后：命名档进列表、可勾选，重命名与删除两支出现', () => {
  const store = saveLayout(emptyLayoutStore(), '我的布局', { explorer: true, bottom: false, view: 'files', tab: 'output', anchors: {}, order: { left: [], right: [], bottom: [] }, sizes: { explorer: 240, trace: 300, output: 180 } })
  const hit = []
  const children = createLayoutMenuRows(store, {
    useFactoryToolLayout: () => hit.push('factory'),
    applyNamedToolLayout: name => hit.push(`apply:${name}`),
    restoreCurrentToolLayout: () => hit.push('restore'),
    storeCurrentToolLayout: () => hit.push('store'),
    openLayoutNameDialog: mode => hit.push(`dialog:${mode}`),
    deleteCurrentToolLayout: () => hit.push('delete'),
  })[0].children
  assert.deepEqual(children.map(row => row.id), [
    'window.factoryLayout', 'window.ruleLayoutsList', 'window.layout.我的布局', 'window.ruleLayoutsActions',
    'window.restoreLayout', 'window.storeLayout', 'window.storeLayoutAs', 'window.renameLayout', 'window.deleteLayout',
  ])
  const named = children.find(row => row.id === 'window.layout.我的布局')
  assert.equal(named.title, '我的布局')
  assert.equal(named.checked(), true, '当前生效的命名布局要被勾上')
  assert.equal(children.find(row => row.id === 'window.factoryLayout').checked(), false)
  named.run()
  children.find(row => row.id === 'window.renameLayout').run()
  assert.deepEqual(hit, ['apply:我的布局', 'dialog:renameLayout'])
})

// ---- 接线：搬出去的东西必须真的被装配根消费（不留死模块） ----

test('装配根从新模块取档位表与布局行，而不是自己再抄一张', () => {
  const app = read('src/App.vue')
  assert.match(app, /import \{ createMainMenuGroups \} from '\.\/appMainMenu\.ts'/)
  assert.match(app, /import \{ createLayoutMenuRows \} from '\.\/appLayoutMenu\.ts'/)
  assert.match(app, /const menus = createMainMenuGroups\(\{ fileMenuRows, editMenuRows, viewMenuRows, navigateMenuRows, codeMenuRows, refactorMenuRows, buildMenuRows, runMenuRows, gitMenuRows, helpMenuRows \}\)/,
    '档位表没有把各域的行喂进去')
  assert.match(app, /const layoutMenuRows = computed<MenuRow\[\]>\(\(\) => createLayoutMenuRows\(toolLayoutStore\.value, \{/,
    '布局行不是每次随店铺快照重算的')
  assert.ok(!/const menus: \{/.test(app), 'App.vue 里还留着搬走的档位表')
})
