// 合并冲突的**宿主动作 + 状态域**（上游 `MergeThreesideViewer.java:333-336` 的那两个按钮在此的落点）。
//
// 从 `CodeEditor.vue` 拆出来（那个文件贴着机检上限）：这里吃一个 view 取值函数，
// 与组件状态无关 —— 与 `src/editorOverwrite.ts` / `src/editorHint.ts` 同一种拆法。
//
// **清单取实时文档，不取 props.content**：父级的 `tab.content` 只在读盘/存盘时更新，
// 编辑期间一直是打开时那一份（真机抓到过：接受了一侧，缓冲区对了，条上的计数还停在 2/2）。
import { ref } from 'vue'
import type { EditorView } from '@codemirror/view'
import { acceptSide, conflictsIn, nextConflict, parseConflicts, type Conflict } from './mergeConflicts.ts'

/** 光标所在的 0 基行号。 */
function caretLine(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number - 1
}

/** 把光标放到某一行（0 基，越界夹到文档内）。 */
function putCaretOnLine(view: EditorView, line: number) {
  const doc = view.state.doc
  const anchor = doc.line(Math.min(Math.max(1, line + 1), doc.lines)).from
  view.dispatch({ selection: { anchor }, scrollIntoView: true })
}

/**
 * 接受某一侧：用整段替换那一处冲突（含四个标记）。
 * 每次接受都**重新解析** —— 标记没了，后面各条的行号也跟着变。
 */
function acceptIn(view: EditorView, side: 'left' | 'right') {
  const text = view.state.doc.toString()
  const conflicts = parseConflicts(text)
  const line = caretLine(view)
  const target = conflicts.find(conflict => line >= conflict.startLine && line <= conflict.endLine) ?? conflicts[0]
  if (!target) return
  const next = acceptSide(text, target, side)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
  putCaretOnLine(view, target.startLine)
}

/** 上一个/下一个冲突（走完一圈回绕）。 */
function jumpIn(view: EditorView, backwards: boolean) {
  const target = nextConflict(parseConflicts(view.state.doc.toString()), caretLine(view), backwards)
  if (target) putCaretOnLine(view, target.startLine)
}

/**
 * 合并冲突导航条（`MergeBar`）的宿主状态域：清单 + 那两个动作。
 * 初始值取打开时那份内容 —— 冲突标记在文件里时，一开标签就该在。
 */
export function createMergeState(getView: () => EditorView | undefined, initialContent: string) {
  const conflicts = ref<Conflict[]>(conflictsIn(initialContent))
  return {
    conflicts,
    /** 文档一变就从实时文档重算（开销与 findBar.refresh 同档：一次遍历而已）。 */
    refresh: (text: string) => { conflicts.value = conflictsIn(text) },
    accept: (side: 'left' | 'right') => { const view = getView(); if (view) acceptIn(view, side) },
    jump: (backwards: boolean) => { const view = getView(); if (view) jumpIn(view, backwards) },
  }
}
