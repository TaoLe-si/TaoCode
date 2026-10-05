// 更改签名（Ctrl+F6）的**编排层** —— 把 `src/refactorSignature.ts` 的纯模型接到本仓的编辑器、
// 工作区读取与重构预览链路上。上游对应物是
// `platform/lang-impl/src/com/intellij/refactoring/changeSignature/ChangeSignatureDialogBase.java`
// （建模型/校验/造 processor 三段）+ `JavaChangeSignatureHandler`（入口检查）。
// 键位：`platform/platform-resources/src/keymaps/$default.xml:469-471`
// （`:469` `<action id="ChangeSignature">` + `:470` `first-keystroke="control F6"`）。
// 出厂键位表 `src/keymapBindings.ts` 与分派表 `src/keymap.ts` 都在保留文件里（本桶只读），
// 那两条的粘贴内容写在 `docs/wiring-requests-2026-10-06-bucket1b.md` A1/A2 ——
// 接上之前这一条动作只有菜单入口（且菜单行按能力渲染，宿主没给 `openChangeSignature` 就不出现）。
//
// **本仓用什么承接了上游的什么**：
//   · 上游 `PsiChangeSignatureHandler.findMethodToChangeSignature` 用 PSI 定位方法
//     → 本仓 `parseSignature(text, offset, language)`（文本层声明头判定，见那边的说明）。
//   · 上游 `ChangeSignatureProcessor` 靠 `JavaChangeSignatureUsageSearcher` 找调用点
//     → 本仓 `scanCallSites`：打开的缓冲区 + 工作区源文件的**文本扫描**（跳过注释/字符串，
//       复用 `src/nonCodeUsages.ts` 的 `nonCodeRanges`）。这是文本级近似，与上游 PSI 找到的集合
//       不保证一致 —— 所以每次都要过 `RefactorPreviewDialog` 的用法树让用户核对。
//   · 上游 `RefactoringDialog.doAction` 的「重构」→ 本仓把编辑交给既有的
//     `renamePreviewOf`（重叠即整体拦下）+ `applyEditsToFiles`（写盘 + 报「更新 N 个文件」）。
//   · 「传播形参」按钮（`ChangeSignatureDialogBase.java:394-421`，alt G，`:476`）要 PSI 的
//     调用者层级（`createCallerChooser`）→ 本仓不移植，见报告「做不到」。
import { computed, ref } from 'vue'
import { request, type LspFileEdits, type Workspace } from './bridge.ts'
import { commentStyleFor } from './commentToggle.ts'
import { nonCodeRanges } from './nonCodeUsages.ts'
import {
  changeSignatureEdits, moveParam as moveParamIn, parseSignature, signaturePreview, validateSignatureChange,
  type ParsedSignature, type SignatureParam,
} from './refactorSignature.ts'

/** 扫描上限：工作区源文件超过这个数就只扫前 N 个并如实标注（不冒充全量）。 */
export const SIGNATURE_SCAN_LIMIT = 600

/** 认作源码的扩展名（文本级调用点扫描的范围；其余文件类型没有函数调用概念，跳过）。 */
export const SIGNATURE_SOURCE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.java', '.kt', '.kts',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.py', '.go', '.rs',
]

export function isSignatureSource(path: string): boolean {
  const lower = path.toLowerCase()
  return SIGNATURE_SOURCE_EXTENSIONS.some(extension => lower.endsWith(extension))
}

/** 对话框的可见状态（组件只读它 + 发意图，不自己算）。 */
export interface ChangeSignatureState {
  path: string
  name: string
  returnType: string
  /** 该语言档/该声明有没有返回类型这一段（Java/C 族有，JS 函数没有）。 */
  hasReturnType: boolean
  params: SignatureParam[]
  /** 表格里当前选中的行（上移/下移/删除都作用于它）。 */
  selected: number
  error: string
  /** 签名预览那一栏的文本（上游 `signature.preview.border.title` 分隔线下面那块）。 */
  preview: string
  busy: boolean
  /** 扫描说明（扫了几个文件、有没有截断）—— 让用户知道调用点是文本扫出来的。 */
  scanNote: string
  /** 编辑器解析出来的语言档 id（校验规则按它分档）。 */
  languageKey: string
}

export interface ChangeSignatureDeps {
  active: { readonly value: { path: string; content: string; line?: number; column?: number } | undefined }
  findTab: (path: string) => { path: string; content: string } | undefined
  tabs: { readonly value: readonly { path: string; content: string }[] }
  editorFor: (path: string) => { text?: () => string; getCursor?: () => { line: number; ch: number } } | undefined
  notify: (message: string, error?: boolean) => void
  workspace: () => Workspace | null | undefined
  isDesktop: boolean
  /** 语言档（编辑器那边解析出来的 id，如 `typescript`）。 */
  languageOf: (path: string) => string
  /** 应用编辑那一半（`createSemanticActions` 的 `applyEditsToFiles`）。 */
  applyEditsToFiles: (edits: LspFileEdits[], doneMessage: string) => Promise<number>
  /** 与语言服务给的编辑一并冲突检测/账目（同一份闸门，见 `src/renamePreview.ts`）。 */
  renamePreviewOf: (edits: readonly LspFileEdits[]) => { edits: LspFileEdits[]; conflicts: { path: string }[]; usageCount: number }
  conflictMessage: (preview: { conflicts: unknown[]; usages?: unknown[] }) => string
  /** 多处改动要不要弹预览对话框（`src/refactorPreview.ts` 的 `previewRequired` + 树）。 */
  openPreview: (label: string, edits: LspFileEdits[]) => Promise<void> | void
}

export function createChangeSignatureFlow(deps: ChangeSignatureDeps) {
  const state = ref<ChangeSignatureState | null>(null)
  /** 打开时那一次的解析结果（预览与校验都以它为「旧签名」）。 */
  let parsed: ParsedSignature | null = null
  let declText = ''

  /** 行列 -> 文档内偏移（LSP 的 cursor 形状换算）。 */
  function offsetOf(text: string, line: number, character: number): number {
    const lines = text.split('\n')
    let offset = 0
    for (let index = 0; index < Math.min(line, lines.length); ++index) offset += lines[index]!.length + 1
    return offset + Math.max(0, character)
  }

  /** 三列 + 名字 + 返回类型 → 预览文本与校验错误（每次改动都重算，界面只有一份真相）。 */
  function refresh(next: Partial<ChangeSignatureState> = {}) {
    if (!state.value || !parsed) return
    const merged = { ...state.value, ...next }
    state.value = {
      ...merged,
      preview: signaturePreview(parsed, merged.name, merged.hasReturnType ? merged.returnType : null, merged.params),
      error: validateSignatureChange(parsed, merged.name, merged.params, merged.languageKey ?? ''),
    }
  }

  /** 调用点扫描的文件集：打开的缓冲优先（拿最新未保存内容），其余读盘。 */
  async function collectFiles(declPath: string): Promise<{ files: { path: string; text: string; nonCode: { from: number; to: number }[] }[]; note: string }> {
    const seen = new Map<string, string>()
    for (const tab of deps.tabs.value) {
      const live = deps.editorFor(tab.path)?.text?.()
      seen.set(tab.path, live ?? tab.content)
    }
    const entries = deps.workspace()?.entries ?? []
    const sources = entries.filter(entry => entry.kind === 'file' && isSignatureSource(entry.path) && !seen.has(entry.path))
    let truncated = false
    const budget = Math.max(0, SIGNATURE_SCAN_LIMIT - seen.size)
    if (sources.length > budget) truncated = true
    for (const entry of sources.slice(0, budget)) {
      try {
        const data = await request<{ content: string }>('file.read', { path: entry.path })
        seen.set(entry.path, data.content)
      } catch {
        // 读不到（权限/符号链接）就少扫这一个文件 —— 不猜内容。
      }
    }
    const files = [...seen].filter(([path]) => isSignatureSource(path) || path === declPath)
      .map(([path, text]) => ({ path, text, nonCode: nonCodeRanges(text, commentStyleFor(undefined, path)) }))
    const note = `调用点在 ${files.length} 个源码文件里按文本扫描找出` +
      (truncated ? `（工作区源码文件超过 ${SIGNATURE_SCAN_LIMIT} 个，已截断，未全部扫描）` : '，请核对下面的改动清单。')
    return { files, note }
  }

  async function openChangeSignature(): Promise<void> {
    const tab = deps.active.value
    if (!tab) { deps.notify('请先打开一个文件。', true); return }
    const text = deps.editorFor(tab.path)?.text?.() ?? tab.content
    const cursor = deps.editorFor(tab.path)?.getCursor?.() ?? { line: (tab.line ?? 1) - 1, ch: (tab.column ?? 1) - 1 }
    const found = parseSignature(text, offsetOf(text, cursor.line, cursor.ch), deps.languageOf(tab.path))
    if (!found) {
      // 上游同样在「光标不在方法上」时什么也不改（`JavaChangeSignatureHandler` 找不到方法就静默退出）。
      deps.notify('光标不在可改签名的函数/方法声明上。请把光标放到方法名或其函数体内。', true)
      return
    }
    parsed = found
    declText = text
    state.value = {
      path: tab.path, name: found.name, returnType: found.returnType ?? '', hasReturnType: found.returnType !== null,
      params: found.params.map(param => ({ ...param })), selected: found.params.length ? 0 : -1,
      error: '', preview: '', busy: false, scanNote: '',
      languageKey: deps.languageOf(tab.path),
    }
    refresh()
  }

  function close() { state.value = null; parsed = null; declText = '' }

  function setName(value: string) { refresh({ name: value }) }
  function setReturnType(value: string) { refresh({ returnType: value }) }
  function setParam(index: number, patch: Partial<SignatureParam>) {
    if (!state.value) return
    const params = state.value.params.map((param, position) => position === index ? { ...param, ...patch } : param)
    refresh({ params })
  }
  function selectRow(index: number) {
    if (!state.value) return
    state.value = { ...state.value, selected: Math.max(-1, Math.min(state.value.params.length - 1, index)) }
  }
  /** 新增一行（上游 `ParameterTableModelBase.addRow()`，`:50-52`）—— `originalIndex = -1` 表示新形参。 */
  function addParam() {
    if (!state.value) return
    const params = [...state.value.params, { name: `param${state.value.params.length + 1}`, type: '', defaultValue: '', variadic: false, originalIndex: -1 }]
    refresh({ params, selected: params.length - 1 })
  }
  function removeParam() {
    if (!state.value || state.value.selected < 0) return
    const params = state.value.params.filter((_, index) => index !== state.value!.selected)
    refresh({ params, selected: Math.min(state.value.selected, params.length - 1) })
  }
  function moveParam(delta: number) {
    if (!state.value || state.value.selected < 0) return
    refresh({ params: moveParamIn(state.value.params, state.value.selected, delta) })
  }

  /** 「重构」那一下：算编辑 → 冲突闸门 → （多处时）预览对话框 → 写盘。 */
  async function apply() {
    const current = state.value
    if (!current || !parsed) return
    if (current.error) { deps.notify(current.error, true); return }
    state.value = { ...current, busy: true }
    try {
      const { files, note } = await collectFiles(current.path)
      const { edits } = changeSignatureEdits(parsed, current.path, declText,
        current.name.trim(), current.hasReturnType ? current.returnType.trim() : null, current.params, files)
      const preview = deps.renamePreviewOf(edits)
      if (preview.conflicts.length) { deps.notify(deps.conflictMessage(preview), true); state.value = { ...current, busy: false, scanNote: note }; return }
      if (!preview.edits.length) { deps.notify('签名没有可应用的改动。'); close(); return }
      // 预览对话框接管写盘（`src/components/RefactorPreviewDialog.vue`）：这里只交模型。
      await deps.openPreview(`更改签名 ${current.name}`, preview.edits)
      close()
    } catch {
      state.value = { ...state.value ?? current, busy: false }
      deps.notify('更改签名失败：工作区文件读取中断。', true)
    }
  }

  const open = computed(() => state.value !== null)
  return {
    changeSignatureState: state, changeSignatureOpen: open,
    openChangeSignature, closeChangeSignature: close,
    setName, setReturnType, setParam, selectRow, addParam, removeParam, moveParam,
    applyChangeSignature: apply,
    /** 给测试/设置页用：本次改动会不会碰到工作区里没打开的文件。 */
    isSignatureSource,
  }
}
