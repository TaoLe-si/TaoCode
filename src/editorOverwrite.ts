// 编辑器的**插入/覆盖模式**（上游 `EditorToggleInsertStateAction` + `EditorEx.setInsertMode`）。
//
// 覆盖模式是 CodeMirror 6 没有的能力，所以这一层是"用我们的架构还原功能"：
// 拦下用户输入的那一笔事务，把"插入"改写成"替换下一个字符"。
//
// 上游的分档（逐条核过）：
//   · `ToggleInsertStateAction`（`platform/platform-impl/src/com/intellij/openapi/editor/actions/
//     ToggleInsertStateAction.java:26`，Handler `:22-28`）：`editorex.setInsertMode(!editorex.isInsertMode())`
//     —— 每编辑器一个布尔。（键位是 263 打包键位表里的 INSERT，但**本仓的上游树里没有 `platform/keymaps`**，
//     `platform-resources/src/idea/DefaultKeymap.xml` 只有 5 行占位，所以那条键位行号**无法核实**。）
//   · `TypedHandler.java:180-183`：`if (!editor.isInsertMode()) { TypedCharImpl.typeChar(...); return }`
//     —— **非插入模式**走的是另一条打字路径。
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/TypedCharImpl.java:31-33`
//     的 `beforeCharTyped`（唯一调用点 `TypedHandler.java:110`）只有**两道**守卫：
//     ① `COMPLEX_CHARS`（`:23` 定义，`\n \t ( ) < > [ ] { } " '`）**永不覆盖** —— 它们照常插入，
//        否则打一个 `(` 会吃掉右边的字符；
//     ② `Character.isSurrogate(ch)`（代理对）也不走这条路径；多字符输入（粘贴、输入法上屏）同理。
//   · 可见指示不是状态栏组件（CE 里 `InsertOverwrite` 那个工厂 id 其实是**列选择**组件，
//     见 `intellij.platform.ide.impl.xml:1627`）—— 是**块状光标**：
//     `ImmediatePainter.java:164` 的 `isBlockCursor = editor.isInsertMode() == settings.isBlockCursor()`。
//     所以本仓的做法也照这条：覆盖模式把光标画成块，而不是加一个上游没有的芯片。

import { StateEffect, StateField, type ChangeSpec, type EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * `TypedCharImpl.COMPLEX_CHARS`（`platform/lang-impl/src/com/intellij/codeInsight/editorActions/
 * TypedCharImpl.java:23`）：这些字符在覆盖模式下**照常插入**，不覆盖右边的字符。
 * 逐字照抄（集合内容与书写顺序都与上游一致）—— 它们是结构性字符，吃掉右边那个往往正好是括号/引号的配对。
 */
export const COMPLEX_CHARS = new Set(['\n', '\t', '(', ')', '<', '>', '[', ']', '{', '}', '"', "'"])

/**
 * 覆盖模式下要不要把这一笔输入改写成替换。
 *
 * 三道判定与上游的对应关系（`TypedCharImpl.java:31-33` 只有前两道）：
 *   ① `length !== 1` —— 上游那一层的入参本来就是 `char`（单个 UTF-16 码元），
 *      多字符输入（粘贴、输入法上屏）根本进不来；本仓的 `inputHandler` 拿的是字符串，补这道。
 *   ② `COMPLEX_CHARS` —— 上游 `:31` 第一道守卫，逐字照抄（见上）。
 *   ③ `Character.isSurrogate` —— 上游 `:31` 第二道守卫。Java 的 `isSurrogate` 定义就是
 *      `0xD800..0xDFFF`，这里按同一区间写。
 */
export function shouldOverwrite(inserted: string): boolean {
  if (inserted.length !== 1) return false
  const ch = inserted
  if (COMPLEX_CHARS.has(ch)) return false
  const code = ch.charCodeAt(0)
  if (code >= 0xd800 && code <= 0xdfff) return false
  return true
}

/**
 * 把一笔"插入"改写成"替换"要用的改动描述。
 *
 * 三个前提都对才改写（与上游同语义）：① 覆盖模式开着；② 光标是**空选区**（有选区时先删选区，
 * 那种情况按普通插入处理也一样）；③ 插入的是一个普通字符。
 *
 * 返回 `null` = 不改写，照常插入。
 */
export function overwriteChange(state: EditorState, insertedText: string): ChangeSpec | null {
  if (!state.field(overwriteField, false)) return null
  if (!shouldOverwrite(insertedText)) return null
  // 只处理"单光标"这一种最普通的事务；多光标一律不动
  // （逐光标改写要自己维护偏移，收益极低而风险高）。
  if (state.selection.ranges.length !== 1) return null
  const range = state.selection.main
  if (!range.empty) return null
  const line = state.doc.lineAt(range.head)
  // 行尾（或文档末尾）没有可覆盖的字符 —— 照常插入，与上游"到行尾就只能追加"一致。
  if (range.head >= line.to) return null
  return { from: range.head, to: range.head + 1, insert: insertedText }
}

export const setOverwriteMode = StateEffect.define<boolean>()

/** 每个编辑器自己的覆盖开关（上游 `EditorEx` 的 `myInsertMode` 也是每编辑器一个）。 */
export const overwriteField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setOverwriteMode)) return effect.value
    return value
  },
})

/** 覆盖模式开着时给编辑器根加一个类（CSS 据此把光标画成块，见 `src/style.css`）。 */
function overwriteClass(): Extension {
  return EditorView.editorAttributes.compute([overwriteField], state => (state.field(overwriteField) ? { class: 'cm-overwrite' } : { class: '' }))
}

/**
 * 输入改写：用 `EditorView.inputHandler`（**CodeMirror 为这件事准备的钩子**）。
 *
 * 第一版用的是 `EditorState.transactionFilter` + 返回 `[tr, {changes}]` —— 真机上打一个字是
 * **插入**而不是覆盖：返回数组的语义是"这两笔都应用"，不是"改写原来那笔"。
 * `inputHandler` 才是那个口子：它在默认插入发生**之前**拿到 `(from, to, text)`，
 * 返回 true 就表示"这次输入我接管了"。
 *
 * 仍然只在"开覆盖 + 单字符普通字符 + 空选区 + 不在行尾"时接管，其余一律放行。
 */
function overwriteInputHandler(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    const state = view.state
    if (!state.field(overwriteField, false)) return false
    // 有选区（`from !== to`）或非空选区：交给默认插入（先删选区再插入）。
    if (from !== to || !state.selection.main.empty || state.selection.ranges.length !== 1) return false
    const change = overwriteChange(state, text)
    if (change === null) return false
    view.dispatch({ changes: change, userEvent: 'input.type', scrollIntoView: true })
    return true
  })
}

/** 切换覆盖模式；返回切换后的值（供状态栏/提示回显）。 */
export function toggleOverwrite(view: EditorView): boolean {
  const next = !view.state.field(overwriteField)
  view.dispatch({ effects: setOverwriteMode.of(next) })
  return next
}

/** 插进编辑器配置的那一组扩展。 */
export function overwriteExtension(): Extension {
  return [overwriteField, overwriteClass(), overwriteInputHandler()]
}

/** 覆盖模式下把光标画成块（上游的可见指示就是块光标，`ImmediatePainter.java:164`）。 */
export const overwriteTheme = EditorView.baseTheme({
  '&.cm-overwrite .cm-cursor': {
    borderLeft: 'none',
    width: '1ch',
    backgroundColor: 'var(--bright)',
    opacity: '0.65',
  },
})
