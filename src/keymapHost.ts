// 键位设置对话框的宿主状态 —— 上游 `KeymapPanel`（`platform/platform-impl/src/com/intellij/openapi/keymap/
// impl/ui/KeymapPanel.java:111`，`implements SearchableConfigurable`）在本仓的等价物里
// **「只有状态、没有 Swing 组件」**的那一层。
//
// 为什么单独一个文件：规则全在 `src/keymapEditor.ts`（纯函数、Vue-free、可单测），
// 面板本身是 `src/components/KeymapDialog.vue`。中间这段需要活的状态只有三样：
//   · 对话框开没开（上游是 `KeymapPanel` 被 settings 的 `Configurable` 装进容器）；
//   · 搜索框 / 只看冲突（上游 `FilterComponent("KEYMAP", 5)`（`:455`）与
//     `showConflictsAction`（`:447`）两个工具栏动作）；
//   · 改键时的三选一冲突对话（上游 `KeymapPanel.addKeyboardShortcut` 的
//     `showConfirmationDialog` + `Messages.YES/NO/CANCEL`，`:529-537`）。
// 这三样都要能被菜单 / 宿主读写，所以不能塞在组件的 `<script setup>` 里（组件一卸载就没了）。
//
// 上游的入口在 **Settings › Keymap**；本仓的设置对话框顶在行数上限、节点表
// `src/settingsTreeMeta.ts` 归接线批，所以入口落在帮助菜单的「键盘映射…」
// （`src/menus/helpMenu.ts`）—— 这是**本仓的落位决定**，不是上游位置。
// 上游 `KeymapPanel` 本身是可搜索设置页，这一点见上。
import { computed, ref } from 'vue'
import {
  applyOverrides, assignShortcut, currentOverrides, effectiveKeysOf, effectiveKeyBindings, keymapRows,
  onOverridesChanged, removeConflictingShortcuts, resetScheme, restrictionReason, type KeymapRow,
} from './keymapEditor.ts'
import { keymapConflicts, parseChord, type KeymapConflict } from './keymapBindings.ts'

/** 改键时要问的那一组（上游 `showConfirmationDialog` 的 YES/NO/CANCEL 三选一）。 */
export interface KeymapConflictPrompt {
  actionId: string
  chordText: string
  conflicts: KeymapConflict[]
}

/** 面板录出来的显示串（`Ctrl Alt M`）→ `KeyChord`；读不出来就是数据坏了，抛。 */
function parseChordOf(text: string) {
  const chord = parseChord(text)
  if (!chord) throw new Error(`不是一组合法的键位：${text}`)
  return chord
}

export function createKeymapHost() {
  /** `KeymapPanel` 是否已挂到宿主上（`v-if` 读它）。 */
  const keymapDialogOpen = ref(false)
  const conflictPrompt = ref<KeymapConflictPrompt | null>(null)

  const openKeymapDialog = () => { keymapDialogOpen.value = true }
  const closeKeymapDialog = () => {
    keymapDialogOpen.value = false
    conflictPrompt.value = null
  }

  // `FilterComponent` 的检索串 + `showConflictsAction` 的开关（`KeymapPanel.java:447`）。
  const query = ref('')
  const conflictsOnly = ref(false)
  /** 覆盖表变更 → 面板重画（上游 `WeakKeymapManagerListener` / `KeymapListener` 的那层）。 */
  const revision = ref(0)
  onOverridesChanged(() => { revision.value += 1 })

  const rows = computed<KeymapRow[]>(() => {
    void revision.value // 订阅覆盖表变更
    const all = keymapRows(effectiveKeyBindings(), query.value)
    return conflictsOnly.value ? all.filter(row => row.conflictsWith.length) : all
  })

  const conflictCount = computed(() => {
    void revision.value
    return keymapConflicts(effectiveKeyBindings()).length
  })

  const customizedCount = computed(() => {
    void revision.value
    return Object.keys(currentOverrides()).length
  })

  /**
   * 改一个动作的键位（上游 `KeymapPanel.addKeyboardShortcut`，`:516-563`）：
   *   · 限制位说不能改 → 直接拒绝（`:523` 的 `if (!restrictions.allowKeyboardShortcut) return`）；
   *   · 撞了别的动作 → **不自动移走**，先把冲突清单交给调用方弹三选一（`:529-537`）。
   * 返回一句可见的拒绝理由或 null。冲突非空时 `conflictPrompt` 会被填上，
   * 调用方/组件要在那之后走 `answerConflictRemove` / `answerConflictKeep` / `answerConflictCancel`。
   */
  function assign(actionId: string, chordText: string): string | null {
    const restriction = restrictionReason(actionId)
    if (restriction) return restriction
    const result = assignShortcut(actionId, chordText)
    if ('error' in result) return result.error
    conflictPrompt.value = result.conflicts.length ? { actionId, chordText, conflicts: result.conflicts } : null
    return null
  }

  /** 三选一的「保留」：两边都留着（上游 `Messages.NO`，`:534` 之后的分支）。 */
  function answerConflictKeep(): void { conflictPrompt.value = null }

  /**
   * 三选一的「移走冲突」（上游 `Messages.YES` → `removeConflictingShortcuts`，`:532`）：
   * 把同一键位从所有冲突动作上摘掉，再把这次的键位落到目标动作上。
   */
  function answerConflictRemove(): void {
    const pending = conflictPrompt.value
    conflictPrompt.value = null
    if (!pending) return
    applyOverrides(removeConflictingShortcuts(pending.actionId, parseChordOf(pending.chordText)))
  }

  /**
   * 三选一的「取消」（上游 `result != YES && != NO`，`:534-536` 直接 `return` 不落盘）：
   * 刚写进去的那条覆盖要撤掉。本仓只有一层覆盖、没有多方案可回退到「别的方案」，
   * 所以取消 = 删掉 `pending.actionId` 这一条。
   */
  function answerConflictCancel(): void {
    const pending = conflictPrompt.value
    conflictPrompt.value = null
    if (!pending) return
    const next: Record<string, string | null> = { ...currentOverrides() }
    delete next[pending.actionId]
    applyOverrides(next)
  }

  /** 恢复出厂键位（上游 `KeymapPanel` 工具栏的「重置」→ `KeymapSchemeManager.resetScheme`，`:139-142`）。 */
  function resetAll(): void { resetScheme() }

  /** 某一行的当前键位显示串（解绑了是空串）。 */
  function keysOf(actionId: string): string { return effectiveKeysOf(actionId) }

  return {
    keymapDialogOpen, openKeymapDialog, closeKeymapDialog,
    query, conflictsOnly, conflictPrompt,
    rows, conflictCount, customizedCount,
    assign, answerConflictRemove, answerConflictKeep, answerConflictCancel,
    resetAll, keysOf,
  }
}

export type KeymapHost = ReturnType<typeof createKeymapHost>

/**
 * 进程内唯一的那份（与 `keymapEditor` 的模块级覆盖表、`actionRegistry` 的 `ACTIONS` 同路）。
 * 组件直接 import 这一个即可 —— 不必由宿主把状态逐个传下来，宿主只需要
 * `keymapDialogOpen` 决定挂不挂载、`openKeymapDialog` 供菜单调用。
 * 工厂本身保留导出，好让测试拿一份隔离实例（改键会落 localStorage，单例会互相干扰）。
 */
export const keymapHost: KeymapHost = createKeymapHost()
