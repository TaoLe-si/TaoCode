// 「转到声明」多目标时的**选择弹层**（IDEA `GotoDeclarationAction` 的 Choose Declaration）。
// 纯逻辑：把 LSP 的 `Location[]` 变成弹层的行，外加过滤与移动两条规则。零 Vue、零 DOM。
//
// 上游链条（逐条核过，坐标在注释里）：
//   · `GotoDeclarationOnlyHandler2.gotoDeclaration`（`platform/lang-impl/src/com/intellij/codeInsight/
//     navigation/actions/GotoDeclarationOnlyHandler2.kt:60-76`）把导航结果分成两种：
//     `SingleTarget` → **直接跳**；`MultipleTargets` → `buildTargetPopup(targets, …)` 开弹层。
//     弹层标题 = `CodeInsightBundle.message("declaration.navigation.title")`
//     （`platform/lang-api/resources/messages/CodeInsightBundle.properties:146` = "Choose Declaration"）。
//     即：**只有一个目标时不该出现任何弹层** —— 本仓原来对多目标取 `locations[0]` 直接跳，
//     多的那些目标用户永远看不到，这一条就是补它。
//   · 一行三段 = `TargetPresentationMainRenderer.customizeCellRenderer`
//     （`platform/platform-impl/src/com/intellij/ui/list/TargetPresentationMainRenderer.kt:30-44`）：
//     图标 + 主文本（`presentableText`）+ 灰色 `" (" + containerText + ")"`
//     （前缀/后缀取 `LocationPresentation.DEFAULT_LOCATION_PREFIX/SUFFIX`
//     = `" ("` / `")"`，`platform/core-api/src/com/intellij/navigation/LocationPresentation.java:26-27`）；
//     右侧那列 `locationText` 由 `TargetPresentationRenderer`
//     （`.../TargetPresentationRenderer.kt:70-83`，`horizontalAlignment = RIGHT`）单独画出、右对齐。
//   · 速度搜索：`buildTargetPopupWithMultiSelect`（`platform/platform-impl/src/com/intellij/ui/list/
//     targetPopup.kt:62-74`）给过滤用的名字是 `presentableText + " " + containerText`
//     （`TargetPresentation.speedSearchText`，`targetPopup.kt:76-81`）。
//
// LSP 侧拿到的只有 `Location[]`（native 的 `lsp_navigation.cpp` 已经回**全部**目标），没有 PSI 的
// `ItemPresentation`，所以三段各取"真数据里最近的一档"，不发明内容：
//   主文本 = 目标位置上的**标识符**（声明点就是名字，`wordAt`）；读不到内容退到那一行原文，
//            再退到文件名 —— 这正是上游 `targetPresentation`（`.../navigation/util.kt:85-108`）的
//            `presentableText → name → text` 退化链。
//   灰尾   = 目标所在文件的路径（宿主给的路径已经是相对工作区的形式，见 `Session::to_path`；
//            工作区外的文件是绝对路径）—— 上游那里是"所在容器"（类名），LSP 没有容器概念。
//   右列   = `行:列`（1 基）—— 上游那里是模块/位置文本，LSP 同样没有。
import { wordAt } from './editorText.ts'
import { baseName } from './filenameWidget.ts'
import { speedSearchMatches } from './speedSearch.ts'

/** LSP `Location` 在本仓的形状（`src/bridge.ts` 的 `LspLocation`）。 */
export interface TargetLocation { path: string; line: number; character: number }

/** 弹层的一行。`id` 同时用作 Vue 的 key 与回传的凭据（位置唯一）。 */
export interface ChooseTargetRow {
  id: string
  path: string
  line: number
  character: number
  /** 主文本（上游 `presentableText`）。 */
  name: string
  /** 灰尾里的容器文本；空串 = 不画那一段（上游 `containerText == null` 时同样不画）。 */
  container: string
  /** 右列的位置文本（1 基行列）。 */
  position: string
}

const normalise = (path: string) => path.replace(/\\/g, '/')

function lineAt(content: string, line: number): string {
  return content.split(/\r?\n/)[line] ?? ''
}

/** 一行 = 目标位置上的名字 + 所在文件 + 行列（三段映射见文件头）。 */
export function targetRow(target: TargetLocation, content: string | null): ChooseTargetRow {
  const word = content === null ? '' : wordAt(content, target.line, target.character)
  const fallback = baseName(target.path)
  const name = word || (content === null ? fallback : lineAt(content, target.line).trim() || fallback)
  const path = normalise(target.path)
  // 名字已经退到文件名时，灰尾只留目录 —— 否则会打成「Helper.java (in src/Helper.java)」。
  const container = word ? path : path.slice(0, Math.max(0, path.length - fallback.length)).replace(/\/+$/, '')
  return { id: `${target.path}:${target.line}:${target.character}`, path: target.path, line: target.line, character: target.character,
           name, container, position: `${target.line + 1}:${target.character + 1}` }
}

/**
 * 目标表 → 行表。**同一个位置只留一条**：上游的 targets 是元素的集合、天然不重复，
 * 而 LSP 的 `Location[]` 允许同一个位置出现两次（服务器可以这么回）。
 */
export function chooseTargetRows(targets: readonly TargetLocation[], contents: ReadonlyMap<string, string | null>): ChooseTargetRow[] {
  const rows: ChooseTargetRow[] = []
  const seen = new Set<string>()
  for (const target of targets) {
    const row = targetRow(target, contents.get(target.path) ?? null)
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
  }
  return rows
}

/** 过滤用的名字（上游 `speedSearchText` = presentableText + " " + containerText）。 */
export const chooseTargetLabel = (row: ChooseTargetRow): string =>
  row.container && row.container !== row.name ? `${row.name} ${row.container}` : row.name

/** 速度搜索过滤（`MinusculeMatcher`，大小写不敏感、驼峰按词首，`src/speedSearch.ts`）。 */
export function filterChooseTargets(rows: readonly ChooseTargetRow[], query: string): ChooseTargetRow[] {
  const pattern = query.trim()
  if (!pattern) return [...rows]
  return rows.filter(row => speedSearchMatches(pattern, chooseTargetLabel(row)))
}

/** ↑↓ 在行之间移动：到两端就停住，不回绕（列表弹层里 `JList` 的选择行为）。 */
export function moveChooseTarget(count: number, from: number, delta: number): number {
  if (count <= 0) return -1
  const next = from + delta
  return next < 0 || next >= count ? from : next
}

/**
 * 从一批位置取行文本（用来取声明点上的名字）：
 * **打开中的缓冲优先**（用户可能还没保存），其次问磁盘，读不到就留 null（行模型会退到文件名）。
 */
export async function loadTargetContents(targets: readonly TargetLocation[],
                                          openBuffer: (path: string) => string | null,
                                          readFile: (path: string) => Promise<string | null>): Promise<Map<string, string | null>> {
  const contents = new Map<string, string | null>()
  for (const target of targets) {
    if (contents.has(target.path)) continue
    const open = openBuffer(target.path)
    if (open !== null) { contents.set(target.path, open); continue }
    try { contents.set(target.path, await readFile(target.path)) } catch { contents.set(target.path, null) }
  }
  return contents
}

// 上游那几种动作的标题/提示文案（都取自资源串，中文按本仓界面语言写）：
//   · `goto.implementation.chooserTitle`（`platform/lang-api/resources/messages/CodeInsightBundle.properties:107`
//     = "Choose Implementation of <b>{0}</b> ({1} found{2})"）—— `{2}` 是后台搜索还没跑完时的 " so far"，
//     LSP 的 `textDocument/implementation` 一次就把整份给全了，所以永远是 finished（不带那截）。
//   · `goto.implementation.notFound`（`:109` = "No implementations found"）。
//   · `goto.implementation.findUsages.title`（`:108` = "Implementations of {0}"）—— 钉到用法视图时那个标题。
//   · `choose.type.popup.title`（`:205` = "Choose Type"）—— 转到类型声明（Ctrl+Shift+B）用的标题。
export const implementationChooserTitle = (name: string, count: number): string =>
  name ? `选择 ${name} 的实现（找到 ${count} 个）` : `选择实现（找到 ${count} 个）`
export const typeChooserTitle = (): string => '选择类型'
/** `goto.implementation.notFound`：一个实现都没有时 IDEA 弹的是错误提示。 */
export const NO_IMPLEMENTATIONS_MESSAGE = '没有找到实现。'
export const implementationsUsageTitle = (name: string): string => (name ? `${name} 的实现` : '实现')

/**
 * 「选择实现」这一类的行要**排序**（上游 `GotoTargetHandler.shouldSortTargets()` + `getComparingObject`，
 * `platform/lang-impl/src/com/intellij/codeInsight/navigation/GotoTargetHandler.java:396-418`）：
 * 按 主文本 → 容器 → 位置 拼出来的串比较；「选择声明」那条路（PsiTargetNavigator）不排、保持服务端顺序。
 */
export function sortTargetRows(rows: readonly ChooseTargetRow[]): ChooseTargetRow[] {
  return [...rows].sort((left, right) => {
    const a = `${left.name} ${left.container} ${left.position}`
    const b = `${right.name} ${right.container} ${right.position}`
    return a.localeCompare(b)
  })
}
