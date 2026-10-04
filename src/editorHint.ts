// IDEA 的轻量信息提示（`HintManagerImpl` / `HintManagerImpl.java:606-624`）——
// 「下一个高亮错误」这类操作在**光标行上方**弹的那一条，下一次按键 / 文本变化 / 滚动就消失。
//
// 从 `CodeEditor.vue` 拆出来（那个文件贴着机检上限）：这一段只依赖"当前编辑器"与"编辑器容器"
// 两个取值函数，与 CodeMirror 的其余扩展没有耦合。
//
// 三条上游语义：
//   · 位置在光标**上方**（`HintManagerImpl.java:611` 的 `Position.ABOVE`）；屏幕最上面那一行
//     上方没有空间，这时翻到该行**下方**，而不是被裁掉（本仓的等价处置）。
//   · `HIDE_BY_ANY_KEY`（`:619-621`）：下一次按键就收 —— 监听器**延后一拍**注册，
//     否则触发它的那一次按键自己就会把它收掉。
//   · `HIDE_BY_TEXT_CHANGE`（`:624`）：文本一变就收（调用方在 updateListener 里调 `hide`）。
import { nextTick, ref } from 'vue'
import type { EditorView } from '@codemirror/view'

export interface ErrorHint { text: string; style: Record<string, string> }

export interface HintController {
  /** 当前要显示的提示；`null` = 不显示。模板据此渲染那一条。 */
  hint: ReturnType<typeof ref<ErrorHint | null>>
  show: (text: string) => void
  hide: () => void
}

/**
 * `getView` / `getContainer` 传取值函数而不是实例：`CodeEditor` 的 `view` 在 `onMounted` 才赋值，
 * 而控制器要在 setup 期就建好。
 */
export function createHintController(getView: () => EditorView | undefined, getContainer: () => HTMLElement | undefined): HintController {
  const hint = ref<ErrorHint | null>(null)
  let keyListener: (() => void) | null = null
  function dropKeyListener() {
    if (keyListener) { window.removeEventListener('keydown', keyListener); keyListener = null }
  }
  function hide() {
    hint.value = null
    dropKeyListener()
  }
  function show(text: string) {
    const editor = getView()
    const box = getContainer()
    if (!editor || !box) return
    const coords = editor.coordsAtPos(editor.state.selection.main.head)
    if (!coords) return
    const rect = box.getBoundingClientRect()
    const top = coords.top - rect.top
    const style = { left: `${Math.round(coords.left - rect.left)}px` }
    // 上方放不下（26px 是那一行的可用高度）就翻到下方 —— 见文件头第二条。
    hint.value = { text, style: top >= 26 ? { ...style, bottom: `${Math.round(rect.height - top + 4)}px` } : { ...style, top: `${Math.round(coords.bottom - rect.top + 4)}px` } }
    dropKeyListener()
    keyListener = hide
    // 延后一拍注册：触发提示的那一次按键不能把自己收掉（上游同款处置）。
    void nextTick(() => { if (keyListener) window.addEventListener('keydown', keyListener, { once: true }) })
  }
  return { hint, show, hide }
}
