# 接线请求（merge3，2026-10-06）：两个自动合并动作的**启用条件**要按内容判

## 1. 为什么要接（上游依据，本批逐条打开核实过）

上游那两条工具栏动作不是"文件处于冲突态就可点"，而是**先看内容里有没有能自动合的东西**：

- `platform/diff-impl/src/com/intellij/diff/merge/MagicResolvedConflictsAction.kt:17`
  `e.presentation.setEnabled(viewer.model.hasAutoResolvableConflictedChanges() && !viewer.isExternalOperationInProgress)`
  ⇒ 「解决简单的冲突」在没有可自动合的冲突时是**灰的**（`:21` 才调 `viewer.applyResolvableConflictedChanges()`）。
- `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt:31`
  `setEnabled(viewer.model.hasNonConflictedChanges(side) && …)`（`:35` 调 `viewer.applyNonConflictedChanges(side)`）。
- 两个判据的定义：`platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt:150-152`
  （`hasAutoResolvableConflictedChanges` = 任一改动 `canResolveChangeAutomatically(index, ThreeSide.BASE)`）
  与 `:146-148`（`hasNonConflictedChanges` = 任一**非冲突**改动能满足该条件）；单条改动的判定在 `:365-381`。
- 落盘侧同款：`platform/vcs-impl/src/com/intellij/openapi/vcs/merge/MultipleFileMergeDialog.kt:297-299`
  `if (model.resolveAllChangesAutomatically()) { saveDocument(file) … }` —— 没合掉任何东西就不保存
  （这条本仓**已经对上**：`src/mergeResolveHost.ts:86-91` 的 `if (!result.resolved) … return false`）。

本仓现状：`src/changesMenuActions.ts:64-67`（行号按该文件实际内容）里 `resolveConflicts` / `applyNonConflicts`
两行（`:66`、`:67`）都是 `available: c => Boolean(c.conflicted)` —— 只看"文件未合并"，不看内容；点下去若一处都合不掉，
靠 `src/mergeResolveHost.ts:87-89` 的一句话告知。**用户可见差**：上游是灰掉，本仓是可点 + 事后提示。

## 2. 目标文件与目标行

| 目标文件 | 目标位置 | 要做什么 |
|---|---|---|
| `src/changesMenuActions.ts` | `:54`（`ChangesMenuRow` 那个接口，`available` 在它下面那行 `:61` 的类型交叉里）与 `:66-67`（那两行） | 加一个 `enabled`（默认可省 = 现状） |
| `src/components/SourceControl.vue` | 组装右键菜单、`mergeDeps()` 与 `case 'resolveConflicts' / 'applyNonConflicts'` 那段（`:226-227` 是派发处） | 对 `conflicted` 的文件先 `conflictsIn(text)`（内容已在手边时）或异步 `file.read` 拿一次内容，把两个布尔喂给 `enabled` |
| `src/mergeResolveHost.ts` | 文件末尾（本批可改面，**我这边等这条线定了再落**） | 两个纯谓词（下面代码可直接贴） |

## 3. 可照抄的整段替换代码

`src/mergeResolveHost.ts` 末尾追加（只依赖已有的 `conflictsIn` 与 `src/mergeResolve.ts`）：

```ts
import { APPLY_NON_CONFLICTS_TEXT, RESOLVE_SIMPLE_CONFLICTS_TEXT, hasAutoResolvableBlock, hasNonConflictingBlock, resolveConflictsInText } from './mergeResolve.ts'

/** `MagicResolvedConflictsAction.kt:17` 那条 `setEnabled` 的内容侧判据（本仓粒度：按标记块）。 */
export function canResolveSimpleConflicts(text: string): boolean {
  return hasAutoResolvableBlock(text)
}

/** `ApplyNonConflictsAction.kt:31` 的 `hasNonConflictedChanges`（本仓粒度：按标记块）。 */
export function canApplyNonConflictingChanges(text: string): boolean {
  return hasNonConflictingBlock(text)
}
```

`src/mergeResolve.ts` 里那两个谓词的实现（放在 `resolveConflictsInText` 之后，共用它的块级判型）：

```ts
/** 任一标记块能自动合（`MergeConflictModel.kt:150-152` 的 hasAutoResolvableConflictedChanges）。 */
export function hasAutoResolvableBlock(content: string): boolean {
  return resolveConflictsInText(content, false).resolved > 0
}

/** 任一整块「两侧没同时改成不一样」（`MergeConflictModel.kt:146-148` 的 hasNonConflictedChanges）。 */
export function hasNonConflictingBlock(content: string): boolean {
  return resolveConflictsInText(content, true).resolved > 0
}
```

`src/changesMenuActions.ts` 的两行改成：

```ts
export interface ChangesMenuRow {
  id: string
  label: string
  /** 上游 `setEnabled`：行在，但内容不允许时灰着（缺省 = 一直可点，等同现状）。 */
  enabled?: (change: ChangesMenuTarget) => boolean
}
```

```ts
  { id: 'resolveConflicts', label: RESOLVE_SIMPLE_CONFLICTS_TEXT, available: c => Boolean(c.conflicted),
    enabled: c => c.canResolveSimple !== false },
  { id: 'applyNonConflicts', label: APPLY_NON_CONFLICTS_TEXT, available: c => Boolean(c.conflicted),
    enabled: c => c.canApplyNonConflicting !== false },
```

（`ChangesMenuTarget` 上那两个可选字段由 `SourceControl.vue` 在展开菜单前填；填不到就留 `undefined` ⇒ 行为与现在一致。）

## 4. 请主代理定的两件事

1. **要不要为此多一次 `file.read`**：上游的判据吃的是**已经读进结果缓冲区的内容**，本仓的菜单模型
   （`ChangesMenuTarget`，`src/changesMenuActions.ts:36`）压根没有内容，也没有"置灰"这一态（只有 `available` 出现/不出现）。
   要 100% 对齐就得给右键菜单加一次异步预读 + 新增灰态；不要的话就保持现状（可点 + 一句"为什么没动"），
   本批**没有**擅自加这两个导出（加了就是零生产消费方的死导出，规约 §5 那条不允许我留）。
2. **`Diff.ApplyNonConflicts` 的 Left / 无后缀 / Right 三变体**（`ApplyNonConflictsAction.kt:18`）要不要一并做：
   本仓只移植了无后缀那条（`src/mergeResolveHost.ts:43-45`）。另两条要先回答"朝哪一侧应用"在标记文本里是什么语义，属新功能。

## 处理结果（wiring-backlog lane，2026-10-06）

- 目标 `src/changesMenuActions.ts`（本 lane 可改面）+ `src/components/SourceControl.vue`（VCS lane 独占）+ `src/mergeResolveHost.ts`（本 lane）。因 SourceControl 非本 lane，且请求原文自述「我这边等这条线定了再落」，登记为「需 VCS lane 同批」。

结论：零接线（转 VCS lane）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（转 VCS lane）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
