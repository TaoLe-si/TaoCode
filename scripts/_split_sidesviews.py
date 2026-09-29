# 一次性脚本：把 App.vue 的「Markdown 预览 + 文件树刷新/定位/面包屑」搬到 src/editorSideViews.ts
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\editorSideViews.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a = next(i for i, l in enumerate(lines) if l.startswith("// IDEA's Markdown preview: a split beside the editor"))
b = next(i for i, l in enumerate(lines) if l.startswith('// 文件树与标签的上下文操作是一个域')) - 1
assert (a + 1, b + 1) == (1369, 1411), (a + 1, b + 1)
block = lines[a:b + 1]
assert len(block) == 43, len(block)
assert 'toggleMarkdownPreview' in '\n'.join(block) and 'openBreadcrumb' in '\n'.join(block[-8:])

ASSEMBLY = '''// 编辑器侧视图（Markdown 预览）与项目视图定位是一个域。
const {
  markdownTimer, refreshMarkdownNow, refreshMarkdownSoon, toggleMarkdownPreview,
  refreshTree, selectInTree, openBreadcrumb,
} = createEditorSideViews({
  notify, workspace, busy, treeVersion, active, activePath, editorFor, findTab, explorer, leftView, fileTreeRef,
  markdownPreviewOn, markdownCapable, markdownSource,
  // 惰性：`refreshSyntheticNodes` 由工作区生命周期模块提供（装配在本块之后）。
  refreshSyntheticNodes: (...a) => refreshSyntheticNodes(...a),
})'''

HEADER = '''// 编辑器侧视图与项目视图定位 —— 从 App.vue 搬出的一域（43 行，15 个依赖）。
//
// 判据：这一组都在回答同一个问题 —— 「当前文件变了，旁边那些视图怎么跟上」：
//   · Markdown 预览（IDEA 的 Markdown 预览编辑器）：只对 `.md` 生效，跟随实时文本，
//     300ms 防抖（`markdownTimer`），切换文件时自动收起；
//   · 文件树刷新（`refreshTree`：重列根目录 + 重建合成节点）；
//   · 「在项目中定位」（`SelectInProjectView`）与面包屑点击 —— 两者都是"打开左栏 → 定位到某个路径"。
// 它们共享 `active` / `activePath` / `fileTreeRef`，所以合成一域。
// 文件树的**右键动作**在 src/treeActions.ts；这里只有"刷新与定位"。
import { ref, watch } from 'vue'
import { request, type Entry } from './bridge'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

export interface EditorSideViewsDeps {
  notify: (message: string, error?: boolean) => void
  workspace: any
  busy: any
  treeVersion: any
  active: { readonly value: Tab | undefined }
  activePath: { readonly value: string }
  editorFor: (path: string) => any
  findTab: (path: string) => Tab | undefined
  explorer: any
  leftView: any
  fileTreeRef: any
  /** Markdown 预览的三个状态（宿主更早的阶段就要读它们，所以留在宿主）。 */
  markdownPreviewOn: any
  markdownCapable: { readonly value: boolean }
  markdownSource: any
  /** 工作区生命周期模块提供 —— 惰性。 */
  refreshSyntheticNodes: () => unknown
}

export function createEditorSideViews(deps: EditorSideViewsDeps) {
  const { notify, workspace, busy, treeVersion, active, activePath, editorFor, findTab, explorer, leftView,
          fileTreeRef, markdownPreviewOn, markdownCapable, markdownSource, refreshSyntheticNodes } = deps
'''

FOOTER = '''
  return {
    markdownTimer, refreshMarkdownNow, refreshMarkdownSoon, toggleMarkdownPreview,
    refreshTree, selectInTree, openBreadcrumb,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(block) + FOOTER)

new_lines = lines[:a] + ASSEMBLY.split('\n') + lines[b + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
