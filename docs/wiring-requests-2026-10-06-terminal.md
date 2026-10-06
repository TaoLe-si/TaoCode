# 接线请求 · 终端族（代号 `terminal`，2026-10-06）

> 这份文档是**补落盘**的：派给 `terminal` 的代理在 150 次工具调用上限被切断时，代码已经全部落在工作区
> 并且门禁全绿，但它自己的 `docs/wiring-requests-2026-10-06-terminal.md` 没来得及写。
> `src/terminalHyperlinks.ts:52` 的文件头写着「接线写在 `docs/wiring-requests-2026-10-06-terminal.md` T1」，
> 当时那个文件不存在 —— 也就是说**代码引用了一份没有的文档**。本轮（`terminal2`）按它自己的注释把 T1 补齐，
> 内容取自 `src/terminalHyperlinks.ts` 文件头第 4 条与 `src/components/TerminalPanel.vue` 的现场。
> 留痕：原写「见接线请求 T1」而文件缺失，实际 T1 现在长这样。
>
> 主代理（Tao）批准后可直接照抄下面的替换段。两条都属于**同一件事**：给终端面板一条打开编辑器的通道。

---

## T1 · 终端输出里的 `file:` 链接要能跳编辑器

**用户可见的缺口**：终端里打印 `file:///D:/a/B.java:12`（Gradle/Maven/构建脚本很常见）时，
面板**判定得出**这是一个文件落点，但画不出链接——因为面板自己没有「打开编辑器」的出口，
`terminalLinkActivatable` 只能返回 `ok:false`（`src/terminalHyperlinks.ts:212-217`），
提示文案是「终端面板没有打开编辑器的通道（见接线请求 T1）。」

**上游依据**：
- 同一族链接在终端里就是**两层过滤器**：
  `platform/execution-impl/src/com/intellij/terminal/JBTerminalWidget.java:87-90`
  （`JediTermHyperlinkFilterAdapter` + `Osc8UrlHyperlinkFilter`）。
- `file:` 那一支的落点是 `buildFileHyperlinkInfo` → `FileUrlHyperlinkInfo`
  （`platform/execution-impl/src/com/intellij/execution/filters/UrlFilter.java:89-92` 与 `:164-201`），
  点开走 `navigate`：找不到文件才弹错误框（同文件 `:186-195`）。
- 终端侧的点击动作是 `setNavigateCallback { info.navigate(project) }`
  （`platform/execution-impl/src/com/intellij/terminal/JediTermHyperlinkFilterAdapter.kt:131-143`）。
  ⇒ 上游的终端**有**编辑器通道，本仓只差一条 emit + 一个监听。

**参照实现**：本轮 `terminal2` 已经在运行控制台上接好了同一条链路
（`src/consoleHyperlinks.ts` 的 `jumpPayload` + `src/components/RunConsole.vue` 的 `emit('jump', action.payload)`），
终端面板照同一个形状补即可；行列口径也一致（本仓 `RunIssue` 是 1 基，上游是 0 基）。

### 1) `src/components/TerminalPanel.vue`（终端域文件；等这条批准后由终端域落，主代理不必手改）

`attachLinkProvider` 里那句 `if (!verdict.ok || target.kind !== 'browser') return []` 是**临时**的否分支；
T1 落地后换成「文件命中 → `emit('jump', …)`」。三处：

```ts
// (a) emits 表（<script setup> 顶部）多一条 jump：
jump: [issue: { path: string; line: number; column: number }]
```

```ts
// (b) attachLinkProvider 内：文件命中不再被丢掉
const links = terminalHyperlinkRanges(text).flatMap(range => {
  const target = terminalLinkTarget(range.text)
  if (target.kind === 'file') {
    // 上游 FileUrlHyperlinkInfo 的行列是 0 基（UrlFilter.java:106 的 lastValue - 1），本仓 RunIssue 是 1 基。
    const issue = { path: target.path, line: (target.line ?? 0) + 1, column: (target.column ?? 0) + 1 }
    return [{
      range: { start: { x: range.start + 1, y: bufferLineNumber }, end: { x: range.end, y: bufferLineNumber } },
      text: range.text,
      decorations: { pointerCursor: true, underline: true },
      activate: () => { emit('jump', issue) },
      hover: () => { if (instance.element) instance.element.title = terminalLinkTooltip(target, true) },
      leave: () => { if (instance.element) instance.element.title = '' },
    }]
  }
  const verdict = terminalLinkActivatable(target, isDesktop)
  if (!verdict.ok) return []
  return [/* 既有那条 browser 分支，原样 */]
})
```

```ts
// (c) 文案跟着改：terminalLinkTooltip 里「（终端面板暂时打不开编辑器）」那一句要删掉否分支。
```

同时 `src/terminalHyperlinks.ts` 的 `terminalLinkActivatable` 去掉 `file` 那一条例外
（它现在的注释就写着「终端面板没有打开编辑器的通道」），
以及 `tests/terminal-hyperlinks.test.mjs:125-126`、`:134` 那三条断言要跟着翻转——
**那是终端域的判据，归这条请求一起改；判据与实现必须同时翻转**，不许只改生产代码。

### 2) `src/App.vue`（保留文件，只有主代理能改）

- **目标行**：`2248`（`<TerminalPanel … />` 那一行）。
- **`jumpToIssue` 已在同一作用域内**：`src/App.vue:1864` 从运行问题那组里解构出它，
  控制台的 `@jump` 用的就是同一个函数（`src/App.vue:2206`）⇒ **不需要新增 import**。
- **替换段**（在既有属性后加一个监听）：

```html
          <div v-show="bottomTab === 'terminal'" class="terminal-host-wrap"><TerminalPanel ref="terminalPanelRef" :active="bottomTab === 'terminal' && bottom" @focus-terminal="showOutput('terminal')" @jump="jumpToIssue" /></div>
```

**验收**：终端里 `echo file:///D:/TaoCode/src/App.vue:10` 之后 Ctrl/⌘+单击那段文字，编辑器要开到 `App.vue` 第 10 行；
判据是 `tests/terminal-hyperlinks.test.mjs` 里「file 命中不可点」那两条翻转成「可点」，
并新增一条消费链断言（面板里有 `emit('jump', issue)`）。

---

## T2 · 逐浏览器那几行菜单（终端与控制台都欠着）

**现状**：两边都只给了「在浏览器中打开（系统默认）」与「复制 URL」。
上游的菜单是**逐个活动浏览器**一行
（`platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java:44-67`，
文案 `platform/platform-api/resources/messages/IdeBundle.properties:1048` 的 `open.in.0=Open in {0}`）。

**卡在哪一环**：宿主通道 `shell.openUrlWithBrowser` 至今没进 `src/bridge.ts` 的 `Method` 联合类型
（现在只有 `'shell.openUrl'`，见 `src/bridge.ts:109`）。
`src/browsers.ts:336-348` 已经把请求体（`BrowserLaunchPayload`）与折算规则写全，
并说明通道本身要动的是保留文件 `native/main.cpp` / `native/browser_launch.cpp` / `CMakeLists.txt` /
`src/bridge.ts` / `native/settings_schema.cpp` —— **那条请求不是新的**，
它挂在 `docs/wiring-requests-2026-10-06-welcome.md`。

⇒ 这条只登记「通道一通，这两处就要补行」：
`src/consoleHyperlinks.ts` 的 `consoleLinkMenuItems`（现在返回 activate + copy 两格）、
`src/components/TerminalPanel.vue` 的 `terminalLinkTooltip`/link provider（终端那条菜单本仓没做，见 T1 的 (b)）。
在通道落地前**不渲染**只有系统默认那一行的假列表（`不放假控件`）。
