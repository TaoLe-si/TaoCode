// 「用文件模板新建文件」的落盘流程。
//
// 判词（`docs/inventory/verdict-platform_rest.md` 的 lp/file-templates / ici/file-templates）说
// 「宿主 `Workspace::create` 只认内建 `template_kind`、不读模板目录也不做变量展开 ⇒ 用户模板与
// `${NAME}` 的展开结果**没有落盘通道**」。**前半句成立、后半句不成立**（2026-10-06 核实）：
//   · `native/workspace.cpp:971-1079` 的 `Workspace::create` 确实只按 16 个内建 kind 自己拼正文，
//     既不读 `fileTemplates/` 也不跑 Velocity —— 所以本模块**不**走 `template_kind`；
//   · 但本仓有 `file.create` + `file.write` 两个通道（`src/bridge.ts:109` 的 Method 清单；
//     同一用法见 `src/patchApplyHost.ts:97`、`src/inspectionProfileIo.ts:34`），
//     先建空文件再写展开结果就是等价路径。⇒ **不需要新宿主方法**，
//     缺的只是 App.vue 那条 `nameDialog` 的接线（`src/App.vue:1744` 现在只把
//     `dialog.template` 当 `template_kind` 传），见接线请求。
//
// 上游对应物：`platform/lang-impl/src/com/intellij/ide/actions/CreateFileFromTemplateAction.java:68-120`
// —— `name` 里带 `/` 时先 `CreateFileAction.MkDirs` 建目录（`:76-79`），正文与变量交给
// `FileTemplateUtil.createFromTemplate`（`:85`，实现在 `fileTemplates/FileTemplateUtil.java:288-347`），
// 额外变量在这一步并进模板属性（`:84` 的 `putAll(extraTemplateProperties)`），
// 成功后 `openFile`（`:93-97`）；Velocity 解析失败包成
// `IncorrectOperationException("Error parsing Velocity template: …")`（`:105-106`）。
// 模板自己的扩展名决定建出来的文件类型（`FileTemplateUtil.java:384` 按 `template.getName()` 取 FileType）。
import { renderFileTemplate } from './fileTemplateParser.ts'
import { templateVariablesFor } from './fileTemplateVars.ts'

/** 模板的最小形状（`FileTemplateEntry` 与 `UserFileTemplate` 都满足）。 */
export interface CreatableFileTemplate {
  name: string
  extension: string
  content: string
}

export interface FileTemplateCreateInput {
  template: CreatableFileTemplate
  /** 目标目录（工作区相对路径；空串 = 工作区根）。 */
  directory?: string
  /** 用户输入的名字：可以带扩展名，也可以写成 `a/b/Name`（那样子目录会被建出来）。 */
  fileName: string
  projectName?: string
  user?: string
  /** 注入时间（测试用）。 */
  now?: Date
  /** `#parse` 的子模板来源（上游 `VelocityWrapper.java:82` 走 Includes 方案）。 */
  resolveInclude?: (name: string) => string | undefined
  /** 覆盖/追加变量（上游 `extraTemplateProperties`，`CreateFileFromTemplateAction.java:84`）。 */
  variables?: Record<string, string>
  /** 行尾：`crlf` 时把展开结果转成 `\r\n`（本仓的行尾通道是 `file.lineSeparators`）。 */
  lineSeparator?: 'lf' | 'crlf'
}

/** 展开后的落盘计划（设置页的「会写成这样」预览用的就是它，纯函数、不碰宿主）。 */
export interface FileTemplateCreatePlan {
  /** 工作区相对路径（已补扩展名、已折进名字里的子目录）。 */
  path: string
  /** 需要先用 `file.create` 建的目录（`path` 的父目录；根目录时为空）。 */
  directory: string
  content: string
  variables: Record<string, string>
  /** 模板引用了但本次没给值的变量（上游 `FileTemplateBase.getUnsetAttributes`）。 */
  unset: string[]
  /** 成环被跳过的 `#parse` 目标。 */
  skipped: string[]
}

/** 路径归一：反斜杠转正斜杠、去掉 `./` 与首尾 `/`。 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/(^|\/)\.\/+/g, '$1').replace(/^\/+|\/+$/g, '')
}

/**
 * 名字 → 目标文件名：模板有扩展名且名字末尾不是它时才补
 * （`FileTemplateUtil.java:384` 用模板名推 FileType，等价物就是这一步）。
 * 大小写按上游 `FileUtil.extensionContainsNameOrEmpty` 的口径当作同一种扩展名。
 */
export function withTemplateExtension(fileName: string, extension: string): string {
  const trimmed = fileName.trim()
  if (!extension || !trimmed) return trimmed
  const suffix = `.${extension}`
  if (trimmed.toLowerCase().endsWith(suffix.toLowerCase())) return trimmed
  // 已经带**别的**扩展名时不再补（用户写 `Foo.txt` + `Class.java` 模板 → 尊重输入的那一个）
  return trimmed.includes('.') ? trimmed : `${trimmed}${suffix}`
}

/**
 * 目录 + 名字 → 工作区相对路径。名字里带 `/` 时那几段并进目录里
 * （上游 `CreateFileAction.MkDirs`，`CreateFileFromTemplateAction.java:76-79`）。
 * 非法路径（空、含 `..`、含 `:` 或 `\0`）抛错，不猜。
 */
export function templateTargetPath(directory: string, fileName: string, extension = ''): string {
  const rawName = fileName.trim().replace(/\\/g, '/')
  if (!rawName) throw new Error('文件名不能为空。')
  const rawDir = normalizePath(directory ?? '')
  const nameSegments = rawName.split('/').filter(Boolean)
  const segments = [...(rawDir ? rawDir.split('/') : []), ...nameSegments]
  for (const segment of segments) {
    if (segment === '..') throw new Error(`路径不合法：${segments.join('/')}`)
    if (segment.includes(':') || segment.includes('\0')) throw new Error(`文件名片段不合法：${segment}`)
  }
  const withoutLast = segments.slice(0, -1).join('/')
  const last = withTemplateExtension(segments[segments.length - 1] ?? '', extension)
  if (!last) throw new Error('文件名不能为空。')
  return [...(withoutLast ? [withoutLast] : []), last].join('/')
}

/** 展开模板正文并算出落盘计划（不写盘）。 */
export function planFileTemplateCreate(input: FileTemplateCreateInput): FileTemplateCreatePlan {
  const path = templateTargetPath(input.directory ?? '', input.fileName, input.template.extension)
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const variables = {
    ...templateVariablesFor({
      fileName: path.split('/').pop() ?? path,
      path,
      projectName: input.projectName ?? '',
      user: input.user ?? '',
      now: input.now,
    }),
    ...(input.variables ?? {}),
  }
  const rendered = renderFileTemplate(input.template.content, {
    variables,
    resolveInclude: input.resolveInclude,
  })
  const content = input.lineSeparator === 'crlf'
    ? rendered.text.replace(/\r?\n/g, '\r\n')
    : input.lineSeparator === 'lf'
      ? rendered.text.replace(/\r\n/g, '\n')
      : rendered.text
  return { path, directory, content, variables, unset: rendered.unset, skipped: rendered.skipped }
}

/** 本模块只依赖这两个宿主动作（`file.create` / `file.write`），便于测试里喂假实现。 */
export interface FileTemplateCreateIo {
  /** `file.create`：`directory=true` 建目录；已存在的**文件**会被宿主拒绝（冲突信号）。 */
  create(path: string, directory?: boolean): Promise<unknown>
  /** `file.write`：写展开后的正文。 */
  write(path: string, content: string): Promise<unknown>
  /** 工作区已有路径清单（可选）：给了就提前判冲突，不用等宿主报错。 */
  knownPaths?: () => readonly string[]
}

/** 冲突时的文案（IDEA 是 `FileExistsException` → 「文件已存在」）。 */
export function fileTemplateConflictMessage(path: string): string {
  return `文件 ${path} 已经存在，先改掉已存在的那个或换个名字。`
}

/**
 * 按模板新建文件：建目录 → 建空文件 → 写展开结果。
 *
 * 「先 create 再 write」的分工照宿主形状来：`file.create` 只负责建（并对已存在文件报错，
 * 这条错误就是冲突信号，见 `src/scratchFiles.ts:29` 的同一用法），正文由 `file.write` 落。
 */
export async function createFileFromTemplate(
  input: FileTemplateCreateInput,
  io: FileTemplateCreateIo,
): Promise<FileTemplateCreatePlan> {
  const plan = planFileTemplateCreate(input)
  const known = io.knownPaths?.() ?? []
  if (known.some(path => normalizePath(path) === plan.path)) throw new Error(fileTemplateConflictMessage(plan.path))
  if (plan.directory) {
    // 建目录是幂等的（已存在不报错，`native/main.cpp` 的 file.create 目录分支）；
    // 真失败了要把原因留给调用方，不能静默地往下写。
    await io.create(plan.directory, true)
  }
  await io.create(plan.path)
  await io.write(plan.path, plan.content)
  return plan
}
