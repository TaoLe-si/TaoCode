# 一次性脚本：把 App.vue 的「标签条单行布局」域搬到 src/tabStripView.ts
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\tabStripView.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a = next(i for i, l in enumerate(lines) if l.startswith("// IDEA's single-row tab strip (`ScrollableSingleRowLayout`"))
b = next(i for i, l in enumerate(lines) if l.startswith("// IDEA maps a file to its type by extension")) - 1
assert (a + 1, b + 1) == (1015, 1110), (a + 1, b + 1)
block = lines[a:b + 1]
assert len(block) == 96, len(block)
assert block[-1] == '}, { immediate: true })' and 'observeTabStrips()' in '\n'.join(block[-12:]), block[-1]

ASSEMBLY = '''// 标签条的单行布局是一个域（IDEA 的 ScrollableSingleRowLayout：装不下的标签落到「…」里）。
const {
  tabNaturalWidths, tabStripLayouts, tabMoreButtonWidth, tabMore, registerTabStrip, tabKeyOf,
  measureTabNaturalWidth, recomputeTabStrip, placedTabFor, isTabDropped, tabWidthStyle, hiddenTabsFor,
  openTabMore, observeTabStrips,
} = createTabStripView({ groups, splitSize, splitOrientation: () => splitOrientation.value })'''

HEADER = '''// 标签条的**单行布局** —— 从 App.vue 搬出的一域（96 行，4 个依赖）。
//
// 判据：IDEA 的 `ScrollableSingleRowLayout`（JBTabsImpl.kt:766-772）把"一行放不下"处理成
// 「先裁切、再把裁掉的塞进 `…` 按钮」。算法本身在 src/tabStripLayout.ts（纯函数，可单测），
// 这个模块只做**测量与缓存**那一半：
//   · `measureTabNaturalWidth` 按 `TabLabel.getPreferredSize()` 的方式量自然宽度，
//     并且必须先清掉我们刚写上去的宽度再量（否则量到的是自己设的值），量到 0 不缓存；
//   · `recomputeTabStrip` 收集首选宽度 + 标签条宽度 + 工具条宽度，喂给 `layoutSingleRow`；
//   · `observeTabStrips` 用 ResizeObserver 跟着窗口/分栏尺寸重算。
// 拖放是另一个域（src/tabDragDrop.ts）；这里只读 `groups` 与分栏尺寸。
import { ref, watch } from 'vue'
import { MIN_TAB_WIDTH, layoutSingleRow, preferredTabWidth, type TabStripLayout } from './tabStripLayout'
import type { Tab } from './editorTab'

export interface TabStripViewDeps {
  /** 两个分栏组（宿主自持的编辑器模型）。 */
  groups: any
  /** 分栏宽度与方向：标签条宽度变化时要重算。 */
  splitSize: { readonly value: number }
  splitOrientation: () => string
}

export function createTabStripView(deps: TabStripViewDeps) {
  const { groups, splitSize, splitOrientation } = deps
'''

FOOTER = '''
  return {
    tabNaturalWidths, tabStripLayouts, tabMoreButtonWidth, tabMore, registerTabStrip, tabKeyOf,
    measureTabNaturalWidth, recomputeTabStrip, placedTabFor, isTabDropped, tabWidthStyle, hiddenTabsFor,
    openTabMore, observeTabStrips,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(block) + FOOTER)

new_lines = lines[:a] + ASSEMBLY.split('\n') + lines[b + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
