// 重构预览（上游 `platform/lang-impl/src/com/intellij/refactoring/`：`RefactoringPreviewComponent` /
// `PreviewUsage` 一族 —— 重命名、移动、安全删除都会先把将要改的每一处列进预览树，
// 用户确认后才写盘；`RenameProcessor` 的 `RenameInputValidator` 在对话框里逐键校验新名字）。
//
// 本仓现状：`src/semanticActions.ts` 的 `applyEditsToFiles` 拿到 `WorkspaceEdit` **直接写盘**，
// 没有预览、没有冲突提示；重命名输入框只校验空名（`invalidRenameName` 由宿主装配）。
// 这个模块补两件纯规则：
//   · `buildRefactorPreview`：把跨文件编辑（LSP `WorkspaceEdit`）整理成「文件 → 改动块」的预览，
//     带旧文本（有当前内容时）与**重叠冲突**标记 —— 预览里第一眼要能看出"这处会打架"；
//   · `validateRenameName`：按语言的标识符与关键字表校验新名字（IDEA 的 `RenameInputValidator`）。
//
// 预览里不写盘、不请求；接线的 `semanticActions` 只需在应用前把 edits 过一遍这个模型。

import type { LspFileEdits, LspTextEdit } from './bridge'
import { buildUsageTree, type UsageTreeNode } from './usageViewGrouping.ts'

/** 预览里的一处改动（`fromLine`/`toLine` 是 0 基行区间，`newText` 是替换文本的前几行）。 */
export interface PreviewHunk {
  fromLine: number
  toLine: number
  startChar: number
  endChar: number
  /** 被替换的原文（没有当前内容时为空串 = 预览只显示位置）。 */
  oldText: string
  newText: string
}

export interface PreviewFile {
  path: string
  editCount: number
  hunks: PreviewHunk[]
  /** 这个文件里有互相重叠的编辑（应用顺序会决定结果）—— 预览必须显式提示。 */
  conflict: boolean
}

export interface RefactorPreview {
  files: PreviewFile[]
  editCount: number
  conflictCount: number
  summary: string
}

function lineOffsets(content: string): number[] {
  const offsets = [0]
  for (let index = 0; index < content.length; ++index) if (content[index] === '\n') offsets.push(index + 1)
  return offsets
}

function offsetOf(offsets: readonly number[], line: number, character: number): number {
  const base = offsets[Math.max(0, Math.min(offsets.length - 1, line))] ?? 0
  return base + Math.max(0, character)
}

/** 同一文件里两条编辑的区间是否重叠（半开区间；只挨着不算）。没有内容时按行/列比较。 */
export function editsOverlap(left: LspTextEdit, right: LspTextEdit, content?: string): boolean {
  if (content === undefined) {
    if (left.endLine < right.startLine || right.endLine < left.startLine) return false
    if (left.endLine === right.startLine && left.endChar <= right.startChar) return false
    if (right.endLine === left.startLine && right.endChar <= left.startChar) return false
    return true
  }
  const offsets = lineOffsets(content)
  const leftFrom = offsetOf(offsets, left.startLine, left.startChar)
  const leftTo = offsetOf(offsets, left.endLine, left.endChar)
  const rightFrom = offsetOf(offsets, right.startLine, right.startChar)
  const rightTo = offsetOf(offsets, right.endLine, right.endChar)
  return leftFrom < rightTo && rightFrom < leftTo
}

/** 预览里一行改动文本的展示（多行只留首行 + 省略号，避免预览撑爆）。 */
export function previewLine(text: string): string {
  const first = text.split('\n')[0] ?? ''
  return text.includes('\n') ? `${first} …` : first
}

/**
 * 把跨文件编辑整理成预览。
 * `contents` 是「路径 → 当前文本」（打开中的缓冲区或读盘结果），有它才能显示旧文本与算准重叠；
 * 没有也照样给位置预览，只是 `oldText` 为空、重叠判定退化成行/列比较。
 */
export function buildRefactorPreview(edits: readonly LspFileEdits[], contents: Record<string, string> = {}): RefactorPreview {
  const files: PreviewFile[] = []
  let editCount = 0
  let conflictCount = 0
  for (const file of edits) {
    const content = Object.prototype.hasOwnProperty.call(contents, file.path) ? contents[file.path] : undefined
    const textEdits = Array.isArray(file.textEdits) ? file.textEdits : []
    const hunks: PreviewHunk[] = []
    let conflict = false
    for (let index = 0; index < textEdits.length; ++index) {
      const edit = textEdits[index]
      let oldText = ''
      if (content !== undefined) {
        const offsets = lineOffsets(content)
        const from = offsetOf(offsets, edit.startLine, edit.startChar)
        const to = offsetOf(offsets, edit.endLine, edit.endChar)
        oldText = content.slice(from, to)
      }
      hunks.push({
        fromLine: edit.startLine, toLine: edit.endLine,
        startChar: edit.startChar, endChar: edit.endChar,
        oldText, newText: previewLine(edit.text),
      })
      for (let other = index + 1; other < textEdits.length; ++other)
        if (editsOverlap(edit, textEdits[other], content)) { conflict = true; break }
      if (conflict) break
    }
    editCount += textEdits.length
    if (conflict) ++conflictCount
    files.push({ path: file.path, editCount: textEdits.length, hunks, conflict })
  }
  const parts = [`${files.length} 个文件`, `${editCount} 处修改`]
  if (conflictCount) parts.push(`${conflictCount} 处冲突`)
  return { files, editCount, conflictCount, summary: parts.join(' · ') }
}

/** 各语言的重命名保留字（IDEA 的 validator 也把关键字挡在「确定」之外）。 */
export const RENAME_KEYWORDS: Record<string, readonly string[]> = {
  java: ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null'],
  typescript: ['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static'],
  python: ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'],
  cpp: ['alignas', 'alignof', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'namespace', 'new', 'nullptr', 'operator', 'private', 'protected', 'public', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while'],
}

/** 标识符形态（Unicode 字母/`$`/`_` 开头；IDEA 对 Java 还禁 `$` 之外的符号）。 */
const IDENTIFIER = /^[$\p{L}_][$\p{L}\p{N}_]*$/u

/**
 * 校验重命名输入。返回错误文案（空串 = 合法，与 `semanticActions.ts` 的
 * `invalidRenameName` 契约一致：「空串表示名字合法」）。
 * 规则：不能空、不能带空白、必须是标识符形态、不能是语言关键字。
 */
export function validateRenameName(name: string, language: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '名字不能为空。'
  if (/\s/.test(trimmed)) return '名字不能包含空白字符。'
  if (!IDENTIFIER.test(trimmed)) return '名字必须是合法标识符（字母、数字、下划线，不能以数字开头）。'
  const keywords = RENAME_KEYWORDS[language] ?? []
  if (keywords.includes(trimmed)) return `「${trimmed}」是${language}关键字，不能用作名字。`
  return ''
}

/** 需要确认弹窗吗：有冲突、或改动跨多个文件时 IDEA 才弹预览（单文件单处直接改）。 */
export function previewRequired(preview: RefactorPreview): boolean {
  return preview.conflictCount > 0 || preview.files.length > 1 || preview.editCount > 1
}

/* ── 用法树：预览对话框要印的那棵树（上游 `UsageViewImpl` 的 `UsageViewTreeStructureProvider`） ── */

/**
 * 树上的一个文件/目录节点。结构直接来自 `usageViewGrouping.buildUsageTree`（目录层级 + 计数），
 * 这里只给**文件节点**补上逐处的旧/新文本。
 */
export interface RefactorPreviewNode {
  kind: 'directory' | 'file'
  name: string
  path: string
  /** 子树里的改动总数（目录 = 合计）。 */
  count: number
  children: RefactorPreviewNode[]
  /** 只有文件节点有：一处改动一行（行号 0 基，界面 +1）。 */
  rows: PreviewRow[]
}

/** 一处改动在树上的行（旧 → 新；`oldText` 为空串 = 只给了位置，拿不到原文）。 */
export interface PreviewRow {
  path: string
  line: number
  column: number
  oldText: string
  newText: string
  /** 这一处与同文件里另一处编辑区间重叠 —— 树里要标出来（`RenameConflict` 的可见形态）。 */
  conflict: boolean
}

/**
 * 把跨文件编辑整理成**目录 → 文件 → 位置**的用法树。
 *
 * 树结构复用 `usageViewGrouping.buildUsageTree`（那一族就是分组规则的本仓落点），
 * 逐处文本来自本模块的 `buildRefactorPreview`；两者按「同一文件内编辑的既有顺序」对齐 ——
 * 调用方传进来的 `edits` 已经是位置排好序的（`renamePreviewOf` 的产出），所以
 * 第 i 条编辑 ↔ 第 i 个位置是一一对应的。
 *
 * 与上游的差别（如实记）：上游的树节点还带**用法类型**图标（读/写/调用…），
 * 那要 `UsageInfo.getUsageInfo`（PSI 语义）；LSP `textDocument/references` 不带 kind，
 * 本仓只能给位置与前后文本。
 */
export function refactorPreviewTree(
  edits: readonly LspFileEdits[],
  contents: Record<string, string> = {},
  rootName = '工作区',
): RefactorPreviewNode {
  const flat = buildRefactorPreview(edits, contents)
  const positions = new Map<string, { line: number; character: number }[]>()
  for (const file of edits) positions.set(file.path, (file.textEdits ?? []).map(edit => ({
    line: edit.startLine, character: edit.startChar,
  })))
  const usageTree = buildUsageTree([...positions].flatMap(([path, list]) =>
    list.map(point => ({ path, line: point.line, character: point.character }))), rootName)

  const hunkOf = (path: string, line: number, character: number): PreviewHunk | undefined => {
    const index = (positions.get(path) ?? []).findIndex(point => point.line === line && point.character === character)
    return index < 0 ? undefined : flat.files.find(file => file.path === path)?.hunks[index]
  }
  const decorate = (node: UsageTreeNode<'directory' | 'file'>): RefactorPreviewNode => {
    const decorated: RefactorPreviewNode = {
      kind: node.kind, name: node.name, path: node.path, count: node.count,
      children: node.children.map(decorate), rows: [],
    }
    if (node.kind === 'file') {
      decorated.rows = node.locations.map(location => {
        const hunk = hunkOf(node.path, location.line, location.character ?? 0)
        return {
          path: node.path, line: location.line, column: location.character ?? 0,
          oldText: hunk?.oldText ?? '', newText: hunk?.newText ?? '',
          conflict: Boolean(flat.files.find(file => file.path === node.path)?.conflict),
        }
      })
    }
    return decorated
  }
  return decorate(usageTree)
}

/** 树顶那一行的标题（上游 `UsageInfo` 树的根节点；`summary` 的位置与 ID 一致）。 */
export function previewTreeTitle(flat: RefactorPreview, label: string): string {
  return `${label} — ${flat.summary}`
}
