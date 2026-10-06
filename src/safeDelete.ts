// 「安全删除」的引用检查（上游 `SafeDeleteProcessor` / `SafeDeleteDialog` / `SafeDeleteUsageSearcher`：
// 删除声明前先搜引用，把「还有 N 处引用」摆到用户面前，再让用户选「仍然删除 / 查看用法」）。
//
// 本批（2026-10-05）补上两件：
//   · **「仍然删除 / 查看用法」这个三选一**的模型与文案。权威是
//     `platform/lang-impl/src/com/intellij/refactoring/safeDelete/UnsafeUsagesDialog.java`：
//     `:35` 标题取 `usages.detected`、`:36` OK 按钮取 `delete.anyway.button`、
//     `:47` `createActions()` 的三个动作依次是 `ViewUsagesAction`（`:95-105`，带
//     `DEFAULT_ACTION`，即回车默认落在它上面）/ OK（「仍然删除」）/ `CancelAction`；
//     `:58` 清单抬头是 `the.following.problems.were.found`。中文文案取
//     `localization-zh.jar` 的 `messages/RefactoringBundle.properties` 同名键（助记符按本仓惯例去掉）。
//   · **注释/字符串里的用法**（`SafeDeleteProcessor.java:449-464` 的 `addNonCodeUsages`：
//     `:459` `addUsagesInStringsAndComments`、`:463` `addTextOccurrences`）——
//     规则与扫描在 `src/nonCodeUsages.ts`，这里只把它并进对话框模型。
//   · 搜索选项的缺省档照 `SafeDeleteDialog.java:163-165`（`RefactoringSettings.SAFE_DELETE_SEARCH_IN_COMMENTS` /
//     `..._IN_NON_JAVA`，新建实例为真；`RenameDialog.java:281` 的同名复选框也是默认勾上）。
//
// 删除入口那一步检查（删前提示「还有 N 处引用」）仍接在 `src/treeActions.ts` 的
// `beginDelete` → `warnBeforeDelete`；本模块是给**对话框**准备的纯模型。
// 纯逻辑（位置去重、文件计数、选项、文案）都在这里，组件侧只负责调用，可单测。
//
// 2026-10-06（桶 1 / A5）：加 `safeDeletePromptFromFiles()` —— 树侧与重构侧的删除入口只要给
// 「名字 + 语言服务的引用 + 文件文本」就能拿到同一份对话框模型，注释/字符串那半本账不会再被
// 漏掉（`style` 在模块里按路径补齐）。树侧那一行改写在 `src/treeActions.ts`（桶 14 名下、本片只读），
// 以**接线请求**交出：`docs/wiring-requests-2026-10-06-format.md` W1。
// 重构菜单/Alt+Delete 那一侧（`src/refactorHostAssembly.ts`）已在上一轮接好（同一份模型）。
import type { LspLocation } from './bridge'
import { commentStyleFor } from './commentToggle.ts'
import { groupNonCodeUsages, nonCodeReport, type NonCodeReport } from './nonCodeUsages.ts'

/** LSP `textDocument/references` 结果里本仓用得上的部分（与 bridge 的 `LspLocation` 同形）。 */
export interface SafeDeleteReport {
  /** 去重后的引用处数。 */
  usages: number
  /** 涉及几个文件（按路径去重）。 */
  files: number
}

/** 同一位置可能被服务器重复报（同一符号的声明/实现各算一条）；按 (path,line,character) 去重。 */
export function safeDeleteReport(refs: readonly LspLocation[]): SafeDeleteReport {
  const seen = new Set<string>()
  const files = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.path}\u0000${ref.line}\u0000${ref.character}`
    if (seen.has(key)) continue
    seen.add(key)
    files.add(ref.path)
  }
  return { usages: seen.size, files: files.size }
}

/**
 * 有引用时的提示语。上游 `SafeDeleteDialog` 的两句文案（`IdeBundle`）在中文界面里的对应物：
 * 「找到 N 处用法」+ 删除会让它们失效的后果。没有引用时返回空串（不打扰用户）。
 */
export function safeDeleteNotice(name: string, report: SafeDeleteReport): string {
  if (report.usages <= 0) return ''
  return `「${name}」还有 ${report.usages} 处引用（${report.files} 个文件）：删除后它们会失效。` +
         '可先用右键菜单「查找用法」逐个处理。'
}

/**
 * 删除前要检查的符号：文件声明的、与文件同名的类型（`FindUsagesAction` 对文件的目标选择）。
 * 取不到同名类型就退到第一个类型符号；没有类型符号（纯文本）返回 null —— 那种文件无引用可查。
 */
export function declarationTarget(path: string, symbols: readonly { name: string; kind: number; startLine: number; startChar: number }[]): { startLine: number; startChar: number } | null {
  // LSP SymbolKind：5 class、11 interface、23 struct、26 enum（与 `treeActions` 原实现一致）。
  const classKinds = new Set([5, 11, 23, 26])
  const stem = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  const declaration = symbols.find(symbol => symbol.name === stem && classKinds.has(symbol.kind))
    ?? symbols.find(symbol => classKinds.has(symbol.kind))
  return declaration ? { startLine: declaration.startLine, startChar: declaration.startChar } : null
}

/* ── 对话框模型：三个选择（上游 `UnsafeUsagesDialog`） ───────────────────────── */

/**
 * 「安全删除」检测到用法时给用户的三选一。
 * 顺序与缺省态照 `UnsafeUsagesDialog.java:47`：`viewUsages` 在前且是 `DEFAULT_ACTION`
 * （`:98` `putValue(DialogWrapper.DEFAULT_ACTION, Boolean.TRUE)`）—— 回车落在**查看用法**上，
 * 删不掉的东西要让用户先看见。
 */
export type SafeDeleteChoice = 'viewUsages' | 'deleteAnyway' | 'cancel'

/** 三个按钮（文案取 `messages/RefactoringBundle.properties` 的 zh 语言包值，助记符按本仓惯例去掉）。 */
export const SAFE_DELETE_CHOICE_LABELS: Record<SafeDeleteChoice, string> = {
  viewUsages: '查看用法',   // :318 view.usages=&View Usages → 查看用法(&V)
  deleteAnyway: '仍然删除',  // :313 delete.anyway.button=&Delete Anyway → 仍然删除(&D)
  cancel: '取消',           // :317 cancel.button=Ca&ncel → 取消(&N)
}

/** 对话框标题（`UnsafeUsagesDialog.java:35` → `usages.detected`，zh 包 = 检测到用法）。 */
export const SAFE_DELETE_TITLE = '检测到用法'
/** 清单抬头（`UnsafeUsagesDialog.java:58` → `the.following.problems.were.found`，zh 包 = 发现以下问题：）。 */
export const SAFE_DELETE_LEAD = '发现以下问题：'

/** 两个搜索选项（`SafeDeleteDialog.java:149/155` 的两个复选框）。 */
export interface SafeDeleteOptions {
  searchInComments: boolean
  searchTextOccurrences: boolean
}

/**
 * 缺省档（`SafeDeleteDialog.java:163-165` 读 `RefactoringSettings.SAFE_DELETE_SEARCH_IN_COMMENTS` /
 * `..._SEARCH_IN_NON_JAVA`，新建实例为真）。「搜索文本匹配项」在没有 `file.usages` 那种
 * 整仓文本扫描的宿主上拿不到结果，所以缺省**关**——不勾一个点了没反应的东西。
 */
export function defaultSafeDeleteOptions(): SafeDeleteOptions {
  return { searchInComments: true, searchTextOccurrences: false }
}

export interface SafeDeleteChoiceRow { id: SafeDeleteChoice; label: string; primary: boolean }

export interface SafeDeletePrompt {
  title: string
  lead: string
  /** 语言服务给的代码引用账。 */
  usages: SafeDeleteReport
  /** 注释/字符串里的用法账（没扫就是 null —— 上游没勾那个框时也是空列表）。 */
  nonCode: NonCodeReport | null
  options: SafeDeleteOptions
  choices: SafeDeleteChoiceRow[]
  /**
   * 问题清单（`UnsafeUsagesDialog.java:61-66` 逐条 `<br><br>`，本仓是逐行）。
   * 每行已经带上分类标签，让用户知道哪条是代码引用、哪条是注释/字符串里的字面出现。
   */
  details: string[]
  /** 清单之外的收尾说明（后果 + 截断提示）。 */
  footer: string
  /** 代码引用与字面出现都没有 → 不出对话框（调用方直接删）。 */
  blocked: boolean
}

/** `path:line`（1 基，与 `UnsafeUsagesDialog` 里给用户看的口径一致）。 */
function place(path: string, line: number, character?: number): string {
  return character === undefined ? `${path}:${line + 1}` : `${path}:${line + 1}:${character + 1}`
}

/** 清单里最多列几条（超出只计数 + 一行「还有 N 条」；上游的清单是滚动面板，这里给个数上限）。 */
export const SAFE_DELETE_MAX_DETAILS = 20

/**
 * 组装删除前的确认对话框模型。
 *   · `refs` 是语言服务 `textDocument/references` 的原始结果（账由 `safeDeleteReport` 算）。
 *   · `nonCode` 为 null/空表示没扫或没找到。
 * 有任何一条问题才 `blocked`（要用户决定）；否则调用方直接删。
 */
export function safeDeletePrompt(
  name: string,
  refs: readonly LspLocation[] = [],
  nonCode: NonCodeReport | null = null,
  options: SafeDeleteOptions = defaultSafeDeleteOptions(),
): SafeDeletePrompt {
  const usages = safeDeleteReport(refs)
  const details: string[] = []
  if (usages.usages > 0) details.push(`代码引用 ${usages.usages} 处（${usages.files} 个文件）—— 删除后这些地方会编译不过。`)
  // 逐条列出（上游 `UnsafeUsagesDialog.java:61-66` 逐条印冲突描述；本仓给 `path:line:col`）。
  const seen = new Set<string>()
  const codeItems: string[] = []
  for (const ref of refs) {
    const key = `${ref.path} ${ref.line} ${ref.character}`
    if (seen.has(key)) continue
    seen.add(key)
    codeItems.push(`引用：${place(ref.path, ref.line, ref.character)}`)
  }
  const stringItems: string[] = []
  for (const group of groupNonCodeUsages(nonCode ?? { comments: 0, strings: 0, usages: 0, files: 0, occurrences: [], truncated: false })) {
    for (const occurrence of group.occurrences)
      stringItems.push(`${group.label}：${place(occurrence.path ?? '', occurrence.line, occurrence.character)}`)
  }
  const items = [...codeItems, ...stringItems]
  const shown = items.slice(0, SAFE_DELETE_MAX_DETAILS)
  details.push(...shown)
  if (items.length > shown.length) details.push(`还有 ${items.length - shown.length} 条未列出。`)
  const truncated = Boolean(nonCode?.truncated)
  return {
    title: SAFE_DELETE_TITLE,
    lead: SAFE_DELETE_LEAD,
    usages,
    nonCode: nonCode && nonCode.usages > 0 ? nonCode : null,
    options,
    choices: (['viewUsages', 'deleteAnyway', 'cancel'] as const)
      .map(id => ({ id, label: SAFE_DELETE_CHOICE_LABELS[id], primary: id === 'viewUsages' })),
    details,
    footer: truncated
      ? `非代码引用的扫描已达上限，上面不是全部。「查看用法」会把这些结果放进引用窗口。`
      : `「查看用法」会把这些结果放进引用窗口。删除「${name}」本身不做任何改动。`,
    blocked: details.length > 0,
  }
}

/* ── 一次调用的组装：文件文本 → 完整对话框模型（A5 的模块侧）─────────────────── */

/** 参与「注释与字符串里的用法」扫描的一份文件文本。 */
export interface SafeDeleteFileText { path: string; text: string }

/**
 * 被删符号在本仓文本扫描里用的那个词：取路径最后一段并去掉扩展名
 * （`Widget.java` → `Widget`；没有点、或以点开头的名字（`.editorconfig`）就整体当词）。
 * 上游对位的是 `ElementDescriptionUtil.getElementDescription(element,
 * NonCodeSearchDescriptionLocation.STRINGS_AND_COMMENTS)`（`SafeDeleteProcessor.java:457-459`），
 * 拿到的就是那个声明的名字 —— 本仓删除入口的对象是文件，故词 = 文件名主干（与 `refactorHostAssembly`
 * 那份 `fileStem` 同一条口径，收在这里就不再要调用方各写一遍）。
 */
export function safeDeleteSearchWord(name: string): string {
  const base = (name.split('/').pop() ?? name).trim()
  const stem = base.replace(/\.[^.]+$/, '')
  return stem || base
}

/**
 * 从「文件文本」直接组装删除前的对话框模型 —— `safeDeletePrompt()` 的调用面，
 * 把两件容易写错的事收在模块里：
 *   1. **注释标记必须按路径给**：`nonCodeReport()` 认的是 `FileText{path,text,style}`，
 *      `style` 缺省为 null 时只扫字符串 ⇒ 注释那一半**静默漏报**。这里统一用
 *      `commentStyleFor(undefined, path)`（扩展名档）补齐，调用方只给 `{path,text}`。
 *   2. **两个搜索开关得真的管住扫描**：上游 `SafeDeleteProcessor.addNonCodeUsages`
 *      （`:447-464`；本仓旧注释写的 `:449-464` 是签名头两行往前挪了一位，实际方法从 `:447` 起）
 *      里 `searchInCommentsAndStrings` 为假就**根本不扫**
 *      （`:457-460` 那个 `if`），`searchNonJava` 为假就不走 `addTextOccurrences`（`:461-463`）。
 *      本仓 `searchInComments` 为假 ⇒ `nonCode = null`（对话框里那一栏空着，与上游"没勾就是空列表"同效）；
 *      `searchTextOccurrences` 在本仓没有对应的宿主通道（见 `docs/wiring-requests-2026-10-06-bucket1b.md`
 *      「不做」第 1 条），缺省关，且**不影响**注释/字符串那一半的扫描。
 * 是否弹三选一由调用方按返回值的 `blocked` 决定（`blocked` 为假时上游也是直接删）。
 */
export function safeDeletePromptFromFiles(
  name: string,
  refs: readonly LspLocation[],
  files: readonly SafeDeleteFileText[],
  options: SafeDeleteOptions = defaultSafeDeleteOptions(),
): SafeDeletePrompt {
  const word = safeDeleteSearchWord(name)
  const nonCode = options.searchInComments
    ? nonCodeReport(files.filter(file => file.text !== '').map(file => ({
        path: file.path, text: file.text, style: commentStyleFor(undefined, file.path),
      })), word)
    : null
  return safeDeletePrompt(name, refs, nonCode, options)
}
