// 插件贡献的**命令入口**（菜单行）与**实时模板**：IDEA 的插件 `<actions>` / LiveTemplate
// 扩展点在本仓的落点。规则在 src/pluginCommands.ts 与 src/templates.ts，这里测行为与接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_PLUGIN_COMMAND_GROUP,
  PLUGIN_MENU_LABEL,
  enabledPlugins,
  pluginCommandEntries,
  pluginCommandGroups,
  pluginMenuRows,
} from '../src/pluginCommands.ts'
import { candidates, defaultTemplateSettings, effectiveTemplates, expand, pluginTemplatePattern } from '../src/templates.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function plugin(overrides = {}) {
  return { id: 'demo', name: '示例', version: '1.0', description: '', path: 'C:/p/demo', enabled: true, commands: [], templates: [], ...overrides }
}
function command(overrides = {}) {
  return { id: 'hello', title: '打招呼', action: 'app.about', group: '示例', ...overrides }
}

test('只有启用且清单可读的插件才贡献命令', () => {
  const plugins = [
    plugin({ id: 'on', commands: [command()] }),
    plugin({ id: 'off', enabled: false, commands: [command()] }),
    plugin({ id: 'broken', error: 'plugin.json 不是合法 JSON', commands: [command()] }),
  ]
  assert.deepEqual(enabledPlugins(plugins).map(item => item.id), ['on'])
  assert.deepEqual(pluginCommandEntries(plugins).map(entry => entry.pluginId), ['on'])
})

test('菜单行 id 是 plugin.<插件 id>.<命令 id>（全局唯一，与 IDEA 的 action id 同性质）', () => {
  const entries = pluginCommandEntries([plugin({ commands: [command(), command({ id: 'bye', title: '告别' })] })])
  assert.deepEqual(entries.map(entry => entry.id), ['plugin.demo.hello', 'plugin.demo.bye'])
  assert.equal(entries[0].pluginName, '示例')
})

test('按 group 归拢：空组名落到默认组，组内与组间按码元顺序排', () => {
  const groups = pluginCommandGroups(pluginCommandEntries([plugin({
    commands: [
      command({ id: 'b', title: 'beta', group: '工具' }),
      command({ id: 'a', title: 'Alpha', group: '工具' }),
      command({ id: 'c', title: 'no group', group: '  ' }),
    ],
  })]))
  assert.deepEqual(groups.map(group => group.group), ['工具', DEFAULT_PLUGIN_COMMAND_GROUP])
  // 'Alpha' 排在 'beta' 前 —— 忽略大小写的码元比较，不是语言排序
  assert.deepEqual(groups[0].entries.map(entry => entry.command.id), ['a', 'b'])
})

test('只有一组命令时直接平铺；多组时每组一个子菜单', () => {
  const single = pluginMenuRows([plugin({ commands: [command()] })], { run: () => {} })
  assert.equal(single.length, 1)
  assert.equal(single[0].id, 'plugin.demo.hello')
  assert.equal(single[0].title, '打招呼')
  assert.equal(single[0].children, undefined)

  const many = pluginMenuRows([plugin({
    commands: [command({ id: 'a', title: 'A', group: '工具' }), command({ id: 'b', title: 'B', group: '示例' })],
  })], { run: () => {} })
  assert.deepEqual(many.map(row => row.id), ['plugin.group.工具', 'plugin.group.示例'])
  assert.deepEqual(many[0].children.map(row => row.id), ['plugin.demo.a'])
})

test('没有可用命令时整组不出现（空组不渲染）', () => {
  assert.deepEqual(pluginMenuRows([], { run: () => {} }), [])
  assert.deepEqual(pluginMenuRows([plugin({ enabled: false, commands: [command()] })], { run: () => {} }), [])
  assert.deepEqual(pluginMenuRows([plugin()], { run: () => {} }), [])
})

test('点击行时把清单里的 action 交给宿主执行', () => {
  const seen = []
  const rows = pluginMenuRows([plugin({ commands: [command({ action: 'file.save' })] })], { run: action => seen.push(action) })
  rows[0].run()
  assert.deepEqual(seen, ['file.save'])
})

test('动作不存在时整行禁用（而不是点了才报错）', () => {
  const rows = pluginMenuRows([plugin({ commands: [command({ action: 'nope.missing' })] })], {
    run: () => {},
    hasAction: action => action === 'file.save',
  })
  assert.equal(rows[0].enabled(), false)
  const ok = pluginMenuRows([plugin({ commands: [command({ action: 'file.save' })] })], {
    run: () => {},
    hasAction: action => action === 'file.save',
  })
  assert.equal(ok[0].enabled(), true)
})

test('命令行的关键字带上插件与命令 id，好让「查找操作」搜得到', () => {
  const [row] = pluginMenuRows([plugin({ commands: [command({ id: 'hello', action: 'app.about' })] })], { run: () => {} })
  for (const needle of ['demo', '示例', 'hello', 'app.about', '插件']) assert.match(row.keywords, new RegExp(needle))
})

test('重复的命令 id 不会产生两行同 id 的菜单项', () => {
  const entries = pluginCommandEntries([plugin({
    commands: [command({ id: 'run', title: '第一条' }), command({ id: 'run', title: '第二条' }), command({ id: 'other' })],
  })])
  assert.deepEqual(entries.map(entry => entry.id), ['plugin.demo.run', 'plugin.demo.other'], '同 id 只留第一条')
  assert.equal(entries[0].command.title, '第一条')
  // 菜单行是同一个判断的消费者：平铺形态下也不能出现重复 id
  const rows = pluginMenuRows([plugin({ commands: [command({ id: 'run' }), command({ id: 'run' })] })], { run: () => {} })
  assert.deepEqual(rows.map(row => row.id), ['plugin.demo.run'])
})

test('插件贡献的实时模板进模板列表，且被用户模板与内建模板正确排序', () => {
  const source = { id: 'demo', enabled: true, templates: [{ key: 'hello', body: 'console.log("hi");', description: '插件模板', languages: ['typescript'] }] }
  const entries = effectiveTemplates('a.ts', defaultTemplateSettings, [source])
  const plugin_entry = entries.find(entry => entry.pattern === pluginTemplatePattern('demo', source.templates[0]))
  assert.ok(plugin_entry, '插件模板要出现在模板列表里')
  assert.equal(plugin_entry.template.body, 'console.log("hi");')
  // Java 文件里不该出现（插件只声明了 typescript）
  assert.equal(effectiveTemplates('A.java', defaultTemplateSettings, [source]).some(entry => entry.pattern.startsWith('plugin:')), false)
})

test('插件模板参与遮蔽同 key 的内建模板，用户自定义模板优先级更高', () => {
  const shadow = { id: 'demo', templates: [{ key: 'log', body: 'plugin.log();', description: '盖掉内建 log', languages: ['typescript'] }] }
  const entries = effectiveTemplates('a.ts', defaultTemplateSettings, [shadow])
  // 内建 log 是 `template:log:typescript`；插件同 key 时它要被遮蔽
  assert.equal(entries.some(entry => entry.pattern === 'template:log:typescript'), false)
  assert.equal(expand('log', 3, 'a.ts', defaultTemplateSettings, [shadow]).text, 'plugin.log();')

  const custom = { key: 'log', body: 'user.log();', description: '用户的', languages: ['typescript'] }
  const settings = { overrides: [], customs: [custom] }
  // 用户模板在前 -> expand 先命中它
  assert.equal(expand('log', 3, 'a.ts', settings, [shadow]).text, 'user.log();')
  assert.match(candidates('lo', 2, 'a.ts', settings, [shadow]).map(item => item.description).join(), /用户的/)
})

test('停用或清单损坏的插件不贡献模板（与命令同一条判断）', () => {
  const off = { id: 'demo', enabled: false, templates: [{ key: 'x', body: 'x', description: 'd', languages: [] }] }
  const broken = { id: 'bad', error: '坏清单', templates: [{ key: 'y', body: 'y', description: 'd', languages: [] }] }
  assert.equal(effectiveTemplates('a.ts', defaultTemplateSettings, [off, broken]).some(entry => entry.pattern.startsWith('plugin:')), false)
})

test('接线：菜单装配、编辑器模板与包围选择器都接上了插件', () => {
  const menuUi = read('src/menuUi.ts')
  assert.match(menuUi, /pluginMenuRows/)
  assert.match(menuUi, /PLUGIN_MENU_LABEL/)
  const app = read('src/App.vue')
  assert.match(app, /pluginList,/)
  assert.match(app, /:plugin-templates="pluginList"/)
  assert.match(read('src/components/CodeEditor.vue'), /props\.pluginTemplates/)
  assert.match(read('src/surroundTemplates.ts'), /pluginList/)
  assert.equal(PLUGIN_MENU_LABEL, '插件')
})
