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
// 改写落进编辑器也要给那一篇换修订号 —— 见 src/documentRevisions.ts（提交检查的指纹吃它）。
import { bumpDocumentRevision } from './documentRevisions.ts'
import { chooseTargetRows, implementationChooserTitle, implementationsUsageTitle, loadTargetContents, NO_IMPLEMENTATIONS_MESSAGE,
         sortTargetRows, typeChooserTitle, type ChooseTargetRow } from './chooseTarget.ts'
import { failReferences, finishReferences, startReferences } from './referenceContents.ts'
// 「优化导入」的请求形状与动作筛选（上游 `LspImportOptimizer.kt:68-80`）。
import { organizeImportsActionOf, organizeImportsRequest } from './organizeImports.ts'
import { mergePreviewEdits, nonCodeRenameEdits, nonCodeRenameSummary, renameConflictMessage, renamePreviewOf,
         renameTargetConflict, renameTargetConflictMessage, renameUsageSummary, SEARCH_IN_COMMENTS_DEFAULT,
         type NonCodeRenameEdits, type RenamePreview } from './renamePreview.ts'
// 重构预览（上游 `RefactoringDialog` + `UsageViewImpl`：应用前把「要改哪些地方」印成用法树，
// 用户确认后才写盘）。模型在 src/refactorPreview.ts，扫描在 src/nonCodeUsages.ts。
import { buildRefactorPreview, previewRequired, refactorPreviewTree, type RefactorPreviewNode } from './refactorPreview.ts'
import { commentStyleFor } from './commentToggle.ts'
import { suppressionActionsFor } from './localIntentions.ts'
// 意图列表的档位顺序（上游 `CachedIntentions.getAllActions()` 的「先修复后意图」）与空档不占位，
// 规则本体在 `src/intentionList.ts`；`openCodeActions` 是 Alt+Enter 那一路的消费方，
// 行菜单那一路的消费方是 `src/components/IntentionListMenu.vue`。
import { orderIntentionSections } from './intentionList.ts'
// 扩展点 `com.intellij.intentionMenuContributor`：第三方按 id 挂的菜单贡献者往 Alt-Enter 里补条目
// （消费点 `openCodeActions`，见下面 `collectedIntentions`）。
import { collectedIntentions } from './intentionExtensionPoints.ts'
// 扩展点 `com.intellij.refactoring.elementListenerProvider`：重命名落地后通知登记的监听者
// （消费点 `writeRename`，见 `src/refactorRenameExtensionPoints.ts`）。
import { notifyRefactoringElementListeners } from './refactorRenameExtensionPoints.ts'
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
// 同一个模块的第二条 import：上面那条的形态被 `tests/formatter-tags.test.mjs:91` 逐字钉住
// （`import { filterFormatEdits } from './formatterTags.ts'`），并进去就会红 —— 门禁不动，这里多写一行。
import { enabledFormatRanges, mergeFormatParts } from './formatterTags.ts'
import { mergeFormattingResult } from './formattingMerge.ts'
// 格式化准入（`ExcludedFileFormattingRestriction`/`UntrustedFileFormattingServiceSuppressor`）与
// 进度行（`FormattingProgressTask`）：规则在 src/formattingRestriction.ts，任务表在 src/progressTasks.ts。
import { formattingRestrictionFor } from './formattingRestriction.ts'
// 每份文件生效的缩进（`CodeStyleSettings.getIndentSize` + `FileIndentOptionsProvider` 链）与
// 格式化后处理设置（`PostFormatProcessor`）：模型在 src/codeStyleSettings.ts / src/postFormatProcessors.ts。
import { indentOptionsFromSettings, makeEditorConfigReader, postFormatSettings, resolveIndentOptions } from './codeStyleSettings.ts'
import { postFormatRegions, processFormattedText } from './postFormatProcessors.ts'
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
async function onSemantic(payload: { kind: 'rename' | 'references' | 'codeAction' | 'format' | 'signature' | 'implementation' | 'callHierarchy' | 'typeHierarchy' | 'typeDefinition'; path: string; line: number; character: number; range?: LspRange; usage?: { shortName: string; longName: string; typeLabel: string } }) {
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
  // 标题两段来自**按语言的 provider 层**（上游 `FindUsagesProvider.getNodeText`/`getDescriptiveName`，
  // 规则在 `src/findUsagesProvider.ts`）：调用方（文件树「查找用法」）已经拿 LSP 的 documentSymbol
  // 算好短名/描述名就带进来；没有就退回光标处的词（上游 provider 一个都没命中时也是这个兜底）。
  const search = startReferences(payload.usage?.shortName || symbol, payload.usage?.longName || `${payload.path}#${symbol}`)
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
  // csi/formatter ③（本轮补）：选区跨 `@formatter:off` 边界时，上游是把禁用段**从要重排的区间里挖掉**、
  // 其余照常重排（`CodeFormatterFacade.java:232-235` 记禁用区间 + `InitialInfoBuilder.java:334` 跳过段内空白），
  // 而不是「跨界那条编辑一起放弃」。本仓重排在语言服务那边，所以切分落在**请求侧**：
  // 区间按 `enabledFormatRanges` 切成仍可格式化的子区间，每段各发一次 `rangeFormatting`
  // （规则、边界与上游坐标见 src/formatterTags.ts 末尾那一节）。拿不到缓冲文本（非编辑器入口）
  // 或文件里没有标记时不额外切段，仍是原来那一次请求。
  const subRanges: LspRange[] = range && before !== undefined ? enabledFormatRanges(before, range) : []
  if (range && before !== undefined && !subRanges.length) {
    // 整段都落在禁用区里 ⇒ 一条请求都不发（上游同样什么都不会改），提示沿用套完编辑后那句的同一口径。
    notify('格式化标记（@formatter:off）已禁用这些区域，未做改动。')
    return
  }
  // 进度行（上游 `FormattingProgressTask`）：格式化是异步长请求，状态栏的后台任务列表可见。
  backgroundTaskManager.begin(FORMAT_FORMATTING_TASK_ID, '正在格式化', { detail: path })
  try {
    const result = await requestFormatting(path, range, subRanges, indent)
    if (!result.available || !result.edits?.length) { notify(range ? '所选内容无需格式化，或语言服务不支持选区格式化。' : '无需格式化，或语言服务不支持格式化。'); return }
    let touched = 0
    let suppressed = result.dropped   // 切段合并时服务器越界给出的重叠/重复编辑（`mergeFormatParts` 拦下的）
    let conflicted = 0
    let insertedSpaces = 0
    let collapsedBlanks = 0
    for (const file of result.edits) {
      const open = findTab(file.path)
      if (!open) continue  // formatting only makes sense on an open buffer
      const base = editorFor(file.path)?.text() ?? open.content
      // 格式化标记（`// @formatter:off` … `// @formatter:on`）：请求已经按启用子区间切过段（上），
      // 这里再兜一道 —— 服务器不守区间时给出的跨界/落段编辑整条丢掉（规则与边界见 src/formatterTags.ts）。
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
      // 格式化后处理（上游那一串 `PostFormatProcessor` + `WhiteSpace.arrangeLineFeeds` 的空行上限，
      // 两条规则都在 src/postFormatProcessors.ts）：语言服务重排完之后补跑一遍，只对发起格式化的那份文件。
      // 区间口径三条（都有上游出处，见该文件头）：
      //   · **只跑启用段** —— `CoreCodeStyleUtil.java:121-142` 把后处理限制在
      //     `FormatterTagHandler.getEnabledRanges` 里，所以 `// @formatter:off` 段里的行注释不补空格、
      //     空行也不并掉（此前这里传的是整份文本，禁用段会被改到）；
      //   · **只跑本次重排的那几段** —— 上游 `postProcessRanges` 收的是格式化区间（`:101-118`），
      //     选区格式化不该动选区外的空行；本仓用 `postFormatRegions()` 把请求侧的区间端点
      //     按已套用的编辑平移过来（上游靠 `RangeFormatInfo` 的智能指针重取，本仓没有 PSI）；
      //   · 用户在格式化期间改过文档那一档（`snapshot !== undefined`）：端点换算不含用户那半位移
      //     ⇒ 退回「整份文本 ∩ 启用段」，不假装换算准确。
      if (file.path === path) {
        const regions = snapshot === undefined
          ? postFormatRegions(base, edits, range ? (subRanges.length ? subRanges : [range]) : [])
          : []
        const processed = processFormattedText(next, regions, postFormatSettings.value, commentStyleFor(undefined, file.path))
        if (processed.text !== next) {
          next = processed.text
          insertedSpaces += processed.inserted
          collapsedBlanks += processed.collapsed
        }
      }
      editorFor(file.path)?.setDraft(next)
      // 意图/重构把预览正文刷进编辑器 = 上游 documentChanged（`DocumentImpl.java:171`）⇒ 这一篇换号，
      // 提交检查的指纹才跟得上"内容又变了"那一维（`src/commitChecksResult.ts` 的第 3 段）。
      bumpDocumentRevision(file.path)
      open.dirty = true  // buffer preview; user reviews then Ctrl+S
      ++touched
    }
    // 后处理干了什么要单独说（上游的字符串没有这一条，本仓既有口径是「重排 + 括号里的本地补跑」）：
    // 补空格与并空行是两条规则，分开报数才不会让人以为语言服务做了这两件事。
    const postNote = [
      insertedSpaces ? `补齐行注释空格 ${insertedSpaces} 处` : '',
      collapsedBlanks ? `合并多余空行 ${collapsedBlanks} 行` : '',
    ].filter(Boolean).join('，')
    if (conflicted) notify(`格式化结果与你在格式化期间的修改重叠，已跳过 ${conflicted} 个文件以免覆盖；请重新格式化。`)
    else if (!touched && suppressed) notify('格式化标记（@formatter:off）已禁用这些区域，未做改动。')
    else notify(touched ? `已格式化当前缓冲（未保存），检查后按 Ctrl+S 保存。${postNote ? `（已按代码风格${postNote}）` : ''}` : '格式已是最新。')
  } catch (error) { notify(errorMessage(error), true) }
  finally { backgroundTaskManager.end(FORMAT_FORMATTING_TASK_ID) }
}

/**
 * 一份格式化响应里本文件用得上的部分：`bridge` 的 `LspFormatResult` 加上「切段合并时丢掉了几条」。
 */
type FormatResponse = LspFormatResult & { dropped: number }

/**
 * 子区间的条数上限。切段是为了让「禁用段之外照样重排」，但每段都是一次语言服务往返，
 * 标记密集的长选区（例如一份到处是 `@formatter:off` 的生成文件）不能把一次格式化变成几十次请求。
 * 超过这个数就退回**一次请求覆盖整个选区** + 响应侧 `filterFormatEdits` 兜底（= 本轮之前的行为）。
 */
const MAX_FORMAT_SUBRANGES = 8

/**
 * 发格式化请求（`runFormatting` 的请求侧，两种形态）：
 *   · 整缓冲重排 → 一次 `textDocument/formatting`；
 *   · 选区重排 → 区间先按 `@formatter:off` 切成仍可格式化的子区间（`enabledFormatRanges`）：
 *     一段（含「文件里没标记」那种原样返回）就只请求那一段，多段就**每段各发一次**
 *     `textDocument/rangeFormatting` 再把响应并起来（`mergeFormatParts`）。
 * 上游的对位做法：`CodeFormatterFacade.java:232-235` 把禁用段记进 `FormatTextRanges`，
 * `InitialInfoBuilder.java:334` 对段内空白跳过处理 ⇒ 禁用段之外的部分照常重排。
 */
async function requestFormatting(path: string, range: LspRange | undefined, subRanges: readonly LspRange[],
  indent: { indentSize: number; useTabCharacter: boolean }): Promise<FormatResponse> {
  const send = (part?: LspRange) => request<LspFormatResult>('lsp.request', {
    kind: part ? 'rangeFormatting' : 'formatting', path, line: 0, character: 0,
    tabSize: indent.indentSize, insertSpaces: !indent.useTabCharacter,
    ...(part ? { range: part } : {}),
  })
  if (!range) return { ...(await send()), dropped: 0 }
  if (subRanges.length === 1) return { ...(await send(subRanges[0]!)), dropped: 0 }
  if (subRanges.length > 1 && subRanges.length <= MAX_FORMAT_SUBRANGES) {
    const parts: LspFormatResult[] = []
    for (const sub of subRanges) parts.push(await send(sub))
    return mergeFormatParts(parts)
  }
  // 没切出可排的子区间（调用方已提前返回）或段数超上限：一次请求覆盖整个选区，跨界编辑交给 filterFormatEdits。
  return { ...(await send(range)), dropped: 0 }
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
  // 本地两半**按档位分开**，不再串成一条 `localActions`：抑制条目是「意图」（上游
  // `SuppressIntentionAction.java:19` 的 `implements IntentionAction` ⇒ 进 `myIntentions`），
  // JUnit 那两条是「快速修复」（上游 inspection 的 quick fix ⇒ 进 `myInspectionFixes`）。
  // 谁在前谁在后不由"哪段代码先写"决定，由 `src/intentionList.ts` 的 `INTENTION_GROUP_ORDER`
  // 决定（上游 `CachedIntentions.java:353-368` 的 `getAllActions()`：先 errorFixes/inspectionFixes，
  // 后 intentions）⇒ Alt+Enter 弹层里 JUnit 的修复现在排在抑制注释**前面**（旧形状是反的）。
  const suppressions = !onlyFixes && tab
    ? suppressionActionsFor({
        path: payload.path, text: tab.content, diagnostics: lineRows,
        enabled: isIntentionEnabled,
      })
    : []
  const localFixes = !onlyFixes && tab
    // JUnit 修复只要 `{行, 来源}`（`JunitQuickFixInput.diagnostics`），`source` 缺省成空串 ——
    // 两条规则（MisorderedAssertEqualsArguments / JUnit3StyleTestMethodInJUnit4Class）都按来源分流。
    ? junitQuickFixActions({
        path: payload.path, text: tab.content,
        diagnostics: lineRows.map(item => ({ line: item.line, source: item.source ?? '' })),
      })
    : []
  // 扩展点 `com.intellij.intentionMenuContributor`：第三方按 id 挂的贡献者往菜单里补条目
  // （上游 `ShowIntentionsPass` 遍历 EP 逐条 collectActions）。bundled 是 passthrough ⇒ 行为不变。
  const contributed = !onlyFixes && tab
    ? collectedIntentions({
        path: payload.path,
        language: payload.path.includes('.') ? payload.path.slice(payload.path.lastIndexOf('.') + 1).toLowerCase() : '',
        text: tab.content, line: payload.line, character: payload.character, passId: 0,
      }).map((row, index) => ({
        title: row.title, index: -(index + 1), kind: row.kind, preferred: row.preferred,
        edits: [...row.edits], command: row.command,
      }))
    : []
  let serverFailed: unknown
  let serverActions: LspCodeAction[] = []
  try {
    const result = await request<LspCodeActionResults>('lsp.request', { kind: 'codeAction', path: payload.path, line: payload.line, character: payload.character, diagnostics })
    serverActions = result.actions ?? []
  } catch (error) { serverFailed = error }
  // IDEA's "Show Fix…" variants keep only actions that actually fix a diagnostic;
  // the server marks those with `isPreferred` or a `diagnostics` backlink.
  // 空档不占位（上游 `getAllActions()` 就是几条列表串起来，空的自然没那一段），有档才排。
  const actions = orderIntentionSections<LspCodeAction>([
    { group: 'fix', rows: [...(onlyFixes ? serverActions.filter(action => action.preferred || action.linkedDiagnostics) : serverActions), ...localFixes] },
    { group: 'intention', rows: [...contributed, ...suppressions] },
  ]).flatMap(section => section.rows)
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
// 请求形状与动作筛选的规则在 `src/organizeImports.ts`（逐条对着上游 `LspImportOptimizer.kt:68-80`）。
async function runOrganizeImports() {
  const tab = active.value
  if (!tab || !lspReady.value) { notify('优化导入需要语言服务。', true); return }
  // 上游那一份 LSP 侧实现（`platform/lsp-impl/src/impl/features/formatter/LspImportOptimizer.kt`）：
  //   · `:77-80` 范围是 `Range(Position(0,0), Position(0,0))`，源码注释写着 `// doesn't matter`
  //     ⇒ 整理导入是**文件级**动作，与光标在哪一列无关；本仓此前问的是光标处（`caretPayload()`），
  //     服务器按范围筛动作时光标落在字符串/注释里就可能不给 source 动作
  //     ⇒「动一下光标，Ctrl+Alt+O 就忽然能用/忽然不能用」；
  //   · `:70-72` `only = listOf(SourceOrganizeImports)` 那一档要宿主在 `textDocument/codeAction` 的
  //     context 里补（`native/lsp_code_actions.cpp:44-46` 目前只发 `diagnostics`）⇒ 见
  //     `docs/wiring-requests-2026-10-06-refactorfix.md` R2；在它补上之前按 `kind` 精确筛，
  //     标题正则只留给没填 kind 的老服务器（上游从不按标题认动作）。
  //     （订正留痕：这里原先引的是 `docs/wiring-requests-2026-10-06-refactor1.md` R1 —— 本仓**没有**
  //     那份文档，而真实存在的 `...-refactor.md` 的 R1 写的是树侧删除，不是这一件事。）
  try {
    const result = await request<LspCodeActionResults>('lsp.request', organizeImportsRequest(tab.path))
    const action = organizeImportsActionOf(result.actions ?? [])
    if (!action) { notify('语言服务没有提供可用的导入优化。'); return }
    actionPrompt.value = { path: tab.path }
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
//
// 两道拦下都放在 `file.rename` **之前**（改名一旦落地就把旧路径吃掉了，回不去）：
//   · 目标位已被占用 —— 上游 `CopyFilesOrDirectoriesHandler.checkFileExist`
//     （`platform/lang-impl/src/com/intellij/refactoring/copy/CopyFilesOrDirectoriesHandler.java:543-571`）
//     问「覆盖 / 跳过」，选跳过就 `RenameProcessor.java:230-237` 把这个条目从改名集合里 remove；
//     关闭对话框在 `SkipOverwriteChoice.java:50` 同样落到 SKIP ⇒ 本仓按「跳过」那一支什么都不做
//     （四选一需要弹层宿主；订正留痕：这里原先引的 `docs/wiring-requests-2026-10-06-refactor1.md` R2
//     本仓**没有**那份文档，请求改记在 `docs/wiring-requests-2026-10-06-refactorfix.md` R3）。
//   · 语言服务给的引用编辑互相覆盖 —— 与符号重命名同一份账（`renamePreviewOf`），
//     上游对位 `RenameProcessor.preprocessUsages`（`:166-188`）：冲突没清掉就 return false，
//     一个文件都不写。此前这条链**直接** `applyTextEdits` 落盘，重叠的 WorkspaceEdit 会把文件改花。
async function renameEntryWithReferences(from: string, to: string) {
  const conflict = renameTargetConflict(from, to, workspace()?.entries ?? [])
  if (conflict) { notify(renameTargetConflictMessage(conflict, from), true); return }
  let referenceEdits: LspFileEdits[] = []
  if (isDesktop && workspace()) {
    try {
      const result = await request<LspFormatResult>('lsp.request',
        { kind: 'willRenameFiles', path: from, line: 0, character: 0, newPath: to })
      referenceEdits = result.available ? result.edits ?? [] : []
    } catch { /* 没有语言服务：跳过更新引用，改名照做 */ }
  }
  const preview = renamePreviewOf(referenceEdits)
  if (preview.conflicts.length) { notify(renameConflictMessage(preview), true); return }
  await request('file.rename', { from, to })
  await retitleTab(from, to)
  if (preview.edits.length) await applyEditsToFiles(preview.edits, `已更新 ${baseName(from)} 的引用（${renameUsageSummary(preview)}）`)
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
    if (open) {
      open.content = next; open.version = saved.version; open.dirty = false
      editorFor(file.path)?.setDraft(next)
      // 写盘 + 把新正文刷进编辑器 = 这一篇的正文换了一版（上游 documentChanged，`DocumentImpl.java:171`）
      // ⇒ 提交检查的指纹要跟着换号，否则上一轮结果被当成还作数。
      bumpDocumentRevision(file.path)
    }
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
