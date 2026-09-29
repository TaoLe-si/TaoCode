# 一次性脚本：把 App.vue 的「编辑区分栏 + 标签页开关」域搬到 src/editorSplits.ts
# 两段区间：R1 = 分栏动作..closeTabIn（含 closedTabsPerPane/ClosedTab），R2 = reopenClosedTab..moveTabToOtherPane。
# 中间夹着崩溃恢复模块的装配（sessionSnapshot），原地留下。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\editorSplits.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a1 = next(i for i, l in enumerate(lines) if l.startswith('function otherPane(pane: Pane): Pane'))
b1 = next(i for i, l in enumerate(lines) if l.startswith('interface ClosedTab {'))
a2 = next(i for i, l in enumerate(lines) if l.startswith('// ReopenClosedTabAction (Windows/Linux default: Ctrl+Shift+F4)'))
b2 = next(i for i, l in enumerate(lines) if l.startswith('// 标签页的拖放是一个域')) - 1

assert (a1 + 1, b1 + 1, a2 + 1, b2 + 1) == (873, 946, 967, 1008), (a1 + 1, b1 + 1, a2 + 1, b2 + 1)
r1 = lines[a1:b1 + 1]
r2 = lines[a2:b2 + 1]
assert len(r1) == 74 and len(r2) == 42, (len(r1), len(r2))
assert r1[-1].startswith('interface ClosedTab') and r1[-2].startswith('const closedTabsPerPane') and r2[-1] == '}'
assert 'closeTabIn' in '\n'.join(r1[-16:]) and 'moveTabToOtherPane' in '\n'.join(r2[-17:])

ASSEMBLY = '''// 编辑区的分栏与标签页开关是一个域（IDEA 的 SplitterAction + EditorWindow 标签页生命周期）。
const {
  otherPane, focusPane, splitTabOut, toggleSplit, unsplit, unsplitAll, splitFromTabMenu, openInOppositeGroup,
  keepTabOpen, switchTabIn, editorHistory, touchHistory, enforceTabLimit, closeTabIn,
  closedTabsPerPane, reopenClosedTab, setSplitOrientation, moveTabToOtherPane,
} = createEditorSplits({
  notify, splitModel, groups, active, activePath, findTab, editorFor, openFile, reveal, focusedPane, tabMenu,
  editorSettings, working, hasTabPath, rememberRecent, rememberPlace, bufferEpoch,
  // 惰性：这三个来自本块之后装配/声明的模块（LSP 模块、工作区生命周期模块）。
  stopLspFile: (...a) => stopLspFile(...a),
  confirmLeave: (...a) => confirmLeave(...a),
})'''

HEADER = '''// 编辑区的分栏与标签页开关 —— 从 App.vue 搬出的一域（116 行，18 个依赖）。
//
// 判据：IDEA 里"多开一个编辑区"和"标签页什么时候消失"是同一条链路上的事，TaoCode 也一样：
//   · 分栏：`splitTabOut` / `toggleSplit` / `unsplit` / `unsplitAll` / `splitFromTabMenu` /
//     `openInOppositeGroup` / `setSplitOrientation` / `moveTabToOtherPane`
//     （SplitterAction + OpenEditorInOppositeTabGroup），纯模型变换在 src/editorGroups.ts；
//   · 标签页生命周期：`switchTabIn`（预览标签页的晋升）、`enforceTabLimit`
//     （IDEA `EditorHistoryManager.fileList` + `tabClosingOrder` 的关闭顺序，tabLimit 设置）、
//     `closeTabIn`（`EditorWindow.removedTabs`：记住位置好还原）、`reopenClosedTab`
//     （ReopenClosedTabAction，Ctrl+Shift+F4）。
// 两者共享 `splitModel` / `groups` / `closedTabsPerPane` —— 关一个标签会改分栏状态，
// 分栏又会改标签归属，拆开就是两份互相写对方状态的代码。
// 崩溃恢复（src/sessionSnapshot.ts）的装配夹在中间，但它属于另一个域，留在宿主。
import { computed, reactive, ref, type Ref } from 'vue'
import { closeTabInPane, splitTabOutIn, tabClosingOrder, unsplitAllModel, unsplitModel, type Pane, type SplitModel } from './editorGroups'
import type { EditorSettings } from './bridge'
import type { Tab } from './editorTab'

/** IDEA `EditorWindow.removedTabs` 的一项：关掉的标签 + 它原来的位置。 */
export interface ClosedTab { path: string; line: number; index: number }

export interface EditorSplitsDeps {
  notify: (message: string, error?: boolean) => void
  splitModel: SplitModel<any>
  groups: any
  active: { readonly value: Tab | undefined }
  activePath: any
  findTab: (path: string) => Tab | undefined
  editorFor: (path: string) => any
  /** 重新打开关闭的标签（编辑器骨架提供）。 */
  openFile: (path: string) => unknown
  reveal: any
  focusedPane: { readonly value: Pane }
  /** 标签右键菜单坐标（文件树模块自持）。 */
  tabMenu: any
  editorSettings: Ref<EditorSettings>
  working: { readonly value: boolean }
  hasTabPath: (path: string) => boolean
  /** 最近文件列表（文件树模块提供）。 */
  rememberRecent: (path: string) => void
  /** 最近位置环（宿主自持）。 */
  rememberPlace: (place: any) => void
  /** 语言服务文档的生命周期（LSP 模块提供）—— 惰性。 */
  stopLspFile: (path: string) => void
  /** 未保存确认（工作区生命周期模块提供）—— 惰性。 */
  confirmLeave: (title: string, scope?: Tab[]) => Promise<boolean>
  bufferEpoch: any
}

export function createEditorSplits(deps: EditorSplitsDeps) {
  const { notify, splitModel, groups, active, activePath, findTab, editorFor, openFile, reveal, focusedPane, tabMenu,
          editorSettings, working, hasTabPath, rememberRecent, rememberPlace, stopLspFile, confirmLeave,
          bufferEpoch } = deps
'''

FOOTER = '''
  return {
    otherPane, focusPane, splitTabOut, toggleSplit, unsplit, unsplitAll, splitFromTabMenu, openInOppositeGroup,
    keepTabOpen, switchTabIn, editorHistory, touchHistory, enforceTabLimit, closeTabIn,
    closedTabsPerPane, reopenClosedTab, setSplitOrientation, moveTabToOtherPane,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(r1) + '\n' + '\n'.join(r2) + FOOTER)

new_lines = lines[:a1] + ASSEMBLY.split('\n') + lines[b1 + 1:a2] + lines[b2 + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('r1/r2:', len(r1), len(r2))
print('App.vue:', len(lines), '->', len(new_lines))
