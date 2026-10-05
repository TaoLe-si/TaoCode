// 代码洞察的语义动作 —— 从 App.vue 搬出的一域（264 行，31 个依赖）。
//
// 判据：编辑器把光标处的语义请求统一发成 `@semantic` 事件，`onSemantic` 是唯一入口，它分发到
// 「重命名 / 格式化 / 签名帮助 / 代码动作 / 引用与实现 / 调用与类型层级」。这些动作彼此耦合：
// 快速修复要复用套用编辑、重命名要复用 `applyEditsToFiles`、批量修复要复用 `applyCodeAction`，
// 所以它们是一个域而不是六个模块。层级视图的**展示**在 src/hierarchyView.ts，这里只负责
// `prepareHierarchy` 的触发。
import { computed, nextTick, ref, type Ref } from 'vue'
import { lspDiagnostics, request, type DocumentData, type GeneralSettingsState, type LspCodeAction, type LspCodeActionResults,
         type LspDiagnostic, type LspExecuteCommandResult, type LspFileEdits, type LspFormatResult, type LspLocation, type LspPrepareRenameResult,
         type LspRange, type LspReferencesResult, type LspRenameResult, type LspSignatureHelpResult, type SaveResult, type Workspace } from './bridge.ts'
import { applyTextEdits, wordAt } from './editorText.ts'
import { chooseTargetRows, implementationChooserTitle, implementationsUsageTitle, loadTargetContents, NO_IMPLEMENTATIONS_MESSAGE,
         sortTargetRows, typeChooserTitle, type ChooseTargetRow } from './chooseTarget.ts'
import { failReferences, finishReferences, startReferences } from './referenceContents.ts'
import { mergePreviewEdits, nonCodeRenameEdits, nonCodeRenameSummary, renameConflictMessage, renamePreviewOf,
         renameUsageSummary, SEARCH_IN_COMMENTS_DEFAULT, type NonCodeRenameEdits, type RenamePreview } from './renamePreview.ts'
// 重构预览（上游 `RefactoringDialog` + `UsageViewImpl`：应用前把「要改哪些地方」印成用法树，
// 用户确认后才写盘）。模型在 src/refactorPreview.ts，扫描在 src/nonCodeUsages.ts。
import { buildRefactorPreview, previewRequired, refactorPreviewTree, type RefactorPreviewNode } from './refactorPreview.ts'
import { commentStyleFor } from './commentToggle.ts'
import { suppressionActionsFor } from './localIntentions.ts'
// 本地检查通道的诊断表（`src/junitInspections.ts:281`）与 JUnit 快速修复规则
// （`src/junitQuickFix.ts:154`）。上游 Alt+Enter 拿的是 HighlightInfo 全集，
// 本地 inspection 与外部注解并进同一张表（`src/problems.ts` 的 `allProblems`）——
// 不接这张表的话，JUnit 检查的诊断到不了 Alt+Enter。
import { localDiagnostics } from './junitInspections.ts'
import { junitQuickFixActions } from './junitQuickFix.ts'
// 本地意图开关（上游 `IntentionManager` 的启用/停用）：停用的抑制形态不进 Alt+Enter 列表
// （规则与清单在 src/intentionSettings.ts）。
import { isIntentionEnabled } from './intentionSettings.ts'
import { filterFormatEdits } from './formatterTags.ts'
import { mergeFormattingResult } from './formattingMerge.ts'
// 格式化准入（`ExcludedFileFormattingRestriction`/`UntrustedFileFormattingServiceSuppressor`）与
// 进度行（`FormattingProgressTask`）：规则在 src/formattingRestriction.ts，任务表在 src/progressTasks.ts。
import { formattingRestrictionFor } from './formattingRestriction.ts'
// 每份文件生效的缩进（`CodeStyleSettings.getIndentSize` + `FileIndentOptionsProvider` 链）与
// 格式化后处理设置（`PostFormatProcessor`）：模型在 src/codeStyleSettings.ts / src/postFormatProcessors.ts。
import { indentOptionsFromSettings, makeEditorConfigReader, postFormatSettings, resolveIndentOptions } from './codeStyleSettings.ts'
import { processLineCommentAddSpace } from './postFormatProcessors.ts'
import { backgroundTaskManager } from './progressTasks.ts'
import { trustBlockReason } from './trustedProjects.ts'

/** 格式化在后台任务表里的 id（与整工程检查同一张表，见 src/progressTasks.ts）。 */
const FORMAT_FORMATTING_TASK_ID = 'editor:formatting'
import { errorMessage } from './errors.ts'
import type { EditorSettings } from './settingsModel'
import type { Tab } from './editorTab'

export interface SemanticActionsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  generalSettings: Ref<GeneralSettingsState>
  /**
   * 编辑器设置（`EditorSettings.tabSize` / `useTabCharacter`）—— 格式化请求的缩进选项起步值。
   * 上游那份是 `CodeStyleSettings.getIndentSize(fileType)`，见 `src/codeStyleSettings.ts`。
   */
  editorSettings: Ref<EditorSettings>
  /** 宿主是 `Ref<Workspace | null>`；本模块只读它的存在性，用 getter 取。 */
  workspace: () => Workspace | null
  active: { readonly value: Tab | undefined }
  activePath: Ref<string>
  findTab: (path: string) => Tab | undefined
  editorFor: (path: string) => any
  lspReady: { readonly value: boolean }
  save: (tab?: Tab) => Promise<boolean>
  codeActions: Ref<LspCodeAction[]>
  actionPrompt: Ref<{ path: string } | null>
  renamePrompt: Ref<{ path: string; line: number; character: number; current: string } | null>
  renameValue: Ref<string>
  renameInput: Ref<HTMLInputElement | undefined>
  /** IDEA `RenameInputValidator`：空串表示名字合法。 */
  invalidRenameName: { readonly value: string }
  baseName: (path: string) => string
  /** 宿主更早的阶段就要读写它们（左栏是否展开、当前是哪个左栏视图），所以留在宿主。 */
  explorer: Ref<boolean>
  leftView: Ref<any>
  /** 下面六个由更晚装配的模块/函数提供 —— 必须惰性调用，否则命中 TDZ。 */
  /** 语言服务在这条文件上是否可用（PowerSaveMode / 大小 / 是否在跑）。 */
  lspOn: (tab: Tab) => boolean
  prepareHierarchy: (kind: 'call' | 'type', payload: { path: string; line: number; character: number }) => unknown
  showOutput: (id: 'references' | 'hierarchy') => void
  refreshOutline: (path: string) => unknown
  revealLocation: (target: { path: string; line: number; column?: number }) => unknown
  retitleTab: (from: string, to: string) => unknown
}

export function createSemanticActions(deps: SemanticActionsDeps) {
  const { notify, isDesktop, generalSettings, editorSettings, workspace, active, activePath, findTab, editorFor, lspOn, lspReady, save,
          codeActions, actionPrompt, renamePrompt, renameValue, renameInput, invalidRenameName,
          baseName, explorer, leftView, prepareHierarchy, showOutput, refreshOutline, revealLocation, retitleTab } = deps
async function onSemantic(payload: { kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy' | 'typeDefinition'; path: string; line: number; character: number; range?: LspRange }) {
  const tab = findTab(payload.path)
  if (!tab || !lspOn(tab)) { notify('该文件未启用语言服务。', true); return }
  if (payload.kind === 'rename') {
    if (tab.dirty && !await save(tab)) return
    // IDEA 的 RenameProcessor 先校验再开对话框；LSP 规范里这一步是 `textDocument/prepareRename`
    // （三种结果：Range / {range, placeholder} / null）。服务器没声明 `prepareProvider` 时
    // 原生返回 supported=false —— 那就跳过预校验按老路重命名，而不是把重命名整个禁掉。
    const target = { path: payload.path, line: payload.line, character: payload.character }
    let current = wordAt(tab.content, payload.line, payload.character)
    try {
      const prepared = await request<LspPrepareRenameResult>('lsp.request', { kind: 'prepareRename', ...target })
      if (prepared.supported && !prepared.available) { notify('此位置没有可以重命名的符号。', true); return }
      // 服务器给的 placeholder 是它的建议名（LSP 的 `prepareRename` 返回值），优先用它。
      if (prepared.placeholder) current = prepared.placeholder
    } catch (error) { notify(errorMessage(error), true); return }
    renamePrompt.value = { ...target, current }
    renameValue.value = current
    await nextTick()
    renameInput.value?.select()
    return
  }
  if (payload.kind === 'format') { await runFormatting(payload.path, payload.range); return }
  if (payload.kind === 'signature') { await runSignature(payload); return }
  if (payload.kind === 'codeAction') { await openCodeActions(payload); return }
  if (payload.kind === 'callHierarchy') { await prepareHierarchy('call', payload); return }
  if (payload.kind === 'typeHierarchy') { await prepareHierarchy('type', payload); return }
  // 实现与类型声明**不是**引用那套：上游是 goto 动作 —— 一个目标直接跳、多个才开选择弹层
  // （`GotoTargetHandler.java:140-160` 的 `targets.length == 1 && finished` 分支，
  // `GotoTypeDeclarationHandler2.kt:52-62` 同一个形状）；一个都没找到时实现那条给错误提示
  // （`goto.implementation.notFound`），类型声明那条静默返回（`:47` 的 `if (result == null) return`）。
  if (payload.kind === 'implementation' || payload.kind === 'typeDefinition') { await runGotoTargets({ ...payload, kind: payload.kind }); return }
  // 引用仍是"把一批地点列出来"的那套界面。一条搜索 = 一条内容
  // （`src/referenceContents.ts`）：先挂上"正在搜索"的那一行，回来再填地点，失败或空结果就撤掉它。
  const source = findTab(payload.path)
  const symbol = wordAt(source?.content ?? '', payload.line, payload.character)
  const search = startReferences(symbol, `${payload.path}#${symbol}`)
  showOutput('references')
  try {
    const result = await request<LspReferencesResult>('lsp.request', { kind: payload.kind, path: payload.path, line: payload.line, character: payload.character })
    if (!finishReferences(search, result.refs ?? [])) notify('没有找到结果。')
  } catch (error) {
    failReferences(search)
    notify(errorMessage(error), true)
  }
}
/** 「选择实现 / 选择类型」弹层的状态；行的三段与过滤在 src/chooseTarget.ts。 */
const targetChooser = ref<{ title: string; rows: ChooseTargetRow[]; x?: number; y?: number; pinnable: boolean;
                             refs: LspLocation[]; usageTitle: string } | null>(null)
async function runGotoTargets(payload: { kind: 'implementation' | 'typeDefinition'; path: string; line: number; character: number }) {
  const source = findTab(payload.path)
  const symbol = wordAt(source?.content ?? '', payload.line, payload.character)
  try {
    const result = await request<LspReferencesResult>('lsp.request', { kind: payload.kind, path: payload.path, line: payload.line, character: payload.character })
    const refs = result.refs ?? []
    if (!refs.length) {
      if (payload.kind === 'implementation') notify(NO_IMPLEMENTATIONS_MESSAGE, true)
      return
    }
    if (refs.length === 1) { void revealLocation({ path: refs[0]!.path, line: refs[0]!.line, column: refs[0]!.character + 1 }); return }
    const contents = await loadTargetContents(refs, path => findTab(path)?.content ?? null,
      async path => (await request<{ content: string }>('file.read', { path })).content)
    const coords = editorFor(payload.path)?.getCursorCoords?.() as { left?: number; bottom?: number } | null | undefined
    targetChooser.value = {
      title: payload.kind === 'implementation' ? implementationChooserTitle(symbol, refs.length) : typeChooserTitle(),
      rows: sortTargetRows(chooseTargetRows(refs, contents)),
      x: coords?.left, y: coords?.bottom,
      // 上游只有实现那条挂了 `setCouldPin`（`GotoTargetHandler.java:238-246`）：类型声明的弹层没有钉。
      pinnable: payload.kind === 'implementation',
      refs, usageTitle: implementationsUsageTitle(symbol),
    }
  } catch (error) { notify(errorMessage(error), true) }
}
function pickTarget(row: ChooseTargetRow) {
  targetChooser.value = null
  void revealLocation({ path: row.path, line: row.line, column: row.character + 1 })
}
function closeTargetChooser() { targetChooser.value = null }
/** 钉住 = 上游的 `FindUtil.showInUsageView`：把这批地点放进"查找"窗口（本仓的引用面板）。 */
function pinTargetChooser() {
  const chooser = targetChooser.value
  if (!chooser) return
  targetChooser.value = null
  const search = startReferences(chooser.usageTitle, chooser.usageTitle)
  if (!finishReferences(search, chooser.refs)) { notify('没有找到结果。'); return }
  showOutput('references')
}
// Reformat: a live selection goes through rangeFormatting (IDEA's "reformat the
// selected lines"), otherwise the whole buffer.
async function runFormatting(path: string, range?: LspRange) {
  // 准入限制（上游 `ExcludedFileFormattingRestriction` + `UntrustedFileFormattingServiceSuppressor`，
  // 规则在 src/formattingRestriction.ts）：不受信任的项目与「不格式化」清单里的文件都不发请求。
  const blockedByTrust = trustBlockReason('格式化', workspace()?.root, generalSettings.value.trustedPaths)
  const restriction = blockedByTrust ?? formattingRestrictionFor(path)
  if (restriction) { notify(restriction, true); return }
  // 请求时刻的缓冲快照：LSP 的行列坐标按**这一刻**的文档算，响应可能晚于用户的输入
  // （上游 `AsyncDocumentFormattingSupportImpl` 的 modificationStamp 快照 + DocumentMerger
  // 扩展点，见 src/formattingMerge.ts）。没有快照时退回旧行为。
  const before = editorFor(path)?.text()
  // 缩进选项（上游 `LspFormattingService.createFormattingOptions`，`:119-125`：只发
  // `tabSize` 与 `isInsertSpaces`）。这份生效值要走完「全局设置 → 按内容探测 → .editorconfig」
  // 那条链（`src/codeStyleSettings.ts` 的 `resolveIndentOptions`）；发不出去就退回全局设置 ——
  // 之前这条路径**不传**这两个字段，宿主按 4/空格兜底（`native/lsp_support.cpp:363-365`），
  // 于是用户改的缩进宽度在「重排代码」上完全不起作用。
  const indent = await formattingIndentOptions(path, Boolean(range), before ?? '')
  // 进度行（上游 `FormattingProgressTask`）：格式化是异步长请求，状态栏的后台任务列表可见。
  backgroundTaskManager.begin(FORMAT_FORMATTING_TASK_ID, '正在格式化', { detail: path })
  try {
    const result = await request<LspFormatResult>('lsp.request', {
      kind: range ? 'rangeFormatting' : 'formatting', path, line: 0, character: 0,
      tabSize: indent.indentSize, insertSpaces: !indent.useTabCharacter,
      ...(range ? { range } : {}),
    })
    if (!result.available || !result.edits?.length) { notify(range ? '所选内容无需格式化，或语言服务不支持选区格式化。' : '无需格式化，或语言服务不支持格式化。'); return }
    let touched = 0
    let suppressed = 0
    let conflicted = 0
    let postProcessed = 0
    for (const file of result.edits) {
      const open = findTab(file.path)
      if (!open) continue  // formatting only makes sense on an open buffer
      const base = editorFor(file.path)?.text() ?? open.content
      // 格式化标记（`// @formatter:off` … `// @formatter:on`）：上游 `FormatterTagHandler`
      // 对禁用区间不重排，这里把落在禁用区间的语言服务编辑整条丢掉（规则与边界见 src/formatterTags.ts）。
      const edits = filterFormatEdits(base, file.textEdits)
      suppressed += file.textEdits.length - edits.length
      // 请求时刻的快照（`file.path === path` 才存在）。快照与当前缓冲一致时这就是原来的
      // `applyTextEdits(base, edits)` 路径；不一致才走合并（下）。
      const snapshot = file.path === path && before !== base ? before : undefined
      const formatted = snapshot === undefined ? applyTextEdits(base, edits) : applyTextEdits(snapshot, edits)
      let next = formatted
      if (snapshot !== undefined) {
        // 请求期间缓冲区被改过：只在格式化改动区间与用户改动区间不重叠时套用；
        // 重叠（含边界）就整条跳过，绝不把按旧坐标算的编辑盖到用户刚打的字上。
        const merged = mergeFormattingResult({ originalText: snapshot, currentText: base, formattedText: formatted })
        if (!merged.merged) { ++conflicted; continue }
        next = merged.text
      }
      if (next === base) continue
      // 格式化后处理器（上游 `PostFormatProcessor`，本仓只落
      // `LineCommentAddSpacePostFormatProcessor`，规则在 src/postFormatProcessors.ts）：
      // 在语言服务重排完之后补跑一遍。**只对发起格式化的那份文件跑**，且用 `base` 的长度当区间 ——
      // 上游 `processText(source, rangeToReformat, settings)` 收的就是待重排区间。
      if (file.path === path) {
        const processed = processLineCommentAddSpace(next, { start: 0, end: next.length }, postFormatSettings.value)
        if (processed.inserted) { next = processed.text; ++postProcessed }
      }
      editorFor(file.path)?.setDraft(next)
      open.dirty = true  // buffer preview; user reviews then Ctrl+S
      ++touched
    }
    if (conflicted) notify(`格式化结果与你在格式化期间的修改重叠，已跳过 ${conflicted} 个文件以免覆盖；请重新格式化。`)
    else if (!touched && suppressed) notify('格式化标记（@formatter:off）已禁用这些区域，未做改动。')
    else notify(touched ? `已格式化当前缓冲（未保存），检查后按 Ctrl+S 保存。${postProcessed ? '（已按设置补齐行注释后的空格）' : ''}` : '格式已是最新。')
  } catch (error) { notify(errorMessage(error), true) }
  finally { backgroundTaskManager.end(FORMAT_FORMATTING_TASK_ID) }
}

/**
 * 这份文件发格式化请求时该用的缩进选项（上游 `LspFormattingService.createFormattingOptions`，
 * `LspFormattingService.kt:119-125`）。
 * 读盘 / 解析出错一律退回全局设置 —— 缩进探测只是锦上添花，绝不能因为它把格式化整个卡住。
 */
async function formattingIndentOptions(path: string, isRangeReformat: boolean, text: string) {
  const base = indentOptionsFromSettings(editorSettings.value)
  if (!isDesktop) return base
  try {
    const resolved = await resolveIndentOptions({
      path, text, base,
      // 整文件重排 vs 选区重排要走不同的 provider 准入门（`FileIndentOptionsProvider.isAllowed`，`:72-74`）。
      isFullReformat: !isRangeReformat,
      root: workspace()?.root,
      readEditorConfig: makeEditorConfigReader(target => request<{ content: string }>('file.read', { path: target })),
    })
    return resolved.options
  } catch {
    return base
  }
}
async function runSignature(payload: { path: string; line: number; character: number }) {
  try {
    const result = await request<LspSignatureHelpResult>('lsp.request', { kind: 'signatureHelp', path: payload.path, line: payload.line, character: payload.character })
    if (!result.available || !result.signatures?.length) { notify('此处没有可用的签名信息。', true); return }
    // Show as a persistent popup near the cursor instead of a transient toast.
    const editor = editorFor(payload.path)
    const rect = editor?.getCursorCoords()
    signaturePopup.value = {
      signatures: result.signatures,
      activeIndex: result.activeSignature ?? 0,
      activeParam: result.activeParameter ?? 0,
      x: rect?.left ?? 200,
      y: rect?.bottom ?? 200,
    }
  } catch (error) { notify(errorMessage(error), true) }
}
// Signature help popup state: IDEA's parameter info panel with overload navigation.
const signaturePopup = ref<{ signatures: { label: string; documentation?: string }[]; activeIndex: number; activeParam: number; x: number; y: number } | null>(null)
function closeSignaturePopup() { signaturePopup.value = null }
function navigateSignature(delta: number) {
  if (!signaturePopup.value) return
  const total = signaturePopup.value.signatures.length
  signaturePopup.value.activeIndex = (signaturePopup.value.activeIndex + delta + total) % total
}
// IDEA's Code Cleanup / batch quick-fix: walk the file's diagnostics and apply the
// single unambiguous preferred fix per problem, looping while new diagnostics with
// fixes keep appearing (bounded, so a fixer that keeps re-triggering cannot loop).
const batchFixBusy = ref(false)
/**
 * 文件级清理（LSP 的 `source.fixAll` / `source.fixAll.<provider>`：eslint --fix、TS 的
 * fix-all 一族）—— 上游 Code Cleanup 先跑 profile 级的批量修复，本仓先问服务器有没有这条
 * 动作；应用成功返回标题，没有这条动作/服务器报错返回 null（落回逐条循环）。
 */
async function applyFileLevelCleanup(path: string): Promise<string | null> {
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path, line: 0, character: 0, diagnostics: [] })
    const action = (result.actions ?? []).find(item =>
      item.kind?.startsWith('source.fixAll') && (item.edits?.length || item.command || item.resolvable))
    if (!action) return null
    actionPrompt.value = { path }
    await applyCodeAction(action)
    actionPrompt.value = null
    return action.title
  } catch { return null }
}
async function fixAllInFile() {
  const tab = active.value
  if (!tab || !lspOn(tab) || batchFixBusy.value) { notify('批量修复需要语言服务。', true); return }
  batchFixBusy.value = true
  let applied = 0
  try {
    const cleanupTitle = await applyFileLevelCleanup(tab.path)
    if (cleanupTitle) { notify(`批量修复：已应用文件级清理「${cleanupTitle}」。`); return }
    for (let pass = 0; pass < 25; ++pass) {
      const problems = (lspDiagnostics.get(tab.path) ?? []).filter(item => item.severity <= 2)
      if (!problems.length) break
      let fixedThisPass = 0
      for (const problem of problems) {
        const diagnostics = (lspDiagnostics.get(tab.path) ?? []).filter(item => item.line === problem.line).map(item => ({
          range: { start: { line: item.line, character: item.character }, end: { line: item.endLine ?? item.line, character: item.endCharacter ?? item.character } },
          severity: item.severity, message: item.message, ...(item.source ? { source: item.source } : {}) }))
        const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: tab.path, line: problem.line, character: problem.character, diagnostics })
        const fixes = (result.actions ?? []).filter(action => action.preferred || action.linkedDiagnostics)
        if (fixes.length !== 1) continue  // ambiguous or nothing: leave for Alt+Enter
        actionPrompt.value = { path: tab.path }
        codeActions.value = fixes
        await applyCodeAction(fixes[0]!)
        actionPrompt.value = null
        ++fixedThisPass
        break  // diagnostics shifted under us; restart the pass from the new state
      }
      if (!fixedThisPass) break
      applied += fixedThisPass
    }
    notify(applied ? `批量修复：已应用 ${applied} 处修复，剩余问题可在 Alt+Enter 中逐个处理。` : '没有可自动应用的快速修复（存在需要人工选择的操作）。')
  } catch (error) { notify(errorMessage(error), true) }
  finally { batchFixBusy.value = false }
}
async function openCodeActions(payload: { path: string; line: number; character: number }, onlyFixes = false) {
  const diagnostics = (lspDiagnostics.get(payload.path) ?? []).filter(item => item.line === payload.line).map(item => ({
    range: { start: { line: item.line, character: item.character }, end: { line: item.endLine ?? item.line, character: item.endCharacter ?? item.character } },
    severity: item.severity, message: item.message, ...(item.source ? { source: item.source } : {}) }))
  // 本地抑制条目（上游 `SuppressIntentionAction`）：规则在 `src/suppressIntention.ts`，
  // 可应用编辑的装配在 `src/localIntentions.ts`。语言服务缺席/报错时本地条目仍要能出，
  // 所以服务端请求失败不直接 return，而是先记下来、再看合流后有没有条目。
  const tab = findTab(payload.path)
  // 本地条目这一层要同时看**两张诊断表**：`lspDiagnostics`（语言服务 push/pull）与
  // `localDiagnostics`（本地检查）。`JunitInspectionProblem`（`junitInspections.ts:25`）与
  // `LspDiagnostic` 结构兼容（多一个非可选的 `source`），所以能直接并进一张表喂给规则层。
  // 注意**发给服务端**的 `diagnostics` 仍只用 LSP 那张：本地检查不是服务端报的，不该回给它。
  const lineRows: LspDiagnostic[] = [
    ...(lspDiagnostics.get(payload.path) ?? []).filter(item => item.line === payload.line),
    ...(localDiagnostics.get(payload.path) ?? []).filter(item => item.line === payload.line),
  ]
  const localActions = !onlyFixes && tab
    ? [
        ...suppressionActionsFor({
          path: payload.path, text: tab.content, diagnostics: lineRows,
          enabled: isIntentionEnabled,
        }),
        // JUnit 修复只要 `{行, 来源}`（`JunitQuickFixInput.diagnostics`），`source` 缺省成空串 ——
        // 两条规则（MisorderedAssertEqualsArguments / JUnit3StyleTestMethodInJUnit4Class）都按来源分流。
        ...junitQuickFixActions({
          path: payload.path, text: tab.content,
          diagnostics: lineRows.map(item => ({ line: item.line, source: item.source ?? '' })),
        }),
      ]
    : []
  let serverFailed: unknown
  let serverActions: LspCodeAction[] = []
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: payload.path, line: payload.line, character: payload.character, diagnostics })
    serverActions = result.actions ?? []
  } catch (error) { serverFailed = error }
  // IDEA's "Show Fix…" variants keep only actions that actually fix a diagnostic;
  // the server marks those with `isPreferred` or a `diagnostics` backlink.
  const actions = [
    ...(onlyFixes ? serverActions.filter(action => action.preferred || action.linkedDiagnostics) : serverActions),
    ...localActions,
  ]
  if (!actions.length) {
    if (serverFailed) { notify(errorMessage(serverFailed), true); return }
    notify(onlyFixes ? '当前行没有与问题关联的快速修复。' : '此处没有可用的代码操作。')
    return
  }
  if (actions.length === 1) { await applyCodeAction(actions[0]!); return }
  codeActions.value = actions
  actionPrompt.value = { path: payload.path }
}
// Menu rows without an event payload ask for the caret position of the active file.
function caretPayload() {
  const tab = active.value!
  const cursor = editorFor(tab.path)?.getCursor() ?? { line: tab.line - 1, ch: 0 }
  return { path: tab.path, line: cursor.line, character: cursor.ch }
}
// IDEA's Code › 优化导入 (Optimize Imports, Ctrl+Alt+O): JDT/TS publish it as a
// `source.organizeImports` code action; apply the first one directly.
async function runOrganizeImports() {
  const tab = active.value
  if (!tab || !lspReady.value) { notify('优化导入需要语言服务。', true); return }
  const payload = caretPayload()
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: payload.path, line: payload.line, character: payload.character, diagnostics: [] })
    const action = (result.actions ?? []).find(item =>
      item.kind === 'source.organizeImports' || item.kind?.startsWith('source.organizeImports') ||
      /organize\s*imports|优化导入/i.test(item.title))
    if (!action) { notify('语言服务没有提供可用的导入优化。'); return }
    actionPrompt.value = { path: payload.path }
    await applyCodeAction(action)
    actionPrompt.value = null
  } catch (error) { notify(errorMessage(error), true) }
}
async function applyCodeAction(action: LspCodeAction) {
  const path = actionPrompt.value?.path ?? activePath.value
  actionPrompt.value = null
  let edits = action.edits ?? []
  // LSP: an action may carry a Command instead of (or in addition to) an edit. The
  // edit is applied first, the command runs after — that is how servers implement
  // "add the import, then reindex". IDEA's counterpart is QuickFixAction handing
  // over to CommandProcessor.
  let executable = action.command === true
  if (!edits.length && action.resolvable) {
    if (!path) { notify('该操作没有可应用的编辑。', true); return }
    // The server listed the action without its edit; codeAction/resolve hands it over.
    try {
      const resolved = await request<LspFormatResult>('lsp.request', { kind: 'codeActionResolve', path, line: 0, character: 0, index: action.index })
      edits = resolved.edits ?? []
      executable = resolved.command === true
    } catch (error) { notify(errorMessage(error), true); return }
  }
  if (!edits.length && !executable) { notify(`语言服务没有为「${action.title}」返回编辑。`, true); return }
  if (edits.length) await applyEditsToFiles(edits, `已应用代码操作：${action.title}`)
  if (!executable) return
  if (!path) { notify('该操作需要在打开的文件里执行。', true); return }
  try {
    // The native layer holds the server's original action object (its `arguments` and
    // `data` must go back verbatim), so the action is addressed by its index.
    await request<LspExecuteCommandResult>('lsp.request', { kind: 'executeCommand', path, line: 0, character: 0, index: action.index })
    const done = edits.length ? `已应用代码操作：${action.title}` : `已执行代码操作：${action.title}`
    notify(done)
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA 的「移动/重命名文件」是一个动作：MoveFileProcessor 移动文件**并**更新引用
// （RefactorMenu → "搜索引用"）。LSP 对应 `workspace/willRenameFiles`：问服务器，它回一个
// WorkspaceEdit，把别处指向这个文件的 import 一并改掉。
//
// 顺序不能反，两端都有理由：
//   · 询问必须在**改名之前** —— 协议是 will* 系列，服务器按"这个文件即将改名"来理解，
//     改名后再问，服务器去读旧路径会发现文件已经不在，算不出引用；
//   · 编辑必须在**改名之后**落盘 —— 有些服务器把编辑落在文件的新路径上，先写就会写到
//     一个还不存在的文件。
// 所以这三步合成一个入口，调用点不许拆开用。
// 服务器没声明这个能力、或这个语言没有语言服务时静默跳过（改名本身照做），
// 否则每改一个 .txt 都会弹一次错。
async function renameEntryWithReferences(from: string, to: string) {
  let referenceEdits: LspFileEdits[] = []
  if (isDesktop && workspace()) {
    try {
      const result = await request<LspFormatResult>('lsp.request',
        { kind: 'willRenameFiles', path: from, line: 0, character: 0, newPath: to })
      referenceEdits = result.available ? result.edits ?? [] : []
    } catch { /* 没有语言服务：跳过更新引用，改名照做 */ }
  }
  await request('file.rename', { from, to })
  await retitleTab(from, to)
  if (referenceEdits.length) await applyEditsToFiles(referenceEdits, `已更新 ${baseName(from)} 的引用`)
}
// Apply a WorkspaceEdit (from rename or a code action) across files: write each
// through the normal safe-save path, then refresh any open buffer + the server.
// Each file keeps the encoding it was read with — otherwise refactoring one GBK file
// would silently rewrite it as UTF-8.
async function applyEditsToFiles(edits: LspFileEdits[], doneMessage: string) {
  let count = 0
  for (const file of edits) {
    const open = findTab(file.path)
    let content = open?.content
    let version = open?.version
    let encoding = open?.encoding ?? 'utf-8'
    let bom = open?.bom ?? false
    if (content === undefined || version === undefined) {
      const doc = await request<DocumentData>('file.read', { path: file.path })
      content = doc.content; version = doc.version; encoding = doc.encoding; bom = doc.bom
    }
    const next = applyTextEdits(content, file.textEdits)
    if (next === content) continue
    const saved = await request<SaveResult>('file.write', { path: file.path, content: next, expectedVersion: version, encoding, bom, safeWrite: generalSettings.value.isUseSafeWrite })
    if (open) { open.content = next; open.version = saved.version; open.dirty = false; editorFor(file.path)?.setDraft(next) }
    if (isDesktop) void request('lsp.change', { path: file.path, text: next }).catch(() => undefined)
    ++count
  }
  notify(`${doneMessage} · 更新 ${count} 个文件`)
  return count
}
function submitRename() {
  const target = renamePrompt.value
  const next = renameValue.value.trim()
  if (!target || !next) return
  if (invalidRenameName.value) { notify(invalidRenameName.value, true); return }
  renamePrompt.value = null
  void applyRename(target, next)
}
async function applyRename(target: { path: string; line: number; character: number; current: string }, newName: string) {
  try {
    const result = await request<LspRenameResult>('lsp.request', { kind: 'rename', path: target.path, line: target.line, character: target.character, newName })
    if (!result.available || !result.edits?.length) { notify('语言服务无法重命名此符号。', true); return }
    // IDEA 的 Refactoring Preview 在应用前算一遍账（`RenameUsage`/`RenameConflict`）：
    // 编辑互相覆盖就整个不应用（写下去是静默改坏文件），重复编辑去掉，范围写进完成提示。
    const preview = renamePreviewOf(result.edits)
    if (preview.conflicts.length) { notify(renameConflictMessage(preview), true); return }
    // 多于一处 / 跨文件 / 有冲突时才弹预览对话框（`RefactoringDialog` 的用法树；单文件单处直接改，
    // 与 `previewRequired` 的判定一致 —— 上游是 `RenameProcessor.myForceShowPreview` 那一档）。
    if (!previewRequired(buildRefactorPreview(preview.edits))) { await writeRename(preview, newName, target); return }
    await openRefactorPreview({ label: '重命名', base: preview, newName, word: target.current, target, done: writeRename })
  } catch (error) { notify(errorMessage(error), true) }
}

/* ── 重构预览对话框（上游 `RefactoringDialog` + `UsageViewImpl`） ───────────────── */

/** 写盘那一半的闭包：等用户在对话框里点了「重构」才跑。 */
type PreviewWriter = (preview: RenamePreview, newName: string,
  target: { path: string; line: number; character: number; current: string }) => Promise<void>

/** 等「重构」那一下的上下文（对话框组件无状态，状态留在这儿）。 */
interface PendingRefactor {
  label: string
  /** 语言服务给的那一半（每次重算都从这份出发，不在已合并的结果上叠加）。 */
  base: RenamePreview
  newName: string
  word: string
  target: { path: string; line: number; character: number; current: string }
  done: PreviewWriter
  contents: Record<string, string>
  extra: NonCodeRenameEdits
  /** 能不能扫非代码出现（要工作区：读盘 + 语言档）。 */
  canScanNonCode: boolean
}
const pendingRefactor = ref<PendingRefactor | null>(null)

/**
 * 非重命名那一族（更改签名 / 成员上移下移 / 引入形参对象）的预览上下文：
 * 上游同样是 `RefactoringDialog` 的用法树（`ChangeSignatureDialogBase.java:97` 继承它），
 * 差别只在**没有**「在注释和字符中搜索」那一档 —— 那半属于 RenameProcessor 的 TextOccurrences。
 * 写盘那一半由调用方给（本仓各重构的落盘路径不同：有的要建新文件）。
 */
interface PendingEditsRefactor {
  label: string
  edits: LspFileEdits[]
  contents: Record<string, string>
  /** 用户在树上确认「重构」之后的落盘动作。 */
  write: (edits: LspFileEdits[]) => Promise<void>
}
const pendingEdits = ref<PendingEditsRefactor | null>(null)

/** 对话框状态；字段与 `src/components/RefactorPreviewDialog.vue` 的 `RefactorPreviewModel` 一一对应。 */
const refactorPreviewState = ref<{
  label: string
  summary: string
  tree: RefactorPreviewNode
  conflictCount: number
  conflictText: string
  showSearchInComments: boolean
  searchInComments: boolean
  searchInCommentsSummary: string
  busy: boolean
} | null>(null)

async function writeRename(preview: RenamePreview, newName: string,
  target: { path: string; line: number; character: number; current: string }) {
  await applyEditsToFiles(preview.edits, `已重命名为 ${newName}（${renameUsageSummary(preview)}）`)
  if (target.path === activePath.value) await refreshOutline(target.path)
}

/** 树里要印的原文：打开的缓冲（带当前未保存编辑）优先，其余读盘。读不到就只给位置。 */
async function previewContentsOf(edits: readonly LspFileEdits[]): Promise<Record<string, string>> {
  const contents: Record<string, string> = {}
  for (const file of edits) {
    const open = findTab(file.path)
    if (open) { contents[file.path] = open.content; continue }
    try { contents[file.path] = (await request<DocumentData>('file.read', { path: file.path })).content }
    catch { /* 读不到就在树里只显示位置（oldText 空串），不猜原文 */ }
  }
  return contents
}

/** 按勾选状态重算整棵模型（打开时与切复选框时走同一条路，行为只有一份）。 */
function refreshRefactorPreview(searchInComments: boolean) {
  const pending = pendingRefactor.value
  if (!pending) return
  const merged = searchInComments ? mergePreviewEdits(pending.base, pending.extra.edits) : pending.base
  const flat = buildRefactorPreview(merged.edits, pending.contents)
  refactorPreviewState.value = {
    label: pending.label,
    summary: flat.summary,
    tree: refactorPreviewTree(merged.edits, pending.contents),
    conflictCount: merged.conflicts.length,
    conflictText: merged.conflicts.length ? renameConflictMessage(merged) : '',
    showSearchInComments: pending.canScanNonCode && Boolean(pending.word),
    searchInComments,
    searchInCommentsSummary: pending.canScanNonCode && pending.word ? nonCodeRenameSummary(pending.extra) : '',
    busy: false,
  }
}

/**
 * 开预览对话框。注释/字符串里的追加编辑在**打开前**就算好（上游 `RenameDialog` 的复选框
 * 旁边同样直接报数），用户取消勾选只是不并进去，不需要重扫。
 * 没有工作区时不扫（读盘要宿主），那一行整行不出现 —— 不渲染点了没反应的东西。
 */
async function openRefactorPreview(payload: { label: string; base: RenamePreview; newName: string; word: string;
  target: { path: string; line: number; character: number; current: string }; done: PreviewWriter }) {
  const contents = await previewContentsOf(payload.base.edits)
  const canScanNonCode = isDesktop && Boolean(workspace())
  const extra = canScanNonCode && payload.word
    ? nonCodeRenameEdits(payload.word, payload.newName,
        Object.entries(contents).map(([path, text]) => ({ path, text, style: commentStyleFor(undefined, path) })),
        payload.base)
    : { edits: [], count: 0, files: 0, skipped: 0, truncated: false } satisfies NonCodeRenameEdits
  pendingRefactor.value = { ...payload, contents, extra, canScanNonCode }
  refreshRefactorPreview(SEARCH_IN_COMMENTS_DEFAULT)
}

/** 「重构」按钮：把勾选的那一档并进去再写盘（冲突仍整体拦下）。 */
async function confirmRefactorPreview(searchInComments: boolean) {
  const pending = pendingRefactor.value
  const edits = pendingEdits.value
  refactorPreviewState.value = null
  pendingRefactor.value = null
  pendingEdits.value = null
  if (edits) { await edits.write(edits.edits); return }
  if (!pending) return
  const merged = searchInComments ? mergePreviewEdits(pending.base, pending.extra.edits) : pending.base
  if (merged.conflicts.length) { notify(renameConflictMessage(merged), true); return }
  await pending.done(merged, pending.newName, pending.target)
}
function cancelRefactorPreview() { refactorPreviewState.value = null; pendingRefactor.value = null; pendingEdits.value = null }
/** 复选框取反：立刻重算树，追加编辑算不算在树上看得见差别。 */
function toggleRefactorSearchInComments(value: boolean) { refreshRefactorPreview(value) }
/** 点树上的一处 → 跳编辑器（宿主 `revealLocation`）。 */
function openRefactorPreviewLocation(location: { path: string; line: number }) {
  void revealLocation({ path: location.path, line: location.line })
}

/**
 * 通用「重构预览」入口（上游 `RefactoringDialog` 的用法树那一面，非重命名族用）。
 * 与 `openRefactorPreview` 的差别：没有「在注释和字符中搜索」那一档，写盘动作由调用方给。
 * 单处改动也照弹 —— 更改签名/成员移动改的是**别的文件的调用点**，用户必须先看一眼。
 */
async function openEditsPreview(label: string, edits: LspFileEdits[],
  write: (edits: LspFileEdits[]) => Promise<void>): Promise<void> {
  const contents = await previewContentsOf(edits)
  const flat = buildRefactorPreview(edits, contents)
  pendingEdits.value = { label, edits, contents, write }
  refactorPreviewState.value = {
    label, summary: flat.summary, tree: refactorPreviewTree(edits, contents),
    conflictCount: flat.conflictCount, conflictText: '',
    showSearchInComments: false, searchInComments: false, searchInCommentsSummary: '', busy: false,
  }
}
function toggleOutline() {
  explorer.value = true
  if (leftView.value === 'outline') { leftView.value = 'files'; return }
  leftView.value = 'outline'
  void refreshOutline(activePath.value)
}
async function jumpDebugLocation(target: { path?: string; line: number }) {
  const path = target.path ?? activePath.value
  if (!path) return
  await revealLocation({ path, line: Math.max(0, target.line - 1) })  // DAP is 1-based; reveal is 0-based
}
  return {
    signaturePopup, closeSignaturePopup, navigateSignature, batchFixBusy, fixAllInFile,
    onSemantic, runFormatting, runSignature, openCodeActions, caretPayload, runOrganizeImports,
    applyCodeAction, renameEntryWithReferences, applyEditsToFiles, submitRename, applyRename,
    toggleOutline, jumpDebugLocation,
    targetChooser, pickTarget, closeTargetChooser, pinTargetChooser,
    // 重构预览对话框（上游 `RefactoringDialog`）：宿主只负责把组件挂上 + 转发这四个动作。
    refactorPreviewState, confirmRefactorPreview, cancelRefactorPreview, toggleRefactorSearchInComments,
    openRefactorPreviewLocation, openEditsPreview,
  }
}
