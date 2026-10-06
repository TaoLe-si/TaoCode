# 接线请求 · 2026-10-06 · 补全 / 意图 / 快速文档半区收尾（代号 `completion3`）

配套报告：`docs/batch-2026-10-06-completion3.md`。本轮**没有**改任何保留文件；下面每一条都在别人名下的文件里，
都给「目标文件 + 本轮实测行号 + import + 可照抄整段 + 上游依据（本轮亲自打开）」。
行号是 2026-10-06 收工时实测（工作区并发变动，落地前请再读一次目标区域）。

派单里点名要的 K-5（快速文档两档的写回 / 读回）落点都在保留面上 ⇒ 模块侧那一半本轮已在本面补完
（见 N0，为了让「关掉齿轮之后已经排下去的那一拍不再刷新一页」），剩下的两半是 N1 / N2。

---

## N0 · 本轮自己落地的模块侧那一半（不需要接线，只登记）

- 文件：`src/quickDocHost.ts:227-233`（自动更新那一拍的 `window.setTimeout` 回调体，新增的是 `:230-232`）+ `:27` 的 import 补 `shouldAutoUpdateDoc`。
- 内容：去抖到期时**再问一次**档位，再决定要不要取文档。
- 上游依据（本轮逐字打开）：`platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:121`
  的 `if (!autoUpdate) {`、`:191` 与 `:219` 的 `if (autoUpdate) {` —— 三处读属性的位置都在**真正动手那一刻**，不在排程那一刻。
- 判据：`tests/doc-hover-policy.test.mjs` 新增「自动更新：去抖到期时再问一次档位…」一条（含**顺序**判据：
  档位必须问在 `void showAt(` 之前）。反向验证见报告 §4 注入 C（删掉这一行 ⇒ 该条红）。

---

## N1 · `src/settingsPersistence.ts`：把两档从盘上灌回运行时单例（K-5 读回 = 桶 3a 的 R3 = 桶 lsp 的 L3）

- 目标文件：`src/settingsPersistence.ts`（**不在本面**）
- 目标行号：第 **86** 行（本轮两次实测都是 86）—— 该行逐字是
  `      editorSettings.value = await request<EditorSettings>('settings.update', { settings })`
  （与桶 lsp 写的 `:86` 一致，**行号未漂**；全文件 `grep docHoverPolicyFromSettings` 本轮实测 **0 命中**）
- **在第 86 行之后插两行**（可照抄）：

```ts
      // 文档面那两档（「在鼠标移动时显示」/「选区更改时自动刷新文档」）的运行时真值在
      // src/docHoverPolicy.ts 的单例里；从盘上读回来后灌进去，缺键按上游默认档（开）。
      docHoverPolicyFromSettings(editorSettings.value)
```

- **import 段补一行**：`import { docHoverPolicyFromSettings } from './docHoverPolicy.ts'`
  （`.ts` 扩展名必须写全 —— 派单规约 §4 第 1 条）
- 上游依据：`platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:55`
  （本轮实测该行就是 `private var autoUpdate_: Boolean by propComponentProperty(name = "documentation.auto.update", defaultValue = true)`）；
  `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`
  （本轮实测 `public boolean SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true;`）。
- **迁移口径（别踩老存档）**：`src/docHoverPolicy.ts:73-79` 的 `docHoverPolicyFromSettings` 认的是「只有显式 `false` 才算关」
  ⇒ 旧存档缺这两把键 = 默认开 = 上游默认档，**不会**因为少一个键把用户当配置损坏。
- 判据：`tests/doc-hover-policy.test.mjs`（本域，已有「缺键 = 开」那条）；接完之后请把这一行也钉进该域的「接线」判据里
  （桶 3a 在 `tests/doc-history.test.mjs` / `tests/doc-hover-policy.test.mjs` 那边有同形状的接线条）。

## N2 · `src/App.vue`：齿轮落盘 + 打开 `can-toggle-hover`（K-5 写回 = 桶 3a 的 R2 = 桶 lsp 的 L2）

- 目标文件：`src/App.vue`（**保留文件**，本轮一行没动）
- **订正行号（留痕）**：桶 lsp 那份写 `<QuickDocPopup>` 在 `:2372`、`saveSettingsPatch` 在 `:652`；本轮两次实测分别是 **`:2396`** 与 **`:2397`**（该文件正被 `appvue` 改，每次数都会漂）与 **`:665`** —— 内容不变，落地前重读。
- 改法一（第 **2397** 行（本轮末次实测），只在行尾 `/>` 之前插两个属性，其余一字不动）：

```
  :can-toggle-hover="true"
  @policy-change="applyDocHoverPolicy($event)"
```

  本轮实测那一行的结尾是 `@follow="quickDocFollowLink($event)" />` ⇒ 插在那之后、`/>` 之前。
- 改法二（在 `createEditorFileOps({ … })` 那个调用的收尾 `})` 之后加一个函数；本轮实测 `saveSettingsPatch` 定义在 `:665`）：

```ts
// 弹层齿轮改了一档：运行时真值已经由 `src/docHoverPolicy.ts` 的单例翻好，这里只负责落盘。
// 上游那两个 ToggleAction 写的也是同一份持久化设置（documentation.auto.update / SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT）。
function applyDocHoverPolicy(patch: Record<string, boolean>) { void saveSettingsPatch(patch as Partial<EditorSettings>) }
```

- 上游依据：`platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationToolWindowManager.kt:57-60`
  （本轮实测 `autoUpdate` 是个有 setter 的属性 ⇒ 动作写的就是持久化那一份）；
  `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`（另一档的同形态）。
  本仓两把键名取自 `src/docHoverPolicy.ts:54-57`（`showQuickDocOnMouseHover` / `autoUpdateDocumentation`，
  与 `src/settingsModel.ts:462/464` 同一对）。
- **为什么 `:can-toggle-hover` 必须和 N3 同批**：那颗按钮的生效点在 N3（hover 通道问 `shouldShowDocOnHover()`）。
  本轮实测 `src/components/QuickDocPopup.vue:148` 是 `v-if="canToggleHover"`，缺省为假 ⇒ 现在**不渲染**（合规）。
  N3 落地之前单独打开它 = 一枚勾了没反应的假控件（派单规约 §3 假控件禁令）。
  `tests/doc-hover-policy.test.mjs:98` 与 `tests/setkeys-batch.test.mjs:181` 钉的就是「没有生效点不许渲染」。
- 判据：`tests/doc-hover-policy.test.mjs`（齿轮与 emit 两条已在）；接完请加一条「`@policy-change` 的处理器走 `saveSettingsPatch`」。

## N3 · `src/components/CodeEditor.vue`：hover 通道改用共享的文档取用面（= 桶 3a 的 R1 = 桶 lsp 的 L1）

- 目标文件：`src/components/CodeEditor.vue`（**保留文件**）
- 目标行号：**第 505-510 行**（本轮收工时实测；桶 lsp 那份写的 511-516 已被同一时间窗里该域的其它改动**上移 6 行** ⇒ 留痕：原写 511-516、实测 505-510）。逐字实测：`:505` `try {`、`:506` 发 `lsp.request` 的 `kind: 'hover'`、`:507` `if (!result.available || !result.contents) return null`、`:508` `const contents = result.contents`、`:509` 把 `contents` 原样 `textContent` 贴进 tooltip、`:510` `} catch { return null }`、`:511` 才是 `}, { hoverTime: 250, hideOnChange: true })`（桶 lsp 那句「3a 写的 512-517 多数了一行」的订正**成立**，只是两端都要再减 6）。
- 顶部 import 段补一行（`import { … } from '../bridge'` 那一段之后）：

```ts
// 文档取用面（闸 + 共享 hover 缓存 + 签名/描述整形）在 src/docHoverContent.ts；
// Ctrl+Q 那条入口（src/quickDocHost.ts）用的是同一个缓存，这里不再自己发 hover。
import { hoverDocStampOf, sharedDocHover } from '../docHoverContent.ts'
```

- 第 **505-510** 行整段替换为：

```ts
  // 「在鼠标移动时显示」这一档关掉时这里返回 null —— 与上游一致：不是改成显示别的，
  // 而是文档这一部分整个不出现（EditorMouseHoverPopupManager.java:452）。
  const text = await sharedDocHover().tooltipText({
    path: props.path,
    line: info.number - 1,
    character: pos - info.from,
    // 标记按 CodeMirror 的不可变文档对象取：只有真改动才变（改选区不算变更）。
    stamp: hoverDocStampOf(hovered.state.doc),
    lineText: info.text,
  })
  if (!text) return null
  return { pos, create: () => { const dom = document.createElement('div'); dom.className = 'lsp-hover'; dom.textContent = text; dom.style.whiteSpace = 'pre-wrap'; return { dom } } }
```

- 上游依据（本轮逐字打开的两条，其余三条沿用桶 lsp 那份）：
  `platform/lang-impl/src/com/intellij/openapi/editor/EditorMouseHoverPopupManager.java:452`
  （本轮实测该行是 `if (!EditorSettingsExternalizable.getInstance().isShowQuickDocOnMouseOverElement()) {` —— `findElementForQuickDoc` 的第一道闸）、
  `platform/lang-impl/src/com/intellij/openapi/editor/HoverPopupContext.kt:106`
  （本轮实测 `if (showDocumentation && EditorSettingsExternalizable.getInstance().isShowQuickDocOnMouseOver) {`）。
- 为什么现在**必须**接：`src/docHoverContent.ts:122` 的 `hoverDocStampOf` 与 `:193` 的 `sharedDocHover`
  本轮实测**零生产消费方**（`hoverDocStampOf` 在整个 `src/` 里只被 `src/semanticHighlighting.ts:47` 的一句注释提到，不是 import）。
  不接 N3，`native/lsp_session.cpp` 已经透传出来的 hover `range` 与 `src/hoverDocumentation.ts` 的按区间命中
  （上游 `HoverResultCache.kt:11-12`）就永远没人读。
- 行数提醒：`src/components/CodeEditor.vue` 的登记上限是 **1147**，本批开工时它 **1151 行**（`node --test tests/module-size.test.mjs` 红的那一条就是它），本批期间该域自己把它降到 **1144** ⇒ 收工时门已复绿，但**只剩 3 行余量**。上面这段替换是 **+4 行的净增** ⇒ 落地时**顺手拆一处**（最自然的就是把 hover 那整段抽成 `src/editorDocHover.ts`，正好与 N3 同源），**不要抬上限、不要登记豁免**。

## N4 · `src/style.css`：弹层几何与 `DOC_POPUP_METRICS` 对不上（登记了上游真值但没人读）

- 目标文件：`src/style.css`（保留文件）；目标行：**1321**
  `.quickdoc-popup { … width: 460px; max-height: 300px; … }`
- 现状（本轮实测）：`src/quickDocLayout.ts:40-69` 的 `DOC_POPUP_METRICS` 抄的是上游真值，本轮 grep 实测它在 `src/` 与 `src/components/` 里**没有任何生产消费方**（只有 `tests/doc-layout.test.mjs:89-94` 在钉数值）
  ⇒ 「抄了不用」的那一半就是这一行 CSS。
- 上游依据（本轮打开 `sed -n '44,77p'` 逐条对过）：
  `platform/lang-impl/src/com/intellij/codeInsight/documentation/DocumentationHtmlUtil.kt:46`（`contentOuterPadding = 14`）、
  `:59` `docPopupPreferredMinWidth = 300`、`:62` `docPopupPreferredMaxWidth = 500`、
  `:64` `docPopupMinWidth = 300`、`:67` `docPopupMaxWidth = 900`、`:71` `docPopupMaxHeight = 500`。
- 建议改法（二选一，不要两条都不选）：
  1. 把 `:1321` 的 `width: 460px` 换成 `width: min(500px, 900px)` 语义的本仓写法
     `max-width: min(900px, 90vw)` + `width: 500px`、`max-height: 500px`（= 上游 preferred/max 两档）；
  2. 或者在 `src/components/QuickDocPopup.vue` 的 `:style` 上真读 `DOC_POPUP_METRICS`
     （那样 CSS 那行就该退成「只有 flex/描边」，宽度由模型给）—— 该文件不在本面，写法由 appvue / toolwindow 那条线定。
- 判据：`tests/doc-layout.test.mjs:184-199` 那条「接线」已经在钉 parts / class 名；请同批加一条
  「`.quickdoc-popup` 的宽度或 `:style` 必须读 `DOC_POPUP_METRICS` 的值」，否则这条登记数值会一直漂。
- **本批为什么不自己落**：`src/style.css` 是保留文件、`QuickDocPopup.vue` 不在派单面（派单 §2）。

## N5 · 补全弹层里「自动展开文档」那一档（`AUTO_POPUP_JAVADOC_INFO`）——**现在落不了，写清楚卡在哪**

- 上游依据（本轮逐字打开，五条都在）：
  `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:66` —— `public boolean AUTO_POPUP_JAVADOC_INFO;`
  （**没有初值 ⇒ 出厂 false**）；
  `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/ToggleAutoShowAction.kt:23`（读）与 `:27`（写）；
  `platform/lang-impl/src/com/intellij/codeInsight/documentation/DocumentationComponent.java:924`（读）与 `:929`（写）；
  `platform/lang-impl/src/com/intellij/codeInsight/lookup/impl/LookupUi.java:125` —— `return !CodeInsightSettings.getInstance().AUTO_POPUP_JAVADOC_INFO;`；
  `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationManager.kt:236`；
  `platform/lang-impl/src/com/intellij/application/options/CodeCompletionConfigurable.kt:192`（设置页那一格 `.bindSelected(settings::AUTO_POPUP_JAVADOC_INFO)`）。
- 卡在哪一环（两条都是硬前提）：
  1. **键不在**：`src/settingsModel.ts` 里 `autoPopupDocumentation` / `AUTO_POPUP` 本轮 grep **0 命中**（保留文件，本批只读）。
  2. **展开面不在**：本仓补全弹层的文档格是 CodeMirror 自带的 `.cm-completionInfo`
     （`src/completionUi.ts:267-275` 只有它的样式，没有「展开 / 收起」的调用面），
     上游那个动作切的是 Swing 的 `DocumentationComponent` 那一份状态。
- 要落的最小形状（等键就位后**本面一行接上**，不需要新模块）：
  `src/completionUi.ts` 的 `completionUi(sources)` 里按设置决定是否把 `.cm-completionInfo` 常驻（默认关，照 `:66` 的出厂档）。
  在那之前**不渲染**任何入口 —— 假控件禁令。

## N6 · `tests/module-size.test.mjs`：开工红、收工绿（留痕给主代理）

- 开工实测：5 条里红 1 条 —— `src/components/CodeEditor.vue 现在 1151 行 > 上限 1147`（**别人名下**，本批 `git diff` 里没有该文件）。
- 收工实测：**5 / 5 全绿**（该域在本批期间自己把它降到 1144）。上限一个没动、没有新增豁免。
- 留给 N3 的约束：现在只剩 3 行余量，接 hover 通道时**必须顺手拆**，不要抬上限（派单 §5）。
