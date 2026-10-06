# 接线请求 · 2026-10-06 · 代号 `projecttree`（项目视图四族）

本桶（`pv/project-view-nodes` / `pv/project-view` / `pv/structure-view` / `pv/command`）做完之后，
剩下四条线接不上，**全部卡在保留文件或别人名下的文件**。每条给：目标文件 + 目标行号 + import 语句 +
可照抄的整段替换 + 上游依据。上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

交付面（模块侧已经就绪的部分）见 `docs/batch-2026-10-06-projecttree.md`。

---

## W1 · 结构视图「跟随编辑器光标」的列精度 —— 1 行

**目标文件**：`src/App.vue`（保留）　**目标行号**：215
**上游依据**：`platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java:804-849`
（`MyAutoScrollFromSourceHandler` 装光标监听、回调 `scrollToSelectedElement()` `:655-661`）——
上游跟随用的是**偏移量**（行 + 列），不是只有行；同一行里有兄弟符号时（一行两个方法、
`{ ... }` 里的一行 lambda）只有列能分出「光标在谁里面」。
**本仓现状**：模块侧算列的那条路已经通 —— `src/structureFollow.ts:88-90`（`caretCharacterInSymbolBasis`：
编辑器 1 基列 → LSP 0 基列）与 `src/components/OutlinePanel.vue:74-77`（已经在读 `props.source.character`）。
缺的只是宿主没把列传上来，于是恒按行首（命中仍按行退化，不会选不中，但同行分不出来）。

现在：

```ts
const todoSource = computed(() => active.value ? { path: active.value.path, line: active.value.line } : null)
```

改成（`Tab` 本来就带 `column`：`src/editorTab.ts:8`，且 `src/App.vue:2123` 的 `@cursor` 一直在写它）：

```ts
const todoSource = computed(() => active.value
  ? { path: active.value.path, line: active.value.line, character: active.value.column } : null)
```

**判据已就位**：`tests/structure-follow.test.mjs` 第 11 项钉住挂点与「没有数据不渲染」；
`caretCharacterInSymbolBasis` 的换算在前一轮就有用例。改完不需要新判据。
风险：`todoSource` 的另一半消费方是 `TodoPanel`（`src/components/ToolWindowView.vue:169`），
它只读 `path`/`line`，多一个字段不影响。

---

## W2 · 新建 / 删除登记成可撤命令（`FileUndoProvider` 的那两步）

**目标文件**：`src/App.vue`（保留）　**目标行号**：1691-1714（`applyNameDialog` 的新建分支）与 1717-1730（`confirmDelete`）
**上游依据**：
- `platform/lvcs-impl/src/com/intellij/openapi/command/impl/FileUndoProvider.java:100-114`
  （`after()` 把 `VFileCreateEvent` / `VFileMoveEvent` / rename / `VFileCopyEvent` / `VFileDeleteEvent` 变成可撤步骤）；
- 同文件 `:133`（`beforeFileDeletion` 删除**之前**抓内容）、`:147`（`fileDeleted` 登记步骤）、
  `:185`（`registerNonUndoableAction`：抓不到内容就登记成不可撤，之后的撤销碰到它整条拒绝）、
  `:206`（`MyUndoableAction extends GlobalUndoableAction` ⇒ 跨标签可撤）。

**本仓现状**：等价物都写好了但没人调 —— `src/pvFileUndoProvider.ts:149` `createStep`（撤销=删掉它）、
`:134` `deleteStep`（按快照重建，含编码/BOM 原样回写）、`:101` `captureForDelete`（目录递归上限 200 文件 / 2 MiB，
超了如实标不可撤）。现在只有粘贴的两条命令进了栈（`src/explorerActions.ts:109,116`），
所以「新建 / 删除落盘就不可撤」这条差距还在（族判词 `docs/inventory/verdict-projectviews.md:33` 原文）。

### W2-a import（`src/App.vue` 脚本区，紧跟 `:59` 那行 `createExplorerActions` 之后）

```ts
import { createFileUndoProvider, hostFileIo, recordFileCommand } from './pvFileUndoProvider.ts'
import { getCommandProcessor } from './pvCommandProcessor.ts'
```

### W2-b 装配（与 `explorer` 同一层，一次就够）

```ts
// 文件级可撤步骤（FileUndoProvider.java:100-114 的等价物）：命令栈按工作区根分桶，
// 与 src/explorerActions.ts:67-68 用的是同一份注册表。
const fileUndo = createFileUndoProvider(hostFileIo)
const fileCommands = () => getCommandProcessor(workspace.value?.root ?? '')
```

### W2-c `applyNameDialog` 的新建分支（现 `:1710-1713`）

```ts
      await request('file.create', { path: target, directory: dialog.mode === 'createDir', template: dialog.template || undefined })
      // 新建登记成一条可撤命令：撤销就是把它删掉（FileUndoProvider.java:102-106 的 create 那一支）。
      recordFileCommand(fileCommands(), {
        name: dialog.mode === 'createDir' ? '新建文件夹' : '新建文件',
        groupId: 'create', steps: [fileUndo.createStep(target, dialog.mode === 'createDir')],
      })
      await refreshTree()
      if (dialog.mode === 'createFile') await openFile(target)
      notify(dialog.mode === 'createDir' ? `已创建文件夹 ${name}` : `已创建文件 ${name}`)
```

按模板新建那一支（`:1698-1709`）想一起接就在 `createFileFromTemplate(...)` 之后同样补一行
`recordFileCommand(fileCommands(), { name: '按模板新建', groupId: 'create', steps: [fileUndo.createStep(plan.path, false)] })`；
不接也不影响正确性（只是那一条撤不了）。

### W2-d `confirmDelete`（现 `:1717-1730`）

```ts
async function confirmDelete() {
  const entry = deleteTarget.value; if (!entry) return
  deleteTarget.value = null
  const trash = deleteToBin.value
  const affected = affectedDirtyTabs(allTabs.value, entry.path, entry.kind === 'directory')
  if (affected.length && !await confirmLeave('删除前处理未保存的修改', affected)) return
  // 删除**之前**抓快照（FileUndoProvider.java:133 的 beforeFileDeletion）；抓不到就按 :185
  // 登记成不可撤动作，之后的撤销碰到它会整条拒绝并给那份报告，不是静默失败。
  const capture = await fileUndo.captureForDelete(entry.path, entry.kind === 'directory')
  try {
    await request('file.delete', { path: entry.path, trash })
    closeAffectedTabs(entry.path, entry.kind === 'directory')
    const commands = fileCommands()
    if (capture.undoable) {
      recordFileCommand(commands, {
        name: '删除', groupId: 'delete',
        steps: [fileUndo.deleteStep(entry.path, capture.files, entry.kind === 'directory')],
      })
    } else {
      commands.markNonUndoable([entry.path])
    }
    await refreshTree()
    if (capture.undoable) notify(trash ? `已把 ${baseName(entry.path)} 移到回收站` : `已删除 ${baseName(entry.path)}`)
    else notify(`${trash ? `已把 ${baseName(entry.path)} 移到回收站` : `已删除 ${baseName(entry.path)}`}（这一次删除无法撤销：${capture.reason}）`, true)
  } catch (error) { notify(errorMessage(error), true) }
}
```

**注意两点**（都在 `src/pvFileUndoProvider.ts` 的模块头写着）：
① 快照走 `file.read`，读不出内容（二进制 / 超限）就是 `undoable: false` ⇒ 必须走 `markNonUndoable`，
否则「撤销删除」会假装成功、留下一堆缺失文件；
② `trash: true`（移到回收站）时撤销仍是按快照重建 —— 回收站里那份还在，本仓不去动它（上游 `delete` 也是走本地历史，
不是走回收站）。
**改完需要的判据**：`tests/pv-file-undo.test.mjs` 已经用内存 `FileIo` 跑通「删了再撤 = 原样回来 / 冲突时报那份报告」，
宿主这一层建议照它的形状补一条「点删除 → Ctrl+Z → 文件回来」的端到端用例（挂点就是 `confirmDelete`）。

---

## W2' · Edit 菜单的「撤销/重做」两行接命令栈（文字要带命令名）

**目标文件**：`src/menus/editMenu.ts`（不在本桶名下）　**目标行号**：30 与 35
**上游依据**：`platform/platform-impl/resources/idea/PlatformActions.xml:446-448`（EditMenu 的头两行就是
`$Undo` / `$Redo`）；名字与空名回落：`platform/platform-impl/src/com/intellij/openapi/command/impl/Undo.java:40-43`
（`undo.command` + `action.undo.description.empty`），键位 `$default.xml:232-235` / `:685-688`。
**本仓现状**：那两行走的是编辑器文本撤销（CodeMirror 自己的历史），文件级命令做完后菜单文字不会变成「撤消删除」，
菜单里也点不到那一条（只能到树里按 Ctrl+Z）。行模型已经备好：
`src/pvFileUndoProvider.ts:206-230` 的 `commandMenuRows(processor, scope, onSettled)`
（本轮给它加了第三个参数：撤完回调，宿主用它刷树 —— 上游撤完文件操作发 VFS 事件，
窗格按 `platform/platform-api/src/com/intellij/ui/treeStructure/ProjectViewUpdateCause.kt:49-52` 重建那一支）。
判据：`tests/pv-command-processor.test.mjs` 最后一项（文字 / 可用性 / run / 回调四条）。

### 装配处（`src/App.vue` 给 `createEditMenuRows` 的那份 ctx 里加一项）

```ts
import { commandMenuRows } from './pvFileUndoProvider.ts'
import { getCommandProcessor } from './pvCommandProcessor.ts'
// …
  // 文件级命令栈那两行；撤/做完成时要刷树（ProjectViewUpdateCause.kt:49-52 的等价物）。
  fileUndoRows: commandMenuRows(getCommandProcessor(workspace.value?.root ?? ''), () => [],
    result => { if (result.ok) void refreshTree() }),
```

### `src/menus/editMenu.ts` 的两行替换

```ts
    // 上游 EditMenu 头两行是 $Undo / $Redo（PlatformActions.xml:447-448）。文本撤销归 CodeMirror，
    // 文件级命令归本仓命令栈 —— 这里先问命令栈有没有可撤的（全局组），没有就退回编辑器文本撤销。
    {
      id: '$Undo', keys: 'Ctrl Z', keywords: 'undo revert 撤销 撤消',
      title: ctx.fileUndoRows[0].enabled() ? ctx.fileUndoRows[0].title : () => '撤销',
      enabled: () => ctx.fileUndoRows[0].enabled() || ctx.hasEditor(),
      run: () => { if (ctx.fileUndoRows[0].enabled()) void ctx.fileUndoRows[0].run(); else ctx.runEditor('undo') },
    },
```

（`redo` 那一行同形，把 `fileUndoRows[0]` / `'undo'` 换成 `[1]` / `'redo'`。）
`EditMenuContext` 加一条：`fileUndoRows: { id: string; title: () => string; keys: string; enabled: () => boolean; run: () => Promise<unknown> }[]`。
`MenuRow.title` 允许 `string | (() => string)`、`run` 允许 `() => void`（`src/menus/types.ts`），所以这两行形状直接放得进去。

---

## W3 · 「显示被排除的文件」这一格（要动 native + bridge，本轮判 `[ ]`）

**目标文件**：`native/workspace.cpp`（不在本桶名下；`native/workspace_tree_ops.cpp` 在我名下但只有
`remove_tree` / `copy_tree`，与这条无关）+ `src/bridge.ts` 的 `Entry`（保留）
**上游依据**：
- 成员 `platform/projectView/shared/resources/intellij.platform.projectView.xml:68-71`；
- 这一格在 Project 窗格**是支持的**：`platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewPane.java:167-170`
  （`supportsShowExcludedFiles()` 返回 true），默认开：`platform/lang-impl/src/com/intellij/ide/projectView/ProjectViewSettings.java:11-13`；
- 生效点：`platform/lang-impl/src/com/intellij/ide/projectView/impl/nodes/PsiFileSystemItemFilter.java:24-31`
  （`shouldShow(item)` —— 排除项**照样是树里的一个节点**，只是呈现不同，不是从列举里消失）。

**卡点**：本仓的排除目录在列举阶段就被剪掉 —— `native/workspace.cpp:455-456`（`ignored_directory`）
与 `:479`（列举里 `continue`），`Workspace::open`（`:699-724`）持有 `excluded_` 名字表。
前端因此**拿不到**「被排除的那几行」，齿轮里这一格画出来就是按了不起作用（违反「不放假控件」，
本轮没有画）。
**要接的话最小改动**（供主代理判：native 一处 + 桥载荷一处 + 我这侧一处，我这侧已备好）：
1. `native/workspace.cpp` 的 `enumerate`：命中 `ignored_directory` 时**不再 `continue`**，改成给该条 JSON 加一个
   `"excluded": true`（子树仍照常列举，交由呈现层灰显 —— 与上游 `showExcludedFiles=false` 时
   「隐藏」而 `=true` 时「显示但标记」的差别，本仓可以先只做「显示 + 灰显」一档）；
2. `src/bridge.ts` 的 `Entry` 加可选 `excluded?: boolean`（旧宿主不给这个字段时按 `false`，不判损坏）；
3. 本桶这侧我来接：`src/projectTreeSort.ts` 加 `showExcludedFiles?: boolean`（默认 true，
   同 `ProjectViewSettings.java:11-13`）、`src/projectTreeState.ts` 进 `BOOLEAN_KEYS`、
   `src/components/ProjectViewSortSettings.vue` 在「显示临时文件和控制台」之前插这一格
   （上游 `:68-71` 就在 `:81-84` 前面）、`src/components/FileTree.vue` 对 `entry.excluded === true`
   的行加一个灰显类并按开关隐藏。**判定与呈现都走既有那条装饰链**
   （`src/projectTreeDecorations.ts` 的 `decorationClass` 同一形状），不需要新模块。
4. 排除的粒度仍是**目录名表**（`src/settingsModel.ts:102` 的 `excludedDirs`，段名匹配见
   `src/projectRoots.ts:66-68`），与上游按路径记 exclude folder 不等价 —— 这条差异
   `bucket14a.md` 已登记并被 `tests/pv-mark-roots.test.mjs` 钉住，W3 不改变它。

---

## 顺带一条文档订正（不是接线，但按图索骥会扑空）

`docs/batch-2026-10-06-welcome2.md` 里给的结构视图坐标写成
`platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java`（参考树里没有这条路径），
实测在 `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java`（中间多一段 `impl/`）。
这条是 `node --test tests/source-citations.test.mjs` 现在红的两条之一（另一条是
`docs/batch-2026-10-06-completion2.md` 的 `SuppressIntentionAction`），都不在本桶名下，留给对应桶改。
本桶自己的两份文档没有带行号的假路径（假路径一律去掉行号写，避免门禁止把它当一条真引用收集）。
