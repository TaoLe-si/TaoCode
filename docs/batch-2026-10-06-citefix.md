# batch-2026-10-06 · citefix：引用门禁的两条红 = 交付文档里的假上游坐标（逐条订正留痕）

代号 `citefix`。派单：**红在 `docs/**.md` 里别人写的假上游坐标（假路径 / 假行号）**，不是代码。
本轮只改 `docs/**.md`（外加 `docs/inventory/citation-anchors.json` 由门禁自己的 update 档重算），
`src/` `tests/` `scripts/verdict_table.py` `docs/inventory/*.md` 一个字没动。

> **记法约定（先读这一段，否则下面的表看不懂）**
> 引用门 `tests/source-citations.test.mjs:19` 的正则是 `路径.(kt|java|xml|…):行号`，
> 它**不区分「断言」和「转述」**：只要出现完整形状就收一条真引用去核对（规约 §5 明写过这个坑）。
> 所以本文件与被我订正的文档里，**凡转述假坐标处一律在扩展名与冒号之间留一个空格**
> （`…PsiUtil.java :223-226`），去掉空格就是门禁/原文的逐字形状；真坐标照常带冒号带行号。
> 没有一条论断被删掉：假路径要么换成实测真路径，要么「这是假路径」这条留痕继续留着（只改形状）。

---

## 1. before：两条门的原始输出（开工第一次，逐条全量）

```
$ node --test tests/source-citations.test.mjs
ℹ tests 3
ℹ pass 2
ℹ fail 1
✖ 仓里每一条带路径的上游引用都指得到（参考树在时）
  AssertionError [ERR_ASSERTION]: 这些引用按图索骥会扑空
  + [
  +   'docs\batch-2026-10-06-projecttree.md :: platform/lang-api/src/com/intellij/psi/util/PsiUtil.java :223-226 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2.md :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19-19 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2.md :: platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2defect.md :: platform/lang-api/src/com/intellij/psi/util/PsiUtil.java :223-226 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2defect.md :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19-19 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2defect.md :: platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2defect.md :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19-19 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2defect.md :: platform/editor-ui-api/src/com/intellij/openapi/editor/settings/EditorSettingsExternalizable.java :76-76 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2defect.md :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19-19 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-status2defect.md :: platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50 —— 参考树里没有这个文件',
  +   'docs\batch-2026-10-06-welcome2.md :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19-19 —— 参考树里没有这个文件',
  +   'docs\wiring-requests-2026-10-06-vcs2.md :: platform/editor-ui-api/src/com/intellij/openapi/editor/settings/EditorSettingsExternalizable.java :76-76 —— 参考树里没有这个文件',
  +   'docs\wiring-requests-2026-10-06-vcs2.md :: platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19-19 —— 参考树里没有这个文件',
  +   'docs\wiring-requests-2026-10-06-vcs2.md :: platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50 —— 参考树里没有这个文件'
  + ]
  - []
```
（上面 14 行里 7 行的「空格」是本报告加的转述遮罩，见开头《记法约定》；其余逐字照抄门禁。）

```
$ node --test tests/source-citation-anchors.test.mjs
锚点核对：快照 1627 条 / 仓里活引用 2631 条 / 未入快照 1004 条 / 区间为空 3 条
ℹ tests 8
ℹ pass 7
ℹ fail 1
```
`fail 1` 就是同一条断言（anchors 文件 `import` 了 citations 的用例，故 8 项里含那 3 项）。
**锚点门当时不报假路径**：`buildAnchors` 对参考树里不存在的路径直接跳过（`tests/source-citation-anchors.test.mjs:132`），
假坐标只会让老门红，不会进快照 —— 这解释了「快照 1627 < 活引用 2631」。

**开工时的 3 条「区间为空」**（文件在、行号漂到空行上 ⇒ 老门绿、按图索骥照样扑空；用一次性脚本 `build/tmp-empty-anchors.mjs` 复算得到，收工已删）：

```
anchors 1627 empty-range 3 not-in-live 0 file-missing 0
 EMPTY   docs/batch-2026-10-06-bucket14b.md java/java-structure-view/src/com/intellij/ide/structureView/impl/java/KindSorter.java 15-15
 EMPTY   docs/settings-parity.md platform/platform-impl/src/com/intellij/xml/breadcrumbs/BreadcrumbsConfigurable.java 24-24
 EMPTY   src/components/DebugConsolePane.vue platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java 19-19
```

**开工时点名的「7 条假上游路径」**= `docs/wiring-requests-2026-10-06-runterm2.md:184-192` 那张表（runterm2 桶收工时实测的清单，
它自己按规约 §5 没写行号所以不拦），4 个去重后的假路径与上面 14 条完全同一批：
`platform/lang-api/...PsiUtil.java`、`platform/analysis-api/...codeInsight/SuppressIntentionAction.java`、
`platform/structure-view-impl/...structureView/StructureViewFactoryImpl.java`、
`platform/editor-ui-api/...openapi/editor/settings/EditorSettingsExternalizable.java`。
（派单里点名的 `editor-code-block`/`problems-view`/`run-startup-focus`/`source-citations` 是**报这条清单的桶**的功能名，
分别在 `docs/batch-2026-10-06-bucket5b.md:62`、`…bucket2b.md:24-27`、`…exec2.md:18`、`…status2defect.md:131-141`，不是另外一批假坐标。）

---

## 2. 逐条订正（原文 → 新文 → 我在参考树里打开过的那一行）

真坐标一律**自己 `find` + 逐行读出**后才落笔；参考树 = `D:/Backup/Downloads/intellij-community-master/intellij-community-master`（未上网）。

### 2.1 假路径 → 实测真路径（论断不变，只把坐标指对）

| # | 文档:行 | 原文（假） | 新文（真） | 我打开过的那一行（逐字摘要） |
|---|---|---|---|---|
| 1 | `docs/batch-2026-10-06-projecttree.md:67` | `platform/lang-api/src/com/intellij/psi/util/PsiUtil.java` :223-226,623-634 | `java/java-psi-api/src/com/intellij/psi/util/PsiUtil.java:223-226,623-634`（同格补注「原写 platform/lang-api 参考树里没有」） | 223 `public static final int ACCESS_LEVEL_PUBLIC = 4;`／224 `…_PROTECTED = 3;`／225 `…_PACKAGE_LOCAL = 2;`／226 `…_PRIVATE = 1;`；623 `public static int getAccessLevel(@NotNull PsiModifierList modifierList) {` 到 634 `}` ⇒ 「public 4 / protected 3 / package-local 2 / private 1」与「按修饰符短路定级」两条论断都成立，只有包路径是编的 |
| 2 | `docs/batch-2026-10-06-vcs2.md:156` | `platform/editor-ui-api/src/com/intellij/openapi/editor/settings/EditorSettingsExternalizable.java` :76 | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`（1270 行，附注订正） | 76 `public boolean SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true;`（75 是 `REMOVE_TRAILING_BLANK_LINES = false`、77 是 `SHOW_INSPECTION_WIDGET = true`）⇒ 「快速文档默认开」成立 |
| 3 | `docs/batch-2026-10-06-bucket14b.md:36` | `…/impl/java/KindSorter.java` :15（`implements Sorter`） | `…/impl/java/KindSorter.java:16`（并注明「15 落在版权头下移后的空行 ⇒ 区间为空」） | 16 `public class KindSorter implements Sorter, TreeActionWithDefaultState {`；15 是空行；24 `public static final @NonNls String ID = "KIND";`；33-58 = `getWeight` 的 55/53-10/15/20/30-35/40/50/60 短路链（文件 86 行）⇒ 档位论断逐条对得上 |
| 4 | `docs/batch-2026-10-06-projecttree.md:66` | `…KindSorter.java` :15,24,33-58 | `…KindSorter.java:16,24,33-58`（同上，带原因） | 同 #3 |
| 5 | `docs/settings-parity.md:71` | `platform/platform-impl/src/com/intellij/xml/breadcrumbs/BreadcrumbsConfigurable.java` :24 | `…BreadcrumbsConfigurable.java:21-28`（注明「原写 :24 已漂到空行」） | 21 `final class BreadcrumbsConfigurable extends CompositeConfigurable<BreadcrumbsConfigurable.BreadcrumbsProviderConfigurable> implements SearchableConfigurable {`；24 是空行；26-28 `public @NotNull String getId() { return "editor.breadcrumbs"; }` ⇒ 该行讲的就是 `editor.breadcrumbs` 这个 configurable 的 id |
| 6 | `docs/batch-2026-10-06-bucket14b.md:42` | `java/java-structure-view/.../PsiClassTreeElementBase.java`（省略号写法，门禁不拦但照样扑空：全树 `find -name "PsiClassTreeElement*"` = 0 命中） | 改为两个真身 `java/java-structure-view/src/com/intellij/ide/structureView/impl/java/JavaClassTreeElementBase.java:22` 与 `java/java-structure-view/src/com/intellij/ide/structureView/impl/java/JavaInheritedMembersNodeProvider.java:25-37`，并在同格写明「原写名字参考树里没有、论断不变」 | 22 `public abstract class JavaClassTreeElementBase<Value extends PsiElement> extends PsiTreeElementBase<Value>`；25 `public final class JavaInheritedMembersNodeProvider extends InheritedMembersNodeProvider {`；27-37 `provideNodes(...)` 里 `Collection<PsiElement> ownChildren = JavaClassTreeElement.getOwnChildren(aClass);` → `aClass.processDeclarations(new AddAllMembersProcessor(inherited, aClass), ResolveState.initial(), null, aClass);` → `inherited.removeAll(ownChildren);` ⇒ 「继承成员由 PSI 超类型解析补进结构树」成立 |

### 2.2 转述假坐标（「这是假路径」这条论断要留着，但不能被门禁当引用收走）

| # | 文档:行 | 处理 | 同时补上的真坐标（实测） |
|---|---|---|---|
| 7 | `docs/batch-2026-10-06-status2.md:85` | 两条假路径的冒号前加空格；句子改成「当时报的是 `docs/batch-2026-10-06-problems2.md` 里…」（实测那份文档现在只剩门禁数字叙述，假形状已不在） | 真路径与逐字行内容见 #8 行末 |
| 8 | `docs/batch-2026-10-06-welcome2.md:45` | 同上，并把「基准树实测该文件在 `platform/analysis-api/src/com/intellij/codeInspection/`」补成完整可核坐标 | `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19`（98 行）19 = `public abstract class SuppressIntentionAction implements Iconable, IntentionAction {`；`platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49-50`（186 行）49 = `@SuppressWarnings("WeakerAccess") public boolean AUTOSCROLL_MODE = true;`、50 = `… AUTOSCROLL_FROM_SOURCE = false;` |
| 9 | `docs/batch-2026-10-06-status2defect.md:131-141`（7 行逐条清单） | 7 行原文全部保留、逐行冒号前加空格，并在块前写清「多了一个空格 = 转述遮罩，去掉空格就是门禁原文」，块后追加 4 条真坐标与它们的行内容 | 同 #1/#2/#8（PsiUtil 223-226、EditorSettings 76、SVFactory 49-50、Suppress 19） |
| 10 | `docs/wiring-requests-2026-10-06-vcs2.md:175-176`（W4 表「里面写的（不存在）」列） | 该列两处冒号前加空格；真路径列不动（本来就是对的）；表后加 citefix 追记 | 同上 |
| 11 | `docs/batch-2026-10-06-vcslog2.md:77-80`（§4 第 2 条：本批自己的**注入实验**原文） | 注入的假坐标 `…EdgePrintElement.kt` :900-901 冒号前加空格，并注明「照抄进文档 = 全仓多一条永远修不掉的红」；反向验证的结论一字未动 | 实测该文件 21 行（门禁诊断里 `total 22` 是 `split('\n')` 口径），所以 900-901 必然「行号超出文件长度」——这正是它当初想证明的事 |
| 12 | `docs/batch-2026-10-06-edact3.md:69` | vcs2 那两条假路径的转述加空格；并把「moved 3 条」的现状写成事实（前两条已由本轮按真行号改好并重算快照，第三条是别人在 `src/` 改掉的） | 同上 |

### 2.3 顺带订正：假路径**没写行号**（门禁不拦、但按图索骥一样扑空）的断言式坐标

这些都在「上游依据」列里当真理写的，包路径是编的。每条都先 `find` 到全树唯一真身、再逐行读到论断要求的那一行才落笔。

| 文档:行 | 原文（假） | 新文（真 + 我读到的那一行） |
|---|---|---|
| `docs/batch-2026-10-06-toolwindow2.md:20` | `platform/platform-impl/src/com/intellij/ui/tabs/TabInfo.kt` | `platform/platform-api/src/com/intellij/ui/tabs/TabInfo.kt:30,301,306`（424 行）30 = `class TabInfo(var component: JComponent) : Queryable, PlaceProvider {`、301 = `fun fireAlert() {`、306 = `fun stopAlerting() {` ⇒ 「alert/blink 在 TabInfo」成立 |
| `docs/batch-2026-10-06-roots.md:25` | `platform/projectModel-api/src/com/intellij/openapi/projectRootDescriptors/impl/JavadocOrderRootType.java`、`AnnotationOrderRootType.java` | `platform/projectModel-impl/src/com/intellij/openapi/roots/JavadocOrderRootType.java:9`（38 行，`public class JavadocOrderRootType extends PersistentOrderRootType {`）、`platform/projectModel-impl/src/com/intellij/openapi/roots/AnnotationOrderRootType.java:9`（71 行，`public class AnnotationOrderRootType extends PersistentOrderRootType {`） |
| `docs/batch-2026-10-06-bucket15.md:64` | `platform/ide-core/src/com/intellij/openapi/projectIndex/FileIndex.java` | `platform/projectModel-api/src/com/intellij/openapi/roots/ProjectFileIndex.java:28`（`public interface ProjectFileIndex extends FileIndex {`）+ `…/roots/FileIndex.java:39`（`public interface FileIndex {`，113 行） |
| `docs/batch-2026-10-06-bucket15.md:67` | `platform/ide-core/src/com/intellij/openapi/vfs/VirtualFileManager.java` | `platform/core-api/src/com/intellij/openapi/vfs/VirtualFileManager.java:30`（294 行，`public abstract class VirtualFileManager implements ModificationTracker {`） |
| `docs/batch-2026-10-06-prob3.md:37` | `platform/lang-impl/src/com/intellij/codeInspection/export/ExportToHTMLAction.kt` | `platform/lang-impl/src/com/intellij/codeInspection/ui/actions/ExportToHTMLAction.kt:22`（52 行，`class ExportToHTMLAction : InspectionResultsExportActionProvider(Supplier { "HTML" },`） |
| `docs/batch-2026-10-06-bucket3a2.md:71` | `java/java-psi-api/src/com/intellij/javadoc/PsiDocFragmentName.java`（少一层 `psi/`） | `java/java-psi-api/src/com/intellij/psi/javadoc/PsiDocFragmentName.java`（18 行，第 2 行 `package com.intellij.psi.javadoc;`） |
| `docs/batch-2026-10-06-status2.md:35`、`docs/wiring-requests-2026-10-06-status2.md:29`、`docs/wiring-requests-2026-10-06-statusbar.md:24` | `platform/platform-api/src/com/intellij/openapi/ui/MessageDialogBuilder.kt` | `platform/ide-core/src/com/intellij/openapi/ui/MessageDialogBuilder.kt:19`（224 行，`sealed class MessageDialogBuilder<T : MessageDialogBuilder<T>>(protected val title: @NlsContexts.DialogTitle String,`）；同目录 `MessageType.java` 实测存在 ⇒「同目录」这句话订正后才是真的 |
| `docs/wiring-requests-2026-10-06-bucket14a.md:59` | `platform/ide-impl/src/com/intellij/openapi/command/impl/UndoManagerImpl.java` | `platform/platform-impl/src/com/intellij/openapi/command/impl/UndoManagerImpl.java:43`（397 行，`public class UndoManagerImpl extends UndoManager implements Disposable {`） |
| `docs/wiring-requests-2026-10-06-bucket12b.md:42` | `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XBreakpointGroup.java`；`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/breakpoints/XBreakpointsPanel.kt` | 前者 → `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/ui/XBreakpointGroup.java:10`（42 行，`public abstract class XBreakpointGroup implements Comparable<XBreakpointGroup> {`）；后者**全树 0 命中、也没有 `xdebugger-impl/ui/` 那层模块** ⇒ 按规约改成 `无法核实` 并写清取证缺口（不删论断、不编替代路径）；同条里的 `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/breakpoints/XBreakpointManagerImpl.java` 实测存在，未改 |

（`docs/batch-2026-10-06-bm3.md:39/160`、`…bucket2c.md:31/173`、`…bucket14c.md:139`、`…saveops.md:14`、`…projecttree.md:59`、
`…wiring-exec2.md:15`、`…wiring-projecttree.md:210`、`…runterm2.md:188-191` 这些**已经**是「标注了不存在 + 给出真身」的留痕写法，
本轮复核后确认它们的真身与我的独立 `find` 一致（例：`BookmarkManager.java` 真身 `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkManager.java`、
`TrustedProjectsDialog.kt` 真身 `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt`、
`RunContentManager.java` 真身 `platform/execution/src/com/intellij/execution/ui/RunContentManager.java`、
`ListPopupStep.java` 真身 `platform/ide-core/src/com/intellij/openapi/ui/popup/ListPopupStep.java`），**未二次改写**，避免把别人的留痕搅成第二种形状。）

---

## 3. 并行 lane 在途带来的新增红（工作区共享，如实记录时间线）

| 时刻 | 门禁红条数 | 新增来源 | 处置 |
|---|---|---|---|
| 开工 | 14 | projecttree / status2 / status2defect / welcome2 / vcs2 | 本轮全部订正（§2） |
| 中段 | 15 | `docs/wiring-requests-2026-10-06-plugins.md:39` 的 `…newui/PluginAdvertiserEditorNotificationProvider.kt` :196 | **plugins 桶自己修好了**：真身 `platform/platform-impl/src/com/intellij/openapi/updateSettings/impl/pluginsAdvertisement/PluginAdvertiserEditorNotificationProvider.kt:196`，480 行，196 = `PluginManagerConfigurable.showPluginConfigurableAndEnable(project, setOf(installedPlugin))`（我核过内容、论断对，没越界代改） |
| 中段 | 15（同批另 2 条） | 同一文档 :267/:270 的 `PluginsConfigurableWrapper.kt`、`PluginModelActions.kt` | 该桶收工前自己去掉行号（全树确无这两个文件），我未动 |
| 后段 | 3 条红（新文档） | `docs/batch-2026-10-06-edact3.md:69` 转述 vcs2 的两条假路径、`…vcslog2.md:78` 照抄自己的注入实验 | §2.2 的 #12 / #11 |
| 后段 | 2 条红（新文档） | `docs/batch-2026-10-06-tw3.md` 又抄了同一对假路径 | **toolwindow 桶在我改之前自己修好了** |
| 收工前最后一次 | 2 条红 | `docs/batch-2026-10-06-lensgate.md:11` 的 `…codeInsight/codeVision/CodeVisionPass.kt` :113-117 | 我刚要落笔时该桶已把它改成 `codeInsight/hints/codeVision/CodeVisionPass.kt:113-117`；我独立核对：真身 150 行，113-117 正是 `CodeVisionSettings.getInstance()` → `!settings.codeVisionEnabled` → `isEnabledForProject()` → `filter { settings.isProviderEnabled(it.groupId) }` ⇒ 改对了 |

⇒ **结论**：这对假路径（`codeInsight/SuppressIntentionAction` + `structureView/StructureViewFactoryImpl`）在 12 路并行里被复制了 8 次，
每份新文档抄一次就复活一次。只靠「谁红谁修」修不完，§10 给了一条机检建议。

---

## 4. after：两条门的原始输出（收工，逐字）

```
$ node --test tests/source-citations.test.mjs
ℹ tests 3
ℹ pass 3
ℹ fail 0

$ node --test tests/source-citation-anchors.test.mjs
锚点核对：快照 3000 条 / 仓里活引用 3000 条 / 未入快照 0 条 / 区间为空 1 条
ℹ tests 8
ℹ pass 8
ℹ fail 0

$ node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs
ℹ tests 11
ℹ pass 11
ℹ fail 0

$ node --test tests/module-size.test.mjs
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

- 快照重算三次：`1627 → 2873`（第一次，吸收我改的 2 处真行号 + 并行 lane 的 1000 余条新引用）`→ 2955`（第二次，吸收 §2.3 那批新写的真坐标）
  `→ 2997 → 3000`（第三、四次：先把本报告自己写进去的真坐标收进快照，再把报告里**转述**那条空区间改成空格遮罩后把它从快照里挤掉）。
  用的就是门禁唯一的写盘入口：`TAOCODE_CITATION_ANCHORS=update node --test tests/source-citation-anchors.test.mjs`。
  **重算前逐条确认**：本轮我新落的每一条 `路径:行号` 都先用 `awk`/`wc -l` 在参考树里读到过那一行（§2 表里「我打开过的那一行」就是取证）。
- `未入快照 0 条`：前两次重算之后并行 lane 又落了 42 条新引用（当时按 `tests/source-citation-anchors.test.mjs:12-13` 的第 ③ 条口径**只报数不拦**），
  最后一次重算把它们一并收进快照；其中**不属于我核对范围**的那些，存在性由老门保证，内容漂移由这一次快照起点开始保护。
- `区间为空 1 条` = `src/components/DebugConsolePane.vue:5` 引 `platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java :19-19`
  （实测 19 行是空行，18 行才是 `final class PauseOutputAction extends ToggleAction implements DumbAware {`）⇒ **在 `src/`，本轮域外，交主代理**（见 §10；
  本报告这行也照例用「空格遮罩」转述它，否则我自己的报告会被收进一条永远空的区间——第一次 update 就中招过一次，见 §5 注）。

**before/after 汇总**：

| 门禁 | before | after |
|---|---|---|
| `source-citations.test.mjs` | tests 3 / pass 2 / **fail 1**（14 条假引用） | tests 3 / pass 3 / **fail 0**（0 条） |
| `source-citation-anchors.test.mjs` | tests 8 / pass 7 / **fail 1**；快照 1627 / 活引用 2631 / 未入快照 1004 / 空区间 3 | tests 8 / pass 8 / **fail 0**；快照 3000 / 活引用 3000 / 未入快照 0 / 空区间 1（非我域） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs`（两条一起） | —— | **tests 11 / pass 11 / fail 0** |
| `module-size.test.mjs` | （开工未单跑；中段采到一次 4/5，红 `src/bridge.ts 911 > 上限 905`） | tests 5 / pass 5 / **fail 0**（上限一个没动） |

---

## 5. §5 自查（本轮只有文档改动，代码门一律「未受影响 + 实测复绿」）

| 命令 | before（开工/中段） | after（收工实测） |
|---|---|---|
| `node --test tests/source-citations.test.mjs` | 3 / 2 / **1 红（14 条）** | **3 / 3 / 0** |
| `node --test tests/source-citation-anchors.test.mjs` | 8 / 7 / **1 红** | **8 / 8 / 0** |
| `node --test tests/module-size.test.mjs` | 5 / 4 / **1 红**（`src/bridge.ts` 911>905，别桶在途） | **5 / 5 / 0** |
| `npx vue-tsc -b --force` | 未跑（本轮零代码改动） | **`error TS` 计数 0**（退出码 0） |
| `node .tools/find-param-props.mjs` | —— | 共 **0** 处参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | —— | 干净：`tests/*.mjs` 全部纯 JavaScript |
| `node .tools/find-missing-ext.mjs` | —— | 干净：没有漏扩展名、且静态也解析不到的相对 import |
| `node .tools/find-orphan-modules.mjs --gate` | —— | 已登记孤儿 **8 / 基线 8 · 新增 0 · 清掉 0** ⇒ 绿 |
| ctest（`native/`） | 未跑：**本轮零 `native/` 改动** | 同左（不适用，理由：diff 只含 `docs/**.md` 与 `docs/inventory/citation-anchors.json`） |

## 6. 反向验证（本轮没新建门禁，所以是「自然实验 + 门禁自证」两类）

1. **门禁有牙（自然发生的三次注入→红→撤→绿）**：并行 lane 把同一对假路径抄进新文档 ⇒ 当场红 2 条
   （`tw3.md`、`lensgate.md`、`edact3.md` 各一次，数字见 §3 表）；订正/去行号 ⇒ 复绿。
   这就是「注入违规 → 变红 → 撤掉 → 复绿」的三步实录，只是注入者是并行 lane、撤除者是我或他们。
2. **我自己的转述遮罩是反证过的**：`docs/batch-2026-10-06-status2defect.md` 那 7 行**加空格前**正是 14 条红里的 7 条，
   加空格后门禁不再收集（`tests/source-citations.test.mjs:19` 的正则要求扩展名后紧跟冒号），
   而同一格补写的 4 条**真**坐标（带冒号带行号）全部被收且核过 ⇒ 证明「门在生效、只是不再收转述」。
3. **锚点门对「假路径」是瞎的**（`…anchors.test.mjs:132` 对树里不存在的路径直接 `continue`）：
   所以本轮 14 条红的唯一暴露面是老门；订正后新坐标进快照才获得后续漂移保护 ——
   我在 `update` 之前先把 §2.1/§2.3 每条逐行读到，才允许它们进快照。
4. **没有放松任何既有断言**：`tests/source-citations.test.mjs` / `tests/source-citation-anchors.test.mjs` / `docs/inventory/*.md` / `scripts/verdict_table.py` 一字未动（`git diff` 里这三个路径的 hunk 都不是我的）。

## 7. 改动文件清单（`wc -l` 收工值；除 `citation-anchors.json` 由门禁 update 生成外，全部是**行内改写 + 追加注记**，没有新建/删除文件）

`docs/batch-2026-10-06-projecttree.md` 181 · `docs/batch-2026-10-06-bucket14b.md` 157 ·
`docs/settings-parity.md` 240 · `docs/batch-2026-10-06-status2.md` 170 ·
`docs/batch-2026-10-06-status2defect.md` 300 · `docs/batch-2026-10-06-welcome2.md` 71 ·
`docs/wiring-requests-2026-10-06-vcs2.md` 186 · `docs/batch-2026-10-06-vcslog2.md` 121 ·
`docs/batch-2026-10-06-edact3.md` 153 · `docs/batch-2026-10-06-toolwindow2.md` 143 ·
`docs/batch-2026-10-06-roots.md` 96 · `docs/batch-2026-10-06-bucket15.md` 243 ·
`docs/batch-2026-10-06-prob3.md` 127 · `docs/batch-2026-10-06-bucket3a2.md` 79 ·
`docs/wiring-requests-2026-10-06-status2.md` 122 · `docs/wiring-requests-2026-10-06-statusbar.md` 168 ·
`docs/wiring-requests-2026-10-06-bucket14a.md` 61 · `docs/wiring-requests-2026-10-06-bucket12b.md` 60 ·
`docs/inventory/citation-anchors.json` 3005 行（锚点 1627 条 → **3000 条**）· 本报告 `docs/batch-2026-10-06-citefix.md`（新建，287 行）。
（这些文档同时被别的桶改过，所以只给收工值、不给「相对 HEAD」的差值：`git status` 里它们本就已是 ` M`。）

## 8. 零消费方自查

本轮**没有新建任何 `src/`、`native/`、`tests/` 模块**（只新增一份 `docs/*.md` 与一次快照重算），
`node .tools/find-orphan-modules.mjs --gate` = 孤儿 8 / 基线 8 · 新增 0 ⇒ 无新增零消费方。
临时取证脚本 `build/tmp-*.mjs` 与 `build/tmp-*.txt`（复算空区间、假路径分类用）**已全部删除**，
`build/` 里剩下的 `domain-list.tmp`、`enterHandlers.tail.tmp`、`tmp-commit2-regex.mjs`、`tmp-diffmerge/` 不是我建的，未动。

## 9. 做不到 / 无法核实（具体卡在哪一环）

1. `XBreakpointsPanel.kt`（`docs/wiring-requests-2026-10-06-bucket12b.md:42` 的「组节点在断点树里的渲染」）：
   全树 `find -name "XBreakpointsPanel.kt"` = 0 命中，也没有 `platform/xdebugger-impl/ui/` 这层模块 ⇒
   不知道原作者指的是哪个类（候选 `XBreakpointsTreeManager`/`BreakpointsTreePanel` 一类**我没有逐行打开过**，不能替他点名）⇒ 已就地写 `无法核实`。
2. `docs/batch-2026-10-06-dap.md:92`、`…dap2.md:94` 的 `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/XDebugProcessBase.java`：
   全树 0 命中（`XDebugProcess` 只有接口，`XDebugProcessBase` 不存在）。要判定该论断（「dap 侧的基类」）的等价物需要读 `XDebugProcess` 的默认实现链，
   属于 `src/debugger*` 的行为判定，**不是文档抄错** ⇒ 交主代理派给 dap 桶（我不替他们改论断）。
3. `docs/batch-2026-10-06-fix-macros.md:148` / `wiring-requests-2026-10-06-fix-macros.md:159` 的
   `platform/lang-impl/src/com/intellij/codeInsight/template/impl/Macros.java`：全树 0 命中（模板宏那族的真身在别的模块，需要按宏名逐个取证），未改。
4. `docs/batch-2026-10-06-plugins.md:45` 的 `…ide/plugins/newui/SearchPopup.kt`、`…bucket8c.md:325` 的 `EditorGroupWrapper.java`、
   `…bucket15.md:96` 的 `ExternalProjectManager.java`、`…roots.md:26` 的 `ModuleScopeProviderFactoryImpl.java`、
   `…runinst.md:53` 的 `…executor/ExecutionManagerImpl.java`、`…ui-parity-checklist.md:1561` 的 `…platform-impl/src/com/intellij/ui/UiUtil.kt`
   （全树同名文件只有 `tools/intellij.lambda.testFramework/.../UiUtil.kt`，语义明显不是同一个东西）：
   都属于**「名字在本仓语境下不存在」**，要找等价物必须重做一遍语义取证（且都不是本桶论断），未改，列在 §10 交派。
5. 「论断真伪需要改代码才能定」的两条，我**没有动代码**，只登记：见 §10 第 1、2 条。

## 10. 交主代理接的线（不另开 wiring 文件，派单要求写在报告里）

1. **`src/components/DebugConsolePane.vue:5`**：`platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java :19-19`
   读到空行（就是 after 里剩下的那 1 条「区间为空」，另 1 条是我自己这份报告的转述，已加空格遮罩）。建议属主改 `:18-22`
   （18 = `final class PauseOutputAction extends ToggleAction implements DumbAware {`、
   20-22 = `PauseOutputAction() { super(ExecutionBundle.messagePointer("run.configuration.pause.output.action.name"), AllIcons.Actions.Pause); }`），
   改完让属主跑一次 update。**域是 `src/` + 桶 12/execution，我不动。**
2. **`src/trustedProjects.ts`**：本轮两次采到它的引用被改形（快照里先 `…impl/TrustedHostsConfigurable.kt|61-69`、后 `|66-71`，最后一次重算时该完整引用已不在文件里）
   ⇒ 锚点门两次报 `moved`。我按域只读没动它；请属主确认那条论断现在指的是哪儿，再 update 一次。
3. **防复发机检（建议，属 `tests/`/`.tools/` 域，规约 §5 的「新门禁必须反向验证」要走三步）**：
   把 4 条**已知不存在的**上游包路径写进一条黑名单断言（`platform/lang-api/src/com/intellij/psi/util/`、
   `platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction`、
   `platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactory`（缺 `impl/` 那一层）、
   `platform/editor-ui-api/src/com/intellij/openapi/editor/settings/EditorSettingsExternalizable`、
   `platform/platform-api/src/com/intellij/openapi/ui/MessageDialogBuilder`、`platform/ide-core/src/com/intellij/openapi/projectIndex/`、
   `platform/ide-core/src/com/intellij/openapi/actions/BookmarkManager`），
   命中即红并打印真身 —— 今晚这一对被复制了 8 次，靠人肉修不完。
4. **剩余「不带行号的假路径」断言式坐标（门禁不拦，按图索骥会扑空），已给真身、待各桶自己订正**：
   `bucket15.md:18` `tools/Tool.java`（真身 `platform/lang-impl/src/com/intellij/tools/Tool.java`）、
   `prob3.md` 之外另有 `toolwindow.md:50`/`runcfg.md:90` `platform/platform-impl/src/com/intellij/ui/popup/ListPopupStep.java`
   （真身 `platform/ide-core/src/com/intellij/openapi/ui/popup/ListPopupStep.java`）、
   `wiring-bucket2c.md:110` / `wiring-completion.md:91` / `bucket2c.md:31`
   `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/SuppressIntentionAction.java`
   （真身 `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java`，见 §2.1 #8 的行内容）、
   `saveops.md:14` `platform/ide-api/.../EditorSettings.java`（真身 `platform/editor-ui-api/src/com/intellij/openapi/editor/EditorSettings.java`，
   但该文件里**没有**行尾空白/末行换行设置项 —— 属主 `docs/batch-2026-10-06-saveops.md` 已自己写明）、
   `problems.md:105` `platform/core-impl/src/messages/resources/core/ActionsBundle.properties`
   （真身 `platform/platform-resources-en/src/messages/ActionsBundle.properties`）、
   `wiring-filetypes.md:82` `platform/ide-core/src/com/intellij/openapi/vfs/VirtualFile.java`（真身 `platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java`）、
   `main.md:281-283` 三条 java debugger 路径（真身分别在 `java/debugger/shared/.../impl/shared/engine/JavaValueTextModificationPreparator.kt`、
   `java/debugger/shared/.../impl/shared/SharedDebuggerUtils.java`；`platform/platform-resources/src/actions/extensions.kt` 全树 0 命中）——
   这几处**多数已是「标注了不存在的留痕写法」**（`main.md:285` 自己就写了「转述的假路径改写成不带行号的说明」），
   是否要把留痕升级成真坐标，我按规约 §2「不越界代改别人的论断」交回各桶。
5. **`docs/inventory/*.md`、`scripts/verdict_table.py` 一字未动**（派单红线）；
   `docs/inventory/citation-anchors.json` 只由门禁 update 生成，没有手改。
