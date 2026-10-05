// 「弹层开着时数据变了就地刷新」—— `src/popupLiveUpdate.ts` 对
// `platform/lang-impl/src/com/intellij/ui/popup/PopupUpdateProcessor.java` 的照抄。
//
// 上游那三个触发源（`DocumentationManager` / `LookupManager` / `QuickSearchComponent`，
// `:5-13` 的 import、`:33-61` 的三个分支）本仓都没有对应物，所以本模块只承接**通道**。
// 这个文件钉的是那三条真正可移植的规则：
//   1. 监听是**显示那一刻**才挂的（`beforeShown`，`:32`），不是构造时；
//   2. 事件到了先问「弹层还可见吗」—— 不可见就顺手退订（`:38` / `:46-48`）；
//   3. 这一拍**没有新条目就不刷新**（`:39-40` `if (item != null)`）—— 选中项被清空时
//      弹层内容保持原样，不是清空。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLivePopupSource } from '../src/popupLiveUpdate.ts'

/** 造一个可手动推事件的数据源（替代上游那三个触发源）。 */
function makeSource(initial, onRefresh) {
  const state = { value: initial, reads: 0, subscribes: 0, stops: 0, listeners: [] }
  const source = createLivePopupSource({
    read() { state.reads++; return state.value },
    subscribe(listener) {
      state.subscribes++
      state.listeners.push(listener)
      return () => { state.stops++ }
    },
    ...(onRefresh ? { onRefresh } : {}),
  })
  return { state, source, emit: payload => state.listeners.forEach(listener => listener(payload)) }
}

test('构造时不取数也不挂监听 —— 监听是显示那一刻才挂的（上游 beforeShown 在 :32）', () => {
  const { state, source } = makeSource(['a'])
  assert.equal(state.reads, 0, '构造就取数 = 提前订阅，上游不是这个时序')
  assert.equal(state.subscribes, 0)
  assert.equal(source.isOpen(), false)
  assert.equal(source.isSubscribed(), false)
  assert.equal(source.revisions(), 0)

  source.open()
  assert.equal(state.reads, 1, 'open() 取一次数')
  assert.equal(state.subscribes, 1, 'open() 才挂监听')
  assert.equal(source.isOpen(), true)
  assert.equal(source.isSubscribed(), true)
  assert.deepEqual(source.value.value, ['a'])
})

test('open() 幂等：已经开着再调不会取第二次数、也不会挂第二个监听', () => {
  const { state, source } = makeSource(['a'])
  source.open()
  source.open()
  source.open()
  assert.equal(state.reads, 1)
  assert.equal(state.subscribes, 1)
})

test('事件带新条目 ⇒ 就地重算一次；revisions 只数真正刷新过的次数', () => {
  const seen = []
  const { state, source, emit } = makeSource(['a'], (next, previous) => seen.push([next, previous]))
  source.open()
  assert.equal(source.revisions(), 0, 'open() 里的首次取数不算一次刷新')

  state.value = ['a', 'b']
  emit(['a', 'b'])
  assert.equal(source.revisions(), 1)
  assert.deepEqual(source.value.value, ['a', 'b'], '弹层读到的是重算后的新内容')
  // onRefresh 是宿主那一侧的钩子（上游 `updatePopup`，:44）：拿到「新的 + 原来的」。
  assert.deepEqual(seen, [[['a', 'b'], ['a']]])
})

test('这一拍没有新条目（null/undefined）⇒ 不刷新，内容保持原样，不是清空（上游 :40）', () => {
  const { state, source, emit } = makeSource(['a'])
  source.open()
  state.value = ['a', 'b']
  emit(null)
  assert.equal(source.revisions(), 0)
  assert.deepEqual(source.value.value, ['a'], '弹层内容保持原样')
  emit(undefined)
  assert.equal(source.revisions(), 0)
  assert.deepEqual(source.value.value, ['a'])
})

test('弹层不可见时收到事件 ⇒ 不刷新，并把监听摘掉（上游 :38 与 :46-48）', () => {
  const { state, source, emit } = makeSource(['a'])
  source.open()
  assert.equal(state.stops, 0)
  source.close()
  assert.equal(state.stops, 1, 'close() 退订')
  // 关掉之后再推一拍（真实场景里监听摘之前队列里已有一拍）：不刷新、不抛。
  state.value = ['a', 'b']
  emit(['a', 'b'])
  assert.equal(source.revisions(), 0)
  assert.deepEqual(source.value.value, ['a'])
  assert.equal(state.stops, 1, 'close() 之后再收到事件不会重复退订')
})

test('close() 幂等；重开时重新取数并重新挂监听', () => {
  const { state, source } = makeSource(['a'])
  source.open()
  source.close()
  source.close()
  assert.equal(state.stops, 1, '重复 close() 不会调两次退订函数')
  assert.equal(source.isSubscribed(), false)

  state.value = ['a', 'b', 'c']
  source.open()
  assert.equal(state.reads, 2)
  assert.equal(state.subscribes, 2)
  assert.deepEqual(source.value.value, ['a', 'b', 'c'], '重开看到的是新数据')
})
