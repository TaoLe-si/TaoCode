# 一次性脚本：把 App.vue 的「工具窗口布局」域搬到 src/toolLayouts.ts
# 区间 A = 352..371（存储键/默认顺序/工厂布局），B = 373..455（快照捕获/套用/命名/删除）。
# 372（`isLeftToolWindowId`）留在宿主：它是 `id is LeftViewId` 类型守卫，和宿主的 toolAnchors 类型同源。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\toolLayouts.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a1 = next(i for i, l in enumerate(lines) if l.startswith("const LAYOUT_STORAGE_KEY = 'taocode.toolWindowLayouts'"))
b1 = next(i for i, l in enumerate(lines) if l.startswith('function isLeftToolWindowId(id: string)')) - 1
a2 = b1 + 2
b2 = next(i for i, l in enumerate(lines) if l.startswith('// --- hide / cycle the tool windows')) - 1
assert (a1 + 1, b1 + 1, a2 + 1, b2 + 1) == (352, 371, 373, 455), (a1 + 1, b1 + 1, a2 + 1, b2 + 1)
assert lines[a1 + 1].startswith('/** The order the stripes start with')
assert lines[a2:].index('}') >= 0
r1 = lines[a1:b1 + 1]
r2 = lines[a2:b2 + 1]
assert len(r1) == 20 and len(r2) == 83, (len(r1), len(r2))
assert r2[-1] == '}' and 'deleteCurrentToolLayout' in '\n'.join(r2[-10:])

MOUNT = next(i for i, l in enumerate(lines) if l.startswith('const layoutMenuRows = computed<MenuRow[]>(() => {'))

ASSEMBLY = '''// 工具窗口的命名布局是一个域（IDEA 的 ToolWindowDefaultLayoutManager + LayoutsGroup 动作）。
const {
  LAYOUT_STORAGE_KEY, DEFAULT_TOOL_ORDER, BOTTOM_TABS, factoryToolLayout, toolLayoutStore, loadToolLayoutStore,
  persistToolLayouts, captureToolLayout, applyToolLayout, applyNamedToolLayout, useFactoryToolLayout,
  restoreCurrentToolLayout, storeCurrentToolLayout, openLayoutNameDialog, deleteCurrentToolLayout,
} = createToolLayouts({
  notify, menu, nameDialog, nameInput, explorer, bottom, leftView, bottomTab, panelSizes, toolAnchors, toolOrder,
  saveToolOrder, setPanelSize, isLeftToolWindowId,
})'''

HEADER = '''// 工具窗口的命名布局 —— 从 App.vue 搬出的一域（103 行，13 个依赖）。
//
// 判据：IDEA 的 `ToolWindowDefaultLayoutManager` 管着「命名快照 + 当前生效的名字」，对应
// `WindowMenu › LayoutsGroup` 那一组动作（PlatformActions.xml:641-651）：
//   默认布局 / <每个命名布局> / 恢复当前布局(Shift+F12) / 将更改保存到当前布局 / 另存为新布局…
//   / 重命名… / 删除当前布局。
// 本模块负责**读写活状态**：把当前停靠/顺序/尺寸拍成快照（`captureToolLayout`），把一份快照写回去
// （`applyToolLayout`，尺寸走 `setPanelSize` 所以和拖拽一样被 clamp，顺序走 `saveToolOrder` 所以会落盘）。
// 纯记账（增删改名、名字校验、工厂布局解析）在 src/toolLayout.ts，本模块只做胶水。
// `isLeftToolWindowId` 留在宿主：它是 `id is LeftViewId` 类型守卫，和宿主的 toolAnchors 类型同源。
import { nextTick, ref } from 'vue'
import { FACTORY_LAYOUT_NAME, deleteLayout, emptyLayoutStore, normalizeLayoutStore, renameLayout, resolveLayout,
         saveLayout, setActiveLayout, type ToolLayout, type ToolLayoutStore } from './toolLayout'
/** 宿主侧的两个视图 id 联合类型（`typeof leftView.value` / `typeof bottomTab.value`）；
 *  本模块只把它们当字符串用，所以在这里退化成 `string`。 */
type LeftViewId = string
type BottomTabId = string

export interface ToolLayoutsDeps {
  notify: (message: string, error?: boolean) => void
  menu: any
  nameDialog: any
  nameInput: any
  explorer: any
  bottom: any
  leftView: any
  bottomTab: any
  panelSizes: Record<string, number>
  /** 每个工具窗口的停靠侧。 */
  toolAnchors: Record<string, string>
  /** 每条磁贴的顺序（`Record<Anchor, ToolWindowId[]>`）。 */
  toolOrder: any
  /** 顺序变更后落盘（宿主自有）。 */
  saveToolOrder: () => void
  /** 恢复尺寸走这条通道，所以和用户拖拽一样被 clamp。 */
  setPanelSize: (panel: any, value: number) => void
  /** 宿主提供的类型守卫：`id in toolAnchors`。 */
  isLeftToolWindowId: (id: string) => boolean
}

export function createToolLayouts(deps: ToolLayoutsDeps) {
  const { notify, menu, nameDialog, nameInput, explorer, bottom, leftView, bottomTab, panelSizes, toolAnchors,
          toolOrder, saveToolOrder, setPanelSize, isLeftToolWindowId } = deps
'''

FOOTER = '''
  return {
    LAYOUT_STORAGE_KEY, DEFAULT_TOOL_ORDER, BOTTOM_TABS, factoryToolLayout, toolLayoutStore, loadToolLayoutStore,
    persistToolLayouts, captureToolLayout, applyToolLayout, applyNamedToolLayout, useFactoryToolLayout,
    restoreCurrentToolLayout, storeCurrentToolLayout, openLayoutNameDialog, deleteCurrentToolLayout,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(r1) + '\n' + '\n'.join(r2) + FOOTER)

new_lines = (lines[:a1] + lines[b1 + 1:a2] + lines[b2 + 1:MOUNT] + ASSEMBLY.split('\n') + lines[MOUNT:])
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('r1/r2:', len(r1), len(r2))
print('App.vue:', len(lines), '->', len(new_lines))
