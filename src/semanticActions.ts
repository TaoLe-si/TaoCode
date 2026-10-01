// 代码洞察的语义动作 —— 从 App.vue 搬出的一域（264 行，31 个依赖）。
//
// 判据：编辑器把光标处的语义请求统一发成 `@semantic` 事件，`onSemantic` 是唯一入口，它分发到
// 「重命名 / 格式化 / 签名帮助 / 代码动作 / 引用与实现 / 调用与类型层级」。这些动作彼此耦合：
// 快速修复要复用套用编辑、重命名要复用 `applyEditsToFiles`、批量修复要复用 `applyCodeAction`，
// 所以它们是一个域而不是六个模块。层级视图的**展示**在 src/hierarchyView.ts，这里只负责
// `prepareHierarchy` 的触发。
import { computed, nextTick, ref, type Ref } from 'vue'
import { lspDiagnostics, request, type DocumentData, type GeneralSettingsState, type LspCodeAction, type LspCodeActionResults,
         type LspExecuteCommandResult, type LspFileEdits, type LspFormatResult, type LspLocation, type LspPrepareRenameResult,
         type LspRange, type LspReferencesResult, type LspRenameResult, type LspSignatureHelpResult, type SaveResult, type Workspace } from './bridge'
import { applyTextEdits, wordAt } from './editorText'
import { chooseTargetRows, implementationChooserTitle, implementationsUsageTitle, loadTargetContents, NO_IMPLEMENTATIONS_MESSAGE,
         sortTargetRows, typeChooserTitle, type ChooseTargetRow } from './chooseTarget.ts'
import { failReferences, finishReferences, startReferences } from './referenceContents.ts'
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
  const { notify, isDesktop, generalSettings, workspace, active, activePath, findTab, editorFor, lspOn, lspReady, save,
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
  try {
    const result = await request<LspFormatResult>('lsp.request', {
      kind: range ? 'rangeFormatting' : 'formatting', path, line: 0, character: 0, ...(range ? { range } : {}),
    })
    if (!result.available || !result.edits?.length) { notify(range ? '所选内容无需格式化，或语言服务不支持选区格式化。' : '无需格式化，或语言服务不支持格式化。'); return }
    let touched = 0
    for (const file of result.edits) {
      const open = findTab(file.path)
      if (!open) continue  // formatting only makes sense on an open buffer
      const base = editorFor(file.path)?.text() ?? open.content
      const next = applyTextEdits(base, file.textEdits)
      if (next === base) continue
      editorFor(file.path)?.setDraft(next)
      open.dirty = true  // buffer preview; user reviews then Ctrl+S
      ++touched
    }
    notify(touched ? '已格式化当前缓冲（未保存），检查后按 Ctrl+S 保存。' : '格式已是最新。')
  } catch (error) { notify(errorMessage(error), true) }
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
async function fixAllInFile() {
  const tab = active.value
  if (!tab || !lspOn(tab) || batchFixBusy.value) { notify('批量修复需要语言服务。', true); return }
  batchFixBusy.value = true
  let applied = 0
  try {
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
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: payload.path, line: payload.line, character: payload.character, diagnostics })
    // IDEA's "Show Fix…" variants keep only actions that actually fix a diagnostic;
    // the server marks those with `isPreferred` or a `diagnostics` backlink.
    let actions = result.actions ?? []
    if (onlyFixes) actions = actions.filter(action => action.preferred || action.linkedDiagnostics)
    if (!actions.length) { notify(onlyFixes ? '当前行没有与问题关联的快速修复。' : '此处没有可用的代码操作。'); return }
    if (actions.length === 1) { await applyCodeAction(actions[0]!); return }
    codeActions.value = actions
    actionPrompt.value = { path: payload.path }
  } catch (error) { notify(errorMessage(error), true) }
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
    await applyEditsToFiles(result.edits, `已重命名为 ${newName}`)
    if (target.path === activePath.value) await refreshOutline(target.path)
  } catch (error) { notify(errorMessage(error), true) }
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
  }
}
