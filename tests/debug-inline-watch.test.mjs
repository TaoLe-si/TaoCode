// 行内监视（`src/debugInlineWatch.ts`）—— 上游 `InlineWatch`
// （`platform/xdebugger-impl/shared/src/com/intellij/xdebugger/impl/inline/InlineWatch.kt`）：
// 位置（:23-27）、只在同一文件暂停时求值（:13-16）、行尾锚点（:70-72）、
// 文档改动后重锚 / 锚点失效即移除（:35-44、:79-81）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INLINE_WATCH_LIMIT, addInlineWatch, inlineWatchText, isInlineWatchVisible, normalizeInlineWatch,
  removeInlineWatch, reanchorInlineWatch, reanchorInlineWatches, visibleInlineWatches,
} from '../src/debugInlineWatch.ts'

test('归一：路径反斜杠归一 + 去尾斜杠；表达式/路径/行号非法一律丢掉', () => {
  assert.deepEqual(
    normalizeInlineWatch({ expression: '  user.name  ', path: 'src\\main\\User.java\\', line: 12.9 }),
    { expression: 'user.name', path: 'src/main/User.java', line: 12 },
  )
  assert.equal(normalizeInlineWatch({ expression: '  ', path: 'a.java', line: 1 }), null)
  assert.equal(normalizeInlineWatch({ expression: 'x', path: '  ', line: 1 }), null)
  assert.equal(normalizeInlineWatch({ expression: 'x', path: 'a.java', line: 0 }), null)
  assert.equal(normalizeInlineWatch({ expression: 'x', path: 'a.java', line: Number.NaN }), null)
})

test('只在同一个文件里暂停时才可见（InlineWatch.kt:13-16）', () => {
  const watch = { expression: 'user.name', path: 'src/User.java', line: 12 }
  assert.equal(isInlineWatchVisible({ watches: [watch], pausedPath: 'src\\User.java' }, watch), true)
  assert.equal(isInlineWatchVisible({ watches: [watch], pausedPath: 'src/Other.java' }, watch), false)
  assert.equal(isInlineWatchVisible({ watches: [watch], pausedPath: null }, watch), false)
  // 可见的按行号排序，同行按表达式排稳。
  const state = {
    watches: [
      { expression: 'b', path: 'src/User.java', line: 20 },
      { expression: 'a', path: 'src/User.java', line: 10 },
      { expression: 'z', path: 'src/User.java', line: 10 },
    ],
    pausedPath: 'src/User.java',
  }
  assert.deepEqual(visibleInlineWatches(state).map(entry => entry.expression), ['a', 'z', 'b'])
  // 停到别的文件 ⇒ 一条都不画。
  assert.deepEqual(visibleInlineWatches({ ...state, pausedPath: 'src/Other.java' }), [])
})

test('渲染文本与行内值同一形态 `表达式 = 值`；空值给占位', () => {
  const watch = { expression: 'user.name', path: 'src/User.java', line: 12 }
  assert.equal(inlineWatchText(watch, ' John '), 'user.name = John')
  assert.equal(inlineWatchText(watch, ''), 'user.name = （空）')
  assert.equal(inlineWatchText(watch, undefined), 'user.name = （空）')
  assert.equal(inlineWatchText(watch, 'a\n  b'), 'user.name = a b', '行内不换行')
})

test('加/删：同表达式同位置不重复加，越限丢最旧的', () => {
  let watches = addInlineWatch([], { expression: 'a', path: 'p.java', line: 3 })
  assert.equal(watches.length, 1)
  // 同一条再加没有变化。
  assert.equal(addInlineWatch(watches, { expression: 'a', path: 'p.java', line: 3 }).length, 1)
  // 同一表达式、不同位置 = 另一条（上游按位置锚定）。
  assert.equal(addInlineWatch(watches, { expression: 'a', path: 'p.java', line: 9 }).length, 2)
  // 非法输入不改变集合。
  assert.deepEqual(addInlineWatch(watches, { expression: '', path: 'p.java', line: 3 }), watches)

  const many = Array.from({ length: INLINE_WATCH_LIMIT + 3 }, (_, index) => ({ expression: `e${index}`, path: 'p.java', line: index + 1 }))
  const capped = many.reduce((list, watch) => addInlineWatch(list, watch), [])
  assert.equal(capped.length, INLINE_WATCH_LIMIT)
  assert.equal(capped[0].expression, 'e3', '丢最旧的')

  assert.deepEqual(removeInlineWatch(watches, watches[0]), [])
})

test('重锚：行号变了就搬走，锚点失效（行号 < 1）即移除（updatePosition :35-44）', () => {
  const watch = { expression: 'a', path: 'p.java', line: 3 }
  assert.deepEqual(reanchorInlineWatch(watch, 5), { expression: 'a', path: 'p.java', line: 5 })
  assert.equal(reanchorInlineWatch(watch, 3), watch, '没变就返回原对象')
  assert.equal(reanchorInlineWatch(watch, 0), null)
  assert.equal(reanchorInlineWatch(watch, -2), null)
})

test('批量重锚：喂进来的新行号生效，没喂到的照旧（文件被删由调用方整份清空）', () => {
  const watches = [
    { expression: 'a', path: 'p.java', line: 3 },
    { expression: 'b', path: 'p.java', line: 8 },
  ]
  const lines = new Map([['p.java:a', 4]])
  const moved = reanchorInlineWatches(watches, lines)
  assert.deepEqual(moved, [{ expression: 'a', path: 'p.java', line: 4 }, { expression: 'b', path: 'p.java', line: 8 }])
  assert.deepEqual(reanchorInlineWatches(watches, new Map([['p.java:a', 0]])), [watches[1]], '失效的那条被移除')
})
