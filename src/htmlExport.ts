// 导出到 HTML（IDEA `FileExportGroup` › `ExportToHTML`）—— 纯逻辑 + 导出引擎。
//
// 对照源码（`platform/lang-impl/src/com/intellij/codeEditor/printing/`）：
//   · `ExportToHTMLAction.java:25-53`：动作本体，`update` 里"有 PSI 文件（或目录）才可用"。
//   · `ExportToHTMLManager.java:84`：`isSelectedTextEnabled = editor != null && editor.getSelectionModel().hasSelection()`
//     —— 「选中文本」这一档要看当前编辑器有没有选区。
//   · `:116/:165`：导出跑在带进度条的模态任务里（TaoCode 是单文件/单目录，直接跑 + 通知）。
//   · `:132-157`：有选区且范围=选中文本时导出选区；`:151` 把 `PRINT_LINE_NUMBERS` 传给渲染；
//     `:157` `OPEN_IN_BROWSER` 时打开生成的 HTML。
//   · `:248/:255`：目录范围时在每个目录下写 `index.html`，并链到子目录的 `index.html`。
//   · `:335` `psiFile.getVirtualFile().getNameSequence() + ".html"` —— 输出文件名 = 原名 + `.html`。
//   · `ExportToHTMLDialog.kt:51-103`：对话框 = 三个范围单选（当前文件 / 选中文本 / 当前目录，后者带
//     「包含子目录」复选框） + 输出目录（带浏览…） + 「选项」组（显示行号 / 在浏览器中打开）。
//   · `ExportToHTMLSettings.java:14-23`：这些选择**按项目保存**（workspace.xml）。
//
// TaoCode 的两处如实差异（都写进界面提示，不假装等价）：
//   ① 语法高亮来自**编辑器已经渲染出来的 DOM** —— 也就是说只有"打开着的"文件带颜色，
//      目录范围里没打开的文件导出为**纯文本 + 行号**（IDEA 用 PSI + 编辑器高亮器，对任何文件都能染色）。
//      结果提示里会把"几个带高亮、几个是纯文本"说清楚。
//   ② 不生成整棵树的 `index.html` 层级？—— 生成：每个被导出的目录一份（与 `:248` 一致）。
import { ref } from 'vue'
import { request, type ProjectSettings, type Workspace } from './bridge.ts'
import { errorMessage } from './errors.ts'

/** `PrintSettings.java:82-84` 的三个范围值（IDEA 的常量原样搬，0 = 还没选过）。 */
export const EXPORT_SCOPES = { none: 0, file: 1, selectedText: 2, directory: 4 } as const
export type ExportScope = 0 | 1 | 2 | 4

export function scopeLabel(scope: ExportScope): string {
  switch (scope) {
    case EXPORT_SCOPES.file: return '当前文件'
    case EXPORT_SCOPES.selectedText: return '选中文本'
    case EXPORT_SCOPES.directory: return '当前目录'
    default: return '未选择'
  }
}

/** 文件对话框过滤器（native `parse_file_filters` 的格式）。 */
export const EXPORT_HTML_FILTERS = 'HTML 文件 (*.html)|*.html|所有文件|*.*'

/** `ExportToHTMLManager.java:335`：输出文件名 = 原名 + `.html`（`main.cpp` → `main.cpp.html`）。 */
export function htmlExportFileName(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  return `${name}.html`
}

/** 目录范围里的输出相对路径：目录结构照搬，每个文件加 `.html`。 */
export function htmlExportRelativePath(path: string, base: string): string {
  const normalized = path.replace(/\\/g, '/')
  const prefix = base ? `${base.replace(/\\/g, '/').replace(/\/$/, '')}/` : ''
  const relative = prefix && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized
  return `${relative}.html`
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 一段带样式的文本（颜色来自编辑器渲染结果，见模块头部的差异①）。 */
export interface StyledRun { text: string; color: string; fontStyle: string; fontWeight: string }
/** 一行 = 若干段；空行是空数组。 */
export type StyledLine = StyledRun[]

export interface HtmlDocumentOptions {
  title: string
  /** 显示行号（IDEA `PRINT_LINE_NUMBERS`）。 */
  lineNumbers: boolean
  background: string
  foreground: string
  fontFamily: string
  fontSize: number
  /** 「生成的文件」那行小字（导出器写进来，方便回头认）。 */
  footnote?: string
}

/**
 * 一份完整的、可独立打开的 HTML 文档。
 *
 * 样式**内联**（不引外部 CSS）：导出物要能被单独拷走、直接双击打开 —— 这也是 IDEA 的做法
 * （它的导出是一套自带的 css + html）。
 */
export function htmlDocument(options: HtmlDocumentOptions, lines: readonly StyledLine[]): string {
  const gutterWidth = `${String(lines.length).length}ch`
  const body = lines.map((line, index) => {
    const number = options.lineNumbers ? `<span class="ln">${index + 1}</span>` : ''
    const runs = line.length === 0
      ? '&nbsp;'
      : line.map(run => {
        const styles: string[] = []
        if (run.color) styles.push(`color:${run.color}`)
        if (run.fontStyle && run.fontStyle !== 'normal') styles.push(`font-style:${run.fontStyle}`)
        if (run.fontWeight && run.fontWeight !== '400') styles.push(`font-weight:${run.fontWeight}`)
        return styles.length ? `<span style="${styles.join(';')}">${escapeHtml(run.text)}</span>` : escapeHtml(run.text)
      }).join('')
    return `<div class="line">${number}<span class="code">${runs}</span></div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title)}</title>
<style>
  body { margin: 0; padding: 16px 20px; background: ${options.background}; color: ${options.foreground};
         font-family: ${options.fontFamily}; font-size: ${options.fontSize}px; }
  h1 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
  p.meta { margin: 0 0 14px; font-size: 11px; opacity: .65; }
  .body { white-space: pre; font-family: ${options.fontFamily}; }
  .line { display: flex; }
  .ln { flex: 0 0 auto; width: ${gutterWidth}; min-width: 2.5ch; padding-right: 12px; text-align: right;
        opacity: .45; user-select: none; }
  .code { flex: 1 1 auto; white-space: pre; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>${escapeHtml(options.title)}</h1>
${options.footnote ? `<p class="meta">${escapeHtml(options.footnote)}</p>` : ''}
<div class="body">
${body}
</div>
</body>
</html>
`
}

export interface IndexEntry { name: string; href: string; directory: boolean }

/** 目录范围的 `index.html`（`ExportToHTMLManager.java:248-255`）：列出文件与子目录索引。 */
export function indexDocument(title: string, entries: readonly IndexEntry[]): string {
  const rows = entries.map(entry => entry.directory
    ? `<li>&#128193; <a href="${escapeHtml(entry.href)}"><b>${escapeHtml(entry.name)}</b></a></li>`
    : `<li><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.name)}</a></li>`).join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, "Segoe UI", sans-serif; margin: 16px 20px; }
  h1 { font-size: 15px; }
  ul { line-height: 1.7; }
  a { text-decoration: none; }
</style></head>
<body><h1>${escapeHtml(title)}</h1>
<ul>
${rows}
</ul>
</body></html>
`
}

/** 导出结果（写盘回来后补上计数）。 */
export interface HtmlExportOutcome {
  scope: ExportScope
  directory: string
  files: number
  highlighted: number
  plain: number
  indexFiles: number
  /** 生成的入口（要么是那个 HTML，要么是目录的 index.html）。 */
  entry: string
}

export function exportResultMessage(outcome: HtmlExportOutcome): string {
  const what = scopeLabel(outcome.scope)
  const parts = [`已把${what}导出到 ${outcome.directory}：${outcome.files} 个 HTML 文件`]
  if (outcome.scope === EXPORT_SCOPES.directory)
    parts.push(`其中 ${outcome.highlighted} 个带语法高亮、${outcome.plain} 个是纯文本（未在编辑器中打开）`)
  if (outcome.indexFiles > 0) parts.push(`并生成了 ${outcome.indexFiles} 个 index.html`)
  return parts.join('，') + `。入口：${outcome.entry}`
}

export function exportFailureMessage(error: unknown, directory: string): string {
  return `导出到 ${directory} 失败：${errorMessage(error)}`
}

/** 对话框里那一份"还没保存"的选择（IDEA 的 `reset()`/`apply()` 之间那份 UI 状态）。 */
export interface ExportToHtmlDraft {
  scope: ExportScope
  includeSubdirectories: boolean
  printLineNumbers: boolean
  openInBrowser: boolean
  outputDirectory: string
}

export interface HtmlExportDeps {
  isDesktop: boolean
  notify: (message: string, error?: boolean) => void
  workspace: { value: Workspace | null }
  projectSettings: { value: ProjectSettings }
  /** 当前打开文件的**工作区相对路径**（没有打开文件时返回空串）。 */
  activePath: () => string
  /** 当前编辑器的**渲染结果**（带颜色的行）与选中文本；没有编辑器时返回 null。 */
  readEditor: () => { lines: StyledLine[]; selection: string } | null
  /** 编辑器的主题色（导出用的背景/前景/字体），来自当前 CSS 变量。 */
  theme: () => { background: string; foreground: string; fontFamily: string; fontSize: number }
  /** 在系统浏览器里打开一个 `file://` 链接。 */
  openExternal: (url: string) => unknown
  /** 选目录对话框（默认输出目录的「浏览…」）。 */
  pickDirectory: (title: string, initial: string) => Promise<string | null>
}

/** `file://` 链接（Windows 盘符要变成 `file:///C:/…`）。 */
export function fileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

export function createHtmlExport(deps: HtmlExportDeps) {
  /** 「导出到 HTML」对话框是否打开（IDEA 的 `ExportToHTMLDialog`）。 */
  const dialogOpen = ref(false)
  const openExportDialog = () => { dialogOpen.value = true }
  const closeExportDialog = () => { dialogOpen.value = false }

  /** 工作区全部文件（目录范围要按目录筛）—— 走 `workspace.files`，不另开通道。 */
  async function workspaceFiles(): Promise<string[]> {
    try { return (await request<{ files: string[] }>('workspace.files')).files }
    catch { return [] }
  }

  /** 按范围算出要导出的「文件 → 内容来源」。 */
  async function collect(scope: ExportScope, includeSubdirectories: boolean): Promise<{
    items: Array<{ relative: string; lines: StyledLine[]; highlighted: boolean }>
    base: string
  }> {
    const active = deps.activePath()
    const editor = deps.readEditor()
    if (scope === EXPORT_SCOPES.selectedText) {
      if (!editor || !editor.selection) throw new Error('当前编辑器没有选中文本。')
      // 选区导出：只写选中的那几行（颜色仍取整行渲染结果，行内容截成选区 —— 与 IDEA 一样，
      // 导出的文本就是用户选中的那一段）。
      const selected = editor.selection.replace(/\r\n/g, '\n').split('\n')
      const lines: StyledLine[] = selected.map(text => [{ text, color: '', fontStyle: '', fontWeight: '' }])
      return { items: [{ relative: htmlExportFileName(active || 'selection'), lines, highlighted: false }], base: '' }
    }
    if (scope === EXPORT_SCOPES.directory) {
      const directory = active ? active.slice(0, active.lastIndexOf('/') < 0 ? 0 : active.lastIndexOf('/')) : ''
      const files = await workspaceFiles()
      const prefix = directory ? `${directory}/` : ''
      const picked = files
        .filter(file => file.startsWith(prefix))
        .filter(file => includeSubdirectories || !file.slice(prefix.length).includes('/'))
        .sort()
      const items: Array<{ relative: string; lines: StyledLine[]; highlighted: boolean }> = []
      for (const file of picked) {
        // 只有"打开着的那个文件"有渲染结果可用（见模块头部的差异①）。
        const isActive = file === active && editor !== null
        let lines: StyledLine[]
        let highlighted = false
        if (isActive && editor) { lines = editor.lines; highlighted = true }
        else {
          try { lines = (await request<{ content: string }>('file.read', { path: file })).content
            .replace(/\r\n/g, '\n').split('\n').map(text => [{ text, color: '', fontStyle: '', fontWeight: '' }]) }
          catch { continue }  // 读不了（二进制/超大）就跳过，不产出半个文件
        }
        items.push({ relative: htmlExportRelativePath(file, directory), lines, highlighted })
      }
      if (!items.length) throw new Error(directory ? `目录 ${directory} 里没有可导出的文本文件。` : '工作区里没有可导出的文本文件。')
      return { items, base: directory }
    }
    if (!active || !editor) throw new Error('请先打开一个文件。')
    return { items: [{ relative: htmlExportFileName(active), lines: editor.lines, highlighted: true }], base: '' }
  }

  /**
   * 真的导出（对话框点「保存」后调用）：先记住这次的选择（IDEA `ExportToHTMLDialog.apply()`），
   * 再生成 + 写盘 +（可选）打开浏览器。
   */
  async function exportToHtml(draft: ExportToHtmlDraft): Promise<HtmlExportOutcome | null> {
    if (!deps.isDesktop) { deps.notify('浏览器预览不能导出文件，请在桌面端使用。', true); return null }
    const directory = draft.outputDirectory.replace(/[\\/]+$/, '')
    if (!directory) { deps.notify('请先选择输出目录。', true); return null }
    if (!/^[A-Za-z]:[\\/]|^\\\\|^\//.test(directory)) { deps.notify('输出目录必须是绝对路径。', true); return null }
    // 选择随项目保存（IDEA `ExportToHTMLSettings` 存 workspace.xml，`ExportToHTMLDialog.apply():135-156`）。
    const exportToHtml = {
      scope: draft.scope, includeSubdirectories: draft.includeSubdirectories,
      printLineNumbers: draft.printLineNumbers, openInBrowser: draft.openInBrowser, outputDirectory: draft.outputDirectory,
    }
    const saved = await request<{ settings: ProjectSettings }>('project.settings.update', {
      exportToHtml: { ...(deps.projectSettings.value.exportToHtml ?? {}), ...exportToHtml },
    })
    deps.projectSettings.value = { ...deps.projectSettings.value, exportToHtml: saved.settings.exportToHtml }
    const theme = deps.theme()
    const { items, base } = await collect(draft.scope, draft.includeSubdirectories)
    const files: Array<{ path: string; content: string }> = []
    let highlighted = 0
    for (const item of items) {
      if (item.highlighted) ++highlighted
      files.push({
        path: `${directory}/${item.relative}`,
        content: htmlDocument({
          title: item.relative.replace(/\.html$/, ''), lineNumbers: draft.printLineNumbers,
          ...theme, footnote: `由 TaoCode 导出到 HTML · ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        }, item.lines),
      })
    }
    // 目录范围：每个被导出的目录一份 index.html（`:248-255`）。
    const directories = new Map<string, IndexEntry[]>()
    if (draft.scope === EXPORT_SCOPES.directory) {
      const directoriesSeen = new Set<string>()
      for (const item of items) {
        const relative = item.relative
        const cut = relative.lastIndexOf('/')
        const folder = cut < 0 ? '' : relative.slice(0, cut)
        const own = directories.get(folder) ?? []
        own.push({ name: relative.slice(cut + 1), href: relative.slice(cut + 1), directory: false })
        directories.set(folder, own)
        for (const parent of parentDirectories(folder)) directoriesSeen.add(parent)
      }
      for (const folder of directoriesSeen) {
        const own = directories.get(folder) ?? []
        const depth = folder === '' ? 1 : folder.split('/').length + 1
        const children: IndexEntry[] = [...new Set(items.map(item => item.relative)
          .filter(relative => relative.startsWith(folder === '' ? '' : `${folder}/`))
          .map(relative => relative.slice(folder === '' ? 0 : folder.length + 1))
          .filter(rest => rest.includes('/'))
          .map(rest => rest.slice(0, rest.indexOf('/'))))]
          .map(name => ({ name, href: `${name}/index.html`, directory: true }))
        const entries = [...children, ...own.sort((a, b) => a.name.localeCompare(b.name))]
        const indexPath = folder === '' ? `${directory}/index.html` : `${directory}/${folder}/index.html`
        directories.set(folder, entries)
        void depth
        files.push({ path: indexPath, content: indexDocument(`${base || '工作区'} · ${folder || '根目录'}`, entries) })
      }
    }
    let result: { written: number; entry?: string }
    try {
      result = await request<{ written: number }>('app.writeExportFiles', { files })
    } catch (error) {
      deps.notify(exportFailureMessage(error, directory), true)
      return null
    }
    const indexFiles = [...directories.keys()].length
    const entry = indexFiles > 0 ? `${directory}/index.html` : files[0]!.path
    const outcome: HtmlExportOutcome = {
      scope: draft.scope, directory, files: items.length, highlighted,
      plain: items.length - highlighted, indexFiles, entry,
    }
    deps.notify(exportResultMessage(outcome))
    if (draft.openInBrowser) deps.openExternal(fileUrl(entry))
    dialogOpen.value = false
    return outcome
  }

  async function browseOutputDirectory(initial: string): Promise<string | null> {
    return deps.pickDirectory('选择输出目录', initial)
  }

  return { dialogOpen, openExportDialog, closeExportDialog, exportToHtml, browseOutputDirectory }
}

/** `a/b/c` → `['a/b', 'a', '']`（每一级父目录，含根）。 */
export function parentDirectories(folder: string): string[] {
  const out: string[] = []
  let current = folder
  while (current.includes('/')) {
    current = current.slice(0, current.lastIndexOf('/'))
    out.push(current)
  }
  out.push('')
  return out
}
