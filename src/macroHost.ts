// 宏的宿主侧：录制状态机 + 回放 + 持久化 + 编辑动作。
//
// 模型与规则在 src/macros.ts（纯逻辑、有单测）；这里只做"和宿主打交道"的部分：
//   · 录制开关（对应 `ActionMacroManager.startRecording` / `stopRecording`）
//   · 停止时问名字（IDEA 是 `Messages.showInputDialog`；TaoCode 与 Git 菜单一样用宿主 prompt，
//     空名字 = 匿名宏 ⇒ 覆盖上一个匿名宏，`:307-330`）
//   · 回放（对应 `ActionMacroManager.playMacro`）：按 id 找动作执行、输入写进活动编辑器；
//     `macroPlaying` 期间宏动作禁用（`InvokeMacroAction.update` 的 `setEnabled(!isPlaying)`）
//   · 持久化：IDEA 存 `macros.xml`；TaoCode 的应用级用户数据用 localStorage（与工具窗口布局同路）
import { computed, nextTick, ref } from 'vue'
import {
  ANONYMOUS_MACRO_LABEL, MACRO_STORAGE_KEY, appendAction, appendTyping, macroDisplayName, macroNameError,
  parseMacros, removeMacro, serializeMacros, upsertMacro, type Macro, type MacroStep,
} from './macros'

/**
 * 当前装配好的宏会话（模块级单例指针）。
 *
 * 为什么需要它：录制钩子在 `src/menuUi.ts`（菜单/命令面板的动作执行处）里被调用，那里**不该**
 * 通过 ctx 拿到宏宿主的每个成员（那会把"记一步"这件事变成 9 个依赖）。IDEA 的钩子是全局
 * `AnActionListener`，这里用同样的"全局指针"形态；没有装配时钩子是空操作。
 */
interface MacroSession {
  recordAction: (step: { id: string; title: string; keys?: string }) => boolean
  recordTyping: (text: string) => boolean
}
let activeSession: MacroSession | null = null

/** 动作执行前记一步（`AnActionListener.beforeActionPerformed`）。 */
export function recordActionStep(step: { id: string; title: string; keys?: string }): boolean {
  return activeSession ? activeSession.recordAction(step) : false
}

/** 编辑器里敲进的文字（`KeyPostProcessor` → `appendKeyPressed`）。 */
export function recordTypingStep(text: string): boolean {
  return activeSession ? activeSession.recordTyping(text) : false
}

export interface MacroHostDeps {
  notify: (message: string, error?: boolean) => void
  /** 活动文件路径（回放的输入写进它的编辑器）。 */
  activePath: { readonly value: string }
  /** 拿某个文件的编辑器句柄（`insertText` 是 src/editorPaste.ts 的插入通道）。 */
  editorFor: (path: string) => any
  /**
   * 按动作 id 找一条菜单/命令动作（IDEA 的 `ActionManager.getAction(id)`）。
   * 宿主传的是 Find Action 的那份清单（`src/menuUi.ts` 的 `actionList`），所以**宏能回放任何
   * 菜单里出现过的动作**，与源码一致。
   */
  resolveAction: (id: string) => (() => void) | undefined
}

export function createMacros(deps: MacroHostDeps) {
  const { notify, activePath, editorFor, resolveAction } = deps
  // `loadState` / `getState` 的对应物：宏表是**应用级用户数据**，这里在模块自持的 ref 上读写。
  const macros = ref<Macro[]>(parseMacros(typeof localStorage === 'undefined' ? null : localStorage.getItem(MACRO_STORAGE_KEY)))
  const namedMacros = computed(() => macros.value.filter(macro => Boolean(macro.name)))
  const recording = ref(false)
  const recordingSteps = ref<MacroStep[]>([])
  const playing = ref(false)
  /** 「编辑宏…」对话框（IDEA `EditMacrosAction` 的 `ActionMacroConfigurable`）。 */
  const macrosDialogOpen = ref(false)
  const openMacrosDialog = () => { macrosDialogOpen.value = true }
  const lastMacro = ref<Macro | null>(null)
  /** 录制期间连续输入的合并缓存：一次键盘输入调用一次 `recordTyping`。 */
  const recentTyping = ref('')
  let typingTimer: number | undefined

  /** `AnActionListener.beforeActionPerformed` 的落点：动作执行**前**记录一步。 */
  function recordAction(step: { id: string; title: string; keys?: string }): boolean {
    if (!recording.value || !step.id || step.id === 'edit.startStopMacroRecording') return false
    flushTyping()
    recordingSteps.value = appendAction(recordingSteps.value, step)
    notify(`宏录制：已记录「${step.title}」${step.keys ? `（${step.keys}）` : ''}`)
    return true
  }

  /** 编辑器的输入：连续键入合并成一条（对应 `appendKeyPressed` 的合并分支）。 */
  function recordTyping(text: string): boolean {
    if (!recording.value || !text) return false
    recentTyping.value += text
    if (typingTimer !== undefined) window.clearTimeout(typingTimer)
    typingTimer = window.setTimeout(flushTyping, 400)
    return true
  }

  // 会话指针在函数定义之后设置（下面一行）；宏宿主只有一份，重复装配时后一个生效。
  function flushTyping() {
    if (typingTimer !== undefined) { window.clearTimeout(typingTimer); typingTimer = undefined }
    if (!recentTyping.value) return
    recordingSteps.value = appendTyping(recordingSteps.value, recentTyping.value)
    recentTyping.value = ''
  }

  activeSession = { recordAction, recordTyping }

  function startMacroRecording() {
    if (recording.value) return
    playing.value = false
    recording.value = true
    recordingSteps.value = []
    recentTyping.value = ''
    notify('开始录制宏：执行的动作会被记录下来，再按一次「开始/停止宏录制」结束。')
  }

  /** `stopRecording`：问名字 → 入表（空名字 = 匿名宏，覆盖旧的那个）→ 记 `lastMacro`。 */
  function stopMacroRecording() {
    if (!recording.value) return
    flushTyping()
    recording.value = false
    const steps = recordingSteps.value
    recordingSteps.value = []
    if (!steps.length) { notify('宏里没有任何动作，已丢弃。'); return }
    // IDEA 用输入对话框循环问（重名不接受）；这里用宿主 prompt，重名同样不接受。
    let name = window.prompt('宏名（留空则保存为未命名宏，会覆盖上一个未命名宏）：', '') ?? null
    if (name === null) { notify('已取消，录制的宏未保存。'); return }
    name = name.trim()
    const error = name ? macroNameError(name, macros.value) : null
    if (error) { notify(error, true); return }
    const recorded: Macro = { name, steps }
    macros.value = upsertMacro(macros.value, recorded)
    lastMacro.value = recorded
    persist()
    notify(`已保存宏「${macroDisplayName(recorded)}」（${steps.length} 步）。`)
  }

  function toggleMacroRecording() { recording.value ? stopMacroRecording() : startMacroRecording() }

  /**
   * `playMacro`：逐步执行。动作走 `resolveAction`（找不到就跳过并提示 —— 与源码
   * `IdActionDescriptor.playBack` 的 `if (action == null) return` 一致），输入写进活动编辑器。
   */
  async function playMacro(macro: Macro | null) {
    if (!macro || playing.value) return
    playing.value = true
    lastMacro.value = macro
    let replayed = 0
    try {
      for (const step of macro.steps) {
        if (step.kind === 'action') {
          const run = resolveAction(step.id)
          if (!run) { notify(`宏里的动作「${step.title}」现在不可用，已跳过。`, true); continue }
          run()
        } else if (step.kind === 'typing') {
          const path = activePath.value
          const editor = path ? editorFor(path) : undefined
          if (editor?.insertText) editor.insertText(step.text)
          else { notify('宏里的输入需要先打开一个文件。', true); break }
        }
        // `shortcut` 步骤**不回放**（源码 `ShortcutActionDescription.playBack` 也是空实现）
        ++replayed
        await nextTick()
      }
      notify(`已回放宏「${macroDisplayName(macro)}」（${replayed} 步）。`)
    } finally { playing.value = false }
  }

  const playLastMacro = () => void playMacro(lastMacro.value)

  function deleteMacro(name: string) {
    macros.value = removeMacro(macros.value, name)
    if (lastMacro.value?.name === name) lastMacro.value = null
    persist()
  }

  function renameMacro(from: string, to: string): string | null {
    const error = macroNameError(to, macros.value, from)
    if (error) return error
    const macro = macros.value.find(item => item.name === from)
    if (!macro) return '找不到该宏。'
    macros.value = upsertMacro(removeMacro(macros.value, from), { ...macro, name: to.trim() })
    if (lastMacro.value?.name === from) lastMacro.value = { ...macro, name: to.trim() }
    persist()
    return null
  }

  /** 删掉宏里的一步（`ActionMacro.deleteAction(idx)`）。 */
  function deleteMacroStep(name: string, index: number) {
    macros.value = macros.value.map(macro => macro.name === name
      ? { ...macro, steps: macro.steps.filter((_, at) => at !== index) }
      : macro)
    persist()
  }

  function persist() {
    try { localStorage.setItem(MACRO_STORAGE_KEY, serializeMacros(macros.value)) }
    catch { /* 存储不可用：本次会话仍可用 */ }
  }

  return {
    macros, namedMacros, recording, recordingSteps, playing, lastMacro,
    macrosDialogOpen, openMacrosDialog,
    startMacroRecording, stopMacroRecording, toggleMacroRecording, playMacro, playLastMacro,
    deleteMacro, renameMacro, deleteMacroStep, recordAction, recordTyping,
    /** 给菜单用的纯查询（匿名宏的显示名）。 */
    displayName: macroDisplayName, anonymousLabel: ANONYMOUS_MACRO_LABEL,
  }
}
