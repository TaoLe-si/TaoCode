// 模块根模型（内容根 / 源根 / 排除根 / 序根条目）—— 上游 `ModuleRootModel` / `ContentEntry` /
// `SourceFolder` / `OrderEntry` 那一层对象图的 DOM 等价物（lp/roots ①、pm/roots ③、an/module ①）。
//
// 判词里三族都记着同一件事：「本仓单根工作区，`Module`/`ContentEntry` 对象图没有对等物」。
// 这句要拆开看：**「只有一个模块」是本仓的事实，「一个根下面可以有很多源根/测试根/排除根」是上游的模型**，
// 后者本仓一直没能如实呈现 —— 面板里过去只有一行「内容根 .」加一张扁平的源根列表，
// 用户看不出「哪些是源根、哪些是测试根、哪些目录整棵被排除了」。这一域补的就是那层对象图与它的呈现。
//
// 上游依据（逐条核过，行号可复现）：
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/ModuleRootModel.java:35` 接口本体；
//     `:42` `getModule()`；`:51` `getContentEntries()`；`:58` `getOrderEntries()`；
//     `:84` `getContentRoots()`；`:92` `getContentRootUrls()`；`:100` `getExcludeRoots()`；
//     `:118` `getSourceRoots()`；`:130` `getSourceRoots(boolean includingTests)`；`:189` `orderEntries()`。
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/ContentEntry.java:56` `getUrl()`；
//     `:63` `getSourceFolders()`；`:92` `getExcludeFolders()`；`:105` `getExcludeFolderFiles()`；
//     `:122` `addSourceFolder(file, isTestSource)`（**测试性是源根自己的属性**，不是另开一类根）。
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/SourceFolder.java:38` 接口；
//     `:44` `isTestSource()`；`:52` `getPackagePrefix()`；`:62` `getRootType()`。
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/OrderEntry.java:31`（`Comparable<OrderEntry>`）、
//     `:52` `getPresentableName()`、`:60` `isValid()`；
//     同目录 `JdkOrderEntry.java` / `LibraryOrderEntry.java` / `ModuleOrderEntry.java` 是三种条目本体，
//     `CompilerModuleExtension.java:29` 生产输出、`:45` 测试输出、`:76` `getOutputRoots(includeTests)`。
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/ProjectRootManager.java:65`
//     `getContentRootsFromAllModules()`、`:79` `getContentRoots()`、`:94` `getModuleSourceRoots(rootTypes)`。
//
// **与上游的四处不等价**（都是本仓后端给的约束，写清楚免得日后被当抄漏）：
//   1. 模块数量：本仓一个隐式模块（模块名 = 工作区目录名），`ModuleManagerImpl` 的模块图与
//      `ModuleOrderEntry` 的模块间依赖没有存储面 ⇒ `orderEntries` 里**不出现**模块依赖条目。
//   2. 内容根数量：`JavaProjectSettings`（`src/settingsModel.ts:66`）只有 `sourcePaths` 一张扁平表，
//      没有内容根字段。所以 `contentRootUrls` 恒为 `['']`（工作区根），但对象图按**复数**建
//      （`RootContentEntry[]`），将来加字段就有多根的落点，不用改这一层。
//   3. 排除根形态：上游按**路径**记（`ContentEntry.addExcludeFolder`，`ContentEntry.java:282-291`），
//      本仓 `ProjectSettings.excludedDirs` 是**目录名表**（命中规则见 `src/projectRoots.ts:66-70`）。
//      这里按名字在磁盘清单上求出**实际命中的那些目录**，所以 `RootExcludeFolder.path` 是求出来的、
//      不是存下来的；同名目录会各出一条（这正是名字表语义的如实结果）。
//   4. 测试输出目录：上游生产/测试输出是两个字段（`CompilerModuleExtension.java:29` 与 `:45`），
//      本仓只有一个 `outputPath` ⇒ `compilerTestOutput` 在没有配置时保持 null，
//      **不猜** `out/test/<模块>`（那条默认布局在本地上游树里取不到出处，按取证口径记「无法核实」）。

import { classifySourceRoot, excludedByNames, normalizeRootPath, SOURCE_ROOT_LABELS, validateSourceRoots, type SourceRootKind } from './projectRoots.ts'
import { libraryPresentableName, libraryUrlsByType, type Library } from './libraryModel.ts'
import { sdkPresentableName, sdkRootsOf, type Sdk } from './rootsSdkTable.ts'
import type { OrderRootType } from './orderRoots.ts'

/** 一个源根（上游 `SourceFolder`：路径 + 类型 + 测试性 + 包前缀）。 */
export interface RootSourceFolder {
  /** 工作区相对路径（`ContentEntry.java:56` 的 url 去掉 `file://` 前缀后的那一段）。 */
  readonly path: string
  /** 显示口径的根类型（`src/projectRoots.ts` 的约定分类，本仓没有存储的类型字段）。 */
  readonly kind: SourceRootKind
  /** `SourceFolder.isTestSource()`（`:44`）：本仓按类型推（tests / test-resources 即测试根）。 */
  readonly test: boolean
  /** `SourceFolder.getPackagePrefix()`（`:52`）：本仓没有这个存储字段，恒为空串，**不编**。 */
  readonly packagePrefix: string
  readonly fileCount: number
  readonly missing: boolean
  readonly excludedBy: string | null
}

/** 一个排除根（`ContentEntry.getExcludeFolders()`，`ContentEntry.java:92`）。 */
export interface RootExcludeFolder {
  readonly path: string
  /** 命中它的那个目录名（本仓按名字排除，见文件头第 3 条不等价）。 */
  readonly name: string
  readonly fileCount: number
}

/** 一个内容根（`ContentEntry`，`ContentEntry.java:56-105`）。 */
export interface RootContentEntry {
  readonly url: string
  readonly sources: RootSourceFolder[]
  readonly excludes: RootExcludeFolder[]
}

/** 序根条目的种类（`OrderEntry` 的三个子类 + 模块自己的输出）。 */
export type RootOrderEntryKind = 'jdk' | 'library' | 'module' | 'output' | 'testOutput'

/** 一个序根条目（`OrderEntry.java:31/:52/:60`）。 */
export interface RootOrderEntry {
  readonly kind: RootOrderEntryKind
  /** `getPresentableName()`（`:52`）。 */
  readonly presentableName: string
  /** `isValid()`（`:60`）：条目指向的东西在不在（本仓按磁盘清单/家目录是否配了判）。 */
  readonly valid: boolean
  /** 该条目贡献的根，按 `OrderRootType` 分组（`LibraryOrSdkOrderEntry.getRootFiles(type)` 的形状）。 */
  readonly roots: Readonly<Record<OrderRootType, string[]>>
  /** 一行补充说明（面板的 comment 位；没有就不显示）。 */
  readonly comment?: string
}

/** 一个模块的根模型（`ModuleRootModel`）。 */
export interface ModuleRootModel {
  /** `getModule()`（`:42`）的等价物：隐式模块名（工作区目录名）。 */
  readonly moduleName: string
  /** `getContentEntries()`（`:51`）。 */
  readonly contentEntries: RootContentEntry[]
  /** `getOrderEntries()`（`:58`）：本仓顺序 = SDK → 库 → 模块输出（上游不排序，见文件头）。 */
  readonly orderEntries: RootOrderEntry[]
}

export interface RootModelInput {
  /** 模块名（`ProjectRootManager` 那边是工作区目录名，`src/projectBuild.ts:125` 同一口径）。 */
  moduleName: string
  /** 内容根（工作区相对路径）。本仓的存储只支撑工作区根一个，缺省即空串。 */
  contentRoots?: readonly string[]
  /** `JavaProjectSettings.sourcePaths`。 */
  sourcePaths?: readonly string[]
  /** `ProjectSettings.excludedDirs`（目录名表）。 */
  excludedDirs?: readonly string[]
  /** `JavaProjectSettings.outputPath`（空串 = 没配，用调用方给的默认输出）。 */
  outputPath?: string
  /** 测试输出：本仓没有存储字段，只有调用方显式给了才有值（见文件头第 4 条不等价）。 */
  compilerTestOutput?: string | null
  /** 模块库（`src/libraryModel.ts` 的实体，已由 `libraryFromJars` 建好）。 */
  libraries?: readonly Library[]
  /** 项目 SDK（`src/rootsSdkTable.ts` 的实体）。 */
  sdk?: Sdk | null
  /** `workspace.files` 的全量清单：文件数 / 是否存在 / 排除命中都靠它。 */
  files?: readonly string[]
  /**
   * 本次会话里被显式改过的根类型（键 = 规范化路径）。本仓的存储没有根类型字段
   * （`JavaProjectSettings.sourcePaths` 是扁平的 `string[]`），面板让用户选过的那一档要能在
   * 这棵树上说出来 —— 所以它是**输入**而不是模型的内部状态（不假装持久化）。
   */
  kindOverrides?: Readonly<Record<string, SourceRootKind>>
}

const emptyRoots = (): Record<OrderRootType, string[]> => ({ sources: [], classes: [], javadoc: [], annotations: [] })

/** 上游 `SourceFolder.isTestSource()` 在本仓的等价求法：由目录约定判出来的类型里带 test 就是测试根。 */
export function isTestSourceKind(kind: SourceRootKind): boolean {
  return kind === 'tests' || kind === 'test-resources'
}

/**
 * `ContentEntry.getExcludeFolders()` 的求法（本仓按名字表在磁盘清单上算实际命中的目录）。
 *
 * 只收**最外层**命中：`build` 命中后 `build/tmp` 不再单独出一条（上游一个模块里排除根也是外层的
 * 子树整体排除，`ExcludedRootsImpl` 不会重复挂内层）。文件数按该目录之下的清单条目数（不含自身）。
 */
export function excludeFoldersFromFiles(files: readonly string[], excludedDirs: readonly string[]): RootExcludeFolder[] {
  if (!excludedDirs.length) return []
  const names = new Map<string, string>()
  for (const raw of files) {
    const path = normalizeRootPath(raw)
    if (!path) continue
    const segments = path.split('/')
    let acc = ''
    for (let index = 0; index < segments.length - 1; index++) {
      acc = acc ? `${acc}/${segments[index]}` : segments[index]!
      const name = excludedByNames(acc, excludedDirs)
      if (!name) continue
      if (!names.has(acc)) names.set(acc, name)
      break   // 最外层命中即止（内层不再算，也不继续往更深走）
    }
  }
  const out: RootExcludeFolder[] = []
  for (const [path, name] of names) {
    const prefix = `${path}/`
    let fileCount = 0
    for (const file of files) if (normalizeRootPath(file).startsWith(prefix)) fileCount += 1
    out.push({ path, name, fileCount })
  }
  return out.sort((left, right) => left.path.localeCompare(right.path))
}

/** 一个内容根（`ContentEntry`）：源根来自配置的 `sourcePaths`，排除根按名字表在清单上求出。 */
export function buildContentEntry(input: RootModelInput, url: string): RootContentEntry {
  const configured = (input.sourcePaths ?? []).map(normalizeRootPath).filter(Boolean)
  const prefix = url ? `${url}/` : ''
  // 只算落在这条内容根里的文件（`ContentEntry` 的源根/排除根都是**这条根下面**的东西，`:63`/`:92`）。
  const underUrl = (path: string) => !prefix || path === url || path.startsWith(prefix)
  const files = (input.files ?? []).map(normalizeRootPath).filter(underUrl)
  const states = validateSourceRoots(configured.filter(underUrl), files, input.excludedDirs ?? [])
  const sources: RootSourceFolder[] = states.map(state => ({
    path: state.path,
    kind: input.kindOverrides?.[state.path] ?? state.kind,
    test: isTestSourceKind(input.kindOverrides?.[state.path] ?? state.kind),
    packagePrefix: '',
    fileCount: state.fileCount,
    missing: state.missing,
    excludedBy: state.excludedBy,
  }))
  return { url, sources, excludes: excludeFoldersFromFiles(files, input.excludedDirs ?? []) }
}

/**
 * 序根条目（`ModuleRootModel.getOrderEntries()`，`:58`）。
 *
 * 顺序：SDK → 库 → 模块输出。上游 `RootModelBase.getOrderEntries()` 把模块依赖排在库之前，
 * 本仓没有模块间依赖（文件头第 1 条不等价），所以 `module` 这一类**一条都不出**，
 * 不是漏了；输出条目放最后是因为面板上它属于「编译输出」而不是「依赖」。
 */
export function buildOrderEntries(input: RootModelInput): RootOrderEntry[] {
  const out: RootOrderEntry[] = []
  const sdk = input.sdk ?? null
  if (sdk) {
    const roots = sdkRootsOf(sdk)
    out.push({
      kind: 'jdk',
      presentableName: sdkPresentableName(sdk),
      valid: Boolean(sdk.homePath.trim()),
      roots,
      comment: sdk.homePath.trim() ? sdk.homePath : '未设置 JDK 家目录',
    })
  }
  for (const library of input.libraries ?? []) {
    const byType = libraryUrlsByType(library)
    const classes = byType.classes
    out.push({
      kind: 'library',
      // 未命名库的名字 = 第一个 CLASSES 根的文件名（`libraryPresentableName`，LibraryBridgeImpl.kt:235-247）。
      presentableName: libraryPresentableName(library),
      // `OrderEntry.isValid()`：上游判「库对象还在不在」；本仓判「这个根在不在磁盘清单上」。
      // 库根通常是**绝对路径**（工程外的 jar），清单里只有工程内路径，所以清单查不到不等于无效 ——
      // 只有当库里**一个根都没有**时才报无效（空库，`LibraryBridgeImpl.kt` 的 `empty.library.title` 同一件事）。
      valid: classes.length + byType.sources.length + byType.javadoc.length > 0,
      roots: byType,
    })
  }
  const output = normalizeRootPath(input.outputPath ?? '')
  if (output) {
    const built = (input.files ?? []).some(file => normalizeRootPath(file).startsWith(`${output}/`))
    out.push({
      kind: 'output', presentableName: output, valid: true,
      roots: { ...emptyRoots(), classes: [output] },
      // 配了路径的条目本身就是有效的；「目录里现在有没有产物」是另一件事，放注释里说出来
      // （上游那侧编译输出属于 `CompilerModuleExtension`（`:29`/`:45`/`:76`），不是 `OrderEntry.isValid()` 判的对象）。
      comment: built ? '模块编译输出（生产）' : '模块编译输出（生产）；目录里还没有产物（未构建或已清理）',
    })
  }
  const testOutput = normalizeRootPath(input.compilerTestOutput ?? '')
  if (testOutput) {
    out.push({ kind: 'testOutput', presentableName: testOutput, valid: true, roots: { ...emptyRoots(), classes: [testOutput] }, comment: '模块编译输出（测试）' })
  }
  return out
}

/** 整张根模型（`ModuleRootModel` 的等价物）。 */
export function buildRootModel(input: RootModelInput): ModuleRootModel {
  const urls = ['', ...(input.contentRoots ?? []).map(normalizeRootPath).filter(Boolean)]
  const configured = [...new Set((input.sourcePaths ?? []).map(normalizeRootPath).filter(Boolean))]
  // 一条源根只归**最长匹配**的那条内容根（上游 `ContentEntry` 各管自己根下的文件夹，
  // `ContentEntry.java:63` 的 getSourceFolders 不会把邻居根下的东西算进来）。
  const ownerOf = (path: string) => urls.reduce((best, url) => {
    const under = !url || path === url || path.startsWith(`${url}/`)
    return under && url.length > best.length ? url : best
  }, '')
  const contentEntries = urls.map(url => buildContentEntry({ ...input, sourcePaths: configured.filter(path => ownerOf(path) === url) }, url))
  return { moduleName: input.moduleName, contentEntries, orderEntries: buildOrderEntries(input) }
}

/** `getContentRootUrls()`（`ModuleRootModel.java:92`）。 */
export function contentRootUrls(model: ModuleRootModel): string[] {
  return model.contentEntries.map(entry => entry.url)
}

/** `getExcludeRootUrls()`（`:108`）：跨内容根汇总、去重、按路径排。 */
export function excludeRootUrls(model: ModuleRootModel): string[] {
  const set = new Set<string>()
  for (const entry of model.contentEntries) for (const folder of entry.excludes) set.add(folder.path)
  return [...set].sort()
}

/**
 * `getSourceRoots(boolean includingTests)`（`:118` / `:130`）：
 * 默认**不含**测试根（上游 `productionOnly` 的默认口径就是不含 test）。
 */
export function sourceRootUrls(model: ModuleRootModel, includingTests = false): string[] {
  const out: string[] = []
  for (const entry of model.contentEntries) {
    for (const folder of entry.sources) {
      if (!includingTests && folder.test) continue
      if (!out.includes(folder.path)) out.push(folder.path)
    }
  }
  return out
}

/** `getModule()` 之后问「这个文件属于哪个内容根」：最长前缀命中（上游按 VirtualFile 找 content entry）。 */
export function contentEntryForFile(model: ModuleRootModel, path: string): RootContentEntry | null {
  const normalized = normalizeRootPath(path)
  let best: RootContentEntry | null = null
  for (const entry of model.contentEntries) {
    if (!entry.url) { if (!best) best = entry; continue }
    if (normalized === entry.url || normalized.startsWith(`${entry.url}/`)) {
      if (!best || entry.url.length > (best.url?.length ?? 0)) best = entry
    }
  }
  return best
}

/** 一个面板行（渲染用的扁平树；`depth` = 缩进层级）。 */
export interface RootModelRow {
  readonly key: string
  readonly depth: number
  readonly text: string
  readonly kind?: SourceRootKind
  /** 计数标签（`SidePanelCountLabel` 那一档）。清单没到时为 null，不编数字。 */
  readonly count: number | null
  readonly missing?: boolean
  readonly excludedBy?: string | null
  readonly orderEntryKind?: RootOrderEntryKind
  readonly valid?: boolean
  readonly comment?: string
}

/**
 * 面板的树（`ContentEntryTreeEditor` 那棵树的本仓等价物）：
 * 内容根 → 按根类型分组（源代码/测试/资源/测试资源/生成）→ 组内逐根 → 排除根分组 → 序根条目分组。
 *
 * 分组是**呈现**用的（上游那棵树也是按 `SourceFolder.getRootType()` 分类显示），
 * 不新增任何存储字段；组按 `SOURCE_ROOT_LABELS` 的固定顺序出，空组不出。
 */
export function rootModelRows(model: ModuleRootModel, known: boolean): RootModelRow[] {
  const rows: RootModelRow[] = []
  for (const entry of model.contentEntries) {
    rows.push({ key: `content:${entry.url}`, depth: 0, text: entry.url ? `内容根 ${entry.url}` : `内容根 ${model.moduleName || '.'}`, count: known ? entry.sources.length : null })
    const groups = new Map<SourceRootKind, RootSourceFolder[]>()
    for (const folder of entry.sources) {
      const list = groups.get(folder.kind) ?? []
      list.push(folder)
      groups.set(folder.kind, list)
    }
    for (const kind of Object.keys(SOURCE_ROOT_LABELS) as SourceRootKind[]) {
      const list = groups.get(kind)
      if (!list?.length) continue
      rows.push({ key: `group:${entry.url}:${kind}`, depth: 1, text: `${SOURCE_ROOT_LABELS[kind]}根（${list.length}）`, kind, count: null })
      for (const folder of list) {
        rows.push({
          key: `source:${entry.url}:${folder.path}`, depth: 2, text: folder.path, kind,
          count: known ? folder.fileCount : null, missing: folder.missing, excludedBy: folder.excludedBy,
        })
      }
    }
    if (!entry.sources.length) rows.push({ key: `empty:${entry.url}`, depth: 1, text: '没有源码目录', count: null })
    if (entry.excludes.length) {
      rows.push({ key: `exgroup:${entry.url}`, depth: 1, text: `排除根（${entry.excludes.length}）`, count: null })
      for (const folder of entry.excludes) {
        rows.push({ key: `exclude:${folder.path}`, depth: 2, text: folder.path, count: known ? folder.fileCount : null, comment: `按目录名「${folder.name}」排除` })
      }
    }
  }
  if (model.orderEntries.length) {
    rows.push({ key: 'order', depth: 0, text: `模块「${model.moduleName}」的序根条目`, count: model.orderEntries.length })
    for (const entry of model.orderEntries) {
      const contributed = (Object.keys(entry.roots) as OrderRootType[]).reduce((sum, type) => sum + entry.roots[type].length, 0)
      rows.push({
        key: `order:${entry.kind}:${entry.presentableName}`, depth: 1, text: entry.presentableName,
        count: contributed, orderEntryKind: entry.kind, valid: entry.valid, comment: entry.comment,
      })
    }
  }
  return rows
}

/** 条目 kinds 的中文标签（面板用；顺序与 `buildOrderEntries` 一致）。 */
export const ORDER_ENTRY_LABELS: Record<RootOrderEntryKind, string> = {
  jdk: 'SDK',
  library: '库',
  module: '模块依赖',
  output: '输出',
  testOutput: '测试输出',
}

/** 条目 kind + 有效性 → 一行标签（面板的树行只有这两样，没有整个条目对象）。 */
export function orderEntryKindLabel(kind: RootOrderEntryKind, valid: boolean): string {
  const label = ORDER_ENTRY_LABELS[kind]
  return valid ? label : `${label}（无效）`
}

/** 序根条目行的说明文案（把 kind 与 valid 合成一行，面板直接显示）。 */
export function orderEntryText(entry: RootOrderEntry): string {
  return orderEntryKindLabel(entry.kind, entry.valid)
}
