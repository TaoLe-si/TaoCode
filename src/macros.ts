// 宏（录制/回放）—— IDEA `com.intellij.ide.actionMacro` 那一套的对应物。
//
// 逐条对照的源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 宏模型 `platform/platform-impl/src/com/intellij/ide/actionMacro/ActionMacro.java`
//       - `:62` `MACRO_ACTION_PREFIX = "Macro."`，`:222` `getActionId()` = `"Macro." + name`
//         —— **命名宏本身也注册成一个动作 id**（所以能在 Find Action 里搜到、也能被键位绑定）
//       - 三类步骤：`TypedDescriptor`（输入的文字，`:235-247` **连续字符合并成一条**）、
//         `IdActionDescriptor`（`appendAction(actionId)`，回放时 `:352-360` 按 id 找动作并 perform）、
//         `ShortcutActionDescription`（按键组合，**`playBack` 是空实现** `:325-327` —— 只有生成脚本时才用）
//   · 管理器 `.../actionMacro/ActionMacroManager.kt`
//       - `:77-78` 存储 `@State(name="ActionMacroManager", storages=[Storage("macros.xml")])`（**应用级用户文件**）
//       - `:100-121` 录制钩子是全局 **`AnActionListener.beforeActionPerformed`**：正在录制时
//         `recordingMacro.appendAction(id)`，并把「id (快捷键)」显示给用户；`StartStopMacroRecording`
//         自身不录（先判 id）
//       - `:148-155` `startRecording`：`isRecording = true` + 状态栏加一个录制指示器 widget
//       - `:279-305` `stopRecording`：删 widget → `isRecording = false` → **弹输入框问名字**（取消则丢弃录制；
//         **空名字 = 匿名宏**，覆盖上一个匿名宏）→ `lastMacro = recordingMacro` → 命名宏入表 → 重新注册动作
//       - `:469-490` `InvokeMacroAction`：回放中 `setEnabled(!isPlaying)`（防递归）
//       - `:496+` `KeyPostProcessor`：录制时按键也进宏（`appendKeyPressed`，走 TypedDescriptor 的合并分支）
//   · 菜单 `platform/platform-impl/resources/idea/PlatformActions.xml:506-510`（EditMenu 内的 `Macros` 子菜单）：
//       `PlaybackLastMacro` · `StartStopMacroRecording` · `EditMacros` · `PlaySavedMacrosAction`
//
// TaoCode 的落点：本模块是**纯逻辑**（零 import ⇒ 可单测）—— 模型、合并规则、命名校验与序列化；
// 录制钩子/回放/持久化/命名宏的动作注册在 src/macroHost.ts。
//
//   · `registerActions`（`ActionMacroManager.kt:395-423`）：命名宏注册成 `Macro.<名字>` 动作
//     —— 本模块的 `macroActionIds`，宿主 `src/macroHost.ts` 的 `syncMacroActions` 真的写进
//     `ACTIONS`。注册了才能被「查找操作」搜到、才能绑键（键位层的动态动作表从同一个来源取）。
//   · `apply`（`ActionMacroConfigurationPanel.java:69-104`）的键位迁移 —— 本模块的
//     `macroRenameKeymapOverrides`（`:71-81` 重命名搬键位）与 `macroStripKeymapOverrides`
//     （`:84`/`:99-103` 删除后从所有键位摘掉）。

/** 一步宏操作。三类与 `ActionMacro.ActionDescriptor` 一一对应。 */
export type MacroStep =
  /** `IdActionDescriptor`：按动作 id 调用（回放走动作注册表）。 */
  | { kind: 'action'; id: string; title: string; keys?: string }
  /** `TypedDescriptor`：输入的文字（连续字符合并成一条）。 */
  | { kind: 'typing'; text: string }
  /** `ShortcutActionDescription`：按键组合。**回放是空操作**（与源码一致），只用于展示/导出脚本。 */
  | { kind: 'shortcut'; stroke: string }

export interface Macro {
  /** 空字符串 = 匿名宏（源码 `macroName == null` 的分支：只有一个匿名宏，新的覆盖旧的）。 */
  name: string
  steps: MacroStep[]
}

/** `ActionMacro.MACRO_ACTION_PREFIX`。 */
export const MACRO_ACTION_PREFIX = 'Macro.'

/** `ActionMacro.getActionId()`：命名宏注册成 `Macro.<名字>`。匿名宏没有动作 id。 */
export function macroActionId(name: string): string {
  return name ? MACRO_ACTION_PREFIX + name : ''
}

/**
 * 表里所有命名宏的动作 id（`ActionMacroManager.registerActions`，`ActionMacroManager.kt:412-423`：
 * 遍历 `allMacros` 逐个 `actionManager.registerAction(macro.actionId, InvokeMacroAction(macro))`，
 * 同名只注册一次）。匿名宏**没有**动作 id —— 上游 `InvokeMacroAction` 是每个宏一个匿名类，
 * 但 `registerActions` 只对 `getActionId()` 非空的（即命名宏）走注册。
 * 注册出来才有 Find Action 条目与可绑的键位（`ActionMacroConfigurationPanel.apply`，`:97`）。
 */
export function macroActionIds(macros: readonly Macro[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const macro of macros) {
    const id = macroActionId(macro.name)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * 键位覆盖表（`src/keymapEditor.ts` 的 `KeymapOverrides`）——这里写成结构等价的本地别名，
 * 好让本模块保持**零 import**（可单测、也能被纯逻辑测试直接引）。
 */
export type MacroKeymapOverrides = Readonly<Record<string, string | null>>

/**
 * 重命名宏时迁移它**已经绑上的键位**（`ActionMacroConfigurationPanel.apply`，`:71-81`）：
 * 遍历所有键位，把 `Macro.<新名>` 原有的绑定清掉，把 `Macro.<旧名>` 的绑定搬到新 id 上，
 * 最后把旧 id 的绑定整个删掉。顺序不能换 —— 先搬再清，新名上原有的（陈旧的）绑定必须先让位。
 * 没有绑过键（覆盖表里没这个 id）时原样返回。
 */
export function macroRenameKeymapOverrides(current: MacroKeymapOverrides, from: string, to: string): MacroKeymapOverrides {
  const oldId = macroActionId(from)
  const newId = macroActionId(to)
  if (!oldId || !newId || oldId === newId) return current
  if (!Object.prototype.hasOwnProperty.call(current, oldId)) return current
  const next: Record<string, string | null> = { ...current }
  const shortcut = next[oldId]
  delete next[oldId]
  if (shortcut !== null && shortcut !== undefined) next[newId] = shortcut
  return next
}

/**
 * 删除宏（或一次提交里少了某个宏）时，把它留在键位里的绑定摘掉
 * （`ActionMacroConfigurationPanel.apply`，`:84`/`:99-103`：`removedIds` 里的动作 id
 * 在**所有**键位上 `removeAllActionShortcuts`）。
 * 只有覆盖表里真的记着这个 id 才动它 —— 别的动作的键位不受影响。
 */
export function macroStripKeymapOverrides(current: MacroKeymapOverrides, names: readonly string[]): MacroKeymapOverrides {
  const ids = names.map(macroActionId).filter(Boolean)
  if (!ids.length) return current
  let changed = false
  const next: Record<string, string | null> = { ...current }
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(next, id)) continue
    delete next[id]
    changed = true
  }
  return changed ? next : current
}

/** 匿名宏在菜单里的显示名（IDEA 用 `action.invoke.macro.text`，这里是「（未命名）」）。 */
export const ANONYMOUS_MACRO_LABEL = '（未命名）'

export function macroDisplayName(macro: Macro): string {
  return macro.name || ANONYMOUS_MACRO_LABEL
}

/**
 * 追加一步「输入」。对应 `ActionMacro.appendKeyPressed`（`:203-213`）：
 * **上一步也是输入**就把字符并进去，否则新开一条 —— 这样"敲了一句话"在宏里是**一条**而不是几十条。
 */
export function appendTyping(steps: readonly MacroStep[], text: string): MacroStep[] {
  if (!text) return [...steps]
  const last = steps[steps.length - 1]
  if (last && last.kind === 'typing') {
    return [...steps.slice(0, -1), { kind: 'typing', text: last.text + text }]
  }
  return [...steps, { kind: 'typing', text }]
}

/** 追加一步动作（对应 `ActionMacro.appendAction`）。 */
export function appendAction(steps: readonly MacroStep[], step: { id: string; title: string; keys?: string }): MacroStep[] {
  if (!step.id) return [...steps]
  return [...steps, { kind: 'action', id: step.id, title: step.title, ...(step.keys ? { keys: step.keys } : {}) }]
}

/** 追加一步按键（对应 `ActionMacro.appendShortcut`）。 */
export function appendShortcut(steps: readonly MacroStep[], stroke: string): MacroStep[] {
  if (!stroke) return [...steps]
  return [...steps, { kind: 'shortcut', stroke }]
}

/** 宏里有多少条**动作**（菜单上显示"宏里的动作数"用；输入/按键不计）。 */
export function actionStepCount(macro: Macro): number {
  return macro.steps.filter(step => step.kind === 'action').length
}

/**
 * 停止录制后的入表规则（`ActionMacroManager.addRecordedMacroWithName`，`:307-330`）：
 * 命名宏追加到表尾（**同名先删旧**，避免出现两个同名宏）；匿名宏**替换**已有的匿名宏。
 */
export function upsertMacro(macros: readonly Macro[], recorded: Macro): Macro[] {
  if (!recorded.name) {
    const index = macros.findIndex(macro => !macro.name)
    if (index < 0) return [...macros, recorded]
    return macros.map((macro, at) => (at === index ? recorded : macro))
  }
  return [...macros.filter(macro => macro.name !== recorded.name), recorded]
}

/** 重命名/新建时的名字校验：空名字只允许"匿名宏"这一种用法，重名要拒绝（源码 `checkCanCreateMacro` 循环再问）。
 *  `overwrite = true` 是重命名的"确认覆盖"分支：调用方已经问过用户、准备把同名宏并掉。 */
export function macroNameError(name: string, macros: readonly Macro[], renaming = '', overwrite = false): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '宏名不能为空。'
  if (trimmed === renaming) return null
  if (!overwrite && macros.some(macro => macro.name === trimmed)) return `已存在名为「${trimmed}」的宏。`
  return null
}

/**
 * 重命名时**与别的宏撞名**的那一个（上游 `ActionMacroConfigurationPanel.canRenameMacro`，`:157-178`）：
 * 目标名字被另一个宏占用时返回那个宏，否则 `undefined`。上游此时弹「宏已存在」的 yes/no —
 * 答"是"就把旧的那个删掉（名字并过来），答"否"重新问名字；本仓由宿主 `renameMacro` 拿它决定要不要问。
 */
export function macroNameConflict(name: string, macros: readonly Macro[], renaming = ''): Macro | undefined {
  const trimmed = name.trim()
  if (!trimmed || trimmed === renaming) return undefined
  return macros.find(macro => macro.name === trimmed)
}

export function findMacro(macros: readonly Macro[], name: string): Macro | undefined {
  return macros.find(macro => macro.name === name)
}

/** 从宏表里删掉一项（按名字；匿名宏传空串）。 */
export function removeMacro(macros: readonly Macro[], name: string): Macro[] {
  return macros.filter(macro => macro.name !== name)
}

/**
 * 把宏里的一步上移/下移一格（`ActionMacroConfigurationPanel` 的上下按钮，
 * 见 `ActionMacroConfigurationPanel.java` 的 `moveUp`/`moveDown`）。
 * 越界或 delta 为 0 时原样返回；返回的是新数组，调用方直接替换。
 */
export function moveMacroStep(steps: readonly MacroStep[], index: number, delta: number): MacroStep[] {
  const target = index + delta
  if (delta === 0 || index < 0 || index >= steps.length || target < 0 || target >= steps.length) return [...steps]
  const next = [...steps]
  const [picked] = next.splice(index, 1)
  next.splice(target, 0, picked!)
  return next
}

// ---------------------------------------------------------------------------
// 录制时的按键分类（`ActionMacroManager.kt` 的 `KeyPostProcessor.postProcessKeyEvent`，`:497-533`）
//
// 判词里 pf/action-macro 写的缺口是「宏编辑的设置页形态」，逐行读过上游后**那个前提不成立**：
//   · `ActionMacroConfigurationPanel.java:187` 对步骤列表是 `.disableAddAction().disableUpDownActions()` ——
//     上游的步骤面板**只有删除**（`:183` `macro.deleteAction(idx)`）与重命名宏（`:144-149`），
//     既不能插入也不能上移下移、不能改动作 id。本仓的 `moveMacroStep` 已经**比上游多**了。
//   · `ActionMacroManager.kt:156` `recordingMacro = ActionMacro(macroName)` —— 每次录制都**新建**一个宏，
//     上游没有「把录制追加到已有宏」这条路径。
// 真正缺的是**第三种步骤从来没被录进来**：`MacroStep` 有 `shortcut` 形态、`appendShortcut` 也在
// （`ActionMacro.java:165-167`），但录制链路只喂了 `appendTyping`，所以宏里永远看不到「按了哪组键」。
// 下面这一段就是把上游 `:498-531` 的分类判定原样搬过来。
// ---------------------------------------------------------------------------

/** 一次按键事件里本仓用得上的那几格（`java.awt.event.KeyEvent` 的结构子集，字段名与 DOM 事件一致）。 */
export interface MacroKeyEvent {
  /** `KeyEvent.getKey()`：单字符是**产生的字符**（Shift 已折进去），功能键是键名。 */
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * `UIUtil.isReallyTypedEvent`（`platform/util/ui/src/com/intellij/util/ui/UIUtil.java:513-521`）：
 * 产出的字符不是 `CHAR_UNDEFINED`、不在 `c < 0x20`、也不是 `0x7F`（DEL）。
 * 上游拿的是 `char`，本仓从 `event.key` 的首字符取同一口径。
 */
export function isReallyTypedChar(key: string): boolean {
  if (!key) return false
  const code = key.charCodeAt(0)
  return code >= 0x20 && code !== 0x7f
}

/**
 * 纯修饰键自己不进宏（`ActionMacroManager.kt:507-513`：Ctrl / Alt / Meta / Shift 直接 return）——
 * 否则「按下 Shift」会在宏里多出一条没意义的按键步骤。
 */
export function isModifierOnlyKey(key: string): boolean {
  return key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'Shift'
}

/**
 * 组合键步骤的文案（`ActionMacroManager.kt:525-529`）：
 * 修饰键部分把 `ctrl` 换成 `control`，与键名之间是**一个空格**（上游不是 `+`）。
 * 修饰键顺序 = AWT `KeyStroke.toString()` 的产出顺序（Ctrl、Alt、Shift、Meta），
 * 判别式是 `KeyEvent.getKey()` 上报的 `ctrlKey/altKey/shiftKey/metaKey`。
 */
export function macroShortcutStroke(event: MacroKeyEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('control')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (event.metaKey) parts.push('meta')
  return `${parts.join(' ')} ${event.key}`.trim()
}

/**
 * 一次按键该记成哪一步（`ActionMacroManager.kt:515-531`）：
 *   · `plainType && ready && !isEnter` → **输入**（`appendKeyPressed`，字符会并进上一步输入）
 *   · `!plainType && ready || isEnter` → **按键**（`appendShortcut`）
 * 其中 `plainType = isReallyTypedEvent(e) && !(alt || ctrl || meta)`（`:516-518`）——
 * **Shift 不算动作修饰键**（上游 `hasActionModifiers` 里没有它），所以 Shift+A 记成输入「A」。
 * `ready`（`:515`，事件队列是否还在分发）由调用方保证：宏宿主只在没有弹层拦键时才问分类。
 * 返回 `null` = 这一下不该进宏（纯修饰键，或 `event.key` 为空）。
 */
export function classifyRecordedKey(event: MacroKeyEvent): { kind: 'typing'; text: string } | { kind: 'shortcut'; stroke: string } | null {
  if (!event.key || isModifierOnlyKey(event.key)) return null
  const hasActionModifiers = event.altKey || event.ctrlKey || event.metaKey
  const plainType = hasActionModifiers ? false : isReallyTypedChar(event.key)
  const isEnter = event.key === 'Enter'
  if (plainType && !isEnter) return { kind: 'typing', text: event.key }
  return { kind: 'shortcut', stroke: macroShortcutStroke(event) }
}

/**
 * 导出成 IDEA 的宏脚本（`ActionMacro.generateTo`，`:305-307` / `:362-363` / `:257`）：
 * 输入步骤一行原文、按键步骤 `%[<stroke>]`、动作步骤 `%action <actionId>`。
 * 上游把它写进「复制脚本」按钮；本仓同口径导出（回放仍跳过按键步骤，那与上游 `playBack` 空实现一致）。
 */
export function macroScript(macro: Macro): string {
  const lines = macro.steps.map(step => {
    if (step.kind === 'typing') return step.text
    if (step.kind === 'shortcut') return `%[${step.stroke}]`
    return `%action ${step.id}`
  })
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 持久化（IDEA 存 `macros.xml`；TaoCode 的应用级用户数据放 localStorage）
// ---------------------------------------------------------------------------

export const MACRO_STORAGE_KEY = 'taocode.macros'
const MACRO_STORAGE_VERSION = 1

interface MacroFile { version: number; macros: Macro[] }

/** 序列化：只写形状正确的字段（`steps` 的 kind 必须认识，否则丢弃该步）。 */
export function serializeMacros(macros: readonly Macro[]): string {
  const file: MacroFile = { version: MACRO_STORAGE_VERSION, macros: macros.map(macro => ({ name: macro.name, steps: macro.steps.map(cloneStep) })) }
  return JSON.stringify(file)
}

/** 解析：坏数据一律退回空表（宏是用户数据，宁可丢也不要让 IDE 起不来）。 */
export function parseMacros(raw: string | null): Macro[] {
  if (!raw) return []
  try {
    const file = JSON.parse(raw) as Partial<MacroFile>
    if (!file || file.version !== MACRO_STORAGE_VERSION || !Array.isArray(file.macros)) return []
    return file.macros
      .filter((macro): macro is Macro => Boolean(macro) && typeof macro.name === 'string' && Array.isArray(macro.steps))
      .map(macro => ({ name: macro.name, steps: macro.steps.filter(isKnownStep).map(cloneStep) }))
  } catch { return [] }
}

function isKnownStep(step: unknown): step is MacroStep {
  if (!step || typeof step !== 'object') return false
  const kind = (step as { kind?: unknown }).kind
  if (kind === 'typing') return typeof (step as { text?: unknown }).text === 'string'
  if (kind === 'shortcut') return typeof (step as { stroke?: unknown }).stroke === 'string'
  if (kind === 'action') return typeof (step as { id?: unknown }).id === 'string'
  return false
}

function cloneStep(step: MacroStep): MacroStep {
  if (step.kind === 'typing') return { kind: 'typing', text: step.text }
  if (step.kind === 'shortcut') return { kind: 'shortcut', stroke: step.stroke }
  return { kind: 'action', id: step.id, title: step.title, ...(step.keys ? { keys: step.keys } : {}) }
}
