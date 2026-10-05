# 桶：全树类型检查打到 0 错 · 2026-10-06 00:45–01:15

> 派单：把 `npx vue-tsc --noEmit -p tsconfig.json` 的全树错误清零；保留文件只读，根因在保留文件里的列成主代理待办。

## 0. 结论

| 项 | 值 |
|---|---|
| 起始（第一次能跑完语义检查的快照） | **35 条 / 18 个文件** |
| 收工（01:12 / 01:15 两次全量跑一致） | **1 条**：`src/keymapBindings.ts(111,29)` TS2322 —— 保留文件，见 §3 |
| 我这边改到 0 的文件 | `codeLensExtension` `completionUi` `editorDebugLine` `externalSystemDataStorage` `navGotoSuper` `navGotoTest` `projectTreeNesting`(+`projectTreeState`) `quickDocLayout` `todoMultiLine` `EventLogPanel.vue` `FileTree.vue` `fileTypePluginBeans` |
| 由文件属主（并发桶）在同一时段自己修掉的 | `toolWindowStripes`(8c) `libraryRootDetection`(15b2) `lspCompletion`(2c) `dbgRunToCursorGutter`(12c) `ProjectStructurePane.vue`(15c) `DebugBreakpointsPane.vue`/`DebugPanel.vue`(12c) `fileTypeRegistry`(14) `editorEnterBlockComment`(5) |

⚠️ 这是一棵**活树**：15 个 agent 同时在写。上表的"谁改的"按最终落地的内容与我的调用点判定，不是按时间戳猜。

## 1. 两个「遮蔽整棵树」的语法错（TS1002/TS1005 家族）

TS 的块注释**不嵌套**，且在 `/** … */` 里出现裸的两个字符收尾序列就把注释关掉，后面的中文全被当代码读 ⇒ 一个文件的注释能把整棵树的语义检查打断（这也是主代理刚在 `customFoldingProviders.ts:48` 修掉的同一形态）。

1. `src/todoMultiLine.ts:57`（**我修的**，00:46）：`return { prefix: marker === '*' ? content, content }` —— 三元的 `:` 写成了 `,` ⇒ TS1005，全树只剩这一条、看不到真实错误数。改成 `return { prefix, content }`（`content` 已经是 `prefix + marker.length`，`'*'` 那一档两者恒等 ⇒ 行为不变）。该文件随后被属主整段重写，现在的内容里没有我这行的痕迹，但语法错已消失。
2. `src/editorEnterBlockComment.ts:37/60/72/106/122`（**属主桶 5 自己修的**，00:58–01:03）：`/** … ['/*', '*/'] … */` 这种把块注释收尾写进文档注释的写法一次造出 **65 条**级联语法错，把我在 00:53 那轮的所有修复成果全部遮掉。我核对过形态（把文档注释改成行注释即可），确认作者在 4 分钟内自己清完，**没有插手**，避免踩他的现场。

## 2. 逐条：错误码 + 根因判定 + 改了哪一侧

「侧」= 调用方写错（改调用点）还是被引用侧漏了声明（补声明）。

| # | 位置 | 码 | 根因判定 | 改了哪一侧 / 怎么改 | 落地方 |
|---|---|---|---|---|---|
| 1 | `src/codeLensExtension.ts(233,50)` | TS2554 参数个数 3→2 | `CodeLensRowWidget` 构造器要 `onContext`（右键一组 → 上下文菜单），但 `buildDecorations` 没有这一份实现：模块里 `openCodeVisionMenu` 定义了却**零调用方**、`shouldShowCodeVisionEntry` 导入了却**没用**、`CodeLensWidget.onContext` 只在行容器内部传递 ⇒ 典型的"接线写到一半被打断" | 补被引用侧：在 `openCodeVisionMenu` 之后新增 `openCodeVisionContext(groupId,x,y)`（`codeVisionContextActions(codeVisionGroupName(gid))` + `handleCodeVisionExtraAction(id,gid)`），并作为第 3 个实参传给 `CodeLensRowWidget`。那枚本来永远打不开的右键菜单因此有了真实落点（不是假控件） | **我** |
| 2 | `src/completionUi.ts(55,5)` | TS2769 没有匹配的重载 | `dispatch({ selection: { ranges: [...] } })` —— `TransactionSpec.selection` 只收 `EditorSelection` 或 `{anchor,head}`，多光标必须走 `EditorSelection.create(ranges)`（`EditorSelection` 早已 import 并在用） | 改调用方：`selection: EditorSelection.create(step.spans.map(span => EditorSelection.cursor(span.from + step.word.length)))` | **我**（现存内容里） |
| 3–4 | `src/completionUi.ts(48/61)` | TS2339 `EditorState` 上没有 `changeCount` | 上游比的是 `getModificationStamp()`；本仓装的 `@codemirror/state@6.7.6` 的 `EditorState` **既没有 `changeCount` 也没有 `seq`**（我枚举过运行时原型成员确认）。`Text` 是不可变的，选择类事务复用同一个对象（node 实测），所以**文档身份就是改动号** | 改调用方：`revision: view.state.doc`，并把 `HippieState.revision`/`HippieStepOptions.revision` 从 `number` 改成 `unknown`（`cyclicWordCompletion.ts:71/91`）| 我先改成 `state.seq`（按 `codeLensCache.ts:39` 那条注释的字面说法），**实测证明该属性不存在**，随后桶 2c 用 `view.state.doc` 收了同一个根因并按意图改了类型；最终落地是他的版本 |
| 5 | `src/components/EventLogPanel.vue(155,161)` | TS2339 模板里的 `DO_NOT_ASK_LIST_ACCESSIBLE_NAME` | 常量**早就存在**（`src/notificationDoNotAsk.ts:98`，中文包 `.list.accessible.name`），是组件的 `<script setup>` 导入清单漏了它这一项 ⇒ 模板取不到 | 补被引用侧的**导入**（`EventLogPanel.vue:20` 那一组里加 `DO_NOT_ASK_LIST_ACCESSIBLE_NAME`），不动模板、不新造文案 | **我** |
| 6 | `src/components/FileTree.vue(142,31)` | TS2551 `Reactive<Set<string>>` 上取 `.value` | `selection` 是 `projectTreeModel.ts:26` 的 `reactive(new Set())`（不是 ref，同文件 183/249/254 都直接 `selection.has(...)`）| 改调用方：`const scope = [...selection]` | **我** |
| 7 | `src/editorDebugLine.ts(207,13)` | TS2339 `Transaction` 上没有 `newState` | CM6 的 `Transaction` 只有 `state`（变更后那份）；`newState` 是杜撰的 API 名 | 改调用方：`tr.state.doc.lineAt(tr.changes.mapPos(from, -1))` | **我** |
| 8 | `src/externalSystemDataStorage.ts(71,18)` | TS2698 spread 只能来自对象类型 | `node: DataNode<unknown>` ⇒ `node.data` 是 `unknown`，`{ ...unknown }` 非法；原作者其实**已经**知道它是记录（后面跟着 `as Record<string, unknown>`），只是收窄写在了 spread 之后 | 改被引用侧写法：先收窄再浅拷贝 `{ ...(node.data as Record<string, unknown>) }`，拷贝语义与字段一个没变（不是新增断言，是把已有断言挪到合法位置） | **我** |
| 9 | `src/externalSystemDataStorage.ts(281,19)` | TS2339 内联类型上缺 `key` | `restoredDependencies` 的 `walk` 形参写成手搓的 `{ data: unknown; children: readonly never[] }[]`，既没有 `key` 又把子表钉成 `never[]`，所以两处 `as never` 是被迫的 | 改被引用侧：形参用真类型 `readonly DataNode<unknown>[]`、`child.key !== …` 换成模型自己的判据 `sameKey(child.key, PROJECT_KEYS.LIBRARY_DEPENDENCY)`（与 `externalSystemModel.ts:326` 那一份同形状的遍历**逐字对齐**）、两处 `as never` 删掉；`sameKey` 加进文件头那一组 import | **我** |
| 10–13 | `src/navGotoSuper.ts(213/218/223/226)` | TS2339 `replied.calls` + 3× TS18048 possibly undefined | 本文件自己声明的 `HierarchyReply` 只有 `items`，而回包契约（`src/bridge.ts:169` 的 `LspHierarchyResult`）是 `items` + `calls` 两档，`src/hierarchyView.ts:117` 就是按 `calls ?? items` 读的 ⇒ 本地类型**漏了一档**；`let supertypes: HierarchyReply['items'] = []` 因此带上 `| undefined`，后面三处全红 | 改被引用侧：把条目形状抽成 `HierarchyItem`，`HierarchyReply` 补 `calls?: HierarchyItem[]`，`supertypes` 直接标 `HierarchyItem[]`。三条 `TS18048` 随根因一起消失（没有加 `!`、没有改可选） | **我** |
| 14 | `src/navGotoTest.ts(90,121)` | TS2339 `'length'` 不存在于 `never` | `export const SUBCLASS_NAME_PREFIX = ''` 被推成字面量类型 `''`，于是 `if (SUBCLASS_NAME_PREFIX && …)` 的真分支被静态判成不可达 ⇒ `.length` 落在 `never` 上。它代的是**代码风格设置值**，出厂恰好为空而已 | 改被引用侧：两条前后缀常量标成 `: string`（`SUBCLASS_NAME_SUFFIX` 一并标，理由同一条）| **我** |
| 15–16 | `src/projectTreeState.ts(106,107)` | TS2345 / TS2322（`nesting.rules` 的 `children`） | `readonly(nesting)` 出来的 `DeepReadonly` 把 `NestingRule.children` 变成 `readonly string[]`，而 `NestingRule` 自己声明的是可变 `string[]`。全仓对 `children` 只做 `some/includes` 遍历、`updateNesting` 写入时是 `.map(...children: [...])` 整表替换（`projectTreeState.ts:100`），没有任何原地改 | 改被引用侧：`projectTreeNesting.ts` 的 `NestingRule` 标成 `{ parent; readonly children: readonly string[] }`（规则表是纯数据）。**没有**在 `createHost` 的返回处 cast 掩盖 | **我** |
| 17 | `src/quickDocLayout.ts(192,80)` | TS2339 `DocPart` 上没有 `text` | `while (out.length && !('link' in out[out.length - 1]) && out[out.length - 1].text …)` —— 收窄只对字面下标 `out[0]` 生效（上一行就是同一个写法且是绿的），计算下标 `out[out.length-1]` TS 收不到窄 | 改调用方：把尾部那一条落到局部变量 `tail` 上再判 `'link' in tail`，循环条件与 `pop` 行为逐字等价 | **我** |
| 18–19 | `src/toolWindowStripes.ts(712/715)` | TS2322 / TS2345 | 门面的 source 契约按 `string` 收 id（底部那几格内容是运行期注册的，不必在出厂 `ToolWindowId` 联合里），而工厂把窄签名的 `anchorOf` 直接塞进对象字面量、`hiddenStripeButtons.has(id)` 也按 `string` 收。该文件自己的既有惯例就是在**调用点**收一次口（713/718/722 三处 `id as ToolWindowId`）| 改调用方：`anchorOf: id => anchorOf(id as ToolWindowId)`、`stripeButtonHidden: id => hiddenStripeButtons.has(id as ToolWindowId)`，与同文件既有形状一致（我没改 `toolWindowManager.ts` 的契约，那是 8c 的在途文件）| **8c 落地**（与我的判据同一结论，我未插手） |
| 20–21 | `src/libraryRootDetection.ts(336/344)` | TS2300 Duplicate identifier `path` | `DetectedRootsTreeNode` 被写进过两条 `path`（一条完整工作区相对路径、一条叶子路径），字段级重复 | 属主 15b2 自己删到一条；我复核过现在接口里只剩 `readonly path?: string` | **15b2** |
| 22 | `src/lspCompletion.ts(393)` | TS2353 `placeholder` 不在 `Completion` 里 | 空态那一行是**带 `placeholder` 的补全项**，本仓已有扩展类型 `PlaceholderCompletion = Completion & { placeholder?: boolean }`（`completionMerge.ts:18`，合流层按它过滤）。写 `satisfies Completion` 才是错的一侧 | 改调用方：`satisfies PlaceholderCompletion`。（判据与我一致，代码由 2c 落地） | **2c** |
| 23 | `src/dbgRunToCursorGutter.ts(27)` | TS2459 `Extension` 未从 `@codemirror/view` 导出 | `Extension` 是 `@codemirror/state` 的类型 | 移到 state 那一行 import | **12c** |
| 24 | `src/editorDebugLine.ts` 之外的 `newState` 同族 | — | （见 #7） | — | — |
| 25 | `src/fileTypeRegistry.ts(516/540)` | TS2304 `HashBangConflict` | 类型声明与使用分在两段，属主补了声明 | — | **14** |
| 26–31 | `src/components/ProjectStructurePane.vue` 6 条（`rowTitle` `orderEntryKindLabel` `dropRootPath` `closeSourcePopup`×3，中途变体 `stateOf` `rootKind`） | TS2339 / TS2551 | 模板用了、`<script setup>` 顶层没有（或用了却没解构/没 import）| 属主 15c 在 00:56–01:05 陆续补齐声明（现在 `rowTitle:125`、`orderEntryKindLabel` 已在 16 行 import、`dropRootPath:135`、`closeSourcePopup:139`）。**这是并发在途文件，我一次都没动过它** | **15c** |
| 32–35 | `src/components/DebugBreakpointsPane.vue` ×2 + `DebugPanel.vue` ×1 + 中途的 `reportHostError`(TS18004) | TS2551 / TS2339 | `openBreakpoints` 这条链（面板 `emit` → 宿主 `DebugPanel` 的 `openBreakpointsDialog`）在两个文件里同时被改写，检查快照恰好切在中间态 | 属主 12c 01:04 收口（现在模板与 `defineExpose`/函数声明对齐）。**同为并发在途文件，我未插手** | **12c** |

## 3. 主代理待办（保留文件，我只读没动）

### 3.1 `src/keymapBindings.ts:111` —— 全树最后这 1 条错

```
src/keymapBindings.ts(111,29): error TS2322: Type '"alt"' is not assignable to type '"ctrl' | 'mod"'
```

* **成因**：`refactor.safeDelete` 那一行写的是 `chord: { key: 'delete', control: 'alt' }`。而同一文件 32–41 行的 `KeyChord` 里 `control` 的取值域是 `'ctrl' | 'mod'`（`'ctrl'` = 必须真按 Ctrl，`'mod'` = Ctrl 或 Meta），`alt` 另有自己的字段 `alt?: boolean`。上游 SafeDelete 的键位是 **Alt+Delete、不带 Ctrl**（该行 `display: 'Alt Delete'` 与 `upstream` 字段也是这么记的），所以这一条既写错了字段、又暴露出**表式子本身表达不出"只有 Alt"的键位** —— `control` 在 `KeyChord` 里是**必填**（没有 `?`）。
* **影响**：①0 错门禁卡在这一条；②`chord` 里那个 `'alt'` 永远不会被任何分派/显示逻辑认出来（`keymapEditor.ts:68/71/74` 只判 `=== 'ctrl'` / `=== 'mod'`），也就是说 SafeDelete 的键位目前是**写成 impossble 的装饰串**，只有 `display` 那份硬编码文案在起效；③`chordIdentity()`（同文件 183–186）把它拼成 `alt|…`，与将来的 `control` 缺失档会算成两个不同键位 ⇒ 冲突表看不出来。
* **建议改法（精确到行，三处都要）**：
  1. `src/keymapBindings.ts:36`：`control: 'ctrl' | 'mod'` → `control?: 'ctrl' | 'mod'`（缺省 = 不按 Ctrl/Meta，与 68/71/74 三处既有判据天然兼容）。
  2. `src/keymapBindings.ts:111`：`chord: { key: 'delete', control: 'alt' }` → `chord: { key: 'delete', alt: true }`。
  3. `src/keymapEditor.ts:128`（`chordToOverrideText`）：`parts.push(chord.control === 'ctrl' ? 'Ctrl' : 'Meta')` 会给无 Ctrl 的键位拼出假前缀 `Meta+`，改成 `if (chord.control) parts.push(chord.control === 'ctrl' ? 'Ctrl' : 'Meta')`。
  * 建议同时把 `src/keymapBindings.ts:185` 的 `[chord.control, …]` 写成 `[chord.control ?? 'none', …]`，让"缺失"在冲突表里是个显式档而不是字符串 `undefined`。
* **门禁提醒**：改完请跑 `node --test tests/keymap-bindings.test.mjs tests/keymap-affordances.test.mjs tests/keymap-dialog.test.mjs tests/action-registry.test.mjs`（SafeDelete 那一条被 `display`/冲突检测钉着）。

## 4. 我没能修的 / 留给别人的

1. **§3.1 之外没有"未修"**：35 条里我改的 17 条全部落地，其余按上表标注由文件属主在同一时段收口（每条我都复查过最终内容与判据一致）。
2. **`tests/source-citations.test.mjs` 现在红 1 条**（不是本桶引入、也不是类型错）：`docs/batch-2026-10-06-bucket2c.md` 与 `docs/wiring-requests-2026-10-06-bucket14c.md` 里各有一条上游路径在参考树里不存在。属主是桶 2c / 14c，保留测试文件我一个字没动。
3. **`tests/module-size.test.mjs` 现在红 1 条**：`src/components/WelcomePage.vue` 涨到 **920 行**（上限 900）且没登记。那是别人正在写的组件；按纪律我**没有**去调上限，也没有登记假条目，交属主拆。
4. **`shouldShowCodeVisionEntry` 仍是死导入**（`codeLensExtension.ts:34` 导入、全仓零调用）：Code Vision 的"隐藏这一组 / 全部隐藏"设置**没有渲染闸**，右键菜单动作会改设置但当前这批 lens 不会因此消失。我一开始把过滤加进了 `buildDecorations`，被 `tests/code-lens-grouping.test.mjs:68` 那条**钉字面形状**的断言（`extension.includes('groupAnchoredLenses(lenses)')`）判红 —— 那是别人名下的测试，按"不许动测试来让类型过"我**回退了这半自动作**，只保留 #1 那处与类型错直接相关的最小接线。这条接线请桶 3 自己做（要么改成先过滤、同时把那条断言按意图重写，二选一，别两边都不动）。

## 5. 验证

* 类型：`npx vue-tsc --noEmit -p tsconfig.json` —— 35 → 24 → 5 → 1（**全程未用 `-b --force`**，按派单避开与并发编辑抢 `.tsbuildinfo`）。收工复跑两次（01:12 与 01:15）都是**只剩 §3.1 那一条**。中间 `src/editorMatchBrace.ts`（桶 5 的新文件，01:12–01:14 正在写）一度冒出 4 条 `TS2323/TS2393`（重复导出的 `matchBraceTarget`）+ 1 条上游行号越界的引用，等它写完即自行消失，我没有插手。
* 三个系统性门禁全绿：`node .tools/find-param-props.mjs`（共 **0** 处参数属性）、`node .tools/find-ts-in-mjs.mjs`（`tests/*.mjs` 全纯 JS）、`node .tools/find-missing-ext.mjs`（1185 个文件，无漏扩展名）。
* 测试（只跑我改过的东西对应的组，**没跑全量 `npm test`**）：
  * `code-lens` / `code-vision` / `cv-local-vision` 8 个文件：**62/62**
  * `project-tree* / file-nesting / nav-goto* / completion* / lsp-completion / external-system* / gradle / quick-doc / event-log / debug-line / inline-watch / file-tree` 一组：**232/232**
  * `cyclic-word-completion / file-type* / todo* / keymap*` 一组：**112 条里 111 过**（唯一红的是 §4.2 那条 source-citations，与本桶无关）
  * 收工前复跑我改动直接对应的 13 个测试文件：**109/109**；`doc-layout / notification-* / doc-hover*`：**75/75**
* git 纪律：没有 `checkout/reset/stash/clean`，没有 commit/push；`src/App.vue`、`CodeEditor.vue`、`bridge*.ts`、`menus/types.ts`、两张测试与 `CMakeLists.txt`/`tsconfig.json`/`package.json` 一字未动。
* 并发现场的自查：`git diff` 里 `codeLensExtension.ts` / `completionUi.ts` / `FileTree.vue` 三个文件同时带着别人的大段在途改动（分别是 323/158/94 行的增幅），我的 hunk 只有 §2 里标"我"的那几处（`openCodeVisionContext` + 第 3 实参、`EditorSelection.create`、`const scope = [...selection]`），逐处复核过没有覆盖别人的行。
