# wiring-requests 2026-10-06 · customfold lane

> 本 lane 不许动的文件：保留文件 `src/App.vue`（2706 行，任务给的余量 30 行）、
> `src/bridge.ts`（904 行，余量 0，已贴顶）、`src/components/CodeEditor.vue`（1144 行，余量 2 行）、
> `native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/*`；
> 并发黑名单（只读）里本 lane 用到的只有 `src/editorFolding.ts`（886 行，foldchord 名下）。
> 行号 = 本批（2026-10-06）自己 grep 的当时值，会漂；引用前先重 grep。
> 本 lane 已完成的那一条（「Surround With」列表的折叠行走 provider 表）不需要任何配合，见
> `docs/batch-2026-10-06-customfold.md` §3.1。

---

## R-1｜把 `foldPlaceholderFor` 接到 CodeMirror 的折痕渲染钩子（A 项剩下的那一层）

| 项 | 内容 |
|---|---|
| 要动的文件 | `src/components/CodeEditor.vue`（**保留**，余量 2 行） |
| 现状 | `src/editorFolding.ts:875` `foldPlaceholderFor(state, range)` 已经把「这条折痕该显示什么」按上游优先级算好了（服务端 `collapsedText` → region 开始标记的 provider 说明 → `...`），但**零生产消费方**：`grep -rn foldPlaceholderFor src --include=*.vue --include=*.ts` 只命中定义处与 `tests/`。折痕上现在显示的是 CodeMirror `codeFolding` 的默认占位（单字符 `…`），不是上游的三个点 `...`（`platform/foldings/src/com/intellij/codeInsight/folding/impl/UpdateFoldRegionsOperation.java:162` 的 `placeholder == null ? "..." : placeholder`），也永远显示不出 `<editor-fold desc="X">` 的那段 `X`。 |
| 要什么 | 把 `codeFolding()` 从 `basicSetup` 里单摘出来，显式给 `foldPlaceholder: (line) => foldPlaceholderFor(view.state, {from: line.from, to: line.to})`（`@codemirror/language` 的 `codeFolding` 配置项；`basicSetup` 本身带 `codeFolding`，需要 `codeFolding:false` 或直接不加那一项）。 |
| 上游坐标 | `UpdateFoldRegionsOperation.java:150`（`String placeholder = null`）、`:152`（`descriptor.getPlaceholderText()`）、`:162`（null ⇒ `"..."`）；LSP 那一路 `platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:51`（`info.highlightingInfo.collapsedText`）；自定义折叠那一路 `platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java:102-111`。 |
| 与既有请求的关系 | 与 `docs/wiring-requests-2026-10-06-fold3.md` **W-2**、`docs/batch-2026-10-06-foldaudit.md` §2.2 末行（fold3 W-2 / folding-lane W-7）是**同一个钩子**。本条只补一句：接上之后 `fold.block` 的 `{...}`（`CollapseBlockHandlerImpl.java:55` + `:82`）与自定义折叠的 `desc` 说明**共用这一个出口**，别再开第二个。 |
| 判据（能失败） | 真机或 `tests/folding-placeholder.test.mjs` 扩一条：折 `<editor-fold desc="构造">` 那条区域后，折痕 DOM 的文本 = `构造`；折一条没有说明的 `#region` ⇒ `...`（不是 `…`）。 |

## R-2｜折外层代码块时撤掉里层那条**手工**折痕（B 项第 1 条 = foldaudit 表二 T1）

| 项 | 内容 |
|---|---|
| 要动的文件 | `src/editorFolding.ts`（**并发黑名单**，foldchord 名下 ⇒ 本 lane 只读未动） |
| 上游坐标（本批实开，87 行那份） | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseBlockHandlerImpl.java:50` `if (info.getPsiElement(existing) == null) myPrevious = existing;`；`:58-61`（新建外层区域后 `info.removeRegion(myPrevious)` + `model.removeFoldRegion(myPrevious)`）；`:66-71`（爬到顶、只 settle 在 `previous` 那一支同样要撤）。"是不是用户自己建的"那一条判据在 `platform/foldings/src/com/intellij/codeInsight/folding/impl/EditorFoldingInfo.java:44-51`（`getPsiElement(region) == null`）。 |
| 缺的不只是那三行 if | 上游的身份来自 PSI（区域有没有对应的 `PsiElement`）。本仓的 `auto` 标记把「builder 给的」和「语法树给的」并成一档，`fold.block` / `fold.selection` 自己建的那条**没有单独一档** ⇒ 要先加一层最小来源身份（`origin: 'auto' \| 'manual'`），否则会把服务端给的区域也撤掉。这件事与 W-2 用的是同一份身份表 ⇒ **建议同一个 lane 一起做**（foldaudit 表二 T1 的「依赖与坑」一栏也是这么写的，本条只是把它接过来并标上"黑名单文件"）。 |
| 判据（能失败） | 先手工折一条内层（不在 `autoAreas` 候选里），再跑 `editingCommands['fold.block']` ⇒ `foldedAreasOf` 里**只剩外层那一条**；反向：内层那条若来自服务端区间（`auto`）⇒ **不许**被撤。 |

## R-3｜注释折叠不许吃掉 region 标记行（B 项第 2 条：`isCustomRegionElement`）

| 项 | 内容 |
|---|---|
| 要动的文件 | `src/editorFolding.ts`（黑名单）的 `commentRanges`(`:185`)/`docCommentRanges`(`:204`) 两条候选 |
| 上游坐标 | 集合本体 `platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java:30`（`ourCustomRegionElements`）、`:88-90`（配上的开始/结束标记入集）、`:189-192`（`isCustomRegionElement`）。消费点本批逐个开过：`python/python-syntax/src/com/jetbrains/python/PythonFoldingBuilder.kt:164`（注释块**不许从**区域标记起）、`:171`（往前遇到区域标记就断）、`:185`（**不许以**区域标记收尾）；`java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/JavaFoldingUtil.java:206`（把它作为过滤条件交给 `CommentFoldingUtil.getCommentDescriptor`）；`plugins/groovy/groovy-psi/src/org/jetbrains/plugins/groovy/lang/folding/GroovyFoldingBuilder.java:84`、`:90`。 |
| 用户可见后果 | 本仓现在允许一条注释折叠把 `#region` / `//</region>` 那一行盖进折痕里 ⇒ 那条自定义区域**点不到也展不开**（开始标记不可见时折痕目标算不出来）。 |
| 本仓缺的那一层 | 上游那份集合是 **builder 在一次 `buildFoldRegions` 里顺手记下**的（`CustomFoldingBuilder.java:34` 建、`:47` 清）。本仓的 region 区间是 `localRegionFolds`(`:93`) 独立扫的，注释折叠候选拿不到"这一行是配对成功的区域标记"这份信息 ⇒ 需要把 `localRegionFolds` 的标记行集合（开始行 + 结束行）交出来给注释那两族候选用。**这个符号本 lane 已经准备好在 provider 表一侧**（`src/customFoldingProviders.ts` 的 `markerKindOf`/`matchingStartIndex` 就是同一套判定），只差 `editorFolding.ts` 里的两处消费。 |
| 判据（能失败） | 一段 `// 说明` 紧跟 `#region X` 再跟注释行 ⇒ 生成的注释折叠**止于** `#region` 之前；`#endregion` 之后的注释另起一条。 |

## R-4｜列表包围之后把 `Description` 那段**选上**（C 项剩下的一小步）

| 项 | 内容 |
|---|---|
| 要动的文件 | `src/components/CodeEditor.vue`（**保留**）的 `surroundWith(template)`（`:732-745` 一带） |
| 现状 | 命令档 `fold.surroundRegion` 已经会选中说明文字（`src/customFoldingSurround.ts` 的 `SurroundResult.selection` + `src/editorCommands.ts` 的 `selection: {anchor, head}`）。列表档走的是 `wrapSelection` → 返回 `{text, caret}` **单光标** ⇒ 插进去的 `Description` 不会被选中，用户得自己重打。 |
| 上游坐标 | `platform/lang-impl/src/com/intellij/lang/folding/CustomFoldingSurroundDescriptor.java:298-304`（`?` → `DEFAULT_DESC_TEXT`，并把那段做成 `rangeToSelect`）、`:313`（`shiftRight(prefixLength)` 跳过注释前缀）、`:320`（`updater.select(rangeToSelect)`）。 |
| 要什么 | `surroundWith` 对带说明的折叠模板落 `{anchor: caret, head: caret + 'Description'.length}`，其余模板不动（保持现在"光标在下一步要敲的字上"那条规矩，`tests/surround.test.mjs` 的 do/while 与 try/catch/finally 两条钉着它）。模块侧不需要改：`src/customFoldingSurround.ts` 的 `surroundRowForFile` 给出的行，其 `prefix` 里那段 `Description` 的偏移 = `prefix.indexOf('Description')`，宿主一行就能算。 |
| 判据（能失败） | 在 `.java` 里 Ctrl+Alt+T 选「`region…endregion 注释`」⇒ 文档变成 `//region Description` 且选区正好覆盖 `Description` 那 11 个字符；选「if 条件」⇒ 光标仍在 `()` 里（回归门）。 |

## R-5｜本 lane **不需要**的两件事（写清楚免得被再派一次）

1. 「用户自定义折叠占位文字的设置项」—— 上游没有这一档：
   `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java` 全文 16 行只有 5 个布尔
   （`:7 COLLAPSE_IMPORTS=true`、`:8 COLLAPSE_METHODS`、`:9 COLLAPSE_FILE_HEADER=true`、
   `:10 COLLAPSE_DOC_COMMENTS`、`:11 COLLAPSE_CUSTOM_FOLDING_REGIONS`），
   `platform/lang-impl/src/com/intellij/application/options/editor/` 整族 grep `placeholder` 零命中，
   全树 grep `DEFAULT_PLACEHOLDER_TEXT` 零命中 ⇒ 自定义只能写在**标记里**（`desc="…"` / `region 后面那段`），
   本仓已经做了。**不新建设置项、不加设置页控件**（没有后端消费链路 ⇒ 属假控件）。
2. 「provider 标记配置页」—— 上游同样没有（全树 `grep -rn CustomFoldingOptionsProvider` **0 命中**，
   本批实测）。EP 声明在 `platform/core-api/resources/intellij.platform.core.xml:40`
   （`com.intellij.customFoldingProvider` ↔ `com.intellij.lang.folding.CustomFoldingProvider`），
   社区树里的注册**只有两条**：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1466`
   （`NetBeansCustomFoldingProvider`）与 `:1467`（`VisualStudioCustomFoldingProvider`）⇒
   本仓 provider 是编译期三档（第三条是判决里的默认标记那一族，社区树里没有它的实现类），
   与 `verdict-platform_rest.md` 里 `lp/custom-folding` 那行末句
   「剩下的只有按 provider 的标记配置面 ⇒ `[-]`」同判。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R-1 / R-2 / R-3 / R-4** —— 目标 `src/components/CodeEditor.vue`（禁改清单）+ `src/customFoldingProviders.ts` / `editorFolding.ts`（本 lane 可改面）。因渲染钩子在 CodeEditor 内，需 CodeEditor owner 先给挂点；模块侧 `foldPlaceholderFor`（`src/editorFolding.ts:880`）已就绪但无生产消费方。
- **R-5** —— 说明项。

结论：零接线（渲染钩子在 CodeEditor，转 owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（渲染钩子在 CodeEditor，转 owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
