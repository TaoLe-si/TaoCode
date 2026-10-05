// 文件模板的**变量替换**（上游 `platform/lang-impl/src/com/intellij/ide/fileTemplates/`：
// `FileTemplateManager` 的预定义变量表 + `FileTemplate` 的 Velocity 文本，`#parse` 引入子模板）。
//
// 本仓现状：新建文件带模板选择，宿主按 `template_kind` 生成**内置 17 种**内容
// （`native/workspace.cpp` 的 `Workspace::create`），没有变量替换，也没有用户自定义模板。
// 这个模块把两件缺的事落成纯规则：
//   · 预定义变量表与展开（`${NAME}` / `$NAME` 两种写法，未知变量默认原样保留）；
//   · 从**文件路径**推 `PACKAGE_NAME`（Java/Kotlin 源根后的包名）与 `CLASS_NAME`（文件名词干）；
//   · 用户模板的登记形状与校验（名字/扩展名/内容），供设置面（`editing.fileTemplates`）消费。
//
// 接线缺口（如实）：宿主 `Workspace::create` 不认识自定义模板，展开结果要写进文件得先有
// 「用户模板 + 变量」这条宿主通道；本模块先把规则与判据锁住，接线时宿主只做「查表 → 展开 → 写」。

/** 一个预定义变量：名字 + 说明（设置面的「编辑模板变量」列表用）。 */
export interface FileTemplateVariable {
  name: string
  description: string
}

/** IDEA 的预定义变量里本仓能算准的那些（时间类由调用方传 `now`，测试可注入）。 */
export const FILE_TEMPLATE_VARIABLES: readonly FileTemplateVariable[] = [
  { name: 'NAME', description: '新建文件名（不含扩展名）' },
  { name: 'FILE_NAME', description: '新建文件名（含扩展名）' },
  { name: 'CLASS_NAME', description: '类名（文件名里的合法标识符词干；不合法时为空）' },
  { name: 'PACKAGE_NAME', description: '包名（按源根后的目录推；推不出时为空）' },
  { name: 'FILE_PATH', description: '文件的工作区相对路径' },
  { name: 'DIR_PATH', description: '文件所在目录的工作区相对路径' },
  { name: 'PROJECT_NAME', description: '项目名' },
  { name: 'USER', description: '当前用户名' },
  { name: 'DATE', description: 'yyyy/M/d' },
  { name: 'TIME', description: 'H:mm' },
  { name: 'YEAR', description: '四位年' },
  { name: 'MONTH', description: '月（1-12）' },
  { name: 'DAY', description: '日（1-31）' },
  { name: 'HOUR', description: '时（0-23）' },
  { name: 'MINUTE', description: '分（0-59）' },
]

/** Java/Kotlin 的源根（Package 从这里之后算；顺序 = 最长优先匹配）。 */
const SOURCE_ROOTS: readonly string[] = [
  'src/main/java', 'src/test/java', 'src/main/kotlin', 'src/test/kotlin',
  'src/main/resources', 'src/test/resources', 'src',
]

/** 合法的包/标识符段（Java 口径；`$` 允许，`-` 不允许）。 */
const IDENTIFIER_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** 文件名词干（去最后一个扩展名；目录与扩展名都不算）。 */
export function fileNameStem(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** 类名：词干是合法标识符时用它，否则空串（`my-class.java` 不硬蹭成 `MyClass`）。 */
export function classNameFor(fileName: string): string {
  const stem = fileNameStem(fileName)
  return IDENTIFIER_SEGMENT.test(stem) ? stem : ''
}

/**
 * 从文件路径推包名：源根之后的每一段都要是合法标识符，否则整条推不出（返回空串）——
 * 宁可不填，也不生成一个编译不过的 `package` 行。
 */
export function packageNameForPath(path: string, sourceRoots: readonly string[] = SOURCE_ROOTS): string {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const directory = slash >= 0 ? normalized.slice(0, slash) : ''
  const roots = [...sourceRoots].sort((left, right) => right.length - left.length)
  for (const root of roots) {
    if (directory === root || directory.startsWith(`${root}/`)) {
      const rest = directory.slice(root.length).replace(/^\/+/, '')
      const segments = rest.split('/').filter(Boolean)
      if (segments.length && segments.every(segment => IDENTIFIER_SEGMENT.test(segment))) return segments.join('.')
      return ''
    }
  }
  // 没有已知源根：整条目录链合法时也认（用户直接在 src 外建 Java 文件的情况）。
  const segments = directory.split('/').filter(Boolean)
  if (!segments.length) return ''
  return segments.every(segment => IDENTIFIER_SEGMENT.test(segment)) ? segments.join('.') : ''
}

export interface TemplateVariableInput {
  fileName: string
  /** 工作区相对路径（含文件名；可给空串 —— 此时 DIR_PATH/FILE_PATH 也是空）。 */
  path?: string
  projectName?: string
  user?: string
  /** 注入时间，测试用；缺省 now。 */
  now?: Date
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 算出一次展开的全部变量值（键名与 `FILE_TEMPLATE_VARIABLES` 一一对应）。 */
export function templateVariablesFor(input: TemplateVariableInput): Record<string, string> {
  const now = input.now ?? new Date()
  const path = (input.path ?? '').replace(/\\/g, '/')
  const slash = path.lastIndexOf('/')
  return {
    NAME: fileNameStem(input.fileName),
    FILE_NAME: input.fileName,
    CLASS_NAME: classNameFor(input.fileName),
    PACKAGE_NAME: path ? packageNameForPath(path) : '',
    FILE_PATH: path,
    DIR_PATH: slash >= 0 ? path.slice(0, slash) : '',
    PROJECT_NAME: input.projectName ?? '',
    USER: input.user ?? '',
    DATE: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
    TIME: `${now.getHours()}:${pad(now.getMinutes())}`,
    YEAR: String(now.getFullYear()),
    MONTH: String(now.getMonth() + 1),
    DAY: String(now.getDate()),
    HOUR: String(now.getHours()),
    MINUTE: String(now.getMinutes()),
  }
}

export interface ExpandTemplateOptions {
  /** 未知变量：true = 原样保留（Velocity 的默认行为），false = 换成空串。 */
  keepUnknown?: boolean
}

const BRACED = /\$\{(\w+)\}/g
// Velocity 变量名不能以数字开头：`$1`、`$(x)` 这类不是变量引用（正则回溯、`$&` 之类同理）。
const BARE = /\$([A-Za-z_]\w*)/g

/**
 * 展开模板文本。先处理 `${NAME}`（带括号，优先），再处理 Velocity 的 `$NAME`。
 * 未知名默认**原样保留** —— 模板里真写了 `$foo` 时，用户能一眼看出哪里没替换，
 * 而不是得到一个被静默掏空的文件。
 */
export function expandFileTemplate(content: string, variables: Record<string, string>, options: ExpandTemplateOptions = {}): string {
  const keepUnknown = options.keepUnknown !== false
  const replace = (name: string, whole: string): string => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name]
    return keepUnknown ? whole : ''
  }
  return content
    .replace(BRACED, (whole, name: string) => replace(name, whole))
    .replace(BARE, (whole, name: string) => replace(name, whole))
}

/** 模板里引用的未知变量（设置面提示「这些变量不会被替换」；`#parse` 由加载器单独处理）。 */
export function unknownTemplateVariables(content: string, known: Record<string, string> = {}): string[] {
  const names = new Set<string>()
  BRACED.lastIndex = 0
  for (let match = BRACED.exec(content); match; match = BRACED.exec(content)) names.add(match[1])
  BARE.lastIndex = 0
  for (let match = BARE.exec(content); match; match = BARE.exec(content)) names.add(match[1])
  const declared = new Set(FILE_TEMPLATE_VARIABLES.map(variable => variable.name))
  return [...names].filter(name => !declared.has(name) && !Object.prototype.hasOwnProperty.call(known, name))
}

/** 一条用户自定义模板（`FileTemplateImpl` 的最小字段集）。 */
export interface UserFileTemplate {
  id: string
  name: string
  /** 扩展名（不含点；空 = 无扩展名模板）。 */
  extension: string
  /** 模板正文（Velocity 子集：`${VAR}` / `$VAR`）。 */
  content: string
  /** 说明（设置面第二列）。 */
  description?: string
}

/** 登记校验：返回第一条问题（null = 可登记）。同名不同 id 允许（IDEA 里就是两个文件模板）。 */
export function validateUserFileTemplate(template: UserFileTemplate): string | null {
  if (!template.id || !/^[A-Za-z0-9_.-]+$/.test(template.id)) return '模板 id 只能包含字母、数字、点、下划线与连字符。'
  if (!template.name.trim()) return '模板名不能为空。'
  if (template.extension && !/^[A-Za-z0-9_+-]+$/.test(template.extension)) return '扩展名不能包含点或空格。'
  if (!template.content.trim()) return '模板内容不能为空。'
  return null
}

/** 用户模板 + 内置模板的合并表：用户模板优先（同名时覆盖内置的展示项）。 */
export function mergeFileTemplates<T extends { name: string }>(builtin: readonly T[], user: readonly T[]): T[] {
  const taken = new Set(user.map(template => template.name))
  return [...user, ...builtin.filter(template => !taken.has(template.name))]
}
