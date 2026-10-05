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
  ANONYMOUS_MACRO_LABEL, MACRO_ACTION_PREFIX, MACRO_STORAGE_KEY, appendAction, appendShortcut, appendTyping,
  classifyRecordedKey, macroActionId, macroDisplayName, macroNameConflict, macroNameError,
  macroRenameKeymapOverrides, macroStripKeymapOverrides,
  moveMacroStep as moveStepInList,
  parseMacros, removeMacro, serializeMacros, upsertMacro, type Macro, type MacroKeyEvent, type MacroStep,
} from './macros.ts'
import { ACTIONS } from './actionRegistry.ts'
import { applyOverrides, currentOverrides, setDynamicKeyBindings } from './keymapEditor.ts'

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
  /** 组合键那一步。收的是整个按键事件而不是 stroke —— 分类要 `ctrlKey`/`key` 等字段
   *  （`classifyRecordedKey`，`ActionMacroManager.kt:515-531`），stroke 是分类之后才有的。 */
  recordKeyEvent: (event: MacroKeyEvent) => boolean
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

/**
 * 全局键盘入口记一步**组合键**（`ActionMacroManager.kt:524-531` 的 `appendShortcut` 分支）。
 *
 * 与 `recordTypingStep` 的分工：编辑器把「真的打进文档的字符」交给 `recordTypingStep`
 * （它拿得到插入文本），这里负责另一种步骤形态 —— 按下 Ctrl/Alt/Meta/Shift 组合键、
 * 功能键、Enter 这类**不产生字符**的按键。它们过去根本进不了宏。
 *
 * 录制中没在 `src/keymap.ts` 的覆盖层闸门之前调用（那里等价于上游 `IdeEventQueue.keyEventDispatcher.isReady`，
 * `ActionMacroManager.kt:515`）：弹层打开时事件被弹层吃掉，不该记进宏。
 */
export function recordKeyEvent(event: MacroKeyEvent): boolean {
  return activeSession ? activeSession.recordKeyEvent(event) : false
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
  resolveAction: (id: string) => (() => unknown) | undefined
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
  const recordingText = ref('')
  let typingTimer: number | undefined

  /** `AnActionListener.beforeActionPerformed` 的落点：动作执行**前**记录一步。 */
  function recordAction(step: { id: string; title: string; keys?: string }): boolean {
    if (!recording.value || playing.value || !step.id || step.id === 'edit.startStopMacroRecording') return false
    flushTyping()
    recordingSteps.value = appendAction(recordingSteps.value, step)
    recordingText.value = `已记录「${step.title}」${step.keys ? `（${step.keys}）` : ''}`
    return true
  }

  /** 编辑器的输入：连续键入合并成一条（对应 `appendKeyPressed` 的合并分支）。 */
  function recordTyping(text: string): boolean {
    if (!recording.value || playing.value || !text) return false
    recentTyping.value += text
    recordingText.value = `已记录输入：${recentTyping.value.slice(-20)}`
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

  /**
   * 组合键步骤（`appendShortcut`）。先 flush 掉待合并的输入 —— 上游是同一个
   * `KeyPostProcessor` 串行处理两类事件，先敲的字会落在组合键这一步**之前**。
   */
  function recordShortcut(stroke: string): boolean {
    if (!recording.value || playing.value || !stroke) return false
    flushTyping()
    recordingSteps.value = appendShortcut(recordingSteps.value, stroke)
    recordingText.value = `已记录按键：${stroke}（回放时跳过）`
    return true
  }

  /**
   * 一次按键事件按上游分类落成一步（`classifyRecordedKey`，`ActionMacroManager.kt:515-531`）。
   * **只处理组合键那一种**：纯字符走编辑器的 `recordTypingStep`（那边拿得到真实插入的文本，
   * 合并窗口也更贴近「连续输入」）。本函数对纯字符返回 false，不重复记。
   */
  function recordKeyEvent(event: MacroKeyEvent): boolean {
    const classified = classifyRecordedKey(event)
    if (!classified || classified.kind !== 'shortcut') return false
    return recordShortcut(classified.stroke)
  }

  activeSession = { recordAction, recordTyping, recordKeyEvent }

  function startMacroRecording() {
    if (recording.value || playing.value) return
    recording.value = true
    recordingSteps.value = []
    recentTyping.value = ''
    recordingText.value = '宏录制已开始'
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
    let name = ''
    let error: string | null = null
    do {
      const entered = window.prompt(`${error ? `${error}\n` : ''}宏名（留空则保存为未命名宏，会覆盖上一个未命名宏）：`, name)
      if (entered === null) { notify('已取消，录制的宏未保存。'); return }
      name = entered.trim()
      error = name ? macroNameError(name, macros.value) : null
    } while (error)
    const recorded: Macro = { name, steps }
    macros.value = upsertMacro(macros.value, recorded)
    lastMacro.value = recorded
    // 命名宏要变成一个可搜、可绑键的动作（`ActionMacroManager.kt:395-423`）。
    syncMacroActions()
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
          await run()
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

  /**
   * 命名宏 → **动作**（上游 `ActionMacroManager.registerActions`，`ActionMacroManager.kt:395-423`）：
   * 先把已注册的 `Macro.*` 全注销（`:398-408`），再按 `macro.getActionId()` 逐个注册
   * `InvokeMacroAction`（`:412-422`）。这一层是宏的**可发现性**前提 ——
   * 注册了才能在「查找操作」/ Search Everywhere 里搜到（`macros.ts` 文件头引的就是这一条），
   * 也才能被绑键（`keymapEditor` 的动态动作层就是从 `setDynamicKeyBindings` 拿这张表）。
   * 可用性谓词 = `!playing`（上游 `InvokeMacroAction.update` 的 `setEnabled(!isPlaying)`，防递归回放）。
   */
  function syncMacroActions() {
    for (const id of [...ACTIONS.ids()]) {
      if (id.startsWith(MACRO_ACTION_PREFIX)) ACTIONS.unregister(id)
    }
    setDynamicKeyBindings(namedMacros.value.map(macro => ({
      id: macroActionId(macro.name), label: `回放宏 ${macroDisplayName(macro)}`, scope: 'global' as const,
    })))
    for (const macro of namedMacros.value) {
      const id = macroActionId(macro.name)
      if (!id) continue
      const target = macro
      ACTIONS.register({
        id,
        title: macroDisplayName(target),
        keywords: '宏 macro 回放 playback',
        enabled: () => !playing.value,
        run: () => { void playMacro(target) },
        source: 'other',
      })
    }
  }

  function deleteMacro(name: string) {
    macros.value = removeMacro(macros.value, name)
    if (lastMacro.value?.name === name) lastMacro.value = null
    // 宏没了，它占着的键位也要摘掉（`ActionMacroConfigurationPanel.apply`，`:99-103`）——
    // 否则那组键会变成「按了没反应」的死绑定。
    applyOverrides(macroStripKeymapOverrides(currentOverrides(), [name]))
    syncMacroActions()
    persist()
  }

  function renameMacro(from: string, to: string): string | null {
    const name = to.trim()
    // 上游 `canRenameMacro`（`ActionMacroConfigurationPanel.java:157-178`）：目标名字已被**别的**宏
    // 占用时先弹 yes/no「宏已存在」，答"是"才把旧的那个删掉、名字并过来；答"否"不改名。
    // 本仓的对话框只有一次输入，所以"否"就等于取消（返回 null，调用方不用回报错）。
    const conflict = macroNameConflict(name, macros.value, from)
    if (conflict && !window.confirm(`已存在名为「${name}」的宏。重命名会覆盖它，确定吗？`)) return null
    const error = macroNameError(name, macros.value, from, Boolean(conflict))
    if (error) return error
    const macro = macros.value.find(item => item.name === from)
    if (!macro) return '找不到该宏。'
    // 名字变了 = 动作 id 变了（`Macro.<名>`），键位要跟着搬（`:71-81`），否则改完名快捷键就失联。
    // 覆盖同名宏时**不**额外清 `Macro.<新名>`：上游 `:84-103` 的 `removedIds` 是「旧表 id 减去新表 id」，
    // 覆盖分支下新表仍然有 `Macro.<新名>`，所以它不在 removedIds 里 —— 清了反而把刚搬过去的键位删掉。
    applyOverrides(macroRenameKeymapOverrides(currentOverrides(), from, name))
    macros.value = upsertMacro(removeMacro(macros.value, from), { ...macro, name })
    if (lastMacro.value?.name === from) lastMacro.value = { ...macro, name }
    syncMacroActions()
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

  /** 上移/下移一步（`ActionMacroConfigurationPanel` 的 moveUp/moveDown）。 */
  function moveMacroStep(name: string, index: number, delta: number) {
    macros.value = macros.value.map(macro => macro.name === name
      ? { ...macro, steps: moveStepInList(macro.steps, index, delta) }
      : macro)
    persist()
  }

  function persist() {
    try { localStorage.setItem(MACRO_STORAGE_KEY, serializeMacros(macros.value)) }
    catch { /* 存储不可用：本次会话仍可用 */ }
  }

  // 启动即装配：上次会话存下来的命名宏要能搜到、能绑键（上游是 `ActionMacroManager` 启动时
  // 从持久化的宏表重建动作注册，`ActionMacroManager.kt:395` 的注册循环的同一个入口）。
  syncMacroActions()

  return {
    macros, namedMacros, recording, recordingSteps, recordingText, playing, lastMacro,
    macrosDialogOpen, openMacrosDialog,
    startMacroRecording, stopMacroRecording, toggleMacroRecording, playMacro, playLastMacro,
    deleteMacro, renameMacro, deleteMacroStep, moveMacroStep, recordAction, recordTyping, recordKeyEvent,
    dispose: () => { flushTyping(); if (activeSession?.recordAction === recordAction) activeSession = null },
    /** 给菜单用的纯查询（匿名宏的显示名）。 */
    displayName: macroDisplayName, anonymousLabel: ANONYMOUS_MACRO_LABEL,
  }
}
