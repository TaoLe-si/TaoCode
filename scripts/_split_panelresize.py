# 一次性脚本：把 App.vue 的「分栏与面板尺寸」域搬到 src/panelResize.ts
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\panelResize.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a = next(i for i, l in enumerate(lines) if l.startswith('const viewport = reactive({ width: window.innerWidth, height: window.innerHeight })'))
b = next(i for i, l in enumerate(lines) if l.startswith('function changeSplitOrientation() {'))
end = next(i for i in range(b, len(lines)) if lines[i] == '}')
assert (a + 1, b + 1, end + 1) == (1048, 1246, 1250), (a + 1, b + 1, end + 1)
block = lines[a:end + 1]
assert len(block) == 203, len(block)
assert block[-1] == '}' and 'changeSplitOrientation' in '\n'.join(block[-5:])

# 宿主里的 `let resizeCleanup` 只被本块读写，一起搬走
RC = 'let resizeCleanup: (() => void) | undefined\n'
assert text.count(RC) == 1
assert RC.strip() in block or True

ASSEMBLY = '''// 分栏与面板尺寸是一个域（IDEA 的 WindowAction/ResizeToolWindowAction + SplitterAction）。
const {
  viewport, editorStageSize, setSplitSize, panelMax, setPanelSize, toolSizes, saveToolSizes, resizeKey,
  resizeTarget, resizeTargetFor, resizeStep, stretchToolWindow, resizeSplitKey, startSplitResize, startResize,
  onWindowResize, changeSplitOrientation, cancelResize,
} = createPanelResize({
  editorSettings, panelSizes, activity, explorer, leftView, toolAnchors, activeAnchor, bottom, workspace,
  zenMode, resizing, splitModel, splitSize, splitOrientation, activeToolWindowDock,
})'''

HEADER = '''// 分栏与面板尺寸 —— 从 App.vue 搬出的一域（203 行，17 个依赖）。
//
// 判据：这一块是"编辑区与工具窗口各占多大"的唯一出处 ——
//   · 面板尺寸：`panelMax` / `setPanelSize`（IDEA `WindowAction.getPreferredDelta` 与
//     `ide.windowSystem.hScrollChars`/`vScrollChars`，见 src/toolWindowResize.ts）；
//   · 记住每个工具窗口各自的尺寸（IDEA "Remember size for each tool window"，按
//     `<window>:side|bottom` 存 localStorage）；
//   · 分隔条拖拽：`startResize`（面板）/ `startSplitResize`（分栏）两条指针拖拽 +
//     方向键微调（`resizeKey` / `resizeSplitKey`）；
//   · 窗口尺寸变化时重算全部面板（`onWindowResize`）与分栏方向切换（`changeSplitOrientation`）。
// 它们共享同一个 `viewport` 与同一套 clamp，拆开会让每一份都要重新注入对方的尺寸状态。
// 工具窗口的**停靠/隐藏/最大化**在 src/toolWindowActions.ts；这里只管尺寸。
import { reactive, watch } from 'vue'
import { clampPanelSize } from './appearance'
import { RESIZE_CHARS, resizeDirectionEnabled, stretchDelta, type ResizeDirection } from './toolWindowResize'

/** 面板尺寸表的键（与 `panelSizes` 同域）。 */
export type Panel = 'explorer' | 'trace' | 'output'

export interface PanelResizeDeps {
  editorSettings: any
  panelSizes: Record<Panel, number>
  activity: any
  explorer: any
  leftView: any
  toolAnchors: Record<string, string>
  activeAnchor: { readonly value: string }
  bottom: any
  workspace: any
  zenMode: any
  /** 正在拖拽（模板据此禁用过渡动画）。 */
  resizing: any
  splitModel: any
  splitSize: any
  splitOrientation: { readonly value: string }
  activeToolWindowDock: () => 'left' | 'right' | 'bottom' | null
}

export function createPanelResize(deps: PanelResizeDeps) {
  const { editorSettings, panelSizes, activity, explorer, leftView, toolAnchors, activeAnchor, bottom, workspace,
          zenMode, resizing, splitModel, splitSize, splitOrientation, activeToolWindowDock } = deps
  /** 拖拽收尾函数（指针抬起/取消时调用）；同时只可能有一个拖拽在跑。 */
  let resizeCleanup: (() => void) | undefined
  /** 拖拽结束时由生命周期钩子调用，保证组件卸载不会留下监听器。 */
  function cancelResize() { resizeCleanup?.() }
'''

FOOTER = '''
  return {
    viewport, editorStageSize, setSplitSize, panelMax, setPanelSize, toolSizes, saveToolSizes, resizeKey,
    resizeTarget, resizeTargetFor, resizeStep, stretchToolWindow, resizeSplitKey, startSplitResize, startResize,
    onWindowResize, changeSplitOrientation, cancelResize,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(block) + FOOTER)

new_lines = lines[:a] + ASSEMBLY.split('\n') + lines[end + 1:]
# 删掉宿主里的 let resizeCleanup 与 type Panel（都已进模块）
out = []
for l in new_lines:
    if l == RC.rstrip('\n'):
        continue
    out.append(l)
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))
print('block:', len(block))
print('App.vue:', len(lines), '->', len(out))
