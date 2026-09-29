# 一次性脚本：把 App.vue 的「标签拖放」域搬到 src/tabDragDrop.ts
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\tabDragDrop.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a = next(i for i, l in enumerate(lines) if l.startswith("// IDEA's tab drag & drop: the strip itself is the drop target"))
b = next(i for i, l in enumerate(lines) if l.startswith("// IDEA's single-row tab strip (`ScrollableSingleRowLayout`")) - 1
assert (a, b) == (1004, 1098), (a + 1, b + 1)
block = lines[a:b + 1]
assert len(block) == 95, len(block)
assert block[-1].strip() == '}'
assert block[-2] == '  dropTabOnGroup(splitModel, (tab: Tab) => tab.path, dragged.pane, tab, pane)', block[-2]

ASSEMBLY = '''// 标签页的拖放是一个域（IDEA 的 TabbedPane 拖放 + TabsUtil 的拖到边缘即分屏）。
const {
  dragTab, tabDropSide, onTabDragStart, onTabDragOver, onStageDragOver, onStageDragLeave, onStageDrop,
  endTabDrag, onTabDrop, onTabStripDrop,
} = createTabDragDrop({
  editorSettings, groups, splitModel,
  // 惰性：`splitTabOut` 声明在本块之后（分栏动作的一部分）。
  splitTabOut: (...a) => splitTabOut(...a),
})'''

HEADER = '''// 标签页的拖放 —— 从 App.vue 搬出的一域（95 行，3 个依赖）。
//
// 判据：IDEA 把标签拖放分成两件事，但它们是同一次拖拽的**两条下落路径**，共享同一个"正在拖什么"
// 状态（`dragTab`），所以合成一域：
//   · 落在**标签条**上 → 在组内重排 / 换组（IDEA `TabsUtil.reorder`、`dropTabOnGroup`）；
//   · 落在**编辑区**边缘 → 按落点的梯形区域分屏（`TabsUtil.java:54-111`，落点判定在
//     src/tabDragSplit.ts，本模块只负责给预览和落盘）。
// `onStageDragLeave` 的存在是因为子元素会冒泡 dragleave，否则预览会闪。
// 标签条的**单行布局**（谁被挤到"…"里）是另一个域：src/tabStripLayout.ts + App.vue 里的测量循环。
import { ref } from 'vue'
import { dropTabOnGroup, swapGroups, type Pane, type SplitModel } from './editorGroups'
import { dropSideFor, dropSidePutsNewGroupFirst, splitOrientationForSide, updateBoundsWithDropSide, type DropSide } from './tabDragSplit'
import type { EditorSettings } from './bridge'
import type { Tab } from './editorTab'

export interface TabDragDropDeps {
  editorSettings: { readonly value: EditorSettings }
  /** 两个分栏组（宿主自持的编辑器模型）。 */
  groups: any
  splitModel: SplitModel
  /** 由分栏动作提供 —— 必须惰性调用。 */
  splitTabOut: (tab: Tab, orientation: 'horizontal' | 'vertical') => void
}

export function createTabDragDrop(deps: TabDragDropDeps) {
  const { editorSettings, groups, splitModel, splitTabOut } = deps
'''

FOOTER = '''
  return {
    dragTab, tabDropSide, onTabDragStart, onTabDragOver, onStageDragOver, onStageDragLeave, onStageDrop,
    endTabDrag, onTabDrop, onTabStripDrop,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(block) + FOOTER)

new_lines = lines[:a] + ASSEMBLY.split('\n') + lines[b + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
