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
// 录制钩子/回放/持久化在 src/macroHost.ts。

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

/** 重命名/新建时的名字校验：空名字只允许"匿名宏"这一种用法，重名要拒绝（源码 `checkCanCreateMacro` 循环再问）。 */
export function macroNameError(name: string, macros: readonly Macro[], renaming = ''): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '宏名不能为空。'
  if (trimmed === renaming) return null
  if (macros.some(macro => macro.name === trimmed)) return `已存在名为「${trimmed}」的宏。`
  return null
}

export function findMacro(macros: readonly Macro[], name: string): Macro | undefined {
  return macros.find(macro => macro.name === name)
}

/** 从宏表里删掉一项（按名字；匿名宏传空串）。 */
export function removeMacro(macros: readonly Macro[], name: string): Macro[] {
  return macros.filter(macro => macro.name !== name)
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
