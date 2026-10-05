// exec/console 本轮的判据：输入历史（上游 CommandHistory + HistoryKeyListener）、
// 控制台编码（上游 ConsoleEncodingComboBox）与真实接线（runActions 挂监听、RunConsole 选择器）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { attachInputHistory, createCommandHistory, INPUT_HISTORY_LIMIT } from '../src/consoleInputHistory.ts'
import {
  CONSOLE_ENCODINGS, DEFAULT_CONSOLE_ENCODING, createConsoleDecoder, isKnownConsoleEncoding,
  readConsoleEncoding, writeConsoleEncoding,
} from '../src/consoleEncoding.ts'
import { runConsoleEncoding, setRunConsoleEncoding } from '../src/runInstances.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('历史：上键从末尾往回翻，先记未完成命令；翻到顶停住；下键越过末尾恢复未完成命令', () => {
  const history = createCommandHistory(5)
  assert.equal(history.up(''), null, '没有历史时不上翻')
  history.push('first')
  history.push('second')
  assert.equal(history.size, 2)
  assert.equal(history.up('third'), 'second')
  assert.equal(history.up('third'), 'first')
  assert.equal(history.up('third'), 'first', '到顶再按上键停住')
  assert.equal(history.down(), 'second')
  assert.equal(history.down(), 'third', '越过最后一条恢复未完成命令')
  assert.equal(history.down(), null, '已在末尾不再动')
  // 新条目进来：游标重置、未完成命令作废（上游 onNewEntry）。
  history.up('draft')
  history.push('third')
  assert.equal(history.down(), null, '游标回到末尾')
  assert.equal(history.up('x'), 'third')
})

test('历史：空行不记、超限丢最旧', () => {
  const history = createCommandHistory(2)
  history.push('a')
  history.push('   ')
  history.push('b')
  history.push('c')
  assert.equal(history.size, 2)
  assert.equal(history.at(0), 'b')
  assert.equal(history.at(1), 'c')
  assert.equal(INPUT_HISTORY_LIMIT > 0, true)
})

test('attachInputHistory：上下键改写输入框内容并 preventDefault，修饰键不抢，解绑生效', () => {
  const listeners = []
  const input = {
    value: '',
    addEventListener: (type, listener) => listeners.push({ type, listener }),
    removeEventListener: () => { listeners.length = 0 },
  }
  const history = createCommandHistory()
  history.push('run main')
  const detach = attachInputHistory(input, history)
  assert.equal(listeners.length, 1)
  const keydown = listeners[0].listener
  let prevented = false
  input.value = 'draft'
  keydown({ key: 'ArrowUp', ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => { prevented = true } })
  assert.equal(input.value, 'run main')
  assert.equal(prevented, true)
  prevented = false
  keydown({ key: 'ArrowDown', ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => { prevented = true } })
  assert.equal(input.value, 'draft', '下键恢复未完成命令')
  prevented = false
  keydown({ key: 'ArrowUp', ctrlKey: true, altKey: false, metaKey: false, preventDefault: () => { prevented = true } })
  assert.equal(prevented, false, 'Ctrl+Up 不抢')
  detach()
  assert.equal(listeners.length, 0, '解绑函数把监听摘掉')
})

test('编码：列表常用字符集、未知 id 退回 UTF-8、读写走存储', () => {
  assert.ok(CONSOLE_ENCODINGS.some(entry => entry.id === 'gbk'))
  assert.ok(isKnownConsoleEncoding('gbk'))
  assert.ok(!isKnownConsoleEncoding('nope'))
  assert.equal(DEFAULT_CONSOLE_ENCODING, 'utf-8')
  assert.equal(createConsoleDecoder('gbk').encoding, 'gbk')
  assert.equal(createConsoleDecoder('不存在的编码').encoding, 'utf-8', '不认识就退回 UTF-8 而不是抛')
  // GBK 解码：UTF-8 会把这两个字节解成替换符，GBK 能解出「中文」。
  const bytes = Uint8Array.from([0xD6, 0xD0, 0xCE, 0xC4])
  assert.equal(createConsoleDecoder('gbk').decode(bytes), '中文')
  const store = new Map()
  const fake = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) }
  assert.equal(readConsoleEncoding(fake), 'utf-8')
  writeConsoleEncoding(fake, 'gbk')
  assert.equal(readConsoleEncoding(fake), 'gbk')
  writeConsoleEncoding(fake, 'nope')
  assert.equal(readConsoleEncoding(fake), 'utf-8', '存储里的未知值按默认处理')
})

test('接线：runActions 挂历史监听并在发送时 push；runInstances 换解码器；RunConsole 有选择器', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /attachInputHistory\(element, inputHistory\)/)
  assert.match(actions, /inputHistory\.push\(line\)/)
  const instances = read('src/runInstances.ts')
  assert.match(instances, /let decoder = createConsoleDecoder\(currentConsoleEncoding\)/)
  assert.match(instances, /export function setRunConsoleEncoding/)
  assert.match(instances, /decoder = createConsoleDecoder\(id\)/)
  const console = read('src/components/RunConsole.vue')
  assert.match(console, /v-for="encoding in CONSOLE_ENCODINGS"/)
  assert.match(console, /aria-label="控制台编码"/)
  // 真实状态改到新解码器上（模块单例）。
  setRunConsoleEncoding('gbk')
  assert.equal(runConsoleEncoding.value, 'gbk')
  setRunConsoleEncoding('utf-8')
  assert.equal(runConsoleEncoding.value, 'utf-8')
})
