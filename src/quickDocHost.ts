// 快速文档弹层的**宿主**：状态（当前页 + 前进/后退历史）+ 取文档 + 链接动作。
// 纯模型在 `src/quickDocLayout.ts`（区块/分节/几何）与 `src/quickDocHistory.ts`（前进后退），
// 这里只做「装配 + 副作用」。
//
// 分工与上游同构：
//   · `DocumentationManager` 取文档 → `show()`（LSP `textDocument/hover`，结果进 hover 缓存）；
//   · `DocumentationTarget` 那一层 → `QuickDocPage`（一次解析的完整结果，history 存的就是它）；
//   · `DocumentationBrowserHistory` → `history`（`src/quickDocHistory.ts`）；
//   · `DocumentationViewExternalAction`（`platform/lang-impl/.../ide/actions/
//     DocumentationViewExternalAction.kt:15`）→ `openExternalDoc()`：只有当前页**有**外部
//     URL 时才可点，点了走 `shell.openUrl`（上游是 `openUrl(...)` → `browseAbsolute`，
//     `platform/lang-impl/.../ide/impl/links.kt:51-58`）。
//
// 「翻页」在本仓有**两个**入口（都不是编造出来的）：
//   ① 点文档里的**符号引用**（`{@link Foo#bar}`）→ `resolveDocSymbolTarget`（`src/docSymbolTarget.ts`，
//      上游 `DefaultTargetSymbolDocumentationTargetProvider.kt:18-20` 的等价物）把名字落成
//      「声明位置 + 在那里取一次 hover」→ `nextPage()` 压历史 → 换一页。这条就是上游那条链。
//   ② 弹层开着时**移动光标**（`documentation.auto.update`，默认开）→ 跟着刷这一页；
//      这一条**不**压历史（上游自动刷新不是"用户点进新的一页"）。
// 历史因此是真会被用到：`{@link Foo}` 点进去 → 「后退」回到第一份文档。

import { onScopeDispose, ref, watch } from 'vue'
import { request, type BinaryView, type LspDocumentSymbol, type LspWorkspaceSymbol } from './bridge.ts'
import { createDocHoverContent, registerSharedDocHover } from './docHoverContent.ts'
import { parseQuickDoc, isSafeDocImageSource, isInlineDocImageSource, type DocImage, type DocLink } from './documentationView.ts'
import { isSymbolDocReference, resolveDocSymbolTarget, type DocSymbolQueries, type DocSymbolTarget } from './docSymbolTarget.ts'
import { docHoverPolicy, DOC_AUTO_UPDATE_QUIESCENCE_MS, shouldAutoUpdateDoc, shouldRefreshDocPage, toggleDocHoverPolicy, type DocHoverPolicy } from './docHoverPolicy.ts'
import { errorMessage } from './errors.ts'
import { openExternalUrl } from './externalLinkLauncher.ts'
import { createHoverDocumentation, type HoverCache } from './hoverDocumentation.ts'
import { imageMimeFor, resolveImagePath } from './literalPreview.ts'
import { serverHintFor } from './lsSessionHost.ts'
import { documentSymbolEntries, mergeWorkspaceSymbols } from './lspSymbolBridge.ts'
import { buildQuickDocLayout, currentExternalUrl, type QuickDocLayout } from './quickDocLayout.ts'
import { createDocumentationHistory, type DocumentationHistory } from './quickDocHistory.ts'
import type { Tab } from './editorTab.ts'

/** 单张图片的读取上限（与 `src/components/MarkdownPreview.vue:27` 的 `MAX_BYTES` 同值）。 */
const IMAGE_LIMIT = 4 * 1024 * 1024

/** 一次文档解析的完整结果 —— 上游一页 `DocumentationTarget` 的等价物。 */
export interface QuickDocPage {
  layout: QuickDocLayout
  /** 弹层锚点（`showInBestPositionFor(editor)`，坐标来自 `EditorHandle.getCursorCoords`）。 */
  x: number
  y: number
  /** 这份文档是从哪里来的 —— 标题栏显示，纯展示。 */
  origin: string
  /**
   * 这一页**属于哪个文件**（不是标题栏那行字）。自动更新那一拍要靠它分辨
   * 「光标在当前文件挪」和「这一页是点 `{@link Foo}` 从别的文件取来的」——
   * 后者不该被前者的光标抢走（上游 `DocumentationToolWindowManager.kt:112-114` 的
   * `getVisibleReusableContent()` 同样按内容归属决定刷不刷）。
   */
  docPath: string
}

export interface QuickDocHostDeps {
  notify: (message: string, error?: boolean) => void
  /** 浏览器预览里没有 `shell.openUrl`，外部链接要如实说不能开。 */
  isDesktop: boolean
  active: { readonly value: Tab | undefined }
  lspReady: { readonly value: boolean }
  editorFor: (path: string) => { getCursor(): { line: number; ch: number }; getCursorCoords(): { left: number; bottom: number } | null } | undefined
  request: typeof request
  /** 打开代码菜单时顺手关掉它（上游 `AbstractPopup` 独占一层）。 */
  menu: { value: unknown }
  /** 内部 `file:` 链接：落回工作区相对路径后跳过去（与 `App.vue` 的 `openDocumentLink` 同一条链）。 */
  revealLocation: (target: { path: string; line: number }) => unknown
  /** 工作区根（绝对路径要落回相对路径才找得到；落在外面就如实说明）。 */
  workspaceRoot: () => string | undefined
  /**
   * hover 结果缓存（`HoverResultCache` 的等价物，`src/hoverDocumentation.ts` 的 `createHoverCache`）。
   *
   * **由调用方建好后注入**，宿主自己不建：那张缓存在本仓是 `src/editorFileOps.ts` 与
   * 补全文档共用的一张（`tests/hover-documentation.test.mjs` 钉着它在那一行），
   * 宿主再建一张就成了两份缓存各记各的。
   */
  hoverCache: HoverCache
}

export function createQuickDocHost(deps: QuickDocHostDeps) {
  const { notify, isDesktop, active, lspReady, editorFor, request, menu, revealLocation, workspaceRoot, hoverCache } = deps
  const quickDoc = ref<QuickDocPage | null>(null)
  const cache = hoverCache
  /**
   * 取文档的**唯一**通道（上游 `LspDocumentationTargetProvider` 的等价物，见
   * `src/docHoverContent.ts` 文件头）。建好后登记成全仓共享的那一张 —— 编辑器 hover
   * 那条入口（保留文件 `CodeEditor.vue`，见接线请求）拿到的就是同一个缓存。
   */
  const hoverContent = registerSharedDocHover(createDocHoverContent({
    cache,
    request: request as <T>(method: string, params: Record<string, unknown>) => Promise<T>,
  }))

  /** 一页 = 布局 + 锚点 + 来源 + 归属文件。历史与 `quickDoc` 存的是同一个形状。 */
  function page(layout: QuickDocLayout, x: number, y: number, origin: string, docPath: string): QuickDocPage {
    return { layout, x, y, origin, docPath }
  }

  const history: DocumentationHistory<QuickDocPage> = createDocumentationHistory<QuickDocPage>(
    () => quickDoc.value as QuickDocPage,
    value => { quickDoc.value = value },
  )

  /**
   * 取一份 hover（带缓存）。`path` 可以是**别的文件** —— 符号引用解析出来的 target 常在
   * 另一个文件里（上游读 PSI 没有这个限制，本仓读语言服务就有：那份文档要先被 didOpen 过）。
   * 取不到时返回 null，由调用方给**如实**的那句话。
   *
   * 命中口径在 `src/docHoverContent.ts`/`src/hoverDocumentation.ts`：位置相同，或**上一次 hover
   * 的区间包含这个位置**（上游 `HoverResultCache.kt:11-12`）。服务器没给区间时退化成
   * 「同一位置才命中」，与上游 `TextRangeAndMarkupContent.kt:16-20` 的零长回退一致。
   */
  async function fetchHover(path: string, line: number, character: number): Promise<string | null> {
    const tab = findTabOf(path)
    const stamp = tab ? `${String(tab.version)}:${tab.dirty ? 'dirty' : 'clean'}` : 'external'
    const target = await hoverContent.targetAt({ path, line, character, stamp })
    return target?.contents ?? null
  }

  /** 缓存与文档账都要按路径找那份文档；不是当前标签页时只能按路径查活动标签。 */
  function findTabOf(path: string): Tab | undefined {
    return active.value?.path === path ? active.value : undefined
  }

  /** 把一份 hover 内容摆成弹层的一页。`remember` = 先把当前页压进历史（上游 `nextPage()`）。 */
  function present(contents: string, x: number, y: number, origin: string, remember: boolean, docPath: string) {
    if (remember && quickDoc.value) history.nextPage()
    quickDoc.value = page(buildQuickDocLayout(createHoverDocumentation(contents), parseQuickDoc(contents)), x, y, origin, docPath)
  }

  /** 取一份文档并摆好弹层。`origin` 只是标题栏那行字。 */
  async function showAt(line: number, character: number, origin: string, remember = true) {
    const tab = active.value
    if (!tab || !lspReady.value) { notify('请先打开一个有语言服务的文件。', true); return }
    menu.value = null
    // 上游 `LspPendingClient.kt:46-58` `showLspServerNotReadyHint`：客户端还在握手中给的是**提示**，
    // 不是"此处没有文档"那种把用户引向错误结论的话。本仓的状态表由 `lsp.open` 回包填
    // （`src/lspCompletionStartup.ts` → `src/lsSessionHost.ts`），这里只是读它。
    const hint = serverHintFor(tab.path)
    if (hint) { notify(hint, true); return }
    try {
      const contents = await fetchHover(tab.path, line, character)
      if (contents === null) { notify('此处没有文档。', true); return }
      // 弹层已经开着 → 沿用它的锚点（同一块面板换内容，不跟着光标跳）；第一次打开才贴光标。
      const coords = quickDoc.value ? null : editorFor(tab.path)?.getCursorCoords()
      const x = coords?.left ?? quickDoc.value?.x ?? 200
      const y = coords?.bottom ?? quickDoc.value?.y ?? 200
      present(contents, x, y, origin, remember, tab.path)
    } catch (error) { notify(errorMessage(error), true) }
  }

  /** Ctrl+Q / 菜单「快速文档」：光标处取文档。 */
  async function showQuickDoc() {
    const tab = active.value
    const editor = tab ? editorFor(tab.path) : undefined
    if (!tab || !editor) { notify('请先打开一个文件。', true); return }
    const cursor = editor.getCursor()
    await showAt(cursor.line, cursor.ch, tab.path)
  }

  /**
   * 符号型 target：文档里点一条 `{@link Foo#bar(int)}` → 把这个名字落成声明位置 → 在那里取
   * hover → 换一页（`src/docSymbolTarget.ts`，上游 `DefaultTargetSymbolDocumentationTargetProvider.kt:18-20`）。
   * 拆不出符号、或拆出来了但那份文档取不到，都给**具体**的一句话而不是静默不动。
   */
  async function showSymbolDoc(link: DocLink) {
    const tab = active.value
    if (!tab) { notify('请先打开一个文件。', true); return }
    const queries: DocSymbolQueries = {
      // 文件内符号：`documentSymbolEntries` 里 selectionRange 优先（跳转要落在元素名那一段），
      // 与结构视图/「文件内符号」搜索取的是同一个位置口径（`src/lspSymbolBridge.ts`）。
      symbolsInFile: async path => {
        try {
          const result = await request<{ available: boolean; symbols?: LspDocumentSymbol[] }>('lsp.request', { kind: 'documentSymbol', path })
          return documentSymbolEntries(result.symbols ?? [], path)
        } catch { return [] }
      },
      // 工作区符号：多来源合并/kind 过滤/去重/排序在 `mergeWorkspaceSymbols`
      // （上游 `LspWorkspaceSymbolContributor.kt:44-89`）。
      workspaceSymbols: async query => {
        try {
          const result = await request<{ available: boolean; symbols?: LspWorkspaceSymbol[] }>('lsp.request', { kind: 'workspaceSymbol', path: tab.path, query })
          return mergeWorkspaceSymbols([result.symbols ?? []], { query })
        } catch { return [] }
      },
    }
    let target: DocSymbolTarget | null
    try { target = await resolveDocSymbolTarget(link.target, tab.path, queries) }
    catch (error) { notify(errorMessage(error), true); return }
    if (!target) { notify(`解析不出符号「${link.target}」：语言服务没有这个名字的声明位置。`, true); return }
    try {
      const contents = await fetchHover(target.path, target.line, target.character)
      if (contents === null) {
        notify(`${target.origin} 的声明在 ${target.path}:${String(target.line + 1)}，但那份文档取不到（该文件还没同步给语言服务）。`, true)
        return
      }
      // 换页**不动弹层位置**：上游是同一块面板换内容（`DocumentationBrowser` 不换锚点）。
      const at = { x: quickDoc.value?.x ?? 200, y: quickDoc.value?.y ?? 200 }
      present(contents, at.x, at.y, `${target.origin}（${target.path}:${String(target.line + 1)}）`, true, target.path)
    } catch (error) { notify(errorMessage(error), true) }
  }

  /**
   * **自动更新**（`documentation.auto.update`，默认开，`DocumentationToolWindowManager.kt:55`）：
   * 弹层开着时光标挪了 → 这一页跟着换。
   * 信号来自当前标签页的 `line/column` —— 那两个字段由编辑器在选区变化时写
   * （`App.vue:2157` 的 `@cursor` → `tab.line/tab.column`），所以这里只 watch，不需要宿主接线。
   * 去抖一档：300ms（`DOC_AUTO_UPDATE_QUIESCENCE_MS`，出处 `LspHighlightingCache.kt:264-269` 的
   * `LOW_PRIORITY_QUIESCENCE_DELAY` —— 文档这一类"打字时纯属装饰"的拉取都压在这个窗口之后）。
   * 自动刷新**不压历史**：上游的自动刷新不是"用户点进新的一页"（`nextPage()` 只由链接点击触发）。
   */
  let autoTimer: number | undefined
  let lastShown: { line: number; character: number } | null = null
  watch(() => {
    const tab = active.value
    return tab ? `${tab.path}:${String(tab.line)}:${String(tab.column)}` : ''
  }, () => {
    if (autoTimer !== undefined) { clearTimeout(autoTimer); autoTimer = undefined }
    const tab = active.value
    // 弹层关了、或者这一页是**别的文件**的符号文档（点 `{@link Foo}` 那一步）—— 光标在当前文件动
    // 不该把它抢走；上游的"可复用 tab"同样按内容归属决定刷不刷（`DocumentationToolWindowManager.kt:112-114`）。
    if (!tab || !quickDoc.value || quickDoc.value.docPath !== tab.path) { lastShown = null; return }
    const next = { line: tab.line, character: tab.column }
    if (!shouldRefreshDocPage(lastShown, next)) return
    autoTimer = window.setTimeout(() => {
      autoTimer = undefined
      // 档位是在去抖**之后**才问的（上游同样在真正刷新那一刻读属性：
      // `DocumentationToolWindowManager.kt:121` 的 `if (!autoUpdate)`、`:191`/`:219` 的 `if (autoUpdate)`）。
      // 少了这一句，用户在这 300ms 里把「选区更改时自动刷新文档」关掉，已经排下去的那一拍照样会刷新一页。
      if (!shouldAutoUpdateDoc()) { lastShown = null; return }
      const current = active.value
      if (!current || !quickDoc.value || quickDoc.value.docPath !== current.path) return
      lastShown = { line: current.line, character: current.column }
      void showAt(current.line, current.column, current.path, false)
    }, DOC_AUTO_UPDATE_QUIESCENCE_MS)
  })
  onScopeDispose(() => { if (autoTimer !== undefined) clearTimeout(autoTimer) })

  function closeQuickDoc() { quickDoc.value = null; lastShown = null }
  function goBackward() { history.backward() }
  function goForward() { history.forward() }
  function canGoBackward() { return history.canBackward() }
  function canGoForward() { return history.canForward() }

  /**
   * `DocumentationViewExternalAction`（`DocumentationViewExternalAction.kt:14-23`）：
   * 没有当前外部 URL 时**不做任何事**，也不报错 —— 上游那时这个动作根本不可见。
   * 打开走 `src/externalLinkLauncher.ts` 那一条出口（上游的「未信任先问那一句」就长在
   * `browse()` 里，`BrowserLauncherAppless.kt:99`），这里只把注入的 `request` 当作最后的运输。
   */
  async function openExternalDoc() {
    const url = quickDoc.value ? currentExternalUrl(quickDoc.value.layout) : null
    if (!url) return
    if (!isDesktop) { notify(`浏览器预览里不能打开外部链接：${url}`, true); return }
    try { await openExternalUrl(url, next => request('shell.openUrl', { url: next })) }
    catch (error) { notify(errorMessage(error), true) }
  }
  /** 这个动作现在该不该可点（`isEnabledAndVisible`，`DocumentationViewExternalAction.kt:15`）。 */
  function canOpenExternalDoc() {
    return quickDoc.value ? currentExternalUrl(quickDoc.value.layout) !== null : false
  }

  /**
   * 弹层里点一条链接 —— 两条不同的上游通道，按链接形状分派：
   *   · **符号引用**（`{@link Foo#bar}`，不带路径分隔符）→ 走 `showSymbolDoc`，也就是上游
   *     `DefaultTargetSymbolDocumentationTargetProvider.kt:18-20` 那条「符号 → 文档」的链，
   *     结果是**换一页**（`nextPage()` 压历史），不是跳编辑器；
   *   · **带路径的 `file:` / 相对路径链接** → 跳到那个文件的对应行（上游是
   *     `GotoDeclarationHandler` / `OpenFileDescriptor`；`DocLink.target` 已由 `classifyDocLink`
   *     解成本机路径）。
   *
   * 落在工作区外的**如实说明**而不是拿猜出来的路径去开（与 `App.vue` 的 `openDocumentLink` 同一口径）。
   * 弹层**不关**：上游的文档面与编辑器导航是并存的（`KeepTabAction` 就是给这个面留位置的）。
   */
  function followInternalDocLink(link: DocLink) {
    if (link.kind !== 'internal' || !link.target) return
    if (isSymbolDocReference(link)) { void showSymbolDoc(link); return }
    const root = workspaceRoot()?.replace(/\\/g, '/').replace(/\/+$/, '')
    let path = link.target.replace(/\\/g, '/')
    if (root && (/^[A-Za-z]:/.test(path) || path.startsWith('/'))) {
      if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) path = path.slice(root.length + 1)
      else { notify(`该链接指向工作区外的文件：${link.target}`, true); return }
    }
    // `filePathFromUri` 解出来的行号是 1 基，`revealLocation` 用 0 基。
    void revealLocation({ path, line: Math.max(0, (link.line ?? 0) - 1) })
  }

  /**
   * 图片：工作区内的源走宿主读字节再转 data URL，`http(s):` 直接给 `<img src>` 让 WebView2 自己取
   * （`DocumentationImageResolver.resolveImage(url)` 的契约：解不出来就返回 `null`，
   * `platform/lang-impl/src/com/intellij/lang/documentation/DocumentationImageResolver.java:21`）。
   *
   * 相对路径按**所在文件**的目录解析（与 `src/literalPreview.ts` 的图片字面量、`src/markdown.ts`
   * 的 Markdown 预览同一口径：hover 里的 `![](img/x.png)` 是相对当前 .java 写的，不是相对工作区根）。
   */
  async function resolveImage(image: DocImage, documentPath: string): Promise<string | null> {
    // 上游 `XssSafeLinks.kt:9-11`：`vbscript:` / `javascript:` / 非图片的 `data:` 一律不给地址
    // （本仓没有 HTML pane，落回 alt 文本就是「不画破图」）。
    if (!isSafeDocImageSource(image.src)) return null
    // `data:image/(gif|png|jpeg|webp|svg)` 上游明确放行（`:11`），字节已经在源串里，不用再读文件。
    if (isInlineDocImageSource(image.src)) return image.src
    if (image.external) return image.src
    if (/^file:/i.test(image.src)) {
      // `file:` URI 带的是绝对路径，本仓的图片读取是**工作区相对**的（`file.readBinary`）——
      // 与 `src/literalPreview.ts:144` 同一个判断：不硬转，直接当解不出来。
      return null
    }
    const path = resolveImagePath({ kind: 'image', from: 0, to: 0, path: image.src, label: image.src }, documentPath)
    if (!path) return null
    const mime = imageMimeFor(path)
    if (!mime) return null
    try {
      const view = await request<BinaryView>('file.readBinary', { path, limit: IMAGE_LIMIT })
      if (!view?.base64) return null
      // MIME 以宿主**嗅探出来的** `kind` 为准（与 `src/components/MarkdownPreview.vue:43` 同一口径）：
      // 名字写着 `.png` 而内容不是 PNG 时，照扩展名编 mime 只会得到一张破图 ——
      // 上游 `DocumentationImageResolver.java:21` 的契约是「解不出来就 `null`」，渲染层据此退回 alt 文本。
      // 宿主没给 `kind`（老桥接、单元测试里的假回包）才退回扩展名那一份。
      const kind = typeof view.kind === 'string' && view.kind ? (view.kind === 'jpg' ? 'jpeg' : view.kind) : ''
      const sniffed = kind ? imageMimeFor(`x.${String(kind)}`) : mime
      if (!sniffed) return null
      return `data:${sniffed};base64,${view.base64}`
    } catch { return null }
  }

  return {
    quickDoc, showQuickDoc, showAt, showSymbolDoc, closeQuickDoc,
    goBackward, goForward, canGoBackward, canGoForward,
    openExternalDoc, canOpenExternalDoc, followInternalDocLink, resolveImage,
    // 弹层齿轮那两档（`ToggleShowDocsOnHoverAction` / `ToggleAutoUpdateAction`）：
    // 读的是 `src/docHoverPolicy.ts` 那份运行时真值，写回来顺手产出设置补丁交给宿主持久化。
    docPolicy: docHoverPolicy,
    toggleDocPolicy: (key: keyof DocHoverPolicy) => toggleDocHoverPolicy(key),
  }
}
