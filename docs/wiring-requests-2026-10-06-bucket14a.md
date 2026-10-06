# 接线请求 · 桶 14a（项目视图面板：树与节点半区，2026-10-06）

给主代理（保留文件的唯一属主）。格式照 `docs/batches-2026-10-06-buckets.md` §4。

本轮**不需要**接线的两件事，先说明，省得重复排查：

- **文件嵌套对话框已经自己接上了**，不动任何保留文件：齿轮下拉里渲染的
  `src/components/ProjectViewSortSettings.vue`（宿主是 `src/components/ToolWindowView.vue:224`，
  传的是 `ctx.projectTreeState.state`，见 `src/toolViewContext.ts:121`）用
  `projectTreeHostFor()` 这张反查表找回宿主（`src/projectTreeState.ts:119`），
  于是「文件嵌套…」→ `FileNestingSettings.vue` → `updateNesting` → `FileTree.vue` 的
  `nestingRules` → 模型整树重建这条链**现在就通**。
  上游依据：`platform/projectView/shared/resources/intellij.platform.projectView.xml:101-102`（`ProjectView.FileNesting`）、
  `platform/projectView/shared/src/actions/ConfigureFilesNestingAction.kt:30-32`（取不到窗格就整项不显示 —— 本仓反查不到宿主时同样不渲染）。
- **压缩目录**同理：开关在同一个组件里（`:98-99`），值走 `projectTreeState` 的
  `compactDirectories`，消费方是 `src/components/FileTree.vue` → `src/projectTreeModel.ts`，不需要挂点。

## 接线请求（给主代理）

- **W1 · 树右键菜单加「将目录标记为」这一格**
  - 目标文件：`src/App.vue` 第 2448 行附近（`剪切 / 复制` 那两枚按钮之后、`书签` 之前）
  - 要接什么：`createTreeActions` 新交出的两个入口（`src/treeActions.ts:146-172`）
    ```vue
    <button v-if="markRootMenu(treeMenu.entry)" class="has-sub"
            @click="treeSubmenu = treeSubmenu === 'markroot' ? null : 'markroot'">{{ markRootMenu(treeMenu.entry)!.title }}</button>
    <template v-if="treeSubmenu === 'markroot'">
      <button v-for="item in markRootMenu(treeMenu.entry)!.items" :key="item.id" class="sub-item"
              @click="applyMarkRoot(item.id, treeMenu.entry)">{{ item.label }}</button>
    </template>
    ```
    并在 `treeSubmenu` 的类型联合里补 `'markroot'`（`src/explorerActions.ts:71` 的
    `ref<'new' | 'filetype' | 'analyze' | null>` —— 那一行属我名下，主代理点头我就自己加）。
  - 为什么需要：模型、可见性判据、写回与提示语全在 `src/pvMarkRoots.ts` + `src/treeActions.ts`，
    只差这格菜单没画；不画就没有用户可见入口（本仓不交只过自己测试的死模块）。
  - 上游依据：`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:252-253`（`MarkRootGroup` 组本体）、
    `platform/platform-impl/resources/idea/LangActions.xml:475`（`<reference ref="MarkRootGroup"/>` 挂在 `ProjectViewPopupMenuSettingsGroup`）、
    `idea/customization/min/resources/intellij.platform.customization.min.xml:61-67`（成员次序 已排除 → 未排除 → 取消标记）、
    `platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootGroup.java:16-22`（两种组标题）。

- **W2 · `createTreeActions` 补一个 `refreshTree` 实参**
  - 目标文件：`src/App.vue` 第 1346 行那个 deps 对象
  - 要接什么：`refreshTree`（已声明成**可选**：`src/treeActions.ts:52-58`；宿主不传也不会编译失败，
    只是「标记为已排除」要等下一次刷新才从树上消失）
  - 为什么需要：本仓的排除是设置表驱动的（`ProjectSettings.excludedDirs`，
    `src/settingsModel.ts:102`），`project.settings.update` 回来不会自动重取目录，
    排除完必须再 `workspace.list` 一次才看得见 —— 这是这条链唯一的用户可见后果。
  - 上游依据：`platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootActionBase.java:52-56`
    之后由 `MarkRootsManager` 提交模型并触发树刷新；`MarkAsContentRootAction.kt:31-38` 的 `model.addContentEntry` + commit。

- **W3 · 移动/重命名的撤销要连引用改写一起撤（上一轮登记但没写出来的那一条）**
  - 目标文件：`src/explorerActions.ts:105-109`（剪切粘贴 = 移动）与重构侧的 `renameEntryWithReferences`
  - 要接什么：把 `renameEntryWithReferences` 的引用改写包进同一条 `CommandStep`
    （现在 `fileUndo.moveStep()` 只反着 rename 文件本身，引用不改回来）
  - 为什么需要：撤销后磁盘回去了、引用还指着旧路径，这是上游 `RenameProcessor` 明确要避免的
    —— 属重构域（桶 1），我这边不越界改；`src/explorerActions.ts:107` 的注释原本指向
    `docs/wiring-requests-2026-10-06-bucket14.md`（那个文件从未被写出，上一轮代理被切断），
    本轮已把指针订正到本文件并留了痕。
  - 上游依据：`platform/lang-impl/src/com/intellij/refactoring/rename/RenameProcessor.java`（改名与引用改写同在一个
    `CommandProcessor.executeCommand` 命令里）、`platform/platform-impl/src/com/intellij/openapi/command/impl/UndoManagerImpl.java:43`
    （43 = `public class UndoManagerImpl extends UndoManager implements Disposable`，397 行；**citefix 订正**：原写 `platform/ide-impl/...` 参考树里没有该模块路径）
    （同一命令组里的所有 `UndoableAction` 一起撤 —— 本仓缺的就是「引用改写」那一步）。
