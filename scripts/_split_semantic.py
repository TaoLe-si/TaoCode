# 一次性脚本：把 App.vue 的「语义动作」域搬到 src/semanticActions.ts
# 安全规程见 skill: scripted-refactor-safety —— 锚点必须唯一，数量断言失败即中止。
import io, sys

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\semanticActions.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

START_ANCHOR = "async function onSemantic(payload: { kind: 'rename'"
END_ANCHOR = "// Code Vision（LSP `codeLens`）的点击"

assert text.count(START_ANCHOR) == 1, ('start anchor not unique', text.count(START_ANCHOR))
assert text.count(END_ANCHOR) == 1, ('end anchor not unique', text.count(END_ANCHOR))

start = next(i for i, l in enumerate(lines) if l.startswith(START_ANCHOR))
end = next(i for i, l in enumerate(lines) if l.startswith(END_ANCHOR))
assert end > start, 'end before start'
assert start == 1960, ('unexpected start line', start + 1)
block = lines[start:end]
assert block[-1].strip() == '}', ('block does not end with a closing brace', block[-1])
assert 'jumpDebugLocation' in '\n'.join(block[-6:]), 'tail is not jumpDebugLocation'

# 行数自检：这一刀应当搬走 264 行
assert len(block) == 264, ('unexpected block size', len(block))

ASSEMBLY = '''// 代码洞察的语义动作是一个域：`onSemantic` 是编辑器 `@semantic` 的唯一入口，它分发到的
// 重命名/格式化/签名帮助/代码动作/层级视图共享同一批弹窗状态（`signaturePopup` / `batchFixBusy`）。
// 审阅入口：src/semanticActions.ts。
const {
  signaturePopup, closeSignaturePopup, navigateSignature, batchFixBusy, fixAllInFile,
  onSemantic, runFormatting, runSignature, openCodeActions, caretPayload, runOrganizeImports,
  applyCodeAction, renameEntryWithReferences, applyEditsToFiles, submitRename, applyRename,
  toggleOutline, jumpDebugLocation,
} = createSemanticActions({
  notify, isDesktop, generalSettings, workspace: () => workspace.value, active, activePath, findTab, editorFor,
  lspOn, lspReady, save, references, codeActions, actionPrompt, renamePrompt, renameValue, renameInput, invalidRenameName,
  baseName,
  // 惰性：这些能力的声明都在本块之后（层级视图模块、底部面板、标签标题），两条依赖互为上下游。
  prepareHierarchy: (...a) => prepareHierarchy(...a),
  showOutput: (...a) => showOutput(...a),
  refreshOutline: (...a) => refreshOutline(...a),
  revealLocation: (...a) => revealLocation(...a),
  retitleTab: (...a) => retitleTab(...a),
})'''

HEADER = '''// 代码洞察的语义动作 —— 从 App.vue 搬出的一域（264 行，31 个依赖）。
//
// 判据：编辑器把光标处的语义请求统一发成 `@semantic` 事件，`onSemantic` 是唯一入口，它分发到
// 「重命名 / 格式化 / 签名帮助 / 代码动作 / 引用与实现 / 调用与类型层级」。这些动作彼此耦合：
// 快速修复要复用套用编辑、重命名要复用 `applyEditsToFiles`、批量修复要复用 `applyCodeAction`，
// 所以它们是一个域而不是六个模块。层级视图的**展示**在 src/hierarchyView.ts，这里只负责
// `prepareHierarchy` 的触发。
import { computed, nextTick, type Ref } from 'vue'
import { lspDiagnostics, request, type DocumentData, type GeneralSettingsState, type LspCodeAction, type LspCodeActionResults,
         type LspExecuteCommandResult, type LspFileEdits, type LspFormatResult, type LspLocation, type LspPrepareRenameResult,
         type LspRange, type LspReferencesResult, type LspRenameResult, type LspSignatureHelpResult, type SaveResult, type Workspace } from './bridge'
import { applyTextEdits, wordAt } from './editorText'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

export interface SemanticActionsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  generalSettings: Ref<GeneralSettingsState>
  /** 宿主是 `Ref<Workspace | null>`；本模块只读它的存在性，用 getter 取。 */
  workspace: () => Workspace | null
  active: { readonly value: Tab | undefined }
  activePath: Ref<string>
  findTab: (path: string) => Tab | undefined
  editorFor: (path: string) => any
  /** 语言服务在这条文件上是否可用（PowerSaveMode / 大小 / 是否在跑）。 */
  lspOn: (tab: Tab) => boolean
  lspReady: { readonly value: boolean }
  save: (tab?: Tab) => Promise<boolean>
  references: Ref<LspLocation[]>
  codeActions: Ref<LspCodeAction[]>
  actionPrompt: Ref<{ path: string } | null>
  renamePrompt: Ref<{ path: string; line: number; character: number; current: string } | null>
  renameValue: Ref<string>
  renameInput: Ref<HTMLInputElement | undefined>
  /** IDEA `RenameInputValidator`：空串表示名字合法。 */
  invalidRenameName: { readonly value: string }
  baseName: (path: string) => string
  /** 下面五个由更晚装配的模块/函数提供 —— 必须惰性调用，否则命中 TDZ。 */
  prepareHierarchy: (kind: 'call' | 'type', payload: { path: string; line: number; character: number }) => unknown
  showOutput: (id: 'references' | 'hierarchy') => void
  refreshOutline: (path: string) => unknown
  revealLocation: (target: { path: string; line: number; column?: number }) => unknown
  retitleTab: (from: string, to: string) => unknown
}

export function createSemanticActions(deps: SemanticActionsDeps) {
  const { notify, isDesktop, generalSettings, active, activePath, findTab, editorFor, lspOn, lspReady, save,
          references, codeActions, actionPrompt, renamePrompt, renameValue, renameInput, invalidRenameName,
          baseName, prepareHierarchy, showOutput, refreshOutline, revealLocation, retitleTab } = deps
'''

FOOTER = '''
  return {
    signaturePopup, closeSignaturePopup, navigateSignature, batchFixBusy, fixAllInFile,
    onSemantic, runFormatting, runSignature, openCodeActions, caretPayload, runOrganizeImports,
    applyCodeAction, renameEntryWithReferences, applyEditsToFiles, submitRename, applyRename,
    toggleOutline, jumpDebugLocation,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(block) + FOOTER)

new_lines = lines[:start] + ASSEMBLY.split('\n') + lines[end:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('block lines:', len(block))
print('App.vue:', len(lines), '->', len(new_lines))
print('module:', len(HEADER.split('\n')) + len(block) + len(FOOTER.split('\n')))
