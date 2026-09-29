# 一次性脚本：把 App.vue 的「编辑器文件级操作」域搬到 src/editorFileOps.ts
# 两段区间：R1 = 保存冲突（1930-1967），R2 = 快速文档/复制引用/文件属性/缩进/行尾/编码（1989-2122）。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\editorFileOps.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a1 = next(i for i, l in enumerate(lines) if l.startswith('const conflictPrompt = ref<{ path: string } | null>(null)'))
b1 = next(i for i, l in enumerate(lines) if l.startswith('async function saveAll() {')) - 1
a2 = next(i for i, l in enumerate(lines) if l.startswith("// IDEA's Quick Documentation (Ctrl+Q): fetches hover at the caret"))
b2 = next(i for i, l in enumerate(lines) if l.startswith('async function closeTab(tab: Tab) {')) - 1

assert (a1, b1, a2, b2) == (1929, 1966, 1988, 2121), (a1 + 1, b1 + 1, a2 + 1, b2 + 1)
assert lines[b1].strip() == '}' and lines[b2].strip() == '}'
assert 'resolveConflictKeep' in '\n'.join(lines[b1 - 6:b1 + 1])
assert 'applyEncodingChoice' in '\n'.join(lines[b2 - 11:b2 + 1])

r1 = lines[a1:b1 + 1]
r2 = lines[a2:b2 + 1]
assert len(r1) == 38 and len(r2) == 134, (len(r1), len(r2))

ASSEMBLY = '''// 编辑器的文件级操作是一个域（保存冲突 / 快速文档 / 复制引用 / 缩进 / 行尾 / 编码）。
const {
  conflictPrompt, conflictDiff, showConflictDiff, resolveConflictReload, resolveConflictKeep,
  quickDoc, showQuickDoc, closeQuickDoc, copyReference, showFileProperties,
  convertIndents, convertLineSeparators, encodingPrompt, encodingSelect, openEncoding,
  reloadWithEncoding, applyEncodingChoice,
} = createEditorFileOps({
  notify, isDesktop, active, findTab, editorFor, request, menu, editorSettings, bufferEpoch, lspReady,
  toggleReadOnly, buffer: () => bufferEpoch,
  // `treeMenu` 由文件树模块（装配在本块之后）自持 —— 用 getter/setter 共享同一份。
  treeMenu: { get value() { return treeMenu.value }, set value(v) { treeMenu.value = v } },
})'''

HEADER = '''// 编辑器的**文件级操作** —— 从 App.vue 搬出的一域（172 行，15 个依赖）。
//
// 判据：这一组动作都作用于「整个文件」而不是光标处的符号，而且都要**重读或重写磁盘**：
//   · 保存冲突（IDEA 的 `SaveDocument` 冲突对话框：预览差异 / 重新载入 / 保留内存版本）；
//   · 快速文档（Ctrl+Q，`HoverInfoComponent`）与复制引用（Ctrl+Alt+Shift+C，`CopyReferenceAction`）；
//   · 文件属性（IDEA 的 `FilePropertiesGroup` popup：只读那一项由文件树右键驱动）；
//   · 缩进转换（`ConvertIndentsGroup`）、行尾转换（`ConvertToWindows/UnixLineSeparatorsAction`）、
//     编码重读/改写保存（IDEA 的 `ReloadWithEncoding` / `ChangeFileEncoding`）。
// 共同点：改完都要把结果推回编辑器缓冲（`editorFor(...).setDraft`）并通知语言服务（`lsp.change`），
// 所以它们共享 `editorFor` / `request` 这两条链路，合成一域。
import { nextTick, ref } from 'vue'
import { encodingLabels, request, type DiffRow, type DocumentData, type EncodingKey, type LspHoverResult,
         type LspSymbolsResult } from './bridge'
import { buildDiffRows, generateUnifiedDiff } from './diffText'
import { errorMessage } from './errors'
import type { EditorHandle, Tab } from './editorTab'

export interface EditorFileOpsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  active: { readonly value: Tab | undefined }
  findTab: (path: string) => Tab | undefined
  editorFor: (path: string) => EditorHandle | undefined
  request: typeof request
  menu: any
  editorSettings: any
  bufferEpoch: any
  lspReady: { readonly value: boolean }
  /** 文件树右键的「切换只读」（`toggleReadOnly`）。 */
  toggleReadOnly: (path: string) => unknown
  /** 行尾转换后要整表重挂编辑器缓冲（宿主是 `ref`）。 */
  buffer: () => any
  /** 文件树右键菜单坐标（由文件树模块自持），只读它的 entry。 */
  treeMenu: { value: any }
}

export function createEditorFileOps(deps: EditorFileOpsDeps) {
  const { notify, isDesktop, active, findTab, editorFor, request, menu, editorSettings, bufferEpoch, lspReady,
          toggleReadOnly, treeMenu } = deps
'''

FOOTER = '''
  return {
    conflictPrompt, conflictDiff, showConflictDiff, resolveConflictReload, resolveConflictKeep,
    quickDoc, showQuickDoc, closeQuickDoc, copyReference, showFileProperties,
    convertIndents, convertLineSeparators, encodingPrompt, encodingSelect, openEncoding,
    reloadWithEncoding, applyEncodingChoice,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(r1) + '\n' + '\n'.join(r2) + FOOTER)

new_lines = lines[:a1] + ASSEMBLY.split('\n') + lines[b1 + 1:a2] + lines[b2 + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('r1/r2:', len(r1), len(r2))
print('App.vue:', len(lines), '->', len(new_lines))
