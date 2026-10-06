# 接线请求 · 2026-10-06 · 桶 2 补全 / 内联补全 / 意图（代号 `completion`）

配套报告：`docs/batch-2026-10-06-completion.md`。本轮**没有**改任何保留文件。
下面每条都给「目标文件 + 现树实测行号 + import + 可照抄整段 + 上游依据」。行号是 2026-10-06 实测（工作区并发变动，落地前重读目标区域）。

## 先给结论：原两张请求单的状态

| 原条目 | 状态 | 依据（本轮实测） |
| --- | --- | --- |
| `bucket2c` **W2** 打开的编辑器改由宿主登记 | **已完成，可销** | `src/App.vue:134` 已 import 三个导出、`:183` 挂载时 `registerOpenEditor`、`:187` 关标签时 `unregisterOpenEditor`、`:201`（`closeAllPanes`）`clearOpenEditors()`。本轮据此把 `src/completionOpenEditors.ts:62-73` 的「正文取不到就当场摘掉」改成「跳过但保留」，并划掉了本模块与 `src/lspCompletion.ts:184-189` 里那条「生产者只有补全查询」的旧说法 |
| `bucket2c` **W3** 行内补全悬浮操作条 | **不再需要改 `CodeEditor.vue`，可销**（残余见 C2） | 本轮把它落在自己的文件里：新模块 `src/inlineCompletionTooltip.ts`（181 行）+ 挂点 `src/inlineCompletionExtension.ts:71-83`（右键绑在幽灵文本那个元素上，宿主装的是同一份 `inlineDecorationsField`）。**顺带订正原请求对上游的描述**：原写「内容 = 来源名 + 接受 / 隐藏两个动作」——实际上游那一格是「接受快捷键下拉 + `to complete` 说明 + provider 自己那份浮层」（`InlineCompletionTooltipComponent.kt:15-27`、`InlineCompletionTooltipActions.kt:34-47`、`IdeBundle.properties:3234`），上游没有「隐藏」按钮 |
| `bucket2c` **W1** Code 菜单三条补全动作 | **仍待接**（本报告 C1） | `src/components/CodeEditor.vue:711` 仍是 `completion: startCompletion`；`src/menus/codeMenu.ts:33` 仍只有一条 `completion` |
| `bucket2c` **W4** 行内补全按 provider 开关 / `options` 设置页 | **仍待接**（本报告 C3） | `src/settingsModel.ts` 里 `inlineCompletion` 0 命中（本轮 grep 实测）；`src/components/SettingsDialog.vue` 不在本轮可改面 |
| `bucket2c` **W5** 问题面板逐行「抑制」入口 | 仍待接，**归问题视图那条线**（本报告 C4 只报状态） | `src/localIntentions.ts` 条目侧 API 就位；`src/components/ProblemsPanel.vue` 不在本轮可改面 |
| `bucket2b2` **R2** 状态栏透出「只看某一组」 | **核实通过、本轮无模块侧项**（本报告 C5） | 前提成立：`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt:21-33` 没有这个字段（原请求只写了文件名没写目录，正确路径见左）；本仓 `src/components/ProblemsPanel.vue:104` 的 `focus` ref 与 `:489-492` 的在场标记/退出按钮都是真的 |

---

## C1 · Code 菜单的补全动作走同一个入口（原 W1，仍要做）

- 目标文件：`src/components/CodeEditor.vue` 第 **711** 行（`editorActions` 那张表里的一行）。
- import 并入现有那行（`:30` 现树就是 `import { completionUi } from '../completionUi'`）：

```ts
import { completionUi, startCompletionAs } from '../completionUi'
```

- 把这一行：

```ts
  completion: startCompletion,
```

替换成：

```ts
  // 菜单与键位走同一个入口：`startCompletionAs` 会登记补全轮次（上游 `CodeCompletionHandlerBase.java:210-213`
  // 的「开着再按一次 invocationCount++」靠这份状态），CodeMirror 自带的 `startCompletion` 没有这一档。
  completion: editor => startCompletionAs(editor, 'basic') || startCompletion(editor),
```

- 模块侧不需要新代码：`startCompletionAs(view, mode)` 在 `src/completionUi.ts:52`，`'smart'` / `'className'` 两档在 `src/completionModes.ts`。
- 若桶 1 决定补另两条菜单行（`src/menus/codeMenu.ts:33` 之后），同一张表加两行即可：

```ts
  smartTypeCompletion: editor => startCompletionAs(editor, 'smart'),
  classNameCompletion: editor => startCompletionAs(editor, 'className'),
```

- 上游依据：`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:115-147`；
  `platform/platform-resources/src/keymaps/$default.xml:732-734`（CodeCompletion）、`:909-911`（SmartTypeCompletion）、`:843-845`（ClassNameCompletion）；
  动作类 `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/CodeCompletionAction.java:12-17`、`SmartCodeCompletionAction.java:11-17`、`ClassNameCompletionAction.java:11-17`。

## C2 · 行内补全浮层的两块残余（**都不建议现在做**，只登记）

本轮已经把「右键 ⇄ 一行 `Tab 以补全`」做完（不需要宿主），剩下的两格各自卡在别人的面上：

1. **provider 名字与图标**（上游 `InlineCompletionTooltipFactory.kt:16-40`）：要有真名字才能显示。
   需要 `src/bridge.ts` 的 inline completion 回包与 `native/lsp_session.cpp` 带一个服务端身份字段（LSP 协议本身不给 ⇒ 只能用我们自己的
   `language`/服务器配置名，那属于**新数据**，要先定口径）。本轮没有编造，`src/inlineCompletionTooltip.ts:88` 是「没有 rows 就不弹」。
2. **就地改接受快捷键**（上游 `InlineCompletionTooltipActions.kt:34-47,127-156`）：要 `src/keymap.ts` / `src/keymapBindings.ts` 有写入口。
   本仓接受键位是 `src/inlineCompletionExtension.ts:171-176` 的静态表，改它 = 换一份 Compartment 化键位，属键位域的一次独立改动。

## C3 · 行内补全的按 provider 开关（原 W4，仍要做；给出可照抄的存储侧形状）

- 目标文件：`src/settingsModel.ts`（存储）+ `src/components/SettingsDialog.vue` 的行内补全区（渲染）。
- 上游形状（本轮实测）：`platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/options/InlineCompletionConfigurable.kt:26`
  是 `BoundCompositeConfigurable<UnnamedConfigurable>`，面板体在 `:42` 起，`：59` 那行是 `data class PluginInfo(name, action, suffix)`
  ⇒ **每个 provider 一行 + 一条到该 provider 设置的链接**；EP 宿主在同目录 `InlineCompletionConfigurableEP.kt`。
  本仓没有 provider 扩展点 ⇒ 不要照抄 EP 结构，做成「已知供给（语言服务）一条启停」即可。
- 存储侧建议（与既有打默认值的写法一致，**旧存档缺键必须补默认，不许按字段数量判损坏**）：

```ts
// 行内补全的按 provider 启停（上游 InlineCompletionConfigurable 那张页的本仓最小形状：
// 本仓只有一条供给 = 语言服务的 textDocument/inlineCompletion）。
export interface InlineCompletionSettings { enabled: boolean }
export const INLINE_COMPLETION_DEFAULTS: InlineCompletionSettings = { enabled: true }
```

- 模块侧接法（设置键落地后我来接，一行）：请求发起点在 `src/components/CodeEditor.vue:264` 的 `runInlineCompletion(...)` 之前加闸；
  纯规则不需要新文件。
- 上游依据：上面两条 + `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:115-117`（`CallInlineCompletionAction`，本仓已接在
  `src/inlineCompletionExtension.ts:187` 的 `Shift-Alt-\\` 绑定与 `:181-193` 的 `inlineNavigationBindings`）。

## C4 · 问题面板逐行「抑制」入口（原 W5，状态转交）

- 目标文件：`src/components/ProblemsPanel.vue`（问题视图那条线名下）。
- 要接什么：每行的次级动作调 `suppressionActionsFor(...)`（`src/localIntentions.ts`），条目形状与 Alt+Enter 完全一致（`src/semanticActions.ts` 已把本地条目与 LSP 条目并进同一个弹层）。
- 本轮补充：`src/intentionSettings.ts:1-93` 已给每个抑制形态一条开关 + 总开关，**面板那边要按它过滤**（上游 `IntentionManager.getActiveIntentions` 同义），
  否则用户在「意图…」里停用的条目还会从面板里冒出来。
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/intention/impl/SuppressIntentionAction.java` 一族；
  `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ShowProblemsViewQuickFixesAction.kt:33-35,78-92`。

## C5 · R2（状态栏「只看某一组」）的裁定意见

- 结论：**上游坐标真实、前提成立，但没有模块侧可做的部分** —— 两个落点（`src/App.vue` 状态栏、`src/components/ProblemsPanel.vue` 抛 `focusChange`）都在别人名下，
  且面板里已经有在场标记与退出按钮（`ProblemsPanel.vue:489-492`，本轮实测）。
- 建议：按原报告口径「可见性提示，不是功能缺口」处理 ⇒ **可做可不做**；若做，请顺手把原请求里的 `ProblemsViewState.kt:20-33` 补成完整路径
  `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt:21-33`（引用门会按完整路径核锚点）。

## C6 · 不是请求，是给主代理的两条现状

1. `node .tools/find-orphan-modules.mjs --gate` 现在是红的：**新增 2 个零生产消费方模块** `src/stickyLineViewport.ts`（折叠域）、`src/structuralCodeBlock.ts`（搜索域），
   都不是本轮的；本轮新模块 `src/inlineCompletionTooltip.ts` 有生产消费方（`src/inlineCompletionExtension.ts:16,75-82`），没进名单。
2. `node --test tests/source-citation-anchors.test.mjs` 现在是红的 1 条：`src/fileTypeDetection.ts|platform/ide-core/src/com/intellij/openapi/fileTypes/NativeFileType.java|48-51`
   「快照里有、仓里已经指不到」⇒ 有人改了那条引用的行号/整段，需要重算锚点快照或由改动者补回。
3. 待查（本轮只划掉假注释，没换算法）：`src/completionCommands.ts` 的命令名过滤用的是 `src/completionSort.ts:76` 的 `camelHumpMatch`，
   实测吃不下 `rn` → `Rename Element`、`cs` → `Change Signature`；对齐上游 `CommandCompletionProvider.kt:237` 的
   `CamelHumpMatcher(prefix, false, true)` 应该换成 `src/completionCamelHump.ts` 的 `camelHumpMatcher(prefix).isStartMatch(label)`。
   换它会改变用户可见候选集合，需要独立一轮判据（详情见报告 §1.6 与 §6 第 5 条）。

---

# 追加 · 2026-10-06 第二轮（代号 `completion2`）

配套报告：`docs/batch-2026-10-06-completion2.md`。本轮同样**没有**改任何保留文件。

## S-1 · 现网那条红「三格是真设置：模型 + native 键表/默认值 + 预览白名单都登记」——**唯一要改的是一行判据的形状**

**先订正派单坐标（留痕）**：派单点名 `node --test tests/setkeys-batch.test.mjs`，本轮实测该文件 **20 / 20 全绿**。
逐字带着那句判词的红在**同族的另一个文件**：`tests/inlay-hints-settings.test.mjs:45`
（`node --test tests/inlay-hints-settings.test.mjs` ⇒ tests 5 / pass 4 / **fail 1**，红的就是它；红因写在 `:48`）。

**根因不在五处登记，而在那条断言把三把键钉成了「`defaultEditorSettings` 的最后三项」**：
`tests/inlay-hints-settings.test.mjs:48` 要求
`showTypeInlayHints: true, showParameterInlayHints: true, showOtherInlayHints: true }` —— 结尾那个 `\}` 只有三键正好排在
对象字面量末尾才成立。取证（本轮实测）：
- `git show HEAD:src/settingsModel.ts` 里这段 `... showOtherInlayHints: true }` **命中** ⇒ HEAD 上是绿的；
- 工作树的 `src/settingsModel.ts:223` 在同样三键**后面**又追加了 6 把键（`stripTrailingSpaces` … `autoUpdateDocumentation: true }`）
  ⇒ 形状失配，值没变（三把仍全是 `true`）；
- `:47` 那条（类型声明）实测通过；`:51`（`native/settings_schema.hpp:87`）、`:54`（`native/settings_schema.cpp:331`）、
  `:56`（`src/previewSettings.ts:24`）三条**本轮没被执行到**（`:48` 先抛）⇒ 改用 grep 逐字核了三处的登记原文，
  三把键在四处（类型 / 前端默认 / native 两表 / 预览白名单）**都齐**，「三格是真设置」这个结论本身没有实质破口。

**归属**：要改的那行在 `tests/inlay-hints-settings.test.mjs`（不在本轮可改面：派单只给了 completion / intention / cyclic / inline-completion / literal-preview 那几族用例），
被钉的数据在 `src/settingsModel.ts`（保留）。**建议改判据而不是改数据**：把三键挪回行尾，下一批再追加键时还会红一次。

**可照抄的整段替换**（形状抄本仓已经跑绿的那套位置无关判据：`tests/setkeys-batch.test.mjs:65,74-84`）——
把 `tests/inlay-hints-settings.test.mjs` 第 **46-56** 行整段换成：

```js
  const model = read('src/settingsModel.ts')
  assert.match(model, /showTypeInlayHints: boolean; showParameterInlayHints: boolean; showOtherInlayHints: boolean/)
  // 钉**值**不钉**位置**：新批次会往 `defaultEditorSettings` 那一行末尾追加键，要求三键相邻或压尾都会随下次追加而假红。
  const defaultsLine = model.split(/\r?\n/).find(line => line.includes('export const defaultEditorSettings'))
  const hpp = read('native/settings_schema.hpp')
  const cpp = read('native/settings_schema.cpp')
  const preview = read('src/previewSettings.ts')
  for (const key of ['showTypeInlayHints', 'showParameterInlayHints', 'showOtherInlayHints']) {
    assert.match(defaultsLine, new RegExp(`\\b${key}: true\\b`), '默认必须全开（同上游 isEnabled 出厂为真）：' + key)
    assert.match(hpp, new RegExp(`"${key}"`), 'native 键表白名单漏了 ' + key + ' ⇒ known_keys 拒掉整次 settings.update')
    assert.match(cpp, new RegExp(`\\{"${key}", true\\}`), 'native 默认值表漏了 ' + key + ' ⇒ 旧存档补不回默认')
    assert.match(preview, new RegExp(`key === '${key}'`), 'previewSettings.ts 没放行 ' + key)
  }
```

断言从 5 条变 1+12 条，**没有放松任何一条**（逐键判值仍在，只是不再要求三键相邻 / 压尾）。
**这段替换本轮已在现树上跑过**：临时脚本按同样 12 条逐键断言取现树 ⇒ 12/12 命中（脚本用完即删，不在仓里留件）。
本请求只动判据的**形状**、不动任何取值 ⇒ 不引入新的上游坐标；取值的上游走点在测试头 `:3-7` 与本仓 `src/inlayHints.ts:52-60`，
本轮没有重开上游文件核实那些坐标（不在这条请求的改动范围内）。

**反向验证（落地后请照跑一遍三步）**：把 `native/settings_schema.hpp:87` 里 `"showOtherInlayHints"` 临时删掉 ⇒ 该 test 应红 1 条；补回 ⇒ 复绿。

## S-2 · C1 / C3 的第二轮复核（**原样有效**，行号重测）

- C1：`src/components/CodeEditor.vue:711` 仍是 `completion: startCompletion`；`src/menus/codeMenu.ts:33` 仍只有 `completion` 一条 ⇒ 上面那段照抄代码仍可用。
- C3：`src/settingsModel.ts` 里 `inlineCompletion` **0 命中**、`src/components/SettingsDialog.vue` 里「行内补全 / inlineCompletion」**0 命中** ⇒ 仍是待接。
  模块侧本轮**没有**新增：在 `src/inlineCompletion.ts` 里补一个「按设置放行」的谓词、而消费方（`CodeEditor.vue`，保留文件）没有落地，
  就是只过自己测试的死代码 ⇒ 按规约不落。

## S-3 · 原 C6 三条的现状更新

1. `node .tools/find-orphan-modules.mjs --gate`：现在**新增 1** = `src/structuralCodeBlock.ts`（搜索域）；上一轮报的 `src/stickyLineViewport.ts` 已被接上、不在名单里了。本轮未新增模块。
2. `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs`：现在 **11 / 11 全绿**（上一轮那条 `src/fileTypeDetection.ts` 的锚点红已消）。
3. 原 C6 第 3 条（命令名过滤的驼峰档）**本轮已做**，并且把「该换成 `isStartMatch`」那句**订正**掉：
   上游放行进表的判据是 `prefixMatches`（`platform/lang-impl/src/com/intellij/codeInsight/completion/command/CommandCompletionProvider.kt:252`
   ⇒ `platform/analysis-impl/src/com/intellij/codeInsight/completion/impl/CamelHumpMatcher.java:80-87`），
   `isStartMatch` 是另一档查询（同文件 `:53-77`，`MinusculeMatcher` 的「命中段贴不贴串首」）。落点与判据见 `docs/batch-2026-10-06-completion2.md` §1.1。

## S-4 · 本轮收尾时观察到的**别人名下**两条红（不属本面，只报现状给主代理）

1. 引用门剩下的红**都不在本域文档里**（本域改正后贡献 0 条）：别人名下的交付文档把同一条上游文件的**包名写成了 `codeInsight`**（基准树实测该文件在 `codeInspection` 包下），
   而且是「整形状 + 行号」的完整写法 ⇒ 被引用门当成直引收集（派单 §5 正是警告这一点：要批评某个假写法就别写完整形状）。
   修法二选一：把包名改成 `codeInspection`（行号本身没错）；若那句话是在**转述/批评**旧写法，就去掉行号、不要写完整路径。
   本轮自己也踩过同一条（凭记忆写路径 ⇒ 门当场报红 ⇒ 改正复绿），过程记在 `docs/batch-2026-10-06-completion2.md` §4。
2. 一条**在途瞬态**的观察（不作为请求，只留痕）：本轮收尾期间 `tests/problems-panel.test.mjs` 曾以 `SyntaxError: Unexpected token '}'`（`src/problems.ts`）整文件加载失败，
   随后再跑该路径已是「文件不存在」⇒ 判定为 `problems` 域正在重写/拆分该文件的过程态，本面一行没动、也不据此提请求。
