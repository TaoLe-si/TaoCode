// **文档浏览器**（上游 `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/
// DocumentationBrowser.kt` + `ide/ui/DocumentationToolWindowUI.kt` 一族）—— 纯状态模型，
// 零 Vue、零 DOM、零 bridge。
//
// 上游是什么：快速文档弹层之外还有一个**常驻的文档工具窗**（`DocumentationToolWindowManager`，
// `TOOL_WINDOW_ID = "documentation.v2"`，`:44`），它的内容页（`Content`）有两档：
//   · **可复用页**（reusable）：跟着光标自动更新，标题前面带一个 `*`
//     （`DocumentationToolWindowUI.kt:108-125` 的 `updateContentTab(browser, content, asterisk = true)`）；
//   · **钉住的页**（kept）：用户执行 `KeepTabAction` 之后**不再自动更新**，标题上的 `*` 去掉
//     （`DocumentationToolWindowUI.kt:105-114` 的 `keep()`：`Disposer.dispose(reusable)`、
//     把 reusable 置 null、再用 `asterisk = false` 重订阅标题、并把 `autoUpdate` 一并拆掉）；
//   · 换页：`nextPage()`（压历史）/`resetBrowser()`（**清空**历史，`DocumentationBrowser.kt:93-100`
//     的 `reset = true` 那一支）；
//   · 重载：`reload()`（同一页重取内容，不动历史）；
//   · `currentExternalUrl()`（`:160`）= 当前页的外部链接（「在浏览器中打开」那个动作的可用性）。
//
// 本仓现状：Ctrl+Q 的弹层 + 前进/后退（`src/quickDocHistory.ts` + `src/quickDocHost.ts`）已经落了，
// 但**没有"钉住/常驻"这一档** —— 弹层一关内容就没了，也没有"这个页面跟着光标自动刷新"与
// "钉住之后不再刷新"的区分。本文件补这一档的**纯模型**：页面身份、可复用/钉住两态、
// 标题前缀（`* `）、自动更新闸、以及 reset/reload/外部链接判定。
// UI 面（工具窗）要挂进冻结的 `src/App.vue`，所以这一层先落模型与判据，接线写成请求。
//
// 判据：`tests/documentation-browser.test.mjs`。

import { createDocumentationHistory, type DocumentationHistory } from './quickDocHistory.ts'

/** 浏览器里的一页（上游 `DocumentationPage` 的最小形状）。 */
export interface BrowserPage<T> {
  /** 页面身份（本仓用它判"是不是同一页"，上游是 `DocumentationRequest` 的 target）。 */
  id: string
  /** 页面的可展示标题（上游 `presentation.presentableText`）。 */
  title: string
  /** 页面内容（本仓是一次文档解析的结果，见 `src/quickDocLayout.ts`）。 */
  value: T
  /** 外部链接（上游 `currentContent?.links?.externalUrl`）—— 决定「在浏览器中打开」可不可点。 */
  externalUrl?: string | null
}

/** 一页在浏览器里的状态（上游 `Content` 的两档）。 */
export interface BrowserTab<T> {
  page: BrowserPage<T>
  /**
   * 可复用（自动更新）—— 上游 `DocumentationToolWindowUI.isReusable`。
   * `true` 时标题带 `* ` 前缀，且光标移动会刷新内容；`false`（钉住）之后两者都不再发生。
   */
  reusable: boolean
  /** 标题前缀：可复用页带 `* `，钉住页不带（上游 `updateContentTab(..., asterisk)`）。 */
  displayTitle: string
}

export interface DocumentationBrowser<T> {
  /** 当前页（没有就是 null）。 */
  current: () => BrowserTab<T> | null
  /** 打开一页。`reset = true` 时**清空历史**（上游 `resetBrowser`），否则压历史（`nextPage`）。 */
  open: (page: BrowserPage<T>, reset?: boolean) => void
  /** 同一页重取内容，不动历史（上游 `reload()`）；内容变了返回 true。 */
  reload: (value: T, externalUrl?: string | null) => boolean
  /** 换一页（压历史）——`open(page, false)` 的别名，读起来更像"点了个链接"。 */
  nextPage: (page: BrowserPage<T>) => void
  /** 钉住当前页（上游 `KeepTabAction` → `DocumentationWindowUI.keep()`）：关掉自动更新、去掉 `*`。 */
  keep: () => boolean
  /** 当前页是不是可复用（钉住之后 false）。 */
  isReusable: () => boolean
  /** 光标移动时该不该刷新这一页（可复用才刷；钉住/没页都不刷）。 */
  shouldAutoUpdate: () => boolean
  canBackward: () => boolean
  backward: () => boolean
  canForward: () => boolean
  forward: () => boolean
  /** 当前页的外部链接（上游 `currentExternalUrl()`）；没有页或没有链接时 null。 */
  currentExternalUrl: () => string | null
  /** 关掉浏览器（上游 `dispose()`：清历史）。 */
  close: () => void
}

/**
 * 建一个文档浏览器。`limit` 是历史的每栈上限（见 `src/quickDocHistory.ts`）。
 *
 * 钉住的语义**只影响"要不要自动更新"**：历史照旧可前后翻（上游 `keep()` 也没有动历史，
 * 它只拆掉 `reusable` 与 `autoUpdate` 两个 `Disposable`）。
 */
export function createDocumentationBrowser<T>(limit?: number): DocumentationBrowser<T> {
  let current: BrowserTab<T> | null = null
  const history: DocumentationHistory<BrowserTab<T>> = createDocumentationHistory<BrowserTab<T>>(
    () => current as BrowserTab<T>,
    value => { current = value },
    limit,
  )

  /** 标题前缀：可复用页带 `* `（上游 `asterisk = true` 那一支）。 */
  function tabOf(page: BrowserPage<T>, reusable: boolean): BrowserTab<T> {
    return { page, reusable, displayTitle: reusable ? `* ${page.title}` : page.title }
  }

  return {
    current: () => current,
    open: (page, reset = false) => {
      if (reset) history.clear()
      else if (current) history.nextPage()
      current = tabOf(page, true)
    },
    reload: (value, externalUrl) => {
      if (!current) return false
      const changed = current.page.value !== value || (current.page.externalUrl ?? null) !== (externalUrl ?? null)
      current = { ...current, page: { ...current.page, value, externalUrl: externalUrl ?? null } }
      return changed
    },
    nextPage: page => {
      if (current) history.nextPage()
      current = tabOf(page, true)
    },
    keep: () => {
      if (!current || !current.reusable) return false
      // 上游 `keep()`：拆 reusable、去掉 `*`、并把 autoUpdate 一并拆掉。
      current = tabOf(current.page, false)
      return true
    },
    isReusable: () => current?.reusable === true,
    shouldAutoUpdate: () => current?.reusable === true,
    canBackward: () => history.canBackward(),
    backward: () => history.backward(),
    canForward: () => history.canForward(),
    forward: () => history.forward(),
    currentExternalUrl: () => current?.page.externalUrl ?? null,
    close: () => { current = null; history.clear() },
  }
}
