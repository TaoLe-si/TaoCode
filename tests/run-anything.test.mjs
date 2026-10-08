import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildRunAnythingRows, commandDisplayName, commandFromQuery, itemKey, loadRunAnythingHistory,
  pushRunAnythingHistory, RUN_ANYTHING_GROUP_LIMITS, RUN_ANYTHING_GROUP_TITLES, splitCommandLines,
} from '../src/runAnything.ts'

const configs = [
  { name: 'MyApp', type: 'application' },
  { name: 'All tests', type: 'junit' },
]

test('commandFromQuery：> 前缀是显式命令，空输入没有命令', () => {
  assert.equal(commandFromQuery('> gradle build'), 'gradle build')
  assert.equal(commandFromQuery('  '), '')
  assert.equal(commandFromQuery('npm run dev'), 'npm run dev')
})

test('空查询：历史在配置前，命令行在最后', () => {
  const history = [{ kind: 'config', name: 'MyApp', detail: '运行配置' }]
  const rows = buildRunAnythingRows(configs, '', history)
  assert.deepEqual(rows.map(row => `${row.kind}:${row.name}`), [
    'history:MyApp', 'config:MyApp', 'config:All tests', 'command:gradle build',
  ].slice(0, 3))
  assert.equal(rows[rows.length - 1]?.kind, 'config')
})

test('空查询 + 空白输入不产生命令行', () => {
  const rows = buildRunAnythingRows(configs, '   ', [])
  assert.ok(rows.every(row => row.kind !== 'command'))
  assert.equal(rows.length, 2)
})

test('非空查询：子串过滤，未命中的配置丢掉', () => {
  const rows = buildRunAnythingRows(configs, 'myapp', [])
  assert.equal(rows[0]?.name, 'MyApp')
  assert.ok(!rows.some(row => row.name === 'All tests'))
  // 命令行恒在最后。
  assert.equal(rows[rows.length - 1]?.kind, 'command')
  assert.equal(rows[rows.length - 1]?.name, 'myapp')
})

test('非空查询下历史进最近组、配置进一般组（组内前缀优先）', () => {
  const history = [{ kind: 'command', name: 'npm run all tests', detail: '在项目根目录运行命令' }]
  const rows = buildRunAnythingRows([...configs, { name: 'ball game', type: 'application' }], 'all', history)
  // 组顺序与上游 RunAnythingSearchListModel 一致：最近组在最前（见 src/runAnything.ts）。
  assert.equal(rows[0]?.kind, 'history')
  assert.equal(rows[0]?.group, 'recent')
  assert.equal(rows[0]?.sourceKind, 'command')
  const general = rows.filter(row => row.group === 'general')
  assert.deepEqual(general.map(row => row.name), ['All tests', 'ball game'], '同组内前缀命中排前面')
  assert.ok(rows.some(row => row.name === 'npm run all tests'))
  assert.equal(RUN_ANYTHING_GROUP_TITLES.recent, '最近')
  assert.equal(RUN_ANYTHING_GROUP_TITLES.command, '命令行')
})

test('显式命令写法即使与配置同名也保留命令行', () => {
  const rows = buildRunAnythingRows(configs, '> MyApp', [])
  const command = rows.filter(row => row.kind === 'command')
  assert.deepEqual(command.map(row => row.name), ['MyApp'])
})

test('历史读写：同 key 顶到最前并截断（localStorage 不可用时退化为空）', () => {
  assert.deepEqual(loadRunAnythingHistory(), [])
  const next = pushRunAnythingHistory({ kind: 'command', name: 'npm test', detail: '在项目根目录运行命令' })
  assert.equal(next[0]?.name, 'npm test')
  assert.deepEqual(itemKey({ kind: 'config', name: 'x' }), 'config:x')
})

test('组上限：一般组满 15 条折成「更多」，展开后全给（上游 getMaxInitialItems + RunAnythingMore）', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ name: `cfg-${index}`, type: 'application' }))
  const capped = buildRunAnythingRows(many, '', [])
  assert.equal(capped.filter(row => row.group === 'general').length, RUN_ANYTHING_GROUP_LIMITS.general + 1)
  const more = capped.find(row => row.kind === 'more')
  assert.equal(more?.group, 'general')
  assert.equal(more?.name, '更多（还有 5 个）')
  const expanded = buildRunAnythingRows(many, '', [], { expanded: ['general'] })
  assert.equal(expanded.filter(row => row.group === 'general').length, 20)
  assert.ok(!expanded.some(row => row.kind === 'more'))
})

test('组上限：最近组满 10 条折成「更多」，命令历史仍带原始类别', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({ kind: 'command', name: `cmd-${index}`, detail: '命令' }))
  const rows = buildRunAnythingRows([], '', history)
  assert.equal(rows.length, RUN_ANYTHING_GROUP_LIMITS.recent + 1)
  assert.equal(rows[rows.length - 1]?.kind, 'more')
  assert.equal(rows[0]?.sourceKind, 'command', '命令历史必须按命令行重跑，不能当同名配置')
})

test('多行命令：折成第一行 + 行数显示，执行用原文', () => {
  const command = 'cd build\ncmake --build .\nctest'
  assert.deepEqual(splitCommandLines(command), ['cd build', 'cmake --build .', 'ctest'])
  assert.equal(commandDisplayName(command), 'cd build …（3 行）')
  assert.equal(commandDisplayName('  cmake --build .  '), 'cmake --build .')
  const rows = buildRunAnythingRows([], '> cd build\ncmake --build .', [])
  assert.equal(rows[0]?.name, 'cd build\ncmake --build .', '行名保留原文（emit 给 App 的是原文）')
})

test('执行侧收得下执行上下文的目录（run.start 的 cwd 不再写死工作区根）', () => {
  const source = readFileSync(new URL('../src/runActions.ts', import.meta.url), 'utf8')
  assert.match(source, /async function runExternalTool\(command: string, name: string, cwd\?: string \| null\)/,
    '外部工具那条通道要能接调用方给的目录（null = 用户没选上下文，与 undefined 同义退回工作区根）')
  assert.match(source, /cwd: cwd\?\.trim\(\) \|\| workspace\.value\.root/,
    '给了就用它、没给才退回工作区根')
})
