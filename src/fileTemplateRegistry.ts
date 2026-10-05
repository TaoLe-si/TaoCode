// 文件模板的**加载与编目**（上游 `FileTemplatesLoader` / `FileTemplatesScheme` /
// `PluginBundledTemplate` / `FileTemplateGroupDescriptor` 一族）。
//
// 上游依据（逐条）：
//   · `platform/lang-impl/.../impl/FileTemplatesLoader.kt:57` `TEMPLATES_DIR = "fileTemplates"`；
//   · 同文件 `:146-152` 五个类别与各自的目录前缀：Default→`""`、Internal→`internal`、
//     Includes→`includes`、Code→`code`、J2EE→`j2ee`；
//   · `platform/ide-core-impl/.../FileTemplateManager.java:22-26` 五个类别的**字符串常量**；
//   · 同文件 `FileTemplatesLoader.kt:163` Internal 类别传 `isInternal` ⇒ 不可编辑；
//   · `FileTemplatesLoader.kt:139-144` **两份目录**：默认方案落 `PathManager.getConfigDir()`，
//     工程方案落工程 `.idea` 旁边 —— `FileTemplatesScheme.java:16-26` 的 `DEFAULT` 方案同理；
//   · `FileTemplatesLoader.kt:279-288` 从 `Class.java.ft` 拆出 name=`Class` / ext=`java`，
//     无扩展名的 `Dockerfile` 整体当名字；`FTManager.java:46-47` 模板文件后缀是 `ft`；
//   · `FileTemplatesLoader.kt:48,243` 描述文件是同名 `.html`；
//   · `platform/ide-core-impl/.../PluginBundledTemplate.java:9-11` 插件内置模板带插件描述符
//     ⇒ 对用户只读。
//
// **与宿主分工（如实，不假装）**：上游模板正文由 Velocity 引擎在**建文件时**展开；本仓宿主
// `Workspace::create`（`native/workspace.cpp:993-1085`）只认 16 个内建 `template_kind`，用
// C++ 字符串拼内容，不读模板目录。所以本模块负责的是**编目 + 校验 + 预览 + 持久化**，
// 把正文算出来的结果是「预览」；真正按用户模板落盘要走 `file.create` 的新通道（接线请求）。
// 那 16 个内建 kind 单独列在 `HOST_FILE_TEMPLATE_KINDS`，不混进正文模板表。
import { computed, ref } from 'vue'
import type { UserFileTemplate } from './fileTemplateVars.ts'
import { validateUserFileTemplate } from './fileTemplateVars.ts'

/** 模板根目录名（`FileTemplatesLoader.kt:57`）。 */
export const FILE_TEMPLATES_DIR = 'fileTemplates'
/** 模板文件后缀（`FTManager.java:46-47`，`DEFAULT_TEMPLATE_EXTENSION = "ft"`）。 */
export const TEMPLATE_FILE_EXTENSION = 'ft'
/** 描述文件后缀（`FileTemplatesLoader.kt:48`，`DESCRIPTION_FILE_EXTENSION = "html"`）。 */
export const DESCRIPTION_FILE_EXTENSION = 'html'

/** 五个类别（`FileTemplateManager.java:22-26` 的常量值逐字照抄）。 */
export type FileTemplateCategory = 'Default' | 'Internal' | 'Includes' | 'Code' | 'J2EE'

export interface FileTemplateCategoryInfo {
  name: FileTemplateCategory
  /** 目录前缀（`FileTemplatesLoader.kt:146-152`；Default 是根，串接时就是模板根目录本身）。 */
  dir: string
  label: string
  /** Internal 那一组对用户只读（`FileTemplatesLoader.kt:163` 传 `isInternal`）。 */
  readOnly: boolean
  /** `#parse` 只能引 Includes 里的模板（`VelocityWrapper.java:82` 走 `getPattern`，即 patternsManager）。 */
  includable: boolean
}

export const FILE_TEMPLATE_CATEGORIES: readonly FileTemplateCategoryInfo[] = [
  { name: 'Default', dir: '', label: '常规', readOnly: false, includable: false },
  { name: 'Internal', dir: 'internal', label: '内置', readOnly: true, includable: false },
  { name: 'Includes', dir: 'includes', label: '包含片段', readOnly: false, includable: true },
  { name: 'Code', dir: 'code', label: '代码片段', readOnly: false, includable: false },
  { name: 'J2EE', dir: 'j2ee', label: 'J2EE', readOnly: false, includable: false },
]

export function categoryInfo(category: FileTemplateCategory): FileTemplateCategoryInfo {
  return FILE_TEMPLATE_CATEGORIES.find(info => info.name === category) ?? FILE_TEMPLATE_CATEGORIES[0]
}

/** 一条编目后的模板。`bundled` 非空 = 插件内置（`PluginBundledTemplate.java:9-11`），对用户只读。 */
export interface FileTemplateEntry {
  /** 模板名（`Class.java.ft` 的 `Class`）。 */
  name: string
  /** 扩展名（`java`；`Dockerfile` 这类为空）。 */
  extension: string
  category: FileTemplateCategory
  content: string
  description?: string
  /** 贡献者插件 id；非空即 `PluginBundledTemplate`。 */
  bundled?: string
}

/** qname = `name.ext`，无扩展名时就是 name（`FileTemplatesLoader.kt:279-288` 的拆名规则反过来拼）。 */
export function templateQName(name: string, extension: string): string {
  return extension ? `${name}.${extension}` : name
}

/** 模板在磁盘上的文件名：`Class.java` + `.ft`（`FTManager.java:47` 的 `TEMPLATE_EXTENSION_SUFFIX`）。 */
export function templateFileName(name: string, extension: string): string {
  return `${templateQName(name, extension)}.${TEMPLATE_FILE_EXTENSION}`
}

/** 描述文件名（`FileTemplatesLoader.kt:128-135`：`$templateName.$ext.html`）。 */
export function templateDescriptionFileName(name: string, extension: string): string {
  return `${templateQName(name, extension)}.${DESCRIPTION_FILE_EXTENSION}`
}

/** 类别目录的相对路径（`fileTemplates` + 类别前缀）。 */
export function templatesDirFor(category: FileTemplateCategory): string {
  const dir = categoryInfo(category).dir
  return dir ? `${FILE_TEMPLATES_DIR}/${dir}` : FILE_TEMPLATES_DIR
}

/** 从 `Class.java.ft` 这样的文件名拆出 name/extension（`FileTemplatesLoader.kt:279-288`）。 */
export function splitTemplateFileName(fileName: string): { name: string; extension: string } {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? ''
  const stem = base.toLowerCase().endsWith(`.${TEMPLATE_FILE_EXTENSION}`)
    ? base.slice(0, -(TEMPLATE_FILE_EXTENSION.length + 1))
    : base
  const dot = stem.lastIndexOf('.')
  return dot > 0
    ? { name: stem.slice(0, dot), extension: stem.slice(dot + 1) }
    : { name: stem, extension: '' }
}

/** 用户能不能改这条模板：Internal 类别与插件内置都只读。 */
export function isTemplateEditable(entry: FileTemplateEntry): boolean {
  return !categoryInfo(entry.category).readOnly && !entry.bundled
}

/** 为什么不许改 —— 设置面直接把这句话给用户看。 */
export function templateEditBlockReason(entry: FileTemplateEntry): string | null {
  if (entry.bundled) return `由插件 ${entry.bundled} 提供，不可编辑。`
  if (categoryInfo(entry.category).readOnly) return `${entry.category} 类别由 IDE 提供，不可编辑。`
  return null
}

/**
 * `#parse` 的目标解析（上游 `VelocityWrapper.java:80-85` 的 resource loader 走
 * `templateManager.getPattern(name)`，而 `FileTemplateManagerImpl.java:328-329` 把它限定在
 * patternsManager = Includes）。所以 `#parse("X")` **只认 Includes 类别**，别的类别同名不算。
 */
export function resolveInclude(entries: readonly FileTemplateEntry[], name: string): string | undefined {
  const hit = entries.find(entry => entry.category === 'Includes' && templateQName(entry.name, entry.extension) === name)
  return hit?.content
}

/** 合并内置与用户模板：用户同名同扩展名覆盖内置（`mergeFileTemplates` 的同一条规则）。 */
export function mergeEntries(bundled: readonly FileTemplateEntry[], user: readonly UserFileTemplate[]): FileTemplateEntry[] {
  const userEntries: FileTemplateEntry[] = user.map(template => ({
    name: template.name,
    extension: template.extension,
    category: 'Default',
    content: template.content,
    description: template.description,
  }))
  const taken = new Set(userEntries.map(entry => templateQName(entry.name, entry.extension)))
  return [...userEntries, ...bundled.filter(entry => !taken.has(templateQName(entry.name, entry.extension)))]
}

/**
 * 宿主 `Workspace::create` 内建的 16 个 `template_kind`（`native/workspace.cpp:998-1079`）。
 * 这些**不是**正文模板：内容由 C++ 侧按 kind 拼，宿主不读模板目录。列出来是为了让设置面
 * 如实说明「哪些新建模板走宿主内建、哪些走正文模板」，不假装两者是一条通道。
 */
export interface HostTemplateKind {
  kind: string
  label: string
  extension: string
}

export const HOST_FILE_TEMPLATE_KINDS: readonly HostTemplateKind[] = [
  { kind: 'java-class', label: 'Java 类', extension: 'java' },
  { kind: 'java-interface', label: 'Java 接口', extension: 'java' },
  { kind: 'java-enum', label: 'Java 枚举', extension: 'java' },
  { kind: 'java-record', label: 'Java 记录类', extension: 'java' },
  { kind: 'java-annotation', label: 'Java 注解', extension: 'java' },
  { kind: 'kotlin-class', label: 'Kotlin 类', extension: 'kt' },
  { kind: 'kotlin-object', label: 'Kotlin 对象', extension: 'kt' },
  { kind: 'kotlin-interface', label: 'Kotlin 接口', extension: 'kt' },
  { kind: 'kotlin-data', label: 'Kotlin 数据类', extension: 'kt' },
  { kind: 'typescript-class', label: 'TypeScript 类', extension: 'ts' },
  { kind: 'typescript-interface', label: 'TypeScript 接口', extension: 'ts' },
  { kind: 'typescript-enum', label: 'TypeScript 枚举', extension: 'ts' },
  { kind: 'vue-component', label: 'Vue 单文件组件', extension: 'vue' },
  { kind: 'react-component', label: 'React 组件', extension: 'tsx' },
  { kind: 'html-file', label: 'HTML 文件', extension: 'html' },
  { kind: 'markdown-file', label: 'Markdown 文件', extension: 'md' },
]

// ---- 持久化（localStorage，与 `src/externalSystemViewOptions.ts` 同一口径） ----

/**
 * 两份目录对应上游的两套方案（`FileTemplatesLoader.kt:139-144`）：默认方案在配置目录里、
 * 工程方案在工程目录里。键里带 `scope`，工程方案再带工程路径。
 */
export type FileTemplateScope = 'default' | 'project'

function storageKey(scope: FileTemplateScope, projectRoot: string | null): string {
  const suffix = scope === 'project' ? `.${(projectRoot ?? '').replace(/\\/g, '/')}` : ''
  return `taocode.fileTemplates.${scope}${suffix}`
}

function readUserTemplates(key: string): UserFileTemplate[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is UserFileTemplate => {
      if (item === null || typeof item !== 'object') return false
      const candidate = item as Record<string, unknown>
      return typeof candidate.id === 'string' && typeof candidate.name === 'string'
        && typeof candidate.extension === 'string' && typeof candidate.content === 'string'
        && validateUserFileTemplate(candidate as unknown as UserFileTemplate) === null
    })
  } catch { return [] }
}

function writeUserTemplates(key: string, templates: readonly UserFileTemplate[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(templates))
  } catch { /* 存储不可用只影响持久化，不影响本轮编辑 */ }
}

/** 一个方案下可读写的用户模板表（响应式；设置面直接 v-model 到它上面）。 */
export function fileTemplatesState(scope: FileTemplateScope, projectRoot: string | null) {
  const key = storageKey(scope, projectRoot)
  const templates = ref<UserFileTemplate[]>(readUserTemplates(key))
  const persist = (next: readonly UserFileTemplate[]) => {
    templates.value = [...next]
    writeUserTemplates(key, templates.value)
  }
  const upsert = (template: UserFileTemplate) => {
    const others = templates.value.filter(entry => entry.id !== template.id)
    persist([...others, template])
  }
  const remove = (id: string) => persist(templates.value.filter(entry => entry.id !== id))
  /** 校验失败返回问题文案；成功则落盘并返回 null（与 `validateUserFileTemplate` 同一个出口）。 */
  const submit = (template: UserFileTemplate): string | null => {
    const problem = validateUserFileTemplate(template)
    if (problem) return problem
    if (!templates.value.some(entry => entry.id === template.id) && templates.value.length >= 200) {
      return `自定义模板最多 200 条，请先删除不再使用的条目。`
    }
    upsert(template)
    return null
  }
  return { templates, submit, remove, persist }
}

/** 供设置页展示的方案目录（`FileTemplatesLoader.kt:139-144` / `FileTemplatesScheme.java:16-26`）。 */
export function schemeDirs(projectRoot: string | null): Array<{ scope: FileTemplateScope; label: string; dir: string }> {
  const normalized = (projectRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  return [
    { scope: 'default', label: '默认方案', dir: `<配置目录>/${FILE_TEMPLATES_DIR}` },
    { scope: 'project', label: '本工程方案', dir: normalized ? `${normalized}/${FILE_TEMPLATES_DIR}` : `<工程目录>/${FILE_TEMPLATES_DIR}` },
  ]
}

/** 分类后按 qname 排序的表（设置面渲染用）。 */
export function entriesByCategory(entries: readonly FileTemplateEntry[]): Array<{ category: FileTemplateCategory; entries: FileTemplateEntry[] }> {
  return FILE_TEMPLATE_CATEGORIES.map(info => ({
    category: info.name,
    entries: entries
      .filter(entry => entry.category === info.name)
      .sort((left, right) => templateQName(left.name, left.extension).localeCompare(templateQName(right.name, right.extension))),
  })).filter(group => group.entries.length > 0)
}

/** 宿主内建 kind 按扩展名分组（设置面「宿主内建」那一片）。 */
export const hostKindsByExtension = computed(() => {
  const groups = new Map<string, HostTemplateKind[]>()
  for (const item of HOST_FILE_TEMPLATE_KINDS) {
    const list = groups.get(item.extension) ?? []
    list.push(item)
    groups.set(item.extension, list)
  }
  return [...groups.entries()].map(([extension, items]) => ({ extension, items }))
})
