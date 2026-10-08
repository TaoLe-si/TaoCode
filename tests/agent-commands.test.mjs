// Agent 斜杠命令表：五条 id、解析、大小写、过滤、可用条件、用法提示、冻结，逐条钉住。
// 只测表与纯函数本身；面板怎么接线是 `AgentPanel.vue` 自己的判据，不在这里重复。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_COMMANDS,
  isAgentCommandInput,
  matchAgentCommands,
  parseAgentCommand,
} from '../src/agentCommands.ts'

const IDS = ['new', 'clear', 'review', 'keep-all', 'settings']

function commandById(id) {
  const found = AGENT_COMMANDS.find(command => command.id === id)
  assert.ok(found, `表里应该有 ${id}`)
  return found
}

const NONE = { hasMessages: false, hasPendingEdits: false }
const ALL = { hasMessages: true, hasPendingEdits: true }

test('表只有这五条，id 固定且无重名、无空 id，label 与 description 非空', () => {
  assert.deepEqual(AGENT_COMMANDS.map(command => command.id), IDS)
  assert.equal(new Set(IDS).size, IDS.length, 'id 不得重复')
  for (const command of AGENT_COMMANDS) {
    assert.ok(command.id.trim(), 'id 不得为空')
    assert.ok(command.label.trim(), `${command.id} 的 label 不得为空`)
    assert.ok(command.description.trim(), `${command.id} 的 description 不得为空`)
    assert.ok(command.label.startsWith('/'), `${command.id} 的显示名要以斜杠开头`)
  }
})

test('takesArgument 为真必须有 argumentHint，为假不得有', () => {
  for (const command of AGENT_COMMANDS) {
    if (command.takesArgument) {
      assert.equal(typeof command.argumentHint, 'string')
      assert.ok(command.argumentHint.trim(), `${command.id} 吃参数就得有提示`)
    } else {
      assert.equal(command.argumentHint, undefined, `${command.id} 不吃参数就不得有 argumentHint`)
    }
  }
  assert.equal(commandById('new').takesArgument, true)
})

test('parse：不是命令、只有斜杠、认不出的名字都是 null', () => {
  assert.equal(parseAgentCommand('不是命令'), null)
  assert.equal(parseAgentCommand('/'), null)
  assert.equal(parseAgentCommand('/不存在'), null)
  assert.equal(isAgentCommandInput('不是命令'), false)
  assert.equal(isAgentCommandInput('/clear'), true)
})

test("parse：'/clear' 无参数，'/new 我的会话' 留下参数，'/clear 多余参数' 拒绝", () => {
  assert.deepEqual(parseAgentCommand('/clear'), { id: 'clear', argument: '' })
  assert.deepEqual(parseAgentCommand('/new 我的会话'), { id: 'new', argument: '我的会话' })
  assert.equal(parseAgentCommand('/clear 多余参数'), null)
})

test('命令名大小写不敏感；参数保留内部空格与中文', () => {
  assert.deepEqual(parseAgentCommand('/CLEAR'), { id: 'clear', argument: '' })
  assert.equal(parseAgentCommand('/Export'), null)
  assert.deepEqual(parseAgentCommand('/New  我的 会话 '), { id: 'new', argument: '我的 会话' })
  assert.deepEqual(parseAgentCommand('/new'), { id: 'new', argument: '' }, '会话名可省')
})

test("match：空查询返回全部且顺序与表一致；'clear' 只含 clear", () => {
  assert.deepEqual(matchAgentCommands('').map(command => command.id), IDS)
  assert.deepEqual(matchAgentCommands('clear').map(command => command.id), ['clear'])
  assert.deepEqual(matchAgentCommands('CLEAR').map(command => command.id), ['clear'])
})

test('match：过滤只打在命令名上，不打在中文显示名或参数提示上', () => {
  assert.deepEqual(matchAgentCommands('导出'), [])
  assert.deepEqual(matchAgentCommands('设置'), [])
  assert.deepEqual(matchAgentCommands('会话名'), [])
  assert.deepEqual(matchAgentCommands('不存在'), [])
  assert.deepEqual(matchAgentCommands('xyz'), [])
  assert.deepEqual(matchAgentCommands('keep').map(command => command.id), ['keep-all'])
})

test('enabledWhen：每条给出满足与不满足的现场', () => {
  const gated = [
    ['clear', 'hasMessages'],
    ['review', 'hasPendingEdits'],
    ['keep-all', 'hasPendingEdits'],
  ]
  for (const [id, flag] of gated) {
    const command = commandById(id)
    assert.equal(typeof command.enabledWhen, 'function', `${id} 应该有 enabledWhen`)
    assert.equal(command.enabledWhen(ALL), true, `${id} 在 ${flag} 为真时可用`)
    assert.equal(command.enabledWhen({ ...ALL, [flag]: false }), false, `${id} 在 ${flag} 为假时不可用`)
    assert.equal(command.enabledWhen(NONE), false)
  }
  // new 与 settings 不设门槛：空现场也该可用。
  for (const id of ['new', 'settings']) {
    const command = commandById(id)
    assert.equal(command.enabledWhen, undefined, `${id} 不设 enabledWhen`)
    assert.equal(command.enabledWhen?.(NONE) ?? true, true)
  }
})

test('AGENT_COMMANDS 冻结：表本身与每一条都改不动', () => {
  assert.equal(Object.isFrozen(AGENT_COMMANDS), true)
  assert.throws(() => { AGENT_COMMANDS.push({ id: 'x', label: '/x', description: 'x' }) }, TypeError)
  for (const command of AGENT_COMMANDS) {
    assert.equal(Object.isFrozen(command), true)
    assert.throws(() => { command.id = 'tampered' }, TypeError)
  }
})
