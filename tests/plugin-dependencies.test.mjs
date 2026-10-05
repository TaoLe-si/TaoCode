// 插件依赖（`plugin.json` 的 `depends` / `optionalDepends`）在本仓分成两半：
//   · 原生侧 `native/plugins.cpp`：解析、反向引用、连带启用/停用（行为由 `native/plugins_test.cpp` 覆盖）；
//   · 前端 `src/pluginGroups.ts` / `src/pluginCommands.ts`：加载判定、筛选、详情摘要、复选框可用性。
//
// 这个文件钉住前端那一半的规则，以及**两端字段名对齐** —— 原生 `to_json` 写出的键
// 就是 `PluginInfo` 读的字段；一边改名另一边不会编译报错（JSON 是无类型的），只能机检。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildInstalledGroups,
  matchesInstalledQuery,
  parseInstalledQuery,
  pluginCanToggle,
  pluginDependencySummary,
  pluginEnabledCount,
  pluginIsBroken,
  pluginIsEnabled,
  pluginIsLoadable,
} from '../src/pluginGroups.ts'
import { enabledPlugins } from '../src/pluginCommands.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

function plugin(overrides = {}) {
  return { id: 'app', name: '应用', version: '1.0', description: '', path: 'C:/p/app', enabled: true, commands: [], templates: [], ...overrides }
}

test('依赖不满足的插件不加载：不算已启用、不贡献命令、不能点启用', () => {
  const broken = plugin({ broken: '缺少依赖插件：lib', missingDependencies: ['lib'], depends: ['lib'] })
  const ok = plugin({ id: 'lib', name: '库' })
  assert.equal(pluginIsBroken(broken), true)
  assert.equal(pluginIsEnabled(broken), false, '依赖不满足的插件不可能是"已启用"')
  assert.equal(pluginIsLoadable(broken), false)
  assert.equal(pluginEnabledCount([broken, ok]), 1)
  assert.deepEqual(enabledPlugins([broken, ok]).map(entry => entry.id), ['lib'],
    '命令贡献只从加载得了的插件来')
  assert.equal(pluginCanToggle(broken), false, '必需依赖缺装时复选框不可点')
  assert.equal(pluginCanToggle(ok), true)
})

test('依赖停用（装齐了但被关掉）也算 broken，但仍可点启用（启用会连带打开依赖）', () => {
  const pluginWithDisabledDep = plugin({ broken: '依赖的插件已停用：lib', disabledDependencies: ['lib'], depends: ['lib'] })
  assert.equal(pluginIsLoadable(pluginWithDisabledDep), false)
  assert.equal(pluginCanToggle(pluginWithDisabledDep), true, '依赖装着，点启用能把它带起来')
})

test('清单坏掉的插件仍然不可点（error 优先）', () => {
  const invalid = plugin({ error: 'plugin.json 不是合法 JSON', commands: [] })
  assert.equal(pluginCanToggle(invalid), false)
  assert.equal(pluginIsLoadable(invalid), false)
})

test('依赖摘要是人话：只列真实存在的部分，没依赖给空串', () => {
  assert.equal(pluginDependencySummary(plugin()), '')
  assert.equal(pluginDependencySummary(plugin({ depends: ['a', 'b'] })), '必需：a、b')
  assert.equal(pluginDependencySummary(plugin({ optionalDepends: ['c'] })), '可选：c')
  assert.equal(
    pluginDependencySummary(plugin({ depends: ['a'], optionalDepends: ['c'], missingDependencies: ['a'], requiredBy: ['d'] })),
    '必需：a · 可选：c · 缺少：a · 依赖它的：d')
  assert.equal(
    pluginDependencySummary(plugin({ depends: ['a'], disabledDependencies: ['a'] })),
    '必需：a · 已停用：a')
})

test('/invalid 同时收"清单读不出来"与"依赖不满足"，/enabled 不收 broken', () => {
  const invalidQuery = parseInstalledQuery('/invalid')
  const enabledQuery = parseInstalledQuery('/enabled')
  const broken = plugin({ broken: '缺少依赖插件：lib', missingDependencies: ['lib'] })
  const unreadable = plugin({ id: 'raw', error: '清单无法读取' })
  const healthy = plugin({ id: 'fine' })
  assert.equal(matchesInstalledQuery(broken, invalidQuery), true)
  assert.equal(matchesInstalledQuery(unreadable, invalidQuery), true)
  assert.equal(matchesInstalledQuery(healthy, invalidQuery), false)
  assert.equal(matchesInstalledQuery(broken, enabledQuery), false)
  assert.equal(matchesInstalledQuery(healthy, enabledQuery), true)
})

test('组级动作跳过依赖缺装的插件，组标题的启用计数也不含它', () => {
  const groups = buildInstalledGroups([
    plugin({ id: 'a', name: 'A', broken: '缺少依赖插件：x', missingDependencies: ['x'] }),
    plugin({ id: 'b', name: 'B' }),
  ], [])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].plugins.length, 2)
  assert.deepEqual(groups[0].action.ids, ['b'], '不能启用的插件不进组级动作')
  assert.match(groups[0].title, /已启用 1\/2/, 'broken 不算已启用')
})

test('两端字段名对齐：原生 to_json 的键就是 PluginInfo 的字段', () => {
  const hpp = read('native/plugins.hpp')
  const cpp = read('native/plugins.cpp')
  for (const field of ['depends', 'optional_depends', 'missing_dependencies', 'disabled_dependencies', 'required_by', 'broken'])
    assert.ok(hpp.includes(field), `plugins.hpp 少了字段 ${field}`)
  for (const key of ['"depends"', '"optionalDepends"', '"missingDependencies"', '"disabledDependencies"', '"requiredBy"', '"broken"'])
    assert.ok(cpp.includes(key), `to_json 少了键 ${key}`)
})

test('原生侧真的做了依赖解析与连带启停（不是只加字段）', () => {
  const cpp = read('native/plugins.cpp')
  assert.match(cpp, /plugin\.broken = "缺少依赖插件："/, '缺装要写进 broken')
  assert.match(cpp, /plugin\.broken = "依赖的插件已停用："/, '依赖停用也要写进 broken')
  assert.match(cpp, /DEPENDENCY_MISSING/, '启用缺依赖要拒绝')
  assert.match(cpp, /affected\.count\(dependency\)/, '停用要连带（递归）停用依赖它的插件')
})
