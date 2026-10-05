# 接线请求 · 2026-10-06 · 桶 3a2（快速文档收尾：正文内联链接 / 图片 / 前进后退）

> 只列**新**需求。上一份 `docs/wiring-requests-2026-10-06-bucket3a.md` 的 R1–R5 仍然欠着，本轮不重述、不重复计数；
> 本轮改动全在我名下模块内，`src/App.vue:2400` 那条挂载链一行没动（任务书已复核过挂载点与 `style.css` 的 24 处 `quickdoc-*`，
> 所以这里**不**交"把 QuickDocPopup 挂上"或"数一下样式条数"那两条，只给**具体选择器与规则**）。

## W1 · 内联链接上线后 `style.css` 欠的 5 条规则（保留文件 ⇒ 请主代理落）

- **目标文件**：`src/style.css`，接在现有 `.quickdoc-*` 那一段之后（当前在 `:1335-1347`，即 `.quickdoc-content.is-text` / `.is-code` / `.quickdoc-link` 三条附近）
- **要接什么**（逐条给全，色值/间距全部走 `src/tokens.css` 既有令牌，无裸 hex、无硬编码毫秒、无 cubic-bezier、不自加动效）：

```css
/* ① 链接现在**长在句子里**（上游正文就是一段 HTML，`a` 在行内标签白名单里：
      platform/markdown-utils/src/com/intellij/markdown/utils/doc/DocMarkdownToHtmlConverter.kt:68）：
      字号跟着正文走。`.quickdoc-link` 那条 11px 只该管底部两行清单（`.quickdoc-links` / `.quickdoc-bottom`），
      否则内联的那个词会比它所在的句子小一号，读起来像另一块控件。 */
.quickdoc-content .quickdoc-link,
.quickdoc-section-body .quickdoc-link { font: inherit; }

/* ②③ 正文段落：`p` 的 UA 默认 margin 是 `1em 0`（`src/style.css:3` 只有 `* { box-sizing }`，全站没有 margin 复位），
      会把上游 `spaceBeforeParagraph` / `spaceAfterParagraph` 的 4px 行距撑成 16px
      （数值出处：platform/lang-impl/src/com/intellij/codeInsight/documentation/DocumentationHtmlUtil.kt:53、:56
       → JBHtmlPaneStyleConfiguration.kt:349、:352，本仓已登记在 src/quickDocLayout.ts:46-49 的 DOC_POPUP_METRICS）。 */
.quickdoc-content.is-text p { margin: 0 0 var(--space-1); }
.quickdoc-content.is-text p:last-child { margin-bottom: 0; }

/* ④ 正文里的代码块同样吃 UA 的 `pre { margin: 1em 0 }`（`:1333` 那条只复位了 `.quickdoc-definition pre`）。 */
.quickdoc-content.is-code pre,
.quickdoc-content.is-code code { margin: 0; font: inherit; }

/* ⑤ 分节右格现在也可能是分段渲染（`<button>` 直接进 `td`），`<p>` 包一层时长高了就分行不齐。
      上游这一格本来就是 `td[valign='top']` 里的一段 HTML：DocumentationMarkup.java:29。 */
.quickdoc-section-body p { margin: 0; }
```

- **为什么需要**：本轮把内联链接补全（正文、标题块、分节右格三处都能长链接），弹层里出现了 `p`/`pre`/句内 `button` 这些**以前模板里没有的**元素；不补这 5 条，内联链接会比句子小一号、段落之间空出一大截，视觉上仍然是"另起一行的链接清单"那个旧样子。
- **上游依据**：`platform/analysis-api/src/com/intellij/lang/documentation/DocumentationMarkup.java:24`、`:28-29`；`platform/markdown-utils/src/com/intellij/markdown/utils/doc/DocMarkdownToHtmlConverter.kt:66-70`；`platform/lang-impl/src/com/intellij/codeInsight/documentation/DocumentationHtmlUtil.kt:53-56`。

## W2 · R1 落地时，hover 那条入口要复用**同一份**内联渲染（别各自实现一遍）

- **目标文件**：`src/components/CodeEditor.vue`（保留文件；就是已登记的 **R1** 那一处 hover 通道）
- **要接什么**：R1 把 hover 通道换成共享的取文档面之后，**渲染侧请走 `src/quickDocLayout.ts` 的 `buildQuickDocLayout(...)` 产出的 `content[].parts` / `sections[].parts`**（同一形态判据：`tests/doc-layout.test.mjs:184`）。本仓内联链接的口径已经钉死在三处：正文 `src/components/QuickDocPopup.vue:165-170`、标题块 `:156-162`、分节右格 `:177-182`。hover 提示若另写一套"把链接抽成一行"的渲染，就会出现本轮刚修掉的那个老毛病（`{@link Foo}` 变成独立一行）。
- **为什么需要**：本轮的三处修复全在**模型 + 渲染层**；如果 hover 那条入口另写渲染，同一个 `{@link}` 在弹层里可点、在 hover 里是死文本，判词 `ls/documentation` 的"富渲染"就永远对不齐。
- **上游依据**：`platform/lsp-impl/src/impl/features/documentation/LspDocumentationData.kt:94-102`（上游只有一条 markdown→HTML 通道，hover 与 QuickDoc 共用）。

## 本轮**没有**新交给主代理的其他事项

- `App.vue:2400` 的 `@follow`/`@back`/`@forward`/`@open-external` 与三个 `can-*` 全部已实接（判据 `tests/doc-host.test.mjs:106`、`:155`、`:169`），不需要再接线。
- `KeepTabAction`（`platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/KeepTabAction.kt:12-21`，注册 `intellij.platform.lang.impl.actions.xml:60-61`）与 `DocRenderer` 一族（`platform/lang-impl/src/com/intellij/codeInsight/documentation/render/`，实测 31 个文件）**不在这里求接线**：本仓快速文档是弹层、没有文档工具窗的 `Content` 页签，也没有可定位的内联区间（区间要等 **R5** 的 native `hover.range` 透传）。按"无消费链路不渲染"处理，未加按钮 ⇒ 不是假控件，但也不假装做了。
