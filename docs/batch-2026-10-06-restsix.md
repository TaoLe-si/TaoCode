# restsix · platform_rest 判词只读核对表（2026-10-06）

> 本 lane 是**只读核对型**：不改 `docs/inventory/**`、不改 `scripts/verdict_table.py`、不改生产码。
> 产出是一张**订正表**，主代理据此跑脚本重生成账本。
> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一参考树；
> `third_party/intellij-community` 坏树禁用）。本地无中文语言包 ⇒ 中文措辞一律「无法核实」。

## 0. 选族与理由

从 `docs/inventory/verdict-platform_rest.md` 的族表里挑「数量最大 / 最可疑」的六族：

| 族 | 档位 | 类数 | 为什么挑它 |
|---|---|---:|---|
| `lp/refactoring` | `[~]` | 275 | A 堆最大族；判词点名 5 个「本批补」的落点 |
| `pf/plugins` | `[~]` | 265 | 判词最长，自报坐标最多（含一处「本轮复核 :109」的漂移声明） |
| `pf/actions` | `[~]` | 259 | 点名 `src/actionRegistry.ts` 全套出口与 `PlatformActions.xml:536-546` |
| `lp/documentation` | `[~]` | 155 | 判词自认「模型到 UI 的接线没做」，与本仓弹层实况可能不符 |
| `lp/inlay-hints` | `[~]` | 135 | 同一本书里 `lp/completion` / `pf/inline-completion` 说已接的「多建议循环」与「按词/按行部分接受」，本族仍挂在「缺」里 |
| `lp/custom-folding` | `[x]` | 5 | 全表**唯一**一个族级 `[x]`（声称已闭环），正是「判词说 `[x]` 但代码里没有那个出口」这种错的高危族 |

## 1. 核对方法

1. 本仓出口：判词里点名的每个 `src/*.ts` / `native/*.cpp` 逐条打开确认存在，行号取**我自己读到的那一行**。
2. 上游坐标：自己在参考树里定位文件，确认行数足够覆盖所引行号后才引用；读到的与判词不符就写我读到的并标「原坐标是假的」。
3. 结论档位：`判词正确` / `档位该升` / `档位该降` / `坐标假` / `无法核实`。

## 2. 订正表（逐族落盘）

### 2.1 `lp/refactoring` `[~]` 275 类 —— 结论：**「缺」段七条里六条整条为假 ⇒ 缺项该重写，本族是全表最重的一处「早做了还挂着缺」**

判词的「缺」列了七项：预览**对话框**、Safe Delete 的「仍然删除/查看用法」与注释/字符串用法、`RenameDialog` 的选项、
ChangeSignature、成员上移/下移、类/接口/超类/模块级 Introduce/Extract 与 `IntroduceParameterObject`。
磁盘上这七项**除「按 PSI 的类级 Introduce/Extract 全集」外都已落**，而且四个对话框组件在 `src/App.vue:10` 就挂上了：
`RefactorPreviewDialog` / `RefactorSignatureDialog` / `RefactorMemberChooserDialog` / `RefactorSafeDeleteDialog`。

| 判词项 | 档位 | 本仓真实出口（自己打开确认） | 上游坐标（自己开参考树确认，**只给路径，行号未逐行复核的不写**） | 结论 |
|---|---|---|---|---|
| 「缺：重构预览**对话框**（IDEA 应用前弹 `UsageView` 用法树，本仓只算账不弹窗——弹窗宿主在 App.vue，本批冻结）」 | 缺 | **弹窗已落**：模型 `src/refactorPreview.ts`（228 行，出口 `buildRefactorPreview`/`previewRequired`/`refactorPreviewTree`/`RefactorPreviewNode`，由 `src/semanticActions.ts:23` 引入）；状态与两条动作 `src/semanticActions.ts:674`/`:710-713`/`:745`/`:754`（`cancelRefactorPreview`）/`:772-773`/`:796`；组件 `src/components/RefactorPreviewDialog.vue`（168 行；`:29` 吃模型类型、`:32` 声明字段与 `semanticActions` 的 `refactorPreviewState` 逐字一致、`:132-133` 「取消 / 重构」两个动作按钮）；宿主 `src/App.vue:10` 已 import 并挂载 | `platform/lang-impl/src/com/intellij/refactoring/ui/RefactoringDialog.java`（存在） | **缺项整条为假 ⇒ 该删**（「弹窗宿主在 App.vue，本批冻结」这句已经过期：App.vue 侧的挂载在盘上） |
| 「缺：Safe Delete 的『仍然删除/查看用法』选择」 | 缺 | **已落**：`src/safeDelete.ts:86`（`SAFE_DELETE_CHOICE_LABELS`）、`:93`（`SAFE_DELETE_TITLE = '检测到用法'`）、`:95`（`SAFE_DELETE_LEAD = '发现以下问题：'`）、`:148`（`safeDeletePrompt`）、`:226`（`safeDeletePromptFromFiles`）；三选一 UI `src/components/RefactorSafeDeleteDialog.vue:48-49`（按 `prompt.choices` 逐条发按钮、`emit('choose', choice.id)`）、`:28`（Enter 走 primary，没有 primary 时退 `viewUsages`） | `platform/lang-impl/src/com/intellij/refactoring/safeDelete/SafeDeleteDialog.java`（存在） | **缺项整条为假 ⇒ 该删** |
| 「缺：注释/字符串里的用法搜索」 | 缺 | **已落**：`src/nonCodeUsages.ts:61`（`nonCodeRanges`）、`:144`（`occurrenceKind`）、`:192`（`nonCodeUsages`）、`:197`（`codeUsages`）、`:225`（`nonCodeReport`，带 `DEFAULT_LIMIT`）、`:247`（`NON_CODE_KIND_LABELS`＝注释/字符串）、`:252`（分组）、`:266`（提示文案）；真实消费者 `src/refactorHostAssembly.ts:25` + `:378`（「同一笔账 = 语言服务的代码引用 + 注释/字符串里的字面出现」）、`src/refactorIntroduceParameterObject.ts:40`（跳过字符串/注释里的出现） | 上游这一档在 IDEA 里是 `UsageSearchContext`/`FindUsagesOptions` 的 comments/strings 位（本 lane 未逐行核，判词也没给行号） | **缺项整条为假 ⇒ 该删** |
| 「缺：`RenameDialog` 的选项（LSP rename 不接收『搜索注释/字符串』，故无法真做）」 | 缺 | **已落且是真选项**：预览框里那一格「在注释和字符中搜索」`src/components/RefactorPreviewDialog.vue:123-127`（复选框），`:46` 说明「没有非代码扫描能力时整行不渲染」，勾选值随确认一起发出（`:133` `emit('refactor', model.searchInComments)`），宿主侧的开关在 `src/semanticActions.ts:796`（`toggleRefactorSearchInComments`）；「无法真做」的理由已被 `src/nonCodeUsages.ts` 那条文本路径绕过 | `platform/lang-impl/src/com/intellij/refactoring/rename/RenameDialog.java`（存在） | **缺项整条为假 ⇒ 该删**（原判词的理由是「LSP 不接收该选项」，本仓确实不靠 LSP 收，而是本地文本扫描 + 预览树合并） |
| 「缺：ChangeSignature（`changeSignature` 16 类，Ctrl+F6）」 | 缺 | **已落**：`src/refactorSignature.ts`（581 行：`PARAMETER_COLUMNS`/`SignatureParam`/`parseSignature`/`signaturePreview`/`validateSignatureChange`/`changeSignatureEdits`/`moveParam`，出口清单见 `src/refactorSignatureFlow.ts:26-29` 的 import）+ `src/refactorSignatureFlow.ts`（218 行，`:32` `SIGNATURE_SCAN_LIMIT = 600` 写明工作区扫描上限、不冒充全量）+ 对话框 `src/components/RefactorSignatureDialog.vue`（155 行，`:26` 引 `PARAMETER_COLUMNS`、`:28` 注明「与 flow 的 `ChangeSignatureState` 同形，组件无状态只发意图」）+ 菜单 `src/menus/refactorMenu.ts:13-14`（✅ 更改签名，键位指 `$default.xml:469-471`）；判据 `tests/refactor-signature.test.mjs` | `platform/platform-resources/src/keymaps/$default.xml:469-471` **我实测**＝`<action id="ChangeSignature"><keyboard-shortcut first-keystroke="control F6"/></action>` ⇒ 键位坐标正确；`platform/lang-impl/src/com/intellij/refactoring/changeSignature/ChangeSignatureDialogBase.java`（存在） | **缺项整条为假 ⇒ 该删** |
| 「缺：成员上移/下移（`memberPushDown`/`memberPullUp` 的 processor 与对话框）」 | 缺 | **已落**：`src/refactorMemberMove.ts`（471 行：`:39` 方向、`:42` `MEMBER_MOVE_TITLES`、`:48` `KEEP_ABSTRACT_COLUMN = '保持抽象'`、`:51` 面板标题、`:58` `supportsMemberMove`、`:82` `findMemberMoveClasses`、`:150` `classMembers`、`:311` `pickMembers`、`:337` `reindentMember`、`:348` `abstractStubOf`、`:402` `memberMoveEdits`、`:465` `memberMoveNotice`）+ 成员勾选框 `src/components/RefactorMemberChooserDialog.vue`（115 行）+ 菜单 `src/menus/refactorMenu.ts:24`（✅ 向上拉取/向下推送）；判据 `tests/refactor-member-move.test.mjs` | `platform/lang-impl/src/com/intellij/refactoring/memberPullUp/PullUpDialogBase.java`（存在）与 `java/java-impl-refactorings/src/com/intellij/refactoring/memberPullUp/PullUpDialog.java`、`…/memberPushDown/PushDownDialog.java`（存在）；`$default.xml` 里 **grep 不到** Push/Pull 的默认键位 ⇒ 本仓没给它键位是对的 | **缺项整条为假 ⇒ 该删**（顺带打掉同簿 `lp/ide-shell` 的「缺：`MemberChooser`/`MemberChooserBuilder` 的本地成员勾选」那条——`RefactorMemberChooserDialog.vue` + `refactorMemberMove.ts:311` 就是它；上游 `platform/lang-impl/src/com/intellij/ide/util/MemberChooser.java` 存在） |
| 「缺：类/接口/超类/模块级 Introduce/Extract 与 `IntroduceParameterObject`（需 PSI 级分析）」 | 缺 | **`IntroduceParameterObject` 已落**：`src/refactorIntroduceParameterObject.ts`（366 行：`:45` 标题「引入形参对象」、`:47` 三段面板名（要提取形参的方法 / 形参类 / 要提取的形参）、`:49` 「使方法保持为委托」、`:51` 「要修改的引用」、`:54` 语言档 ts/java/kotlin/python、`:57` `supportsDelegate`、`:102`/`:116` 请求与结果、`:200` `splitWrappedParams`）；判据 `tests/refactor-introduce-parameter-object.test.mjs`。其余「按 PSI 的类级 Introduce/Extract 全集」确实仍缺 | `java/java-impl-refactorings/src/com/intellij/refactoring/introduceparameterobject/IntroduceParameterObjectDialog.java`（存在，包名 `introduceparameterobject`） | **缺项该拆两半**：`IntroduceParameterObject` 一半删掉，PSI 级 Introduce/Extract 全集保留 |
| 「本仓：重命名的预览账与冲突检测在 `src/renamePreview.ts`…接线在 `semanticActions.applyRename`；安全删除的引用检查在 `src/safeDelete.ts`…接线在 `src/treeActions.ts` 的 `beginDelete`」 | 本仓已有 | 文件都在（`src/renamePreview.ts` 283 行、`src/safeDelete.ts` 239 行），`src/safeDelete.ts:40`（`safeDeleteReport`）/`:66`（`declarationTarget`）与判词描述一致 | — | **判词正确**（这一段的类名/落点/判据都核得过） |

**这一族的总结论**：`[~]` 档位**不动**（275 类里绝大多数是 PSI 级 processor，本仓按架构只能做文本/LSP 子集，
`[x]` 不可能；`[ ]` 也不该），但**判词的「缺」段要整段重写**：七条里六条已在盘上，
其中「预览对话框」「ChangeSignature」「成员上移/下移」「IntroduceParameterObject」四条还各有独立判据测试
（`tests/refactor-preview*.test.mjs`、`refactor-signature`、`refactor-member-move`、`refactor-introduce-parameter-object`，
另有 `refactor-host-assembly` / `refactor-menu-parity` / `refactor-safe-delete`）。
**建议主代理同时核对 `lp/ide-shell`（110 类）与 `lp/generation`（22 类）**——这两族的「缺」里也挂着 `MemberChooser`，同一处错。


### 2.2 `pf/plugins` `[~]` 265 类 —— 结论：**判词正确（本族是全表最干净的一条）；上游 12 处坐标逐条实读全对**

这一族是判词里坐标最密的一条（12 处上游坐标 + 4 处本仓坐标），也是唯一自带「订正留痕」的一条。逐条开文件复算：

| 判词项 / 坐标 | 本仓真实出口（自己打开确认） | 上游坐标（我读到的） | 结论 |
|---|---|---|---|
| `src/bridge.ts:109` 的 `Method` union（判词自注「本轮复核：union 现在在这行，原判词写的 :101 已漂」） | `src/bridge.ts:109` **确实是** `export type Method = 'app.state' \| 'app.quit' \| …` 那一行 ⇒ 自注正确，`:101` 那条旧坐标已按磁盘改掉 | — | **判词正确** |
| 「应用生命周期只有 `app.quit`，没有任何重启通道」 | `src/bridge.ts:109` 全文里 `app.*` 只有 `app.state/quit/memory/fullScreen/setFullScreen/info/jdks/logPaths/internalErrors/specialPaths/collectLogs/troubleshooting/readImage/exportSettings/readSettingsArchive/importSettings/resetSettings/writeExportFiles` ⇒ **没有 restart**；`plugin.*` 四条（list/setEnabled/install/uninstall） | 上游重启链存在（见下） | **判词正确**（「禁用/卸载后不放假『重启』按钮」的成因分析成立） |
| `index.html` 的 CSP 是 `connect-src 'self' ws://127.0.0.1:5173` ⇒ 远程市场被拦 | `index.html:6` 逐字命中：`… connect-src 'self' ws://127.0.0.1:5173; object-src 'none' …` | — | **判词正确** |
| 「`src/pluginGroups.ts` 的 `matchesInstalledQuery` 收市场算出的更新 id；`/outdated` 由待办变真实过滤；档位留在 `INSTALLED_SEARCH_OPTIONS`、故意不进 `SUPPORTED_SEARCH_OPTIONS`」 | `src/pluginGroups.ts:695`（`matchesInstalledQuery(plugin, query, updateIds?)`，第三参就是更新 id 清单）、`:439`（`INSTALLED_SEARCH_OPTIONS`）、`:456`（`SUPPORTED_SEARCH_OPTIONS` 含 `needUpdate`，注释 `:451` 写明取数来源）、`:473-486`（`/outdated` ↔ `needUpdate` 双向映射）；消费者 `src/components/PluginDialog.vue:18`/`:209`（把市场算出的 update id 传进去） | — | **判词正确** |
| 「复选框按 `pluginCanToggle` 置灰」 | `src/pluginGroups.ts:200`（定义）、`:384`/`:420`（两处按它筛可切换项） | — | **判词正确** |
| 「插件声明的文件类型跟着插件集合走」：`src/projectExtras.ts` 里 `pluginList` 的 watch 灌进 `src/fileTypePluginBeans.ts` | `src/projectExtras.ts:9`（import `applyPluginFileTypes`）、`:24`（`pluginList` ref）、`:36`（`watch(pluginList, …, { immediate: true, flush: 'sync' })`）；`pluginList` 在 `:51`/`:65`/`:98`/`:107` 每次 list/install/setEnabled/uninstall 后整体重写 ⇒ 触发点是真的；`src/fileTypePluginBeans.ts`（216 行） | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java`（全文 2025 行）：`:130` = `public class FileTypeManagerImpl … ExtensionPointListener<FileTypeBean>`、`:132` = `EP_NAME = new ExtensionPointName<>("com.intellij.fileType")`、`:280` = `public void extensionAdded(FileTypeBean, PluginDescriptor)`（同起 `:281` `fireBeforeFileTypesChanged()`、`:289` `fireFileTypesChanged(...)`）、`:294` = `extensionRemoved(...)` ⇒ **`:280-300` 那对回调的坐标正确** | **判词正确** |
| 「bundled 判定在 `PluginUiModel.kt:34` 的 `isBundled` 与 `:146` 的 `isBundledUpdate`，消费点在 `InstalledPluginsTabSearchResultPanel.kt:133-145`」 | 本仓侧对应档：`/bundled`、`/updatedBundled` 不进 `SUPPORTED_SEARCH_OPTIONS`、筛选按钮不渲染（判词自述） | `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginUiModel.kt:34` = `val isBundled: Boolean`、`:146` = `val isBundledUpdate: Boolean`（全文 319 行）；`platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:133-145` 实测正是 `isBundledOrBundledUpdate` / `parser.bundled` / `parser.updatedBundled` / `parser.userInstalled` 四段剔除（全文 252 行） ⇒ **两处坐标全对** | **判词正确** |
| 「订正留痕：原判词把 bundled 层挂在 `BundledPluginsLister.kt` 上，那个类实际是 `ModernApplicationStarter` 命令行工具（`:30`）」 | — | `platform/platform-impl/src/com/intellij/ide/plugins/BundledPluginsLister.kt:30` = `internal class BundledPluginsLister : ModernApplicationStarter()`（全文 158 行） ⇒ **这条留痕写对了，是真纠错** | **判词正确（留痕可信）** |
| 「require-restart 整条链」`PluginXmlConst.kt:10` → `XmlReader.kt:118` → `PluginMainDescriptor.kt:63`/`:155` → `DynamicPluginsValidators.kt:156-162` → `MyPluginModel.kt:93`/`:155`/`:191` → `PluginManagerConfigurable.kt:261-286`，文案 `IdeBundle.properties:447-453` | 本仓没有重启通道（第一行已核） | **十处坐标逐条实读**：`platform/pluginSystem/parser/impl/src/com/intellij/platform/pluginSystem/parser/impl/PluginXmlConst.kt:10`（`PLUGIN_REQUIRE_RESTART_ATTR = "require-restart"`）、`…/XmlReader.kt:118`（`-> builder.isRestartRequired = reader.getAttributeAsBoolean(i)`）、`platform/core-impl/src/com/intellij/ide/plugins/PluginMainDescriptor.kt:63`（`private val isRestartRequired`）与 `:155`（`override fun isRequireRestart(): Boolean = isRestartRequired`）、`platform/platform-impl/src/com/intellij/ide/plugins/DynamicPluginsValidators.kt:156-162`（`validateDescriptorDoesNotRequireRestart`）、`…/newui/MyPluginModel.kt:93`（`var needRestart`）/`:155`（`isModified()` 带 needRestart）/`:191`（`!applyResult.needRestart`）、`…/PluginManagerConfigurable.kt:261-286`（三个 `showRestartDialog` 重载）、`platform/platform-api/resources/messages/IdeBundle.properties:447-453`（`ide.restart.required.comment/message/notification` + `ide.restart.action`/`ide.shutdown.action`/`ide.postpone.action`/`ide.notnow.action`） ⇒ **一条不差** | **判词正确** |
| 「远程市场仍缺 / 签名校验未做 / `PluginRepositoryAuthService` 没有落点」 | 全仓 grep 无网络通道（`Method` union 里没有 http/download 类方法，`index.html:6` 的 CSP 也拦） | `pf/net`、`ic/proxy-download`、`pf/plugin-signature` 三族同簿判 `[-]`，口径一致 | **判词正确**（真缺，理由可复算） |

**这一族的总结论**：`[~]` 不用动，**判词文本也不用动**——这是六族里唯一一条「每条坐标都实读对上」的。
主代理不必为 `pf/plugins` 改脚本，只需注意它引用 `src/bridge.ts:109` 这类**行号会随别人改动漂**：本批读到 109 仍对。


### 2.3 `pf/actions` `[~]` 259 类 —— 结论：**「缺」段里两条整条为假（含一处把已做的 UI 判成没有），一处消费者指错文件**

| 判词项 | 档位 | 本仓真实出口（自己打开确认） | 上游坐标（自己开参考树确认） | 结论 |
|---|---|---|---|---|
| 「本批补 `UIToggleActions` 的两条真实入口（`PlatformActions.xml:536-546`）：`ViewStatusBar`（`src/menus/viewMenu.ts` 的 `view.statusBar`…）与 `ViewToolButtons`（`view.toolButtons` = `showToolWindowBars`，**消费者 `src/toolWindowStripes.ts`**）」 | 本仓已有 | 两条菜单行确实在：`src/menus/viewMenu.ts:140`（`view.statusBar`，`checked: () => ctx.editorSettings.value.showStatusBar`）、`:141`（`view.toolButtons`）；判据 `tests/view-toggle-actions.test.mjs` 存在。**但消费者写错**：全仓 grep `showToolWindowBars` ⇒ 读点是 `src/appearanceActions.ts:235-237`（watch 写 `html[data-tool-stripes]`）+ 样式闸 `src/style.css:43`（`html[data-tool-stripes='off'] .activity-bar { display: none; }`）+ `src/App.vue:2329`（状态栏那枚 PanelLeftClose/Open）与 `:869`（切换写回）；**`src/toolWindowStripes.ts` 里 `showToolWindowBars` 零命中**（那个文件管的是条纹的注册表与可见集合，不是这个设置键）。`view.statusBar` 的消费者判词写「状态栏 footer」——对，`src/App.vue:2329` 的 `<footer v-if="… editorSettings.showStatusBar …">` | `platform/platform-impl/resources/idea/PlatformActions.xml`（全文 1411 行）：`:536` = `<group id="UIToggleActions">`、`:545` = `<reference ref="ViewToolButtons"/>`、`:546` = `<reference ref="ViewStatusBar"/>` ⇒ **判词引的 `:536-546` 区间正好包住这两条 reference，坐标正确** | **判词基本正确，消费者文件名该改**：`src/toolWindowStripes.ts` ⇒ `src/appearanceActions.ts:235-237` + `src/style.css:43` |
| 「本批补动作注册表 `src/actionRegistry.ts`…`registerKeymapActions()` 把 25 条尾部绑定连处理器注册进单例 `ACTIONS`，`src/keymap.ts` 分派改为 `ACTIONS.has/run(binding.id)`；菜单侧 `actionRow(id)`…`buildMenu.ts`（4 条）与 `localHistory.ts` 已整组迁过去」 | 本仓已有 | 全部对得上：`src/actionRegistry.ts:130`（`ACTIONS` 单例）、`:136`（`registerKeymapActions`）、`:188`（`actionRow`）、`:197`（转发 icon）；`src/keymap.ts:16` import、`:442` `if (binding && ACTIONS.has(binding.id))`；`src/menus/buildMenu.ts:46-50` 正好 4 条 `actionRow('build.…')`；`src/menus/localHistory.ts:36`；判据 `tests/action-registry.test.mjs` 存在。**判词漏记一条出口**：`src/actionRegistry.ts:166` 的 `registerEditorActions()`（编辑器动作也进了同一张表，`src/keymap.ts:440` 注册、`:398`/`:427` 写明没给宿主时 `ACTIONS.has` 为假、按键原样放行） | 判词没给上游行号 ⇒ 不引 | **判词正确但欠一条**：该把 `registerEditorActions` 一并写进落点句 |
| 「键位冲突检查（`keymapConflicts()`）接进帮助 › 诊断工具：`help.keymapConflicts` 行标题实时显示冲突数」 | 本仓已有 | `src/menus/helpMenu.ts:25`（import `keymapConflictReport`/`keymapConflicts`）、`:65`（标题里 `${keymapConflicts().length} 处` + 点击复制报告）；规则在 `src/keymapBindings.ts:349`（`keymapConflicts`），报告文本是 `src/keymapBindings.ts:377-382`（`keymapConflictReport`）——帮助菜单那条读的就是它。⚠ 顺带一条**代码注释过期**：`src/keymapBindings.ts:374-375` 写「本仓没有键位设置页，所以由这个纯函数拼出一份」，而 `src/components/KeymapSettingsPage.vue` 已经在了（下一行）；属改键 lane 的事，账本不动 | — | **判词正确** |
| 「缺：图标字段已就位但**菜单渲染层（`src/menuUi.ts`）还没有图标位，尚无人消费**」 | 缺 | **已消费**：`src/menuUi.ts` 确实一个 `icon` 都没有（判词这半对），但渲染层从来不在那儿 —— 主菜单模板在 `src/App.vue`：`:89` import `menuRowIcon`、`:2019`/`:2026`/`:2031` 三处 `<span class="menu-item-icon"><component :is="menuRowIcon(row.icon)" …/></span>`；名字→组件表在 `src/menuRowIcons.ts:41`（`menuRowIcon()`）；上游那枚「Display icons in menu items」开关也活着：`src/settingsModel.ts:364`（`showIconsInMenus`）+ `src/appearanceActions.ts:240-242`（写 `data-menu-icons`）+ `src/style.css:28-34`（关掉时隐藏图标列）+ 设置页复选框 `src/components/SettingsDialog.vue:693` | — | **缺项整条为假 ⇒ 该删**（判词只按一个文件名搜，没找到真实渲染点就判「无人消费」，正是规则 §1 说的「按文件名搜不到 ≠ 没有」） |
| 「缺：**「给动作改键位」的 UI（`SetShortcutAction`）没有** —— 键位方案模型/冲突检测在 `src/keymapBindings.ts`，但**没有设置页可挂**（本 lane 未获设置页文件）」＋「缺：键位冲突的**面板**（`KeymapPanel` 的冲突页）与**用户自定义改键（没有把按键录进注册表的通道）**」 | 缺 | **整条为假，四件都已落**：纯规则 `src/keymapEditor.ts`（491 行：`:112` `strokeFromKeyEvent` = 把按键录进表、`:196` `shortcutRestrictions`/`:205` `restrictionReason`、`:216` `KEYMAP_OVERRIDE_STORAGE_KEY`、`:219`/`:234` 覆盖表读写、`:301` `effectiveKeyBindings`、`:355` `assignShortcut`（回冲突清单）、`:368` `unassignShortcut`、`:382` `applyOverrides`、`:389` `resetScheme`、`:420` `keymapRows`、`:477` `removeConflictsShortcuts` 同档的 `removeConflictingShortcuts`）；活状态 `src/keymapHost.ts`（140 行）；**两个 UI**：`src/components/KeymapSettingsPage.vue`（`:31` 取 `conflictCount`/`conflictsOnly`/`customizedCount`，`:89-91` 「只看冲突（N）」，`:106-107` 行内冲突标，`:120-126` 冲突三选一「移走冲突」）与 `src/components/KeymapDialog.vue`（`:7`/`:10` 同口径）；**设置页真挂上了**：`src/components/SettingsDialog.vue:38` import、`:924` 的 `preferences.keymap` 面板，树节点 `src/settingsTreeMeta.ts:142`（含「改键 冲突 恢复默认」关键词）；**分派真读用户覆盖**：`src/keymap.ts:15` import `effectiveKeyBindings`；判据 `tests/keymap-dialog.test.mjs` + `tests/keymap-affordances.test.mjs` + `tests/keymap-bindings.test.mjs` | 设置页 id 与 `KeymapPanel` 那一棵：`platform/platform-impl/resources/intellij.platform.ide.impl.xml:951-953` **本批收尾时实读**（全文 2055 行）＝`<applicationConfigurable groupId="root" groupWeight="65" instance="com.intellij.openapi.keymap.impl.ui.KeymapPanel" id="preferences.keymap" key="keymap.display.name" bundle="messages.KeyMapBundle"/>` ⇒ 本仓 `src/settingsTreeMeta.ts:136` 抄的那句是真坐标，本仓那一页也真挂上了 | **缺项整条为假 ⇒ 该删**，并且**同簿 `pf/keymap` 族（53 类）那句「可切换的键位方案要落 UI（设置库里没有空位：`SettingsDialog.vue` 顶在 1356 行上限）」是同一条错**，主代理改账本时要一起改 |
| 「缺：`ActionGroup` 的动态 `childrenOf` 仍只有**宏菜单**使用」 | 缺 | **已有三处动态子菜单 + 一处通用消费**：`src/menus/macrosMenu.ts:42`（已保存的宏）、`src/menus/analyzeMenu.ts:102`（检查方案，`:57-58`/`:96` 写明「档数会变，静态 children 表达不了」）、`src/menus/navigateMenu.ts:84`（符号类型过滤档）；通用消费点 `src/menus/submenuState.ts:12`（`row.childrenOf ? row.childrenOf() : row.children ?? []`） | — | **缺项该改写**：从「只有宏菜单」改成「宏/检查方案/符号过滤三处」；EP 式贡献者那半仍真缺 |
| 「缺：`Switcher`（Ctrl+Tab 弹窗，宿主在 App.vue）」 | 缺 | **真缺**：`ls src/switcher*` 无文件；`src/keymap.ts`/`src/keymapBindings.ts` 里 `Ctrl+Tab` 零命中；与同簿 `rf/core` 的「Switcher 没有入口、`recentlyEdited`/pinned 只有模型没有消费者」一致 | — | **判词正确** |
| 「缺：`InvalidateCachesAndRestartAction` 一族没有对应物（最接近的是 `file.reloadFromDisk` 与重启）」 | 缺 | 真缺且口径对：`src/menus/fileMenu.ts:98` 有 `file.reloadFromDisk`（Ctrl+Alt+Y），全仓无 `invalidateCaches` 出口 | — | **判词正确** |
| 「缺：工具栏视图模式（`ViewNewToolbarAction`/`ViewObsoleteToolbarAction`）…没有宿主通道」 | 缺 | 真缺：全仓无 `NewToolbar`/`ObsoleteToolbar`/`toolBarVisible` 出口（只有 `src/components/MainToolbar.vue` 本体） | `PlatformActions.xml:542-543`（`<reference ref="ViewNewToolbarAction"/>`、`:543` `ViewObsoleteToolbarAction`）——判词没引行号，此处补上实测行号 | **判词正确**（上游两条就在 `UIToggleActions` 组里，`:542`/`:543`） |

**这一族的总结论**：`[~]` 档位**不用动**（Switcher / 缓存失效 / 工具栏视图模式 / provider EP 那几块真缺），
但「缺」段**要删两条整条为假的**（图标位无人消费、改键 UI 与冲突面板没有），
**改写一条**（`childrenOf` 不止宏菜单），**订正一个消费者文件**（`toolWindowStripes.ts` ⇒ `appearanceActions.ts:235-237` + `style.css:43`），
**补记一条出口**（`registerEditorActions`）。上游 `PlatformActions.xml:536-546` 的坐标**实测正确**（文件 1411 行）。


### 2.4 `lp/documentation` `[~]` 155 类 —— 结论：**「本族最大的缺口」已在盘上闭合 ⇒ 缺项该删、判词落点该改**

判词自己写了「**缺：模型到 UI 的接线 —— 弹层仍是 hover 原文，链接与图片不可点（这是本族最大的缺口）**」。
磁盘上这条已经整条做完（`src/quickDocHost.ts` 337 行 + `src/quickDocLayout.ts` 406 行 + `src/quickDocHistory.ts` + `src/components/QuickDocPopup.vue` 215 行，宿主在 `src/App.vue:2428`）。

| 判词项 | 档位 | 本仓真实出口（自己打开确认） | 上游坐标（自己开参考树确认） | 结论 |
|---|---|---|---|---|
| 落点句「Ctrl+Q 取 LSP hover 并在固定弹层显示（`src/editorFileOps.ts` 的 `showQuickDoc`，**弹层渲染在 `src/components/CodeEditor.vue`**）」 | 本仓已有 | 前半对：`src/editorFileOps.ts:113`（`const showQuickDoc = quickDocHost.showQuickDoc`）、`:278` 导出；后半**错**：弹层不在 CodeEditor.vue，是 `src/components/QuickDocPopup.vue`，由 `src/App.vue:2428` 的 `<Teleport><QuickDocPopup …>` 挂载。`CodeEditor.vue` 里剩下的只有 hover 装饰（`:503`/`:509` 的 `lsp-hover` 纯文本 tooltip） | — | **落点该改**（判词把渲染宿主指到了错文件；这也解释了为什么「接线未做」的结论还能写在账本里） |
| 「缺：模型到 UI 的接线 —— 链接与图片不可点」 | 缺 | **已接**：`src/quickDocHost.ts:155` `showQuickDoc`、`:168` `showSymbolDoc`、`:279`（符号引用走 `showSymbolDoc`）、`:329` 一整组出口；弹层侧 `src/components/QuickDocPopup.vue:158`/`:167`/`:179`/`:191` 把 `DocLink` 画成**真按钮**（`@click="onLink(...)"`）、`:122-124`（外链直接 `open-external`，内链 `emit('follow', link)`）、`:128-135`（`resolveImage` 逐图解析出 `src`）、`:195-197`（`<img>` 与 `<figcaption>` 两态）；App 侧 `:2428` 绑了 `@follow="quickDocFollowLink($event)"` 与 `:resolve-image="(image, docPath) => quickDocResolveImage(image, docPath)"` | 富内容模型对上游 `DocumentationTarget`/`DocData` 一族，本 lane 未逐行引（判词也没给行号） | **缺项已闭合 ⇒ 该行该删** |
| 「缺：文档浏览器与前进/后退历史（`DocumentationBrowserHistory`/`DocumentationBackAction`/`DocumentationForwardAction`/`KeepTabAction`）」 | 缺 | **历史那一半已落**：`src/quickDocHistory.ts`（`createDocumentationHistory` + `DEFAULT_HISTORY_LIMIT`），`src/quickDocHost.ts:35` 引它、`:8` 写明 `DocumentationBrowserHistory` → `history` 的对应关系；UI 侧 `src/components/QuickDocPopup.vue:144-145`（后退/前进两个按钮，`:disabled="!canBackward"`/`!canForward`）、`:85-86`（`ArrowLeft`/`ArrowRight` 键盘），App 绑 `@back`/`@forward`；判据 `tests/doc-history.test.mjs`。**独立的文档工具窗**（`DocumentationToolWindowUI` 那种常驻浏览器）确实没有 ⇒ 只剩这一半真缺 | `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationBrowserHistory.kt`（全文 48 行，存在）；`…/ide/actions/DocumentationBackAction.kt:14`（实测就是 `e.presentation.isEnabled = documentationHistory(e.dataContext)?.canBackward() == true`，全文 20 行 ⇒ 本仓 `:disabled` 的同档）；`…/ide/actions/KeepTabAction.kt`（存在）；常驻窗在 `…/ide/ui/DocumentationToolWindowUI.kt`、`…/ide/impl/DocumentationToolWindowManager.kt`（存在） | **缺项该拆两半**：历史一半删掉（已落），「独立文档浏览器/工具窗」一半保留 |
| 「缺：外部文档动作（`DocumentationViewExternalAction` 打开 javadoc 站点）」 | 缺 | **已落**：`src/components/QuickDocPopup.vue:146`（「在浏览器中打开（Shift+F1）」按钮，`:disabled="!canOpenExternal"`）、`:94` 键盘触发、`:200`（外链行也走同一条）、`src/quickDocLayout.ts:380`（`externalDocumentationLinks(model)[0] ?? null` 决定按钮是否可用）、`src/quickDocHost.ts:257`（`openExternalUrl(...)` → `request('shell.openUrl', { url })`，宿主没有该通道时如实拒绝 `:60`） | `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/DocumentationViewExternalAction.kt`（全文 24 行，存在） | **缺项已闭合 ⇒ 该行该删** |
| 「缺：hover 自动显示/自动更新开关（`ToggleShowDocsOnHoverAction`/`ToggleAutoUpdateAction`）」 | 缺 | **大半已落**：`src/docHoverPolicy.ts`（146 行；`:64-66` 把两档绑到 `showQuickDocOnMouseHover`/`autoUpdateDocumentation`）、`src/settingsModel.ts:504`/`:506`（字段）+ `:265`（默认 true）、落盘白名单 `native/settings_schema.hpp:107` + 默认 `native/settings_schema.cpp:419`、齿轮按钮 `src/components/QuickDocPopup.vue:147-148`（`aria-pressed` + `togglePolicy`）、读盘点 `src/workspaceLifecycle.ts:14`；判据 `tests/doc-hover-policy.test.mjs` + `tests/setkeys-batch.test.mjs`（`:150`/`:165` 钉住两把键在两处都在）。**残余真缺只有一行**：`src/components/QuickDocPopup.vue:61` 声明的 `policy-change` 事件在 `src/App.vue:2428` 的绑定清单里**没有**（我实测那一行的绑定是 `@close/@back/@forward/@open-external/@follow` + `:resolve-image`，无 `@policy-change`）⇒ 齿轮当场生效、重启回出厂；`src/docHoverPolicy.ts:55-57` 自己也这么写着 | `platform/lang-impl/src/com/intellij/codeInsight/documentation/ToggleShowDocsOnHoverAction.java:22`（实测 `return EditorSettingsExternalizable.getInstance().isShowQuickDocOnMouseOverElement();`，全文 34 行）——本仓两档 = 上游那两把 toggle | **缺项该改写**：从「开关没有」改成「开关+设置键+齿轮已落，只差宿主那行 `@policy-change` 持久化绑定（App.vue 禁改）」；另记一条接线请求（§5） |
| 「缺：符号型 target（`DefaultTargetSymbolDocumentationTargetProvider`/`PsiElementDocumentationTarget` 需要 PSI 与符号解析）」 | 缺 | 部分已有等价路径：`src/quickDocHost.ts:168`/`:279` 的 `showSymbolDoc` 把 `{@link Foo#bar}` 这类**符号引用**接成了真实导航（上游那一族的核心用户可见行为就是「点了跳到那个符号」）；PSI 级 provider 本身仍然没有 | 判词没给上游行号 ⇒ 不引 | **判词半正确**：该补一句「本仓用 `showSymbolDoc` 承担了符号链接的导航，缺的只是 PSI 侧 provider」，别让人以为点 `{@link}` 没反应 |
| 「缺：内联文档渲染（`render/` 的 DocRender 一族）」 | 缺 | 本仓无 `docRender`/`renderDocumentationHtml` 类出口（全仓 grep 零命中）；富渲染走 `src/documentationView.ts`（367 行）+ `src/quickDocLayout.ts` | — | **判词正确** |

**这一族的总结论**：`[~]` 档位本身不用动（还有 PSI 符号 target、独立文档工具窗、DocRender 三块真缺），
但判词的「缺」段**过半已失效**：整条「模型到 UI 的接线（本族最大缺口）」、「前进/后退历史」的一半、
「外部文档动作」、「hover 两档开关」四条都要按上表重写；**落点句里的 `src/components/CodeEditor.vue` 是错的**，
弹层宿主是 `src/components/QuickDocPopup.vue` + `src/App.vue:2428`。


### 2.5 `lp/inlay-hints` `[~]` 135 类 —— 结论：**「缺」里三条已落盘（内容该删），族档位仍留 `[~]`**

这一族是「判词按类名搜不到就判未做 / 判词写完没人回来改」的典型：判词自报的三条缺口磁盘上都已经闭合，
而同一本书里的 `lp/completion` 与 `pf/inline-completion` 两族已经把它们写成「本仓有」——**同一本书自相矛盾**。

| 判词点名的项 | 档位 | 本仓真实出口（自己打开确认） | 上游坐标（自己开参考树确认） | 结论 |
|---|---|---|---|---|
| 「三个设置键（`INLAY_HINT_SETTING_KEYS`）要登记进 `src/settingsModel.ts` 与设置页 ⇒ 按类型开关现在还不生效」 | 缺 | **已登记且已生效**：键定义 `src/inlayHints.ts:55-60`；设置模型 `src/settingsModel.ts:441`（字段）+ `:265`（默认 true 三格）；落盘白名单 `native/settings_schema.hpp:87` + 默认值 `native/settings_schema.cpp:331`；**设置页已挂**：`src/components/InlayHintsSettingsPage.vue:24`（引 `INLAY_HINT_SETTING_KEYS`）、`:52-53`（三格勾选），宿主 `src/components/SettingsDialog.vue:32` import、`:805` 渲染；**真实消费**：`src/editorInlayHints.ts:43`/`:217-218`，过滤在 `src/inlayHintLayout.ts:71`（`shouldShowInlayHint`），改档即时重算 `src/components/CodeEditor.vue:215`（`toggles: () => inlayHintToggles(props.settings)`）与 `:1053`（watch `inlayHintTogglesKey`）；判据 `tests/inlay-hints-settings.test.mjs`（`:221-222` 钉住三键、`:252` 钉住键↔槽位） | 上游那一页是真有注册的：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:935-941`（`<projectConfigurable provider="…InlaySettingsConfigurableProvider" id="inlay.hints" parentId="editor" …>`）；勾选态字段在 `platform/lang-api/src/com/intellij/codeInsight/hints/settings/InlayProviderSettingsModel.kt:26`（`abstract class InlayProviderSettingsModel(var isEnabled: Boolean, …)`，全文 132 行） | **缺项已闭合 ⇒ 该行该从「缺」里删掉**（本仓把按 provider 逐勾折成按 LSP `kind` 三档，是等价口径不是假控件） |
| 「宿主 `native/lsp_session.cpp` 只转发 label/padding/kind，`tooltip`/`command` 转发后才能点与悬停」 | 缺 | **已转发**：分派现在在 `native/lsp_session_kinds.cpp:552`（`kind == "inlayHint"`，同文件 `:657` 行内），`label` 摊平 `:561-565`、`paddingLeft/Right` `:569-570`、`kind` `:571`、**command `:578-586`**（命令名非空才转、arguments 必须是数组）、**tooltip `:588-594`**（字符串与 MarkupContent 两形都取 value）；前端消费 `src/inlayHints.ts:97`（`inlayHintCommand`）/`:104`（`inlayHintTooltip`）→ `src/editorInlayHints.ts:217-218`（可点行 / 悬停说明，没命令的仍是只读 span） | `platform/lang-api/src/com/intellij/codeInsight/hints/declarative/InlayTreeSink.kt:27-31`（本批收尾时实读：全文 59 行，那五行正是 `addPresentation(position: InlayPosition, payloads: List<InlayPayload>?, tooltip: String?, hintFormat, builder)` —— 与 `native/lsp_session_kinds.cpp:574-576` 的本仓注释一致 ⇒ 坐标正确） | **缺项已闭合 ⇒ 该行该删**（原判词连宿主文件名都写旧了：转发不在 `lsp_session.cpp`，在 `lsp_session_kinds.cpp`） |
| 「多建议切换未接（`CodeEditor.vue` 只取第一条建议，Alt+] / Alt+[ 没有落点）」 | 缺 | **已接**：`src/components/CodeEditor.vue:54` import `cycleSuggestionIndex`/`dedupeSuggestions`/`inlineTriggerKindFor`，`:282-285` `cycleInlineSuggestion`（无建议时不消费按键），`:763` 把 `inlineNavigationKeymap({cycle: …})` 挂进 keymap 链；键位本体 `src/inlineCompletionExtension.ts:204-205`（`Alt-]` / `Alt-[`）；判据 `tests/inline-completion-nav.test.mjs` + `tests/inline-completion-variants.test.mjs` | 上游动作在 `platform/code/style/src/...` 之外的 `ide/inlineRefactor`/`codeInsight/inline/completion`（本 lane 只核本仓档位，未逐行引上游） | **缺项已闭合 ⇒ 该行该删**；与同簿 `lp/completion`（已写「另有 `src/inlineCompletionNav.ts` … 判据 …」）、`pf/inline-completion` 直接矛盾 |
| 「本地 provider 扩展点与 declarative hints（`FactoryInlayHintsCollector`/`HintsBuffer`/`InlayTags`/各 `*Presentation`）」 | 缺 | 本仓没有任何 declarative hints 宿主：全仓 `src/` 无 `HintsBuffer`/`InlayTags`/`FactoryInlayCollector` 对应物 | 三个类**在参考树里都真实存在**：`platform/lang-impl/src/com/intellij/codeInsight/hints/FactoryInlayHintsCollector.kt`、`…/hints/HintsBuffer.kt`、`…/hints/declarative/impl/InlayTags.kt` | **判词正确**（本仓没有插件 EP 宿主，条目全来自语言服务 ⇒ 真缺） |
| 「参数提示排除列表（`ParameterHintExcludeListService`/`ParameterHintsExcludeListConfigProvider`/`MethodMatcher`）没有设置面与通往宿主的通道」 | 缺 | 全仓 grep `excludeList`/`hintExclude` ⇒ **零命中**（`src/`、`native/` 都没有） | `platform/lang-impl/src/com/intellij/codeInsight/hints/parameters/ParameterHintExcludeListService.kt`（存在） | **判词正确**（真缺；且是本架构下可做的一条，见 §5 建议实现） |
| 「Swing/Compose 渲染器与设置面板本体（`BlockInlayRenderer`/`InlaySettingsPanel`/`PresentationRenderer`）机械降级」 | 缺 | DOM 等价物是 `src/editorInlayHints.ts`（304 行） | `platform/lang-impl/src/com/intellij/codeInsight/hints/settings/InlaySettingsPanel.kt`（存在） | **判词正确**（组件本体逐类降级，与本仓架构口径一致） |

**这一族的总结论**：三条「缺」已在磁盘上闭合（其中两条同簿另两族已经承认，本族判词没跟着改），
**族档位仍是 `[~]` 不动**（provider EP 与排除列表真缺），但**判词文本必须重生成**：删掉那三行、
并把宿主文件名从 `native/lsp_session.cpp` 订正为 `native/lsp_session_kinds.cpp`（转发分支 `:552`）。


### 2.6 `lp/custom-folding` `[x]` 5 类 —— 结论：**判词正确（档位不动），两处本仓行号漂了**

这是全表**唯一**一个族级 `[x]`，所以按「判词说 `[x]` 但代码里根本没有那个出口」这一号错重点核。逐条打开后的实况：

| 判词点名的出口 | 本仓真实位置（自己打开确认） | 上游坐标（自己开参考树确认） | 结论 |
|---|---|---|---|
| `regionMarker`/`localRegionFolds`/`mergeFoldRanges` | `src/editorFolding.ts:82`、`:93`、`:123`（`regionMarkerBody` 在 `:77`） | `platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java`（存在，逐行未引） | 判词正确 |
| 设置项 `collapseCustomRegions` + `autoCollapseKinds` | `src/editorFoldingSettings.ts:25`（字段）/`:30`（默认 false）/`:49`（`autoCollapseKinds`，`:52` 真的把 `region` 推进 kinds）；一路到 `src/settingsModel.ts:265`/`:316` | — | 判词正确 |
| 区域列表弹层 `src/customFoldingPopup.ts` | `:29` `NO_CUSTOM_REGIONS_IN_FILE`、`:42` `regionNavigateSpec`、`:70` 用 spec 跳、`:105` 用 `regionIndent` 画行、`:114` `nextCustomRegion`；**消费者确认存在**：`src/components/CodeEditor.vue:82` import、`:112` 建实例、`:939` 挂 extension | `platform/lang-impl/src/com/intellij/lang/customFolding/CustomFoldingRegionsPopup.java:26`（`orderByPosition` 调用）/`:58`（`StringUtil.repeat("   ", myIndent) + getPlaceholderText()`）/`:80-88`（`navigateTo`，全文 89 行）——**三条都对得上** | 判词正确 |
| 上/下一个区域：判词写「`src/customFoldingRegions.ts:128` 的 `nextCustomRegion`」 | **行号漂**：`nextCustomRegion` 实际在 `src/customFoldingRegions.ts:143`（`:128` 是 `orderByPosition` 那层的 `const open: CustomRegion[] = []`）；`regionIndent` 在 `:153` | `GotoCustomRegionAction.java:65` = `showInformationHint(..., "goto.custom.region.message.unavailable")`——空区域那条提示分支**坐标正确**（全文 119 行） | 符号在、档位对；**行号该改成 :143** |
| 用标记包围选区：判词写「`src/customFoldingSurround.ts:57-112`」 | `snapToLines` 起 `:58`、`surroundWithRegion` 起 `:79`、返回体 `:105-112`、函数收在 `:113`——区间基本对（末行差 1） | `platform/lang-impl/src/com/intellij/lang/folding/CustomFoldingSurroundDescriptor.java` 全文 332 行，判词没引具体行 ⇒ 无越界风险 | 判词正确 |
| provider 表三档 | `src/customFoldingProviders.ts:60`（NetBeans `<editor-fold>`）/`:71`（VS `#region`）/`:89`（默认 `<region>`，id 空串）；消费者：`src/surround.ts:46`（`customFoldingSurroundRows()`）、`src/editorCommands.ts:53`/`:211`、`src/editorFolding.ts:21` | — | 判词正确 |
| 键位 Ctrl+Alt+.：判词写「`src/components/CodeEditor.vue:915-921`」 | 实际键位块是 `:913-919`（`:915` 是 `{ key: 'Ctrl-Alt-.', ...}`，`:920` 起是 `]),` 与下一条英文注释）——**区间尾端多算 2 行** | `platform/platform-resources/src/keymaps/$default.xml:535-537` 实测正是 `<action id="GotoCustomRegion"><keyboard-shortcut first-keystroke="control alt PERIOD"/></action>`——**坐标正确** | 符号在；**区间该收成 :913-919** |
| 判据 | 四个文件全在：`tests/editor-custom-fold-regions.test.mjs`、`tests/folding-custom-region-providers.test.mjs`、`tests/folding-custom-region-surround.test.mjs`、`tests/folding-region-navigate.test.mjs` | — | 判词正确 |
| 「剩下的按 provider 的标记配置面 ⇒ `[-]`」+「全树 grep `CustomFoldingOptionsProvider` 零命中」 | — | **在参考树里复跑 `grep -rl CustomFoldingOptionsProvider .` ⇒ 零命中**，与判词一致（社区树确实没那一页） | 判词正确 |

**这一族的总结论：`[x]` 站得住，不用降档**（不是「判词说 `[x]` 其实没做」那一号错）。要订正的只有两条本仓行号：
`src/customFoldingRegions.ts:128` ⇒ `:143`；`src/components/CodeEditor.vue:915-921` ⇒ `:913-919`。
上游六条坐标（`CustomFoldingRegionsPopup.java:26/:58/:80-88`、`GotoCustomRegionAction.java:65`、`$default.xml:535-537`）
**逐条实读对上，没有一条是假的**。

## 3. 门禁原始数字（照实报，一条没修）

| 命令 | 结果 |
|---|---|
| `node --test tests/b*-verdict.test.mjs tests/verdict-generated.test.mjs tests/verdict-table-check.test.mjs` | **tests 98 / pass 97 / fail 1**。唯一红：`tests/b7-verdict.test.mjs:124`「src/diffAlign.ts 引的上游行号没有漂」——报 14 条找不到：`Diff.kt:29-41 / :64-75 / :96-101 / :118-127 / :129-141`、`Enumerator.kt:16-25`、`MyersLCS.kt:10-11 / :38-42 / :64-70 / :96-190 / :175-186 / :186-188`、`IgnorePolicy.java:29-35`、`TrimUtil.kt:53-55`。**属桶 9 diff/patch lane 的在途现场（任务 #235 in_progress），本 lane 一字未动、不修。** |
| `python scripts/verdict_table.py --check`（不带域，只读） | **退出 0**，「一致 7 / 7 条产物」；打印 `execution: total=1608 [x]=0 [~]=978 [ ]=0 [-]=630`、`xdebugger: total=635 [x]=0 [~]=338 [ ]=0 [-]=297`。默认 `--check` **不覆盖 platform_rest**，故补跑下一条 |
| `python scripts/verdict_table.py --check platform_rest`（只读） | **退出 1**：`platform_rest: total=20574 [x]=27 [~]=5418 [ ]=0 [-]=15129`，而磁盘账本是 `[~]=5429 / [-]=15118`；「不一致 3 / 3 条产物」（`platform_rest_verdict_table.json`、`.md`、`verdict-platform_rest.md`）。差异行含 `lp/refactoring`、`pf/actions`、`pf/plugins`、`pf/progress`、`module/progress`、`pf/file-types` 等族行 ⇒ **`scripts/verdict_table.py` 正被别的路改（git 显示 M）**，本 lane 不重生成、不改表。**⚠ 必须让主代理先看的两点**：现脚本会把磁盘上 `module/progress` 的 `[~]`（msgverdict 的逐条重判，2812 字判词）**打回 `[-]` 默认档**，并把逐类表里 `TaskCancellation` / `NonCancellableTaskCancellation` / `CancellableTaskCancellation` 三行从 `[~]` 改回 `[-]`；`pf/progress` 的判词会从 4201 字**截成 2040 字**（丢掉那批「订正 ①②③」）。谁跑重生成都会先把 msgverdict 的账冲掉。 |
| `node --test tests/source-citations.test.mjs` | **tests 3 / pass 2 / fail 1**（唯一红 = `docs\batch-2026-10-06-findrep2.md` 转述的那条 `ConsoleViewImpl.kt`，行号写成六个 9、越界：该文件实测 1730 行）。**本报告所有上游行号都落在实读过的文件长度内**（最长的几处：`intellij.platform.ide.impl.xml` 2055 行、`FileTypeManagerImpl.java` 2025 行、`PlatformActions.xml` 1411 行、`PluginUiModel.kt` 319 行、`DocumentationBackAction.kt` 20 行）。⚠ **本 lane 自己踩过一次引用门**：第一版把那条假引用按「路径 + 行号」的完整形状抄进了这张表，引用门立刻把它当**本报告的一条真引用**收走并变红；按规则 §5 去掉行号、只留文件名后复跑，`restsix` 在红名单里的命中数从 1 回到 **0**（下表最后一行）。 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs`（收工复跑） | **tests 11 / pass 8 / fail 3（两条不同的测试各计一次，anchors 计一次）**，红的全是别人的现场：① 引用可达性 —— `docs/batch-2026-10-06-findrep2.md` 与 `docs/batch-2026-10-06-hlregistry.md`（后者在我核账期间新落盘）各带一条 `ConsoleViewImpl.kt` 的越界行号；② 快照锚点 —— 4 条 `moved`：`src/commitChecks.ts` 1、`src/components/ProblemsPanel.vue` 2、`src/runStartupFocus.ts` 1（别的路改了这几个文件里的上游区间行号，快照没跟着重算）。**`grep -c restsix` 在这份输出里 = 0** ⇒ 本 lane 没把共享门染红。本 lane 未跑 `TAOCODE_CITATION_ANCHORS=update`（那会改快照）。 |
| 其它 | 本 lane 零改动生产码 ⇒ 未跑 `vue-tsc`/`module-size`/`ctest`；未 commit、未 add、未 `checkout/reset/stash/clean`。跑 `--check` 会让 `scripts/__pycache__/verdict_table.cpython-314.pyc`（这仓库把 `__pycache__` 纳入了版本控制）显示为 modified，**我没有 add，也没有还原**；`scripts/verdict_table.py` 的 M 是别的 lane 改的。 |

## 4. 无法核实 / 做不到（具体卡在哪一环）

1. **中文措辞全部「无法核实」**：参考树里没有中文语言包（本地只有 `IdeBundle.properties` 等英文 bundle）。
   连带：`lp/custom-folding` 判词引用的 `src/customFoldingProviders.ts:73` `description: 'region…endregion 注释'`
   与 `RefactorPreviewDialog.vue:127`「在注释和字符中搜索」等文案，我只能确认**本仓有这条出口**，
   无法核实上游中文串本身（上游是 `LangBundle`/`IdeBundle` 的英文 key）。
2. **`lp/documentation` 的上游 provider 层**：`DefaultTargetSymbolDocumentationTargetProvider`/`PsiElementDocumentationTarget`
   与 `render/` 的 DocRender 一族判词没给行号，我只确认了本仓侧有无出口 ⇒ 上游形状「未逐类开」。
3. **（已撤销的一条）**`lp/inlay-hints` 的 declarative sink 坐标：第一版只把它当本仓注释的转述、标「未逐行复核」；
   收尾时开了 `platform/lang-api/src/com/intellij/codeInsight/hints/declarative/InlayTreeSink.kt`（59 行），
   `:27-31` 就是 `addPresentation(position, payloads?, tooltip?, hintFormat, builder)` ⇒ 本仓注释的引用是真坐标，已并进 §2.5。
4. **（已撤销的一条）**`pf/actions` 的 `KeymapPanel` 注册行：本 lane 第一版只复核到本仓侧、把上游 `intellij.platform.ide.impl.xml`
   那一行标成「未复核」；收尾时补开了那个文件（2055 行），`:951-953` 实读到 `instance="com.intellij.openapi.keymap.impl.ui.KeymapPanel"`
   与 `id="preferences.keymap"` ⇒ 不再是「无法核实」，已并进 §2.3 订正 #8 的证据列。
5. **`lp/custom-folding` 的 `CustomFoldingBuilder.java` / `NetBeansCustomFoldingProvider.java`**：只确认路径存在，
   未逐行 ⇒ 报告里不带行号。
6. **做不到（越权项）**：六条订正都要写进 `scripts/verdict_table.py` 的 `FAMILIES` 表并重生成 `docs/inventory/**`，
   这两处本 lane 禁写 ⇒ 只交表；另 `QuickDocPopup` 的持久化那一行在禁改的 `src/App.vue`，也交不了手。

## 5. 六族结论汇总 + 订正表（主代理据此改脚本重生成）

### 5.1 结论一览

| 族 | 档 | 类数 | 本 lane 结论 |
|---|---|---:|---|
| `lp/refactoring` | `[~]` | 275 | **缺项该整段重写**：七条缺里六条已在盘上（预览弹窗 / Safe Delete 三选一 / 注释字符串用法 / RenameDialog 选项 / ChangeSignature / 成员上移下移 / IntroduceParameterObject）；档位仍 `[~]` |
| `pf/plugins` | `[~]` | 265 | **判词正确**：12 处上游坐标 + 4 处本仓坐标全部实读对上；不改 |
| `pf/actions` | `[~]` | 259 | **两条缺整条为假**（图标位无人消费 / 改键 UI 与冲突面板没有），一条该改写（`childrenOf` 不止宏菜单），一个消费者文件指错，一条出口漏记；上游 `PlatformActions.xml:536-546` 坐标正确 |
| `lp/documentation` | `[~]` | 155 | **「本族最大缺口」已闭合**：接线/前进后退/外部打开/hover 两档四条缺该删或拆半；**落点句把弹层宿主写成了 `CodeEditor.vue`，实际是 `QuickDocPopup.vue` + `App.vue:2428`** |
| `lp/inlay-hints` | `[~]` | 135 | **三条缺已闭合**（三把设置键+设置页+生效、宿主 tooltip/command、多建议 Alt+]/[）；宿主文件名该从 `lsp_session.cpp` 改成 `lsp_session_kinds.cpp:552`；EP/declarative 与参数提示排除列表真缺 |
| `lp/custom-folding` | `[x]` | 5 | **`[x]` 站得住、不降档**：出口、消费者、判据、上游六条坐标全对；只漂了两条**本仓**行号 |

### 5.2 订正表（逐条可直接抄进 `FAMILIES`）

| # | 族 | 判词原文（片段） | 磁盘实况 | 该怎么改 |
|---:|---|---|---|---|
| 1 | `lp/refactoring` | 「缺：重构预览**对话框**……本仓只算账不弹窗」 | `src/refactorPreview.ts` + `src/components/RefactorPreviewDialog.vue` + `src/semanticActions.ts:674`/`:745`/`:754`/`:796` + `src/App.vue:10` | 删这一条；把「本仓」句补上预览弹窗与两条判据 `tests/refactor-preview.test.mjs`/`tests/refactor-preview-tree.test.mjs` |
| 2 | `lp/refactoring` | 「缺：Safe Delete 的『仍然删除/查看用法』选择与注释/字符串里的用法搜索」 | `src/safeDelete.ts:86`/`:93`/`:148`/`:226` + `RefactorSafeDeleteDialog.vue:28`/`:48-49`；`src/nonCodeUsages.ts:61`/`:192`/`:225`/`:252` | 整条删；非代码用法的落点补进本族（消费者是 `src/refactorHostAssembly.ts:25`/`:378`） |
| 3 | `lp/refactoring` | 「缺：`RenameDialog` 的选项（LSP 不接收『搜索注释/字符串』，无法真做）」 | `RefactorPreviewDialog.vue:123-127`（复选框）+ `:133`（随确认发出）+ `semanticActions.ts:796` | 删「无法真做」，改成「走本地 `nonCodeUsages` 文本扫描 + 预览树合并，不经 LSP」 |
| 4 | `lp/refactoring` | 「缺：ChangeSignature（16 类，Ctrl+F6）」 | `src/refactorSignature.ts`(581，含 `PARAMETER_COLUMNS`/`parseSignature`/`signaturePreview`/`validateSignatureChange`/`changeSignatureEdits`/`moveParam`) + `src/refactorSignatureFlow.ts`(218，`:26-29` 引这五个出口、`:32` `SIGNATURE_SCAN_LIMIT = 600`) + `RefactorSignatureDialog.vue`(155，`:26` 引 `PARAMETER_COLUMNS`、`:28` 写明「与 flow 的 `ChangeSignatureState` 同形、组件无状态只发意图」) + `src/menus/refactorMenu.ts:13-14`（✅ 更改签名，指 `$default.xml:469-471`）；上游键位本批实测 `$default.xml:469-471` | 删；键位坐标可以钉 `$default.xml:469-471`（本批实测） |
| 5 | `lp/refactoring` | 「缺：成员上移/下移（`memberPushDown`/`memberPullUp` 的 processor 与对话框）」 | `src/refactorMemberMove.ts`(471，`:42`/`:48`/`:311`/`:348`/`:402`/`:465`) + `RefactorMemberChooserDialog.vue`(115) + `refactorMenu.ts:24` + `tests/refactor-member-move.test.mjs` | 删（上游 Push/Pull 在 `$default.xml` 里**没有**默认键位，别补一个） |
| 6 | `lp/refactoring` | 「缺：…与 `IntroduceParameterObject`（需 PSI 级分析）」 | `src/refactorIntroduceParameterObject.ts`(366，`:45`/`:47`/`:49`/`:51`/`:54`/`:102`/`:200`) + `tests/refactor-introduce-parameter-object.test.mjs` | 拆两半：`IntroduceParameterObject` 删，PSI 级 Introduce/Extract 全集留 |
| 7 | `pf/actions` | 「缺：图标字段已就位但菜单渲染层（`src/menuUi.ts`）还没有图标位，尚无人消费」 | `src/menuRowIcons.ts:41` + `src/App.vue:89`/`:2019`/`:2026`/`:2031` + `src/appearanceActions.ts:240-242` + `src/style.css:28-34` + 设置页复选框 `SettingsDialog.vue:693` | 整条删（真实渲染层从来不在 `menuUi.ts`，按一个文件名搜不到就判「无人消费」） |
| 8 | `pf/actions` | 「缺：『给动作改键位』的 UI（`SetShortcutAction`）没有……没有设置页可挂」＋「缺：键位冲突的面板与用户自定义改键（没有把按键录进注册表的通道）」 | `src/keymapEditor.ts`（`:112`/`:196`/`:216`/`:219`/`:301`/`:355`/`:368`/`:382`/`:389`/`:420`/`:477`）+ `src/keymapHost.ts` + `KeymapSettingsPage.vue:31`/`:89-91`/`:106-107`/`:120-126` + `KeymapDialog.vue` + 挂载 `SettingsDialog.vue:38`/`:924`、`settingsTreeMeta.ts:142` + 分派读 `src/keymap.ts:15`；判据 `tests/keymap-dialog.test.mjs`/`tests/keymap-affordances.test.mjs` | 两条整条删；**同时删 `pf/keymap`（53 类）里的同一条错**（那句「可切换的键位方案要落 UI（`SettingsDialog.vue` 顶在 1356 行上限）」已不成立） |
| 9 | `pf/actions` | 「缺：`ActionGroup` 的动态 `childrenOf` 仍只有宏菜单使用」 | `macrosMenu.ts:42`、`analyzeMenu.ts:102`、`navigateMenu.ts:84`，通用消费 `src/menus/submenuState.ts:12` | 改成「宏 / 检查方案 / 符号类型过滤三处动态子菜单；EP 式贡献者仍缺」 |
| 10 | `pf/actions` | 「`ViewToolButtons`…消费者 `src/toolWindowStripes.ts`」 | 读点 `src/appearanceActions.ts:235-237`（写 `data-tool-stripes`）+ `src/style.css:43`；`toolWindowStripes.ts` 里该键零命中 | 消费者文件名改掉 |
| 11 | `pf/actions` | 落点句只写 `registerKeymapActions()` | `src/actionRegistry.ts:166` 还有 `registerEditorActions()`，`src/keymap.ts:440` 注册 | 出口清单补一条 |
| 12 | `lp/documentation` | 「缺：模型到 UI 的接线——弹层仍是 hover 原文，链接与图片不可点（**本族最大的缺口**）」 | `src/quickDocHost.ts:155`/`:168`/`:257`/`:329` + `src/quickDocLayout.ts:380` + `QuickDocPopup.vue:122-124`/`:128-135`/`:158`/`:191-200` + `App.vue:2428` | 整条删 |
| 13 | `lp/documentation` | 「缺：文档浏览器与前进/后退历史（`DocumentationBrowserHistory`/`Back`/`Forward`/`KeepTab`）」 | 历史已落：`src/quickDocHistory.ts`（`createDocumentationHistory`/`DEFAULT_HISTORY_LIMIT`）+ `quickDocHost.ts:35` + `QuickDocPopup.vue:85-86`/`:144-145` + `tests/doc-history.test.mjs`；上游实测 `DocumentationBrowserHistory.kt`（48 行）与 `DocumentationBackAction.kt:14`（20 行） | 拆：历史删，「独立文档工具窗（`DocumentationToolWindowUI.kt`）」保留 |
| 14 | `lp/documentation` | 「缺：外部文档动作（`DocumentationViewExternalAction`）」 | `QuickDocPopup.vue:94`/`:146`/`:200` + `quickDocLayout.ts:380` + `quickDocHost.ts:257`（`shell.openUrl`）；上游文件实测存在（24 行） | 整条删 |
| 15 | `lp/documentation` | 「缺：hover 自动显示/自动更新开关」 | `src/docHoverPolicy.ts:64-66` + `settingsModel.ts:504/:506/:265` + `native/settings_schema.hpp:107`/`.cpp:419` + `QuickDocPopup.vue:147-148` + `tests/doc-hover-policy.test.mjs`/`tests/setkeys-batch.test.mjs:150`；**残余**：`App.vue:2428` 的绑定清单没有 `@policy-change`（组件在 `QuickDocPopup.vue:61`/`:73` 已发）⇒ 重启回出厂 | 改写成「开关与设置键已落，只差宿主一行持久化绑定（App.vue 禁改）」 |
| 16 | `lp/documentation` | 落点句「弹层渲染在 `src/components/CodeEditor.vue`」 | 渲染宿主是 `src/components/QuickDocPopup.vue`（`App.vue:2428` Teleport）；`CodeEditor.vue` 只剩 `:503`/`:509` 的 hover 装饰 | 落点文件名改掉 |
| 17 | `lp/inlay-hints` | 「缺：三个设置键要登记进 `settingsModel.ts` 与设置页……按类型开关现在还不生效」 | `inlayHints.ts:55-60` + `settingsModel.ts:441`/`:265` + `native/settings_schema.hpp:87`/`.cpp:331` + `InlayHintsSettingsPage.vue:24`/`:52-53`（挂 `SettingsDialog.vue:32`/`:805`）+ `editorInlayHints.ts:43`/`inlayHintLayout.ts:71` + `CodeEditor.vue:215`/`:1053` + `tests/inlay-hints-settings.test.mjs` | 整条删（上游那页实测 `intellij.platform.lang.impl.xml:935-941`） |
| 18 | `lp/inlay-hints` | 「缺：宿主 `native/lsp_session.cpp` 只转发 label/padding/kind」 | 转发在 `native/lsp_session_kinds.cpp`：`:552` 分支、`:561-571` label/padding/kind、`:578-586` command、`:588-594` tooltip；前端 `inlayHints.ts:97`/`:104` → `editorInlayHints.ts:217-218` | 删该缺并**把宿主文件名订正**（不是 `lsp_session.cpp`） |
| 19 | `lp/inlay-hints` | 「缺：多建议切换未接（`CodeEditor.vue` 只取第一条建议，Alt+] / Alt+[ 没有落点）」 | `inlineCompletionExtension.ts:204-205` 两条键位 + `CodeEditor.vue:54`/`:282-285`/`:763` | 整条删（与 `lp/completion`/`pf/inline-completion` 自相矛盾，一起改） |
| 20 | `lp/custom-folding` | 「`src/customFoldingRegions.ts:128` 的 `nextCustomRegion`」；「键位在 `CodeEditor.vue:915-921`」 | 实测 `nextCustomRegion` 在 `:143`（`regionIndent` `:153`）；键位块 `CodeEditor.vue:913-919` | 只改这两处**本仓**行号，档位与上游六条坐标不动 |

### 5.3 建议实现（今天就能落，本 lane 没动手）

1. **快速文档齿轮的持久化一行**（`lp/documentation` 唯一残余）：`src/App.vue:2428` 的 `<QuickDocPopup …>` 少一条
   `@policy-change="(patch) => void saveSettingsPatch(patch)"`（组件侧 `src/components/QuickDocPopup.vue:61`/`:73` 已发事件、
   `src/docHoverPolicy.ts:55-57` 已写明缺的就是这一行）。目标文件禁改 ⇒ 交主代理，属一行接线。
2. **参数提示排除列表**（`lp/inlay-hints` 真缺、本架构可做）：上游 `ParameterHintExcludeListService.kt` 存在（本批实测路径），
   本仓零命中。落点：`src/inlayHints.ts` 加 `isParameterHintExcluded(label, excludedNames)` 纯规则（大小写与全限定名尾段口径）
   → `src/inlayHintLayout.ts:71` 的过滤链里多一档 → 编辑面 `src/components/InlayHintsSettingsPage.vue`（65 行，有余量）。
   这三处都不在禁写清单里，判据可仿 `tests/inlay-hints-settings.test.mjs`。

### 5.4 跨族连带（同一处错写在别的族里，改脚本时一起改）

- `pf/keymap`（53 类）：见订正 #8，改键 UI/冲突面板**都已有**且分派真读用户覆盖。
- `lp/ide-shell`（110 类）与 `lp/generation`（22 类）：`MemberChooser` 那一族的本地成员勾选已由
  `src/components/RefactorMemberChooserDialog.vue`（115 行）+ `src/refactorMemberMove.ts:311`（`pickMembers`）承担。
- `pf/vfs`（148 类）与 `ic/vfs`（7 类）：「jar 在外部库树里是叶子、**没有展开内容的桥接方法**」「浏览/搜索 jar 内容没有通道」**已不成立**
  ——宿主通道 `native/file_queries.cpp:230`（实现 `:26` 起，输入写明是「磁盘上的任意归档」），
  取数面 `src/jarEntriesSource.ts:45`（`loadJarListing`/`jarChannelStatus`），行模型 `src/rootsJarEntries.ts`（`jarRows`/`jarUrl`），
  UI 消费者 `src/components/JarEntriesPane.vue:16-17` + `src/components/ProjectStructurePane.vue:26`，判据 `tests/ext-jar-entries-channel.test.mjs`。
  只有「外部库树里 jar 仍是叶子」这一半成立，`file.archiveEntries` 那半该删。
- `ls/documentation`（4 类）：那句「markdown → HTML 的富渲染缺、弹层宿主 `src/App.vue` 那里是 `<pre>`」同步过期
  （弹层现在是 `QuickDocPopup.vue` 的区块 + 按钮 + `<img>`，见订正 #12/#16）。

