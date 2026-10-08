// 书签事件面（`src/bookmarkListener.ts`）的判据。
//
// 上游 `BookmarksListener` 是 MessageBus Topic（`BookmarksListener.java:10-16` 的
// `Topic<BookmarksListener> TOPIC = Topic.create("Bookmarks", …)` 与四个 default 空方法），
// 插件用 `connection.subscribe(BookmarksListener.TOPIC, listener)` 订阅 —— 这是第三方能观察
// 书签表的唯一官方口子。本仓把它落成 EP（`com.intellij.ide.bookmarks.BookmarksListener`）+
// 四条同名回调 + 由「表的前后两份」算出事件的分派口，消费点在 `src/bookmarkActions.ts`。
//
// 这组判据钉四件事：① 身份键与四类事件的算法规格；② 订阅/注销真的分派；
// ③ EP 已声明且贡献按作用域过滤；④ 宿主那条 watch 真的在投递（生产消费点没断）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BOOKMARKS_LISTENER_EP,
  bookmarkKey,
  bookmarksChangeEvents,
  bookmarksListeners,
  dispatchBookmarksChange,
  onBookmarksEvent,
} from '../src/bookmarkListener.ts'
import { EXTENSIONS, APPLICATION_SCOPE } from '../src/extensionPoints.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const line = (path, n, extra = {}) => ({ path, line: n, ...extra })
const file = (path, extra = {}) => ({ path, ...extra })

test('身份键：路径 + 行号，文件书签（无行号）与同路径的行书签互不相同', () => {
  assert.equal(bookmarkKey(line('a.cpp', 3)), 'a.cpp\u00003', '身份键 = 路径 + NUL + 行号')
  assert.notEqual(bookmarkKey(file('a.cpp')), bookmarkKey(line('a.cpp', 1)))
  assert.equal(bookmarkKey(line('a.cpp', 3)), bookmarkKey(line('a.cpp', 3)))
})

test('四类事件：增/删按身份键做集合差，改是同键内容变，重排只在成员未变时发', () => {
  const a = line('a.cpp', 1)
  const b = line('b.cpp', 2)
  const added = bookmarksChangeEvents([a], [a, b])
  assert.deepEqual(added.added.map(entry => entry.path), ['b.cpp'])
  assert.deepEqual(added.removed, [])
  assert.equal(added.orderChanged, false, '有增删时顺序变化由 added/removed 表达，不额外发重排')

  const removed = bookmarksChangeEvents([a, b], [b])
  assert.deepEqual(removed.removed.map(entry => entry.path), ['a.cpp'])
  assert.equal(removed.orderChanged, false)

  const changed = bookmarksChangeEvents([line('a.cpp', 1, { mnemonic: '1' })], [line('a.cpp', 1, { mnemonic: '2' })])
  assert.deepEqual(changed.changed.map(entry => entry.mnemonic), ['2'], 'changed 要给变化后的样子')
  assert.deepEqual(changed.added, [])
  assert.deepEqual(changed.removed, [])

  const sameContent = bookmarksChangeEvents([line('a.cpp', 1, { text: 'x' })], [line('a.cpp', 1, { text: 'x' })])
  assert.deepEqual(sameContent.changed, [], '身份外字段没变就不算改')

  const reordered = bookmarksChangeEvents([a, b], [b, a])
  assert.equal(reordered.orderChanged, true)
  assert.deepEqual(reordered.added, [])
  assert.deepEqual(reordered.removed, [])
})

test('订阅口：四条同名回调都收到对应事件，注销后不再投递', () => {
  const seen = []
  const dispose = onBookmarksEvent({
    bookmarkAdded: entry => seen.push(['added', entry.path, entry.line]),
    bookmarkRemoved: entry => seen.push(['removed', entry.path, entry.line]),
    bookmarkChanged: entry => seen.push(['changed', entry.path, entry.mnemonic]),
    bookmarksOrderChanged: () => seen.push(['order']),
  })
  const a = line('a.cpp', 1)
  const b = line('b.cpp', 2)
  const c = line('c.cpp', 7)
  // 第一次：成员未变、顺序翻转 ⇒ 只发重排。
  dispatchBookmarksChange([a, c], [c, a])
  // 第二次：b 是新增、c 被删、a 的助记键变了 ⇒ 增/删/改 三类，不额外交叉发重排。
  const events = dispatchBookmarksChange([a, c], [b, { ...a, mnemonic: '3' }])
  assert.deepEqual(seen, [['order'], ['added', 'b.cpp', 2], ['removed', 'c.cpp', 7], ['changed', 'a.cpp', '3']],
    '每条订阅者按 增/删/改/重排 的固定次序收到回调')
  assert.deepEqual(events.added.map(entry => entry.path), ['b.cpp'])

  dispose()
  dispatchBookmarksChange([a], [a, b])
  assert.equal(seen.length, 4, '注销之后不再投递')
})

test('EP 宿主：主题已声明，贡献按作用域过滤，bundled 与第三方走同一条分派链', () => {
  assert.ok(EXTENSIONS.hasExtensionPoint(BOOKMARKS_LISTENER_EP), `${BOOKMARKS_LISTENER_EP} 必须已声明`)
  const before = bookmarksListeners().length
  const off = onBookmarksEvent({ bookmarkAdded: () => {} }, 'D:/other-workspace')
  assert.equal(bookmarksListeners().length, before, '别的 scope 的订阅不进 application 视图')
  assert.equal(bookmarksListeners('D:/other-workspace').length, before + 1, '自己的 scope 里看得见')
  off()
  assert.equal(bookmarksListeners('D:/other-workspace').length, before)
  assert.equal(APPLICATION_SCOPE, 'application')
})

test('生产消费点：宿主把书签表的变化真的投给分派口（src/bookmarkActions.ts）', () => {
  const actions = readFileSync(join(root, 'src/bookmarkActions.ts'), 'utf8')
  assert.match(actions, /import \{[^}]*dispatchBookmarksChange[^}]*\} from '\.\/bookmarkListener\.ts'/)
  assert.match(actions, /watch\(bookmarks, \(next, prev\) => \{ dispatchBookmarksChange\(prev \?\? \[\], next\) \}\)/,
    '表一变就投递（唯一的口：所有增删改都写 bookmarks.value）')
})
