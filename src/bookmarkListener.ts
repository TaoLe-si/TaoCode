// **书签事件面** —— 上游 `BookmarksListener`（`platform/bookmarks/src/com/intellij/ide/bookmarks/
// BookmarksListener.java`）在本仓的插件入口。
//
// 上游是什么：`BookmarksListener` 是一个 **MessageBus Topic**
// （`Topic<BookmarksListener> TOPIC = Topic.create("Bookmarks", BookmarksListener.class)`），
// 四个 default 空方法 `bookmarkAdded(Bookmark)` / `bookmarkRemoved(Bookmark)` /
// `bookmarkChanged(Bookmark)` / `bookmarksOrderChanged()`；`BookmarkManagerImpl` 在增/删/改/重排
// 后分别 `bus.syncPublisher(TOPIC).bookmarkAdded(...)` 广播。插件用
// `connection.subscribe(BookmarksListener.TOPIC, listener)` 订阅 —— 这是**第三方能观察书签表的
// 唯一官方口子**。本仓此前只有 Vue 响应式（表变 ⇒ 依赖它的 computed 重算，见
// `docs/inventory/verdict-bookmarks.md` 的 `BookmarksListener` 行），**没有插件可订的对象**。
//
// 本文件补上那一层，形状与上游逐条对齐：
//   · 主题名 `Bookmarks`（上游 `Topic.create` 的第一个实参），本仓按 EP 名承载
//     （与 `src/extensionPoints.ts` 里 `FILE_EDITOR_MANAGER_LISTENER_EP` /
//     `SHELVE_CHANGES_MANAGER_LISTENER_EP` 两条消息主题同口径）；
//   · 四个**同名**回调（大小写逐字相同），缺省都不做事（上游是 default 空方法）；
//   · 订阅口 `onBookmarksEvent(listener)` 返回注销函数（上游 `subscribe` 返回的 `Disposable`
//     在本仓是取消订阅函数）；
//   · 广播口 `dispatchBookmarksChange(prev, next)` 按**表的前后两份**算出增/删/改/重排四类事件
//     再逐个投给订阅者 —— 上游逐次显式调用那四种，本仓由差异算出，语义等价（同 key 视为同一条）。
//
// 纯数据层：只 import `src/bookmarks.ts`（书签形状）与 `src/extensionPoints.ts`（EP 宿主），
// 不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/bookmarks-listener.test.mjs`。

import { EXTENSIONS, APPLICATION_SCOPE, type ExtensionHandle } from './extensionPoints.ts'
import type { Bookmark } from './bookmarks.ts'

/**
 * 书签事件主题。上游 `Topic.create("Bookmarks", …)` 的名字就是 `Bookmarks`；本仓按
 * 监听接口的全限定名承载（与 `FILE_EDITOR_MANAGER_LISTENER_EP` 同一口径，便于按 id 挂贡献）。
 */
export const BOOKMARKS_LISTENER_EP = 'com.intellij.ide.bookmarks.BookmarksListener'

declareBundledExtensionPoints()

/** 该 EP 的声明（模块加载即声明，第三方贡献按同一 id 挂）。 */
function declareBundledExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: BOOKMARKS_LISTENER_EP,
    name: '书签事件监听',
    scope: APPLICATION_SCOPE,
    dynamic: true,
  })
}

/**
 * 上游 `BookmarksListener` 的可移植子集：四个回调都可选（上游是 default 空方法）。
 */
export interface BookmarksListener {
  /** 新增了一条书签（上游 `bookmarkAdded`）。 */
  bookmarkAdded?: (bookmark: Bookmark) => void
  /** 删掉了一条书签（上游 `bookmarkRemoved`）。 */
  bookmarkRemoved?: (bookmark: Bookmark) => void
  /** 某条书签变了（助记键 / 行原文锚 / 自定义描述；上游 `bookmarkChanged`）。 */
  bookmarkChanged?: (bookmark: Bookmark) => void
  /** 表内顺序变了（成员没变；上游 `bookmarksOrderChanged`）。 */
  bookmarksOrderChanged?: () => void
}

/**
 * 一条书签的身份键：路径 + 行号（文件书签的行号是缺省，用 `file` 占位）。
 * 与 `src/bookmarks.ts` 的 `Bookmark` 语义一致 —— 同一 (path, line) 只能是同一条。
 */
export function bookmarkKey(entry: Bookmark): string {
  return `${entry.path}\u0000${entry.line === undefined ? 'file' : entry.line}`
}

/** 相邻两条书签在**内容**上是否等价（身份之外的全部字段）。 */
function sameContent(a: Bookmark, b: Bookmark): boolean {
  return a.mnemonic === b.mnemonic && a.text === b.text && a.description === b.description
}

/** 一次表变化算出来的四类事件（上游四次广播的可判等价物）。 */
export interface BookmarksChangeEvents {
  added: Bookmark[]
  removed: Bookmark[]
  changed: Bookmark[]
  orderChanged: boolean
}

/**
 * 由表的前后两份算出四类事件。
 *   · `added` / `removed`：按身份键做集合差；
 *   · `changed`：同键且身份之外字段有变的那些（用新值，消费方要读变化后的样子）；
 *   · `orderChanged`：**成员未变**但键序列不同 —— 有增删时顺序变化由 added/removed 表达，
 *     不额外发（与上游"重排"是独立动作同口径）。
 */
export function bookmarksChangeEvents(prev: readonly Bookmark[], next: readonly Bookmark[]): BookmarksChangeEvents {
  const prevByKey = new Map<string, Bookmark>()
  for (const entry of prev) prevByKey.set(bookmarkKey(entry), entry)
  const nextByKey = new Map<string, Bookmark>()
  for (const entry of next) nextByKey.set(bookmarkKey(entry), entry)

  const added = next.filter(entry => !prevByKey.has(bookmarkKey(entry)))
  const removed = prev.filter(entry => !nextByKey.has(bookmarkKey(entry)))
  const changed = next.filter(entry => {
    const before = prevByKey.get(bookmarkKey(entry))
    return before !== undefined && !sameContent(before, entry)
  })
  const membershipSame = added.length === 0 && removed.length === 0
  const orderChanged = membershipSame
    && (prev.length === next.length)
    && prev.some((entry, index) => bookmarkKey(entry) !== bookmarkKey(next[index]!))

  return { added, removed, changed, orderChanged }
}

/**
 * 订阅书签事件。返回注销函数（上游 `connection.subscribe(...)` 的 `Disposable` 在本仓是函数）。
 * 订阅是一条 EP 贡献（`source: 'user'`），所以第三方插件的监听器与内建的走同一条分派链。
 */
export function onBookmarksEvent(listener: BookmarksListener, scope: string = APPLICATION_SCOPE): () => void {
  const id = `bookmarks.listener.${listenerSequence++}`
  const handle: ExtensionHandle = EXTENSIONS.registerExtension(BOOKMARKS_LISTENER_EP, id, listener, {
    scope, source: 'user',
  })
  return () => { handle.dispose() }
}

let listenerSequence = 0

/** 当前作用域下已订阅的全部监听器（已按 EP 的 `LoadingOrder` 排序）。 */
export function bookmarksListeners(scope: string = APPLICATION_SCOPE): BookmarksListener[] {
  return EXTENSIONS.extensionsOf<BookmarksListener>(BOOKMARKS_LISTENER_EP, scope)
}

/**
 * 把一次表变化投给所有订阅者，并回传算出来的事件（调用方/判据可核）。
 * 逐条书签逐个回调 —— 上游也是每条 `syncPublisher(...)` 一次。
 */
export function dispatchBookmarksChange(
  prev: readonly Bookmark[],
  next: readonly Bookmark[],
  scope: string = APPLICATION_SCOPE,
): BookmarksChangeEvents {
  const events = bookmarksChangeEvents(prev, next)
  const listeners = bookmarksListeners(scope)
  if (listeners.length) {
    for (const listener of listeners) {
      for (const bookmark of events.added) listener.bookmarkAdded?.(bookmark)
      for (const bookmark of events.removed) listener.bookmarkRemoved?.(bookmark)
      for (const bookmark of events.changed) listener.bookmarkChanged?.(bookmark)
      if (events.orderChanged) listener.bookmarksOrderChanged?.()
    }
  }
  return events
}
