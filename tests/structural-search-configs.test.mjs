// 结构化搜索的配置/模板管理（src/structuralSearchConfigs.ts）：
// 命名规则、收藏与最近使用、内置模板能真的被编译器吃下、变量补全候选。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_STRUCTURAL_TEMPLATES, configurationName, loadRecentConfigurations, loadSavedConfigurations,
  MAX_RECENT_CONFIGURATIONS, mergeRecentConfigurations, pushRecentConfiguration, removeConfiguration,
  saveConfiguration, variableCompletions, variableCompletionValues,
} from '../src/structuralSearchConfigs.ts'
import { compileStructuralPattern, compileStructuralReplacement } from '../src/structuralSearch.ts'

const config = overrides => ({
  name: '', query: '$x$ == null', replacement: '$x$ != null', structural: true,
  caseSensitive: false, wholeWord: false, regex: false, scope: '', created: 1, ...overrides,
})

test('配置名：取模板前 40 字符，超出截断加省略号（上游 RECENT_CONFIGURATION_NAME_LENGTH）', () => {
  assert.equal(configurationName('  $x$ == null  '), '$x$ == null')
  assert.equal(configurationName(''), '未命名模板')
  const long = 'a'.repeat(60)
  const named = configurationName(long)
  assert.equal(named.length, 41)
  assert.ok(named.endsWith('…'))
})

test('内置模板：每一份都能被文本子集编译器吃下（不留编译错误）', () => {
  assert.ok(BUILTIN_STRUCTURAL_TEMPLATES.length >= 4)
  for (const template of BUILTIN_STRUCTURAL_TEMPLATES) {
    const compiled = compileStructuralPattern(template.query)
    assert.ok(!('error' in compiled), `${template.name} 编译失败：${compiled.error}`)
    if (template.replacement) {
      const replacement = compileStructuralReplacement(template.replacement, compiled.variables)
      assert.ok(replacement.length > 0)
    }
  }
})

test('收藏：命名规则兜底、同名覆盖、删除', () => {
  assert.deepEqual(loadSavedConfigurations(), [])
  const first = saveConfiguration(config({ name: '空值' }))
  assert.equal(first[0].name, '空值')
  const replaced = saveConfiguration(config({ name: '空值', replacement: '$x$ != null  // 反选' }))
  assert.equal(replaced.length, 1, '同名覆盖不新增')
  assert.match(replaced[0].replacement, /反选/)
  const unnamed = saveConfiguration(config({ name: '   ', query: 'catch ($type$ $e$)' }))
  assert.equal(unnamed[0].name, 'catch ($type$ $e$)')
  const afterDelete = removeConfiguration('空值')
  assert.ok(!afterDelete.some(item => item.name === '空值'))
})

test('最近使用：上限 30、同名去重前插（纯合并函数，不依赖 localStorage）', () => {
  assert.deepEqual(loadRecentConfigurations(), [])
  let recent = []
  for (let index = 0; index < MAX_RECENT_CONFIGURATIONS + 5; ++index) {
    recent = mergeRecentConfigurations(recent, config({ name: `t-${index}` }))
  }
  assert.equal(recent.length, MAX_RECENT_CONFIGURATIONS)
  assert.equal(recent[0].name, `t-${MAX_RECENT_CONFIGURATIONS + 4}`)
  recent = mergeRecentConfigurations(recent, config({ name: 't-5' }))
  assert.equal(recent[0].name, 't-5')
  assert.equal(recent.filter(item => item.name === 't-5').length, 1)
  // push 也走同一条合并（Node 里存储不可用时只返回本次那条）。
  assert.deepEqual(pushRecentConfiguration(config({ name: 'once' })).map(item => item.name), ['once'])
})

test('变量补全：已用变量在前，常用起手名兜底，正在输入的不算', () => {
  assert.deepEqual(variableCompletions('$x$.equals($y$)'), ['x', 'y', 'args'])
  assert.deepEqual(variableCompletions('$foo$ + $foo$'), ['foo', 'x', 'y', 'args'])
  assert.deepEqual(variableCompletions('$x$ == $ab'), ['x', 'y', 'args'], '结尾半截名不算已用')
  assert.deepEqual(variableCompletionValues('$x$'), ['$x$', '$y$', '$args$'])
})
