// 速度搜索（IDEA `SpeedSearch`）的纯逻辑判据：匹配规则、命中定位、按键归属。
//
// 上游：`MinusculeMatcherImpl.kt`（驼峰子序列）、`SpeedSearchBase.java`（findElement / 键盘）、
// `SpeedSearchComparator.java`（默认从中间开始匹配）、`SpeedSearchActionPromoter.kt`（盖过 Find in Path）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { firstSpeedSearchHit, isWordStartAt, nextSpeedSearchHit, SPEED_SEARCH_HINT,
         speedSearchKeyAction, speedSearchMatches, speedSearchStepForKey } from '../src/speedSearch.ts'

test('大小写不敏感，但大写字母必须落在词首（MinusculeMatcherImpl.kt:303-305）', () => {
  assert.equal(speedSearchMatches('abc', 'Abc'), true, '小写 pattern 命中词首大写')
  assert.equal(speedSearchMatches('ac', 'Abc'), true, '子序列也算命中')
  assert.equal(speedSearchMatches('aB', 'aBC'), true, '词首的大写 B 可以')
  assert.equal(speedSearchMatches('aB', 'abC'), false, '词中的大写 C 不能当作 B 之外的词首')
  assert.equal(speedSearchMatches('bs', 'buildSystem'), true, '驼峰缩写')
  assert.equal(speedSearchMatches('bs', 'BuildSystem'), true, '词首大写同样算')
})

test('顺序必须一致，空 pattern 放行一切', () => {
  assert.equal(speedSearchMatches('ba', 'abc'), false, '顺序反了不命中')
  assert.equal(speedSearchMatches('', 'whatever'), true)
  assert.equal(speedSearchMatches('  ', 'whatever'), true, '全是空白等于空 pattern')
  assert.equal(speedSearchMatches('*', 'whatever'), true)
})

test('默认"从中间开始"：pattern 前不必加 * 就能命中中间（SpeedSearchComparator.java:59-61）', () => {
  assert.equal(speedSearchMatches('sys', 'buildSystem'), true)
  assert.equal(speedSearchMatches('Sys', 'buildSystem'), true)
})

test('词首判定：非字母数字之后算词首，大小写切换也算', () => {
  assert.equal(isWordStartAt('buildSystem', 0), true, '下标 0 恒为词首')
  assert.equal(isWordStartAt('buildSystem', 5), true, 'S 前是小写 b 且自身大写')
  assert.equal(isWordStartAt('build_system', 6), true, '下划线之后算词首')
  assert.equal(isWordStartAt('buildSystem', 6), false, '词中的小写 y 不是词首')
})

test('定位第一条命中（findElement）；空 pattern 不选中任何东西', () => {
  const labels = ['README.md', 'buildSystem.kt', 'TestRunner.kt']
  assert.equal(firstSpeedSearchHit(labels, 'bs'), 1, 'buildSystem 是第一条命中')
  assert.equal(firstSpeedSearchHit(labels, 'zzz'), -1, '没有命中就 -1（上游 findElement 返回 null）')
  assert.equal(firstSpeedSearchHit(labels, ''), -1, '空串不该跳走 —— 焦点还在搜索框里')
})

test('下一条命中先迈一步再找、走完一圈回绕（findNextElement）', () => {
  const labels = ['a.kt', 'ab.kt', 'ac.kt']
    assert.equal(nextSpeedSearchHit(labels, 'a', 2, 1), 0, '到底回绕')
  assert.equal(nextSpeedSearchHit(labels, 'a', 0, -1), 2, '反向往上同样回绕')
  assert.equal(nextSpeedSearchHit(labels, 'zzz', 0, 1), -1)
})

test('键盘归属照 SpeedSearchBase.java:958-1002', () => {
  assert.equal(speedSearchKeyAction('Escape', 'ab'), 'hide', 'Esc 收搜索框')
  assert.equal(speedSearchKeyAction('Enter', 'ab'), 'accept', '回车把焦点交回列表（确认选中）')
  assert.equal(speedSearchKeyAction('ArrowDown', 'ab'), 'navigate', '上下键在命中项之间移动（搜索框自己处理，:684-691）')
  assert.equal(speedSearchKeyAction('ArrowUp', 'ab'), 'navigate')
  assert.equal(speedSearchKeyAction('Home', 'ab'), 'navigate', 'Home 去第一条')
  assert.equal(speedSearchKeyAction('ArrowLeft', 'ab'), 'accept', '左右键交回列表（行内导航）')
  assert.equal(speedSearchKeyAction('Backspace', ''), 'ignore', '空串上退格要吞掉，焦点不许弹出搜索框')
  assert.equal(speedSearchKeyAction('a', ''), 'ignore')
})

test('上下/Home/End 映射到命中项之间的移动（findTargetElement:695-706）', () => {
  assert.deepEqual(speedSearchStepForKey('ArrowDown'), { kind: 'next' })
  assert.deepEqual(speedSearchStepForKey('ArrowUp'), { kind: 'previous' })
  assert.deepEqual(speedSearchStepForKey('Home'), { kind: 'first' })
  assert.deepEqual(speedSearchStepForKey('End'), { kind: 'last' })
  assert.equal(speedSearchStepForKey('a'), null)
})

test('提示文字来自上游那一条 bundle 键', () => {
  // editorsearch.search.hint=Search（ApplicationBundle.properties:661）
  assert.equal(SPEED_SEARCH_HINT, '搜索')
})
