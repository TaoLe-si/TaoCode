# 接线请求 2026-10-06 · lane `stickyfold`

本 lane 名下文件已做完模块侧；下面四条都落在**保留文件 / 别人名下文件**里，本 lane 一行未动。
每条给：目标文件 + 现在盘上的真实文本（行号是 `2026-10-06 16:2x` 实测，会漂，**按文本锚点找**）+ 可照抄的替换 + 上游依据。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

---

## W-1（占位文字的渲染钩子）：`src/components/CodeEditor.vue`

**要收的那件事**：`src/editorFolding.ts:880` 的 `foldPlaceholderFor` 现在**零生产消费方**
（`grep -rn "foldPlaceholderFor" src/ tests/ native/` ⇒ src 里只有定义 + 两处注释，其余全在 `tests/folding-placeholder.test.mjs`）。
后果：宿主没有本仓自己的 `codeFolding(...)` 那一句（`grep -n "codeFolding" src/components/CodeEditor.vue` **零命中**，
折叠由 `:935` 的 `basicSetup,` 带进来）⇒ 折痕上显示的是 CodeMirror 的默认档
`placeholderText: "…"`（单字符，`node_modules/@codemirror/language/dist/index.js:1517`），
而上游是**三个点**（`platform/foldings/src/com/intellij/codeInsight/folding/impl/UpdateFoldRegionsOperation.java:162` 的
`placeholder == null ? "..." : placeholder`）或服务端/标记给的那段文字。用户每一下「收起」都看得见。

**目标行（现在盘上）**：`src/components/CodeEditor.vue:6`
```ts
import { foldEffect, foldService, foldedRanges, indentUnit, syntaxHighlighting, unfoldEffect } from '@codemirror/language'
```
`src/components/CodeEditor.vue:12`
```ts
import { foldingRanges, lspFoldService } from '../editorFolding'
```
`src/components/CodeEditor.vue:935`（扩展数组里的一项）
```ts
        basicSetup,
```

**改法**（净增 2 行；该文件余量 2 行 ⇒ 只能这么少）：
1. `:6` 的 import 里加 `codeFolding`（同一行，净增 0）；
2. `:12` 的 import 里加 `FOLD_PLACEHOLDER_TEXT, foldPlaceholderFor`（同一行，净增 0）；
3. `basicSetup,` **之后**插这 2 行（排在 `basicSetup` 之后才盖得住它带进来的那一份 `codeFolding` 配置）：
```ts
        codeFolding({ preparePlaceholder: (state, range) => foldPlaceholderFor(state, range),
          placeholderDOM: (_view, onclick, prepared) => { const el = document.createElement('span'); el.className = 'cm-foldPlaceholder'; el.textContent = typeof prepared === 'string' && prepared !== '' ? prepared : FOLD_PLACEHOLDER_TEXT; if (onclick) el.addEventListener('click', onclick); return el } }),
```

**这段已经过类型自检**：本 lane 把同样的表达式落进 `build/stickyfold/w1-check.ts`（两行拆开的可读版），
`npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable
--allowImportingTsExtensions --skipLibCheck --verbatimModuleSyntax build/stickyfold/w1-check.ts` ⇒ **0 错、exit 0**。
形状契约的判据在 `tests/folding-placeholder.test.mjs` 末条（`foldPlaceholderFor.length === 2`、
入参 `{ from, to }`）——上游依据：`FoldConfig.preparePlaceholder`
（`node_modules/@codemirror/language/dist/index.d.ts:783-786`）与 `placeholderDOM`（同文件 `:771`）。

**别顺手做的事**：不要新增「自定义占位符」设置项。上游 `CodeFoldingSettings.java:7-11` 整份只有 5 个布尔，
没有字符串字段；能自定义的只有标记里那段说明文字（`NetBeansCustomFoldingProvider.java:24-27`、
`VisualStudioCustomFoldingProvider.java:22-27`）⇒ 本仓已由 `src/customFoldingProviders.ts` 的 `placeholderOf` 承接。

---

## W-2（层数上限档位 10 → 20）：三处校验 + 设置页那一格

**要收的那件事**：上游设置页那一格是 `UINumericRange(5, 1, 20)`
（`platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/configurable/StickyLinesConfigurableUI.kt:40`）
⇒ 用户能选 **1…20**；本仓三处都停在 **0…10**，11…20 这一档拿不到。
默认值 5 三处都对（`EditorSettingsExternalizable.java:94`）。

真源已经落在 `src/stickyLines.ts:68-85`：`STICKY_LINES_LIMIT_DEFAULT = 5` / `STICKY_LINES_LIMIT_MIN = 1` /
`STICKY_LINES_LIMIT_MAX = 20`（判据：`tests/sticky-tier-scroll.test.mjs` 第 1 条）。下面三处建议直接 import 它，
别再各写一份字面量（本仓出过「同一个界写在四处、改一处漏三处」的事故）。

**上游那几行的英文原文**（`platform/ide-core/resources/messages/ApplicationBundle.properties:283-286`，本 lane 自己 grep 的）：
```
283:checkbox.show.sticky.lines=Show sticky lines while scrolling
284:label.sticky.lines.languages=Languages:
285:label.show.sticky.lines=Maximum number of lines:
286:configure.sticky.lines.colors=Manage colors
```
⇒ 那一格的名字是 **Maximum number of lines:**（「层数上限」是它的中文对译，**中文措辞无法核实**：本地树没有 zh 语言包），
复选框是 **Show sticky lines while scrolling**（注意 `while scrolling` —— 上游把「跟随滚动」写进了这一项的名字里）。
本仓 `:909` 那句「在编辑器顶边固定显示当前作用域」不是这一行的对译（少了滚动那一半），改文案时按上面四行来。


1. `src/components/SettingsDialog.vue:910`（现文本）：
```html
            <label class="field-row"><span>层数上限</span><input v-model.number="settings.stickyLinesLimit" type="number" min="0" max="10" step="1" :disabled="!settings.showStickyLines" aria-describedby="editor-sticky-hint" /></label>
```
   ⇒ 改 `min="1" max="20"`。⚠ 顺带：`:911` 那条提示写着「最多显示 N 层（0 = 关闭）」——
   上游没有「0 = 关闭」这一档（最小 1，关闭走上面那个复选框）。要么把这句改成
   「最多显示 N 层（1…20），关掉请用上面的复选框」，要么保留 0 并**在判词里写清本仓多这一档**
   （模块侧 `createStickyLines` 对 0 的处理已钉住：`!(limit > 0)` ⇒ 两份出口都空，
   判据 `tests/gutter-menu.test.mjs:129`、`tests/sticky-lines.test.mjs:74`）。
   `min="0"` 是**存量用户值**，改 `min` 不会损坏旧存档（`src/settingsModel.ts` 的补默认逻辑不动）。
2. `src/previewSettings.ts:70`（现文本）：
```ts
      : key === 'stickyLinesLimit' ? !Number.isInteger(value) || Number(value) < 0 || Number(value) > 10
```
   ⇒ `> STICKY_LINES_LIMIT_MAX`（或 `> 20`）。这一档不改，用户存 20 会被预览档判非法。
3. `native/settings_schema.cpp` 有**两处**同名分支（实测 `:123-126` 与 `:238-240`，同一个界写了两遍）：
```cpp
            if (!value.is_number_integer() || value.get<int>() < 0 || value.get<int>() > 10)
                fail("INVALID_SETTINGS", "stickyLinesLimit must be an integer between 0 and 10.");
```
   ⇒ 两处一起改到 20（含 fail 文案里的数字）。默认值 `:163` / `:403` 的 `{"stickyLinesLimit", 5}` **不动**。
   另：`native/settings_schema.hpp:70-71` 那段注释已经写对了默认 5 与属性名出处，不用改。
   ⚠ 这个文件正被别的 lane 改（本轮两次 `grep -n` 之间 `:123` 附近内容就漂过一次），
   `native/settings_schema.*` 是本 lane 的保留文件，**没动**；改的时候两处分支必须同一批。
   顺带提醒：`tests/bidi-notification.test.mjs:42-43` 只数 `{"stickyLinesLimit", <n>}` 那两处**默认值**，
   与这里的范围校验无关，不会因此红。

**注意**：不要为了「对齐」而在编辑器侧夹取（`src/stickyLines.ts` 的 gate 故意不看 MAX）。
上游读取侧也不夹：`EditorSettingsExternalizable.java:549-556` setter 无校验 →
`EditorSettingsState.kt:227` 原样读 → `SettingsImpl.kt:729-731` 原样给编辑器。
判据已钉：`tests/sticky-tier-scroll.test.mjs` 第 2 条（给 25 就按 25 排）。

---

## W-3（多分栏 + 度量的实参）：`src/App.vue`、`src/components/CodeEditor.vue`

这条**不新提形状**，只补本批新增的两个前提，形状仍以
`docs/wiring-requests-2026-10-06-stickyprio.md` 的 W1/W2/W3 为准（那份在盘上，本 lane 复核过内容）：

1. `src/App.vue:544` 现在还是 `const { stickyLines } = createStickyLines({ editorSettings, outline, currentLine: ..., language: ... })`
   —— 只取了顶边那一份，`stickyLinesByView` 没要。按 stickyprio 的 W2 补 `views` / `currentLineOf` 时，
   **每个 `StickyView` 要带自己那份 `firstVisibleLine`、`lineHeight`、`viewportHeight`**：
   本批的短面板前缀语义（`stickyViewRowBudget`）只有拿到 `lineHeight` + `viewportHeight` 才能生效，
   拿不到时**不夹**（与旧行为逐字一致，判据 `tests/sticky-tier-scroll.test.mjs` 第 3 条末两行）。
2. 多块面板时**别再传**顶层那个共享的 `firstVisibleLine`：`createStickyLines` 现在会忽略它
   （`fallbackScrollTop`：`declaredViews().length > 1` ⇒ 共享值不参与任一栏的筛选，
   上游依据 `StickyLinesManager.kt:15-34` + `:86-99`「一块面板一份可视区」）。
   单块面板 / 不给面板时它照旧生效（W-5 的过渡形状，行为不变，判据同上文件第 5 条末两段）。
3. `lineHeight` / `viewportHeight` 从 `CodeEditor.vue` 透出来与 stickyprio 的 W1 是同一个出口
   （那边要 `firstVisibleLine`）⇒ 建议一次 emit 三个数，别开两条通道。

---

## W-4（视口模块里剩下的那一档）：`src/stickyLineViewport.ts`

本批把「短面板时出前缀」做在了合成处（`src/stickyLines.ts` 的 `stickyViewRowBudget`），
但**还差一条**：上游 `VisualStickyLines.kt:141-148` 的 `break` 发生在
`withYLocation.add(line)` **之后** ⇒ 把面板顶过界的那一条其实会被留下
（`lineHeight=20, viewportHeight=200, limit>=4` 时上游留 **4** 条）；
`stickyViewRowBudget` 只能取到「严格放得下」的 3 条，因为
`stickyVisualLines`（`src/stickyLineViewport.ts:154`）末尾那句 `stickyPanelFits(picked.length, view)`
会把超界的整块清空。要吃到上游那一档，需要 `stickyVisualLines` 把 fits 判据**移进循环**：
```ts
  for (const scope of candidates) {
    if (seen.has(scope.startLine)) continue
    seen.add(scope.startLine)
    if (!stickyPanelFits(picked.length + 1, view) && picked.length === 0) return []   // :125-127 进循环前那一次
    picked.push(scope)
    if (picked.length >= lineLimit || !stickyPanelFits(picked.length, view)) break    // :144-148 收完再问
  }
  return picked
```
（上面的片段是**方向**，不是照抄：它会让 `tests/sticky-line-viewport.test.mjs:82`
「`{ firstVisibleLine: 44, lineHeight: 20, viewportHeight: 100 }, 3` ⇒ `[]`」这条既有判据变红，
改它要先按 `.tools/agent-rules.md` §3 证明它钉错了形状并给上游理由。本 lane **没动**那个文件，
因为它不在派单名下。）本文件名下已经有的判据不受影响。

---

## 本 lane 明确不做的（避免与别的 lane 撞）

- `src/customFoldingSurround.ts` 与 `tests/folding-custom-region-surround.test.mjs`：**跳过**。
  接手时它们的 mtime 是 15:40 / 15:43，`docs/batch-2026-10-06-customfold.md` 的 mtime 15:53（我开工是 16:06）
  ⇒ 判定 `customfold` 这条 lane 还在写这一族，本 lane 未动这两个文件（`git status` 里它们的 ` M` 不是我造成的）。
- `src/customFoldingProviders.ts` 的 provider 表条数（本仓 3 条 vs 上游注册 2 条，
  `intellij.platform.lang.impl.xml:1466-1467`）：**只登记，不改**（那张表在 `customfold` / `foldgoto` 名下）。
- 中文措辞（设置页那句提示、菜单标题等）：本地树没有 zh 语言包 ⇒ **无法核实**，见报告 §6。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-1（占位文字渲染钩子）** —— `src/components/CodeEditor.vue`（禁改）。需 CodeEditor owner。
- **W-2（层数上限 10→20）** —— 三处校验 + 设置页（本 lane 可改面），登记。
- **W-3（多分栏 + 度量实参）** —— `src/App.vue`（本 lane）+ `CodeEditor.vue`（禁改）。需 CodeEditor owner 先出度量。
- **W-4** —— `src/stickyLineViewport.ts`（本 lane），登记。

结论：零接线（W-1/W-3 卡 CodeEditor，W-2/W-4 登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W-1/W-3 卡 CodeEditor，W-2/W-4 登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
