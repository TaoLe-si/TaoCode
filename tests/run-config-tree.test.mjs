import test from 'node:test'
import assert from 'node:assert/strict'
import { RUN_CONFIG_TYPES, buildRunConfigTree, nodeKey, runConfigTypeLabel, uniqueRunConfigName, validateFolderName } from '../src/runConfigTree.ts'

const config = (name, extra = {}) => ({ name, command: 'run', ...extra })

// RunConfigurable.kt:170-183 —— 节点种类：类型（CONFIGURATION_TYPE）/ 文件夹（FOLDER，名字串）/ 配置。
test('the tree groups configurations by type and folder', () => {
  const tree = buildRunConfigTree([
    config('build', { type: 'shell' }),
    config('fmt', { type: 'shell', folder: '格式化' }),
    config('lint', { type: 'shell', folder: '检查' }),
    config('app', { type: 'application' }),
  ])
  assert.deepEqual(tree.map(node => node.id), ['shell', 'application'], 'only types that have configurations appear')
  const shell = tree[0]
  assert.deepEqual(shell.configs.map(entry => entry.name), ['build'], 'configurations without a folder sit directly under the type')
  assert.deepEqual(shell.folders.map(group => group.name), ['格式化', '检查'].sort((a, b) => a.localeCompare(b)), 'folders are sorted by name')
  assert.deepEqual(shell.folders.find(group => group.name === '检查').configs.map(entry => entry.name), ['lint'])
  assert.deepEqual(tree[1].configs.map(entry => entry.name), ['app'])
})

test('an empty or blank folder means "directly under the type"', () => {
  const tree = buildRunConfigTree([config('a', { folder: '' }), config('b', { folder: '   ' })])
  assert.equal(tree.length, 1)
  assert.deepEqual(tree[0].folders, [], 'blank folder names do not create a folder node')
  assert.deepEqual(tree[0].configs.map(entry => entry.name), ['a', 'b'])
})

test('a configuration without a type lands in the shell type', () => {
  const tree = buildRunConfigTree([config('plain')])
  assert.equal(tree[0].id, 'shell', 'the panel default is shell')
})

test('every type the panel offers has a label', () => {
  for (const entry of RUN_CONFIG_TYPES) assert.equal(runConfigTypeLabel(entry.id), entry.label)
  assert.equal(runConfigTypeLabel('something-else'), 'something-else', 'an unknown type keeps its raw id')
})

// RunConfigurable.kt:934 createUniqueName —— 新建/另存为时取名不能撞车。
test('a new configuration name is made unique', () => {
  const configs = [config('新配置'), config('新配置 2')]
  assert.equal(uniqueRunConfigName(configs, '新配置'), '新配置 3')
  assert.equal(uniqueRunConfigName(configs, '其它'), '其它')
  assert.equal(uniqueRunConfigName([], 'x'), 'x')
})

// 与原生 runConfigs[].folder 的校验同规则。
test('folder names are bounded and single-line', () => {
  assert.equal(validateFolderName('格式化'), null)
  assert.equal(validateFolderName(''), null, 'an empty name means "no folder"')
  assert.match(validateFolderName('f'.repeat(81)), /80/)
  assert.match(validateFolderName('a\nb'), /换行/)
  assert.match(validateFolderName('a\tb'), /制表符/)
})

test('node keys stay distinct across the three kinds', () => {
  assert.notEqual(nodeKey('type', 'shell'), nodeKey('config', 'shell'))
  assert.notEqual(nodeKey('folder', 'shell', 'x'), nodeKey('config', 'x'))
  assert.equal(nodeKey('config', 'build'), 'config:build')
})
