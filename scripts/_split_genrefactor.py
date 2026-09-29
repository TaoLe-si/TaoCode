# 一次性脚本：把 App.vue 的「生成 / 重构 / 文件移动」域搬到 src/generateRefactor.ts
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\generateRefactor.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a = next(i for i, l in enumerate(lines) if l.startswith('function copyFilePath() {'))
b = next(i for i, l in enumerate(lines) if l.startswith('function parentOf(path: string)')) - 1
assert (a + 1, b + 1) == (1797, 1893), (a + 1, b + 1)
block = lines[a:b + 1]
assert len(block) == 97, len(block)
assert block[-1].startswith("function inlineVariable()")
assert 'copyFilePath' in block[0] and 'GENERATE_WORDS' in '\n'.join(block)

ASSEMBLY = '''// 生成 / 重构 / 文件移动是一个域（IDEA 的 Generate 菜单 + Refactor 菜单）。
const {
  copyFilePath, moveActiveFile, copyActiveFile, openGeneratePopup,
  refactorTitles, runRefactorFlow, extractVariable, extractConstant, extractMethod, inlineVariable,
} = createGenerateRefactor({
  notify, isDesktop, workspace, active, editorFor, lspReady, request, parentOf, baseName, refreshTree,
  renameEntryWithReferences, copyCollisionName, codeActions, actionPrompt, applyCodeAction,
})'''

HEADER = '''// 生成 / 重构 / 文件移动 —— 从 App.vue 搬出的一域（97 行，15 个依赖）。
//
// 判据：IDEA 的 Generate（Alt+Insert）和 Refactor（Ctrl+Alt+Shift+T / F5 / F6）在 TaoCode 里
// 走的是**同一条** Alt+Enter 代码动作通道，只是过滤条件不同：
//   · 生成：`action.kind` 以 `source` 开头，或标题命中 GENERATE_WORDS（构造器/getter/toString…）；
//   · 提取/内联：`action.kind` 以 `refactor` 开头，再按 `refactorTitles` 命中目标动作；
//   · 文件级：复制路径 / 移动文件（F6）/ 复制文件（F5）—— 移动要顺带改引用（`willRenameFiles`）。
// 它们共享 `codeActions` + `actionPrompt` 两个弹窗状态与 `applyCodeAction` 这一条套用链路，
// 拆开会让每一半都要重新注入对方的弹窗状态。`parentOf` / `baseName` 是全局工具函数，留在宿主。
import { request, lspDiagnostics, type LspCodeAction, type LspCodeActionResults } from './bridge'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

export interface GenerateRefactorDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  workspace: any
  active: { readonly value: Tab | undefined }
  editorFor: (path: string) => any
  lspReady: { readonly value: boolean }
  request: typeof request
  parentOf: (path: string) => string
  baseName: (path: string) => string
  refreshTree: () => unknown
  /** 移动文件时要顺带更新引用（语义动作模块提供）。 */
  renameEntryWithReferences: (from: string, to: string) => unknown
  /** 「X copy.ext」去重命名（文件树模块提供）。 */
  copyCollisionName: (existing: (name: string) => boolean, name: string) => string
  codeActions: { value: LspCodeAction[] }
  actionPrompt: { value: { path: string } | null }
  /** Alt+Enter 里套用一条代码动作（语义动作模块提供）。 */
  applyCodeAction: (action: LspCodeAction) => Promise<void>
}

export function createGenerateRefactor(deps: GenerateRefactorDeps) {
  const { notify, isDesktop, workspace, active, editorFor, lspReady, request, parentOf, baseName, refreshTree,
          renameEntryWithReferences, copyCollisionName, codeActions, actionPrompt, applyCodeAction } = deps
'''

FOOTER = '''
  return {
    copyFilePath, moveActiveFile, copyActiveFile, openGeneratePopup,
    refactorTitles, runRefactorFlow, extractVariable, extractConstant, extractMethod, inlineVariable,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(block) + FOOTER)

new_lines = lines[:a] + ASSEMBLY.split('\n') + lines[b + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
