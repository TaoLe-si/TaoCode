// 模块 / 内容根 / 库 / SDK 作用域模型 —— 上游
// `platform/analysis-impl/src/com/intellij/openapi/module/impl/scopes` 一族的可移植子集。
//
// 上游逐类（本文件按这些类名逐条对照，行为差异都写在下面）：
//   · `RootContainer.kt:18-40` + `ClassicRootContainer`：一组根 → 优先级表。根按加入顺序拿 1..n，
//     `getSortedRoots()` 按优先级升序；多个容器用 `merge` 合并时，后一个容器的优先级整体
//     叠在前一个容器的 max 之上（`:74-97`）。
//   · `ScopeRootDescriptor.kt`：根 → `{rootType, orderEntryName}`（哪条依赖项带来了这个根）。
//   · `ModuleContentScopes.kt`：`ModuleContentScope.contains` = 文件在**本模块**内容内；
//     `ModuleWithDependenciesContentScope` = 文件在依赖闭包中任一模块的内容内，`compare` 按
//     依赖顺序（本仓只有一个隐式模块，因此两者相等，`compare` 恒 0）。
//   · `ModulesScope.java:41-74`：一组模块的内容；`isSearchInLibraries=false`。
//   · `ModuleWithDependenciesScope.kt:17-33`：内容 + 依赖模块 + 库/SDK，选项位决定加什么；
//     `:47-49` COMPILE_ONLY 决定显示名是「module」还是「module.runtime」。
//   · `ModuleWithDependentsScope.java`：反向依赖闭包（`ModuleIndex` 两张反向表 + 只沿 exported 边下探的
//     BFS，`:76-123`；`isSearchInLibraries():219-222` 恒 false）。本仓默认没有 `ModuleOrderEntry`
//     ⇒ 闭包退化为自身；给了边（`ModuleScopeInput.moduleOrderEntries`）就走真闭包。
//   · `LibraryScopeBase`/`LibraryScope`/`LibraryRuntimeClasspathScope`：库的 classes/sources 根；
//     运行时类路径 = 内容 + 库 + SDK（`ModuleScopeProviderImpl.getModuleRuntimeScope`）。
//   · `JdkScope.java`：SDK 的 classes/sources 根 + JDK 名。
//   · `ModuleScopeUtil.kt:24-33`：`getOrderEnumeratorForOptions` 的选项语义
//     （COMPILE_ONLY → exportedOnly+compileOnly；LIBRARIES → 带库与 SDK，否则都没有；
//      MODULES → 带依赖模块；TESTS → 带测试根）。
//
// 本仓的现实：单隐式模块（名字取工作区目录名）、内容根是项目设置里的 `sourcePaths`
// （`JavaProjectSettings.sourcePaths`，见 `src/settingsModel.ts:58`），库是
// `referencedLibraries` 的 glob 命中物（`src/externalLibraries.ts` 的 `matchedJars`），
// SDK 是 `buildHost` 的 `detectedJdk`。因此本模型只做**对已有数据的结构化**：
//   · 依赖闭包退化为自身（没有 ModuleOrderEntry 可枚举）——`withDependencies` 与 `content` 同集，
//     但 API 与显示名保留上游形状，调用方不必知道这个退化；
//   · 库没有 `Library` 实体，一条 glob 模式就是一条库，库名取该模式（上游 `matchesLibrary`
//     在库名为 null 时退到 presentable name 的文件名，本仓把模式名当库名，语义等价于
//     「这条路径声明属于哪条库」）；
//   · SDK 的根是安装目录（绝对路径），**工作区相对路径永远不在里面** —— 与上游一致：
//     `JdkScope` 只匹配 JDK 根内的文件，项目文件不该被它命中。
//
// 消费者：`src/scopes.ts` 的 `file[...]` 求值（`ext:`/库名匹配；见那边的 `ScopeFileSystem`），
// 界面落点是设置 › 外观与行为 › 作用域页的命中计数与文件树标记
// （`src/components/ScopesSettingsPage.vue`，对应 `ScopeEditorPanel.java:432-452,126-1035`）。

import { classifySourceRoot } from './projectRoots.ts'

/** `ModuleScopeUtil.kt` 的选项位（位值本身是上游内部约定，这里按同样的组合语义）。 */
export const SCOPE_OPTION = {
  /** 只看产出（compile）：`exportedOnly().compileOnly()`。 */
  COMPILE_ONLY: 1,
  /** 带库与 SDK（上游 LIBRARIES 同时管这两者，见 `ModuleScopeUtil.kt:30`）。 */
  LIBRARIES: 2,
  /** 带依赖模块。 */
  MODULES: 4,
  /** 带测试根。 */
  TESTS: 8,
} as const

export interface ScopeLibrary {
  /** 库名（本仓 = `referencedLibraries` 的那条 glob 模式）。 */
  name: string
  /** 库根：本仓是命中的 jar 文件（工作区相对路径）。 */
  files: readonly string[]
}

export interface ModuleScopeInput {
  /** 单隐式模块名（工作区目录名）。 */
  moduleName: string
  /** 内容根（工作区相对路径；`''` = 工作区根）。缺省即 `['']`。 */
  contentRoots?: readonly string[]
  /** 源根（`JavaProjectSettings.sourcePaths`；不含内容根本身）。 */
  sourcePaths?: readonly string[]
  /** 库清单（`src/externalLibraries.ts` 的 `matchedJars` 原料）。 */
  libraries?: readonly ScopeLibrary[]
  /** 项目 SDK（`buildHost` 的 `detectedJdk` 口径）。 */
  jdk?: { name: string; home: string } | null
  /**
   * 模块依赖边。单隐式模块下缺省 `[]`；传了边才有非平凡的依赖/反向依赖闭包
   * （见 `ModuleWithDependentsScope.java:96-123` 的 `ModuleIndex`）。
   * 同时给出各模块自己的内容根，闭包里别的模块要按各自的内容根判定（`ModuleContentScope` 的口径）。
   */
  moduleOrderEntries?: readonly ModuleOrderEntry[]
  /** 模块名 → 它自己的内容根（`ModuleRootManager.getContentRoots()`）。缺省只有本模块。 */
  moduleContentRoots?: Readonly<Record<string, readonly string[]>>
}

/**
 * 一条 `ModuleOrderEntry`（`platform/analysis-impl/.../module/impl/scopes/ModuleWithDependentsScope.java:105-120`
 * 枚举的 `ModuleRootManager.getOrderEntries()` 里那类 `ModuleOrderEntry`）：`from` 依赖 `to`。
 * `exported` 对应 `ModuleOrderEntry.isExported()`。
 *
 * 本仓是单隐式模块，所以**默认没有边**（`[]` ⇒ 反向闭包退化为自身，与改动前一致）。
 * 有多模块数据时（`ModuleScopeModel.moduleOrderEntries`）`moduleWithDependentsScope` 才走真闭包。
 */
export interface ModuleOrderEntry {
  from: string
  to: string
  exported: boolean
}

/** `ScopeRootDescriptor.kt` 的等价物：一个根 + 它是哪种根 + 谁带来的。 */
export interface ScopeRootDescriptor {
  /** 根路径（工作区相对；SDK 根是绝对路径）。 */
  root: string
  rootType: 'content' | 'source' | 'library' | 'jdk'
  /** 上游的 `orderEntryName`：内容根用模块名，库根用库名，SDK 根用 JDK 名。 */
  orderEntryName: string
  /** 优先级，从 1 起；数字小的排在类路径前面（`RootContainer.getPriority`）。 */
  priority: number
}

export interface ModuleScopeModel {
  moduleName: string
  /** 内容根（规范化后，`''` 表示工作区根）。 */
  contentRoots: readonly string[]
  /** 源根（规范化、去重、去掉空串）。 */
  sourceRoots: readonly string[]
  /** 测试源根（按 Maven/Gradle 目录约定从 `sourcePaths` 判出，`projectRoots.classifySourceRoot`）。 */
  testRoots: readonly string[]
  libraries: readonly ScopeLibrary[]
  jdk: { name: string; home: string } | null
  /** 根优先级表（按优先级升序，即类路径顺序）。 */
  roots: readonly ScopeRootDescriptor[]
  /**
   * 模块依赖边（`ModuleOrderEntry`）。默认空 —— 本仓是单隐式模块，没有 `ModuleOrderEntry` 可枚举；
   * `moduleWithDependentsScope` 的反向闭包在空表下退化为自身。
   */
  moduleOrderEntries: readonly ModuleOrderEntry[]
  /** 模块名 → 它自己的内容根（`ModuleRootManager.getContentRoots()` 的等价物）。 */
  moduleContentRoots: ReadonlyMap<string, readonly string[]>
  /** 文件是否在内容根内（`ModuleContentScope.contains`）。 */
  isInContent(file: string): boolean
  /** 文件所在的内容根相对路径；不在内容根内返回 null。 */
  contentRelativePath(file: string): string | null
  /** 文件属于哪条库（库根 = jar 本身或其下的合成路径）；不属于任何库返回 null。 */
  libraryNameOf(file: string): string | null
  /** 文件相对所在库根的路径；不在库里返回 null。 */
  libraryRelativePath(file: string): string | null
  /** 文件是否在 SDK 根内（工作区相对路径永远 false，见文件头）。 */
  isInJdk(file: string): boolean
  /** 文件命中的根的描述件；都没有返回 null。 */
  rootDescriptorOf(file: string): ScopeRootDescriptor | null
}

const normalize = (path: string): string => path
  .trim()
  .replace(/\\/g, '/')
  .replace(/^\.\//, '')
  .replace(/\/+$/, '')

const isUnder = (root: string, file: string): boolean =>
  root === '' || file === root || file.startsWith(`${root}/`)

/** 绝对路径（盘符或前导 `/`）不属于工作区相对的内容根 —— SDK 根是绝对路径，不能被 `''` 吞掉。 */
const isAbsolutePath = (file: string): boolean => file.startsWith('/') || /^[a-zA-Z]:\//.test(file)

/** 内容根相对路径：`''` 根直接给整条；其余去掉根前缀与分隔符。 */
function relativeTo(root: string, file: string): string {
  if (root === '') return file
  if (file === root) return ''
  return file.slice(root.length + 1)
}

const samePath = (left: string, right: string): boolean =>
  normalize(left).toLowerCase() === normalize(right).toLowerCase()

/**
 * `RootContainer.merge`（:74-97）：把多个容器的根按优先级合并。
 * 后一个容器的每个根拿「前一容器的 max 优先级 + 它自己的优先级」，**先出现的根保留原优先级**
 * （`putIfAbsent`）。返回按优先级升序的根表。
 */
export function mergeRootContainers(containers: readonly (readonly ScopeRootDescriptor[])[]): ScopeRootDescriptor[] {
  if (containers.length === 0) return []
  const first = containers[0]!
  if (containers.length === 1) return [...first].sort((a, b) => a.priority - b.priority)
  const merged = new Map<string, ScopeRootDescriptor>()
  let maxPriority = 0
  for (const container of containers) {
    let currentMax = 0
    for (const descriptor of container) {
      const priority = descriptor.priority + maxPriority
      currentMax = Math.max(currentMax, priority)
      const key = normalize(descriptor.root)
      if (!merged.has(key)) merged.set(key, { ...descriptor, priority })
    }
    maxPriority = Math.max(maxPriority, currentMax)
  }
  return [...merged.values()].sort((a, b) => a.priority - b.priority)
}

/** `ModuleScopeUtil.getOrderEnumeratorForOptions` 的选项语义（返回规范化后的开关）。 */
export function scopeOptions(options: number): { compileOnly: boolean; libraries: boolean; modules: boolean; tests: boolean } {
  return {
    compileOnly: (options & SCOPE_OPTION.COMPILE_ONLY) !== 0,
    libraries: (options & SCOPE_OPTION.LIBRARIES) !== 0,
    modules: (options & SCOPE_OPTION.MODULES) !== 0,
    tests: (options & SCOPE_OPTION.TESTS) !== 0,
  }
}

/** 构建单隐式模块的作用域模型（纯函数；输入变了就重建，不做缓存 —— 上游缓存见 `ModuleWithDependenciesScopeCache`）。 */
export function moduleScopeModel(input: ModuleScopeInput): ModuleScopeModel {
  const contentRoots = (input.contentRoots && input.contentRoots.length ? input.contentRoots : [''])
    .map(normalize)
    .filter((root, index, all) => all.indexOf(root) === index)
  const sourceRoots = (input.sourcePaths ?? [])
    .map(normalize)
    .filter((root, index, all) => root !== '' && all.indexOf(root) === index)
  const testRoots = sourceRoots.filter(root => {
    const kind = classifySourceRoot(root)
    return kind === 'tests' || kind === 'test-resources'
  })
  const libraries = input.libraries ?? []
  const jdk = input.jdk && (input.jdk.name || input.jdk.home) ? input.jdk : null
  const moduleOrderEntries = input.moduleOrderEntries ?? []
  // 每个模块自己的内容根：`ModuleRootManager.getContentRoots()` 的等价物。缺省只有本模块这一条。
  const moduleContentRoots = new Map<string, string[]>()
  for (const [name, rootsOf] of Object.entries(input.moduleContentRoots ?? {}))
    moduleContentRoots.set(name, rootsOf.map(normalize).filter((root, index, all) => all.indexOf(root) === index))
  moduleContentRoots.set(input.moduleName, contentRoots)

  // 根优先级：内容根 → 源根 → 库根 → SDK 根。上游的 `RootCalculator` 也是这个加入顺序
  // （`ModuleWithDependenciesScope.kt:139-152`：先 order entries 的 roots，再逐个 putIfAbsent）。
  const roots: ScopeRootDescriptor[] = []
  let priority = 1
  for (const root of contentRoots)
    roots.push({ root, rootType: 'content', orderEntryName: input.moduleName, priority: priority++ })
  for (const root of sourceRoots) {
    if (contentRoots.includes(root)) continue          // 源根与内容根重合时不重复登记
    roots.push({ root, rootType: 'source', orderEntryName: input.moduleName, priority: priority++ })
  }
  for (const library of libraries)
    for (const file of library.files)
      roots.push({ root: normalize(file), rootType: 'library', orderEntryName: library.name, priority: priority++ })
  if (jdk) roots.push({ root: normalize(jdk.home), rootType: 'jdk', orderEntryName: jdk.name, priority: priority++ })

  // 命中判定用「最长根优先」：文件同时落在 '' 与 'src/main' 下时取更具体的那个根
  // （上游 `getContentRootForFile` 也是取包含文件的内容根，不是任意祖先）。
  // 绝对路径（盘符或前导 `/`）不属于工作区相对的内容根 —— JDK 根是绝对路径，不能被 '' 吞掉。
  const isAbsolute = isAbsolutePath
  const sortedContent = [...contentRoots].sort((a, b) => b.length - a.length)
  const inContentRoot = (file: string): string | null => {
    if (isAbsolute(file)) return null
    for (const root of sortedContent) if (isUnder(root, file)) return root
    return null
  }
  const libraryOf = (file: string): ScopeLibrary | null => {
    for (const library of libraries) {
      for (const raw of library.files) {
        const root = normalize(raw)
        // 库根是 jar 文件本身：命中根或根下的合成路径（`a.jar!/...` 这类由调用方给全）。
        if (file === root || file.startsWith(`${root}!/`)) return library
      }
    }
    return null
  }

  const model: ModuleScopeModel = {
    moduleName: input.moduleName,
    contentRoots,
    sourceRoots,
    testRoots,
    libraries,
    jdk,
    roots: mergeRootContainers([roots]),
    moduleOrderEntries,
    moduleContentRoots,
    isInContent: file => inContentRoot(file) !== null,
    contentRelativePath: file => {
      const root = inContentRoot(file)
      return root === null ? null : relativeTo(root, file)
    },
    libraryNameOf: file => libraryOf(file)?.name ?? null,
    libraryRelativePath: file => {
      const library = libraryOf(file)
      if (!library) return null
      for (const raw of library.files) {
        const root = normalize(raw)
        if (file === root) return root.replace(/^.*\//, '')
        if (file.startsWith(`${root}!/`)) return `${root.replace(/^.*\//, '')}${file.slice(root.length)}`
      }
      return null
    },
    isInJdk: file => {
      if (!jdk || !jdk.home) return false
      // SDK 根是绝对路径，工作区相对路径不可能落在里面 —— 沿用上游语义（项目文件不被 JdkScope 命中）。
      return /^[a-zA-Z]:\//.test(normalize(file)) && isUnder(normalize(jdk.home), normalize(file))
    },
    rootDescriptorOf: file => {
      const contentRoot = inContentRoot(file)
      if (contentRoot !== null) return roots.find(entry => entry.root === contentRoot) ?? null
      const library = libraryOf(file)
      if (library) {
        const root = library.files.map(normalize).find(candidate =>
          file === candidate || file.startsWith(`${candidate}!/`))
        if (root) return roots.find(entry => entry.root === root) ?? null
      }
      if (jdk && isUnder(normalize(jdk.home), normalize(file)))
        return roots.find(entry => entry.rootType === 'jdk') ?? null
      return null
    },
  }
  return model
}

/** `ModulesScope`：一组模块的内容。单模块下等于 `moduleScopeModel` 的内容判定。 */
export function modulesScope(input: ModuleScopeInput, moduleNames: readonly string[]): ModuleScopeModel | null {
  if (!moduleNames.includes(input.moduleName)) return null
  return moduleScopeModel(input)
}

/**
 * 把「另一个模块的内容根」并进当前模型的根表（`ModuleWithDependenciesScope.kt:138-142` 的
 * `putIfAbsent(root, i++)`：首次出现为准、出现顺序即优先级）。
 * `keepLibraries` 决定库/SDK 根留不留（`ModuleScopeUtil.kt:31` 的 `withoutLibraries().withoutSdk()`
 * 与 `ModuleWithDependentsScope.java:219-222` 的 `isSearchInLibraries()` 恒假是**两条不同的**
 * **语义**，所以这一层只搬根表，不冒充上面那两个判据）。
 */
function withModuleRoots(model: ModuleScopeModel, roots: readonly string[], keepLibraries: boolean): ModuleScopeModel {
  const own = keepLibraries ? model.roots : model.roots.filter(root => root.rootType !== 'library' && root.rootType !== 'jdk')
  const extra: ScopeRootDescriptor[] = []
  let priority = own.length
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    if (model.contentRoots.includes(root)) continue
    extra.push({ root, rootType: 'content', orderEntryName: model.moduleName, priority: ++priority })
  }
  const stripped: ModuleScopeModel = keepLibraries ? model : {
    ...model,
    libraries: [],
    jdk: null,
    roots: own,
    libraryNameOf: () => null,
    libraryRelativePath: () => null,
    isInJdk: () => false,
    rootDescriptorOf: file => {
      const descriptor = model.rootDescriptorOf(file)
      return descriptor && descriptor.rootType !== 'library' && descriptor.rootType !== 'jdk' ? descriptor : null
    },
  }
  if (!extra.length) return stripped
  const byLength = [...extra].sort((a, b) => b.root.length - a.root.length)
  const extraRootOf = (file: string): ScopeRootDescriptor | null => {
    if (isAbsolutePath(file)) return null
    for (const entry of byLength) if (isUnder(entry.root, file)) return entry
    return null
  }
  return {
    ...stripped,
    contentRoots: [...stripped.contentRoots, ...extra.map(entry => entry.root)],
    roots: mergeRootContainers([stripped.roots, extra]),
    isInContent: file => stripped.isInContent(file) || extraRootOf(file) !== null,
    contentRelativePath: file => {
      const ownRoot = stripped.contentRoots.find(root => isUnder(root, file) && !isAbsolutePath(file))
      const other = extraRootOf(file)
      if (ownRoot === undefined && other === null) return null
      if (ownRoot === undefined) return relativeTo(other!.root, file)
      if (other === null || ownRoot.length >= other.root.length) return relativeTo(ownRoot, file)
      return relativeTo(other.root, file)
    },
    rootDescriptorOf: file => stripped.rootDescriptorOf(file) ?? extraRootOf(file),
  }
}

/**
 * `ModuleWithDependenciesScope`（`:17-33`）：内容 + 依赖模块 + 库/SDK，由选项位决定。
 * 选项语义逐条照 `ModuleScopeUtil.getOrderEnumeratorForOptions`（`ModuleScopeUtil.kt:27-35`）：
 * `LIBRARIES` 没开 ⇒ 库与 SDK 根都不参与（`:31`）、`MODULES` 没开 ⇒ 不并依赖模块的根（`:32`）、
 * `COMPILE_ONLY` 开着 ⇒ 只沿 `isExported()` 的模块边走（`:30`）。
 * 依赖模块的根按 **SOURCES** 收（`ModuleWithDependenciesScope.kt:131-134`：
 * `ModuleOrderEntry`/`ModuleSourceOrderEntry` 取 SOURCES，其余取 CLASSES）。
 * 单模块（没有边）⇒ 闭包只有自己 ⇒ 与改动前逐字一致。
 * 入参是**已建好的模型**（上游入参是 Module，本仓等价物就是 `moduleScopeModel` 的产物）。
 *
 * 未接的一半（如实）：`TESTS` 位的 `productionOnly()`（`ModuleScopeUtil.kt:33`）在本仓只作用于
 * 依赖模块的**测试源根**，而本仓的多模块输入面只给了各模块的内容根
 * （`ModuleScopeInput.moduleContentRoots`），没有各模块自己的源根表 ⇒ 这一位对依赖模块暂时无差别。
 */
export function moduleWithDependenciesScope(model: ModuleScopeModel, options: number): ModuleScopeModel {
  const flags = scopeOptions(options)
  const modules = dependencyModuleClosure(model, options)
  const foreign: string[] = []
  if (modules.length > 1) {
    for (const name of [...modules].sort((a, b) => a.localeCompare(b))) {
      if (name === model.moduleName) continue
      for (const root of model.moduleContentRoots.get(name) ?? []) if (root && !foreign.includes(root)) foreign.push(root)
    }
  }
  return withModuleRoots(model, foreign, flags.libraries)
}

/**
 * `ModuleWithDependentsScope` 的反向闭包（`platform/analysis-impl/.../module/impl/scopes/ModuleWithDependentsScope.java`）：
 *   · `ModuleIndex`（`:96-123`）从 `ModuleOrderEntry` 建两张反向表 ——
 *     `allUsages`（被依赖方 → 依赖它的模块）与 `exportingUsages`（只收 `isExported()` 的）；
 *   · 构造里的 BFS（`:76-93`）：`myModules` 收全部 `allUsages`（不管有没有 exported），
 *     但**只有 `exportingUsages` 的边继续往下走**。
 *     这就是「闭包里非 exported 的依赖方被算进来，但它的依赖方不再被拉进来」那层意思。
 *   · 起点是根模块自己（`myModules.addAll(myRootModules)`）。
 *
 * 本仓默认没有边（单隐式模块）⇒ 返回 `[本模块]`，与改动前的恒等行为一致。
 */
export function dependentModuleClosure(model: ModuleScopeModel): string[] {
  const allUsages = new Map<string, string[]>()
  const exportingUsages = new Map<string, string[]>()
  const push = (index: Map<string, string[]>, key: string, value: string) => {
    const list = index.get(key)
    if (list) { if (!list.includes(value)) list.push(value) }
    else index.set(key, [value])
  }
  for (const entry of model.moduleOrderEntries) {
    push(allUsages, entry.to, entry.from)
    if (entry.exported) push(exportingUsages, entry.to, entry.from)
  }
  const modules = new Set<string>([model.moduleName])
  const queue: string[] = [model.moduleName]
  const seen = new Set<string>([model.moduleName])
  for (let i = 0; i < queue.length; ++i) {
    const current = queue[i]!
    for (const dependent of allUsages.get(current) ?? []) modules.add(dependent)
    for (const dependent of exportingUsages.get(current) ?? []) {
      if (seen.has(dependent)) continue
      seen.add(dependent)
      queue.push(dependent)
    }
  }
  return [...modules]
}

/**
 * `ModuleWithDependentsScope`（`:53-231`）：本模块 + 全部依赖它的模块的内容。
 * 库与 SDK **不**参与（`isSearchInLibraries():219-222` 恒 false）；`contains`（`:181-212`）的判据是
 * 「文件所属模块与闭包有交集」，这里按各模块自己的内容根 union 承接
 * （`ModuleContentScope` 对每个模块各判一次的口径）。
 * 单模块下闭包只有自己 ⇒ 直接返回原模型，行为与改动前逐字一致。
 */
export function moduleWithDependentsScope(model: ModuleScopeModel): ModuleScopeModel {
  const modules = dependentModuleClosure(model)
  if (modules.length === 1) return model
  // `isSearchInLibraries()` 恒 false ⇒ 本模块的库/SDK 根也不进根表（`ModuleWithDependentsScope.java:219-222`），
  // 根表只剩内容根 + 闭包里其它模块的内容根。
  const ownContentRoots = model.roots.filter(isContentRoot)
  // 闭包里其它模块的内容根，按模块名 + 根名稳定排序（`toString()` 那个清单的上游口径是按模块名）。
  const extra: ScopeRootDescriptor[] = []
  let priority = ownContentRoots.length
  for (const name of [...modules].sort((a, b) => a.localeCompare(b))) {
    if (name === model.moduleName) continue
    for (const root of [...(model.moduleContentRoots.get(name) ?? [])].sort((a, b) => b.length - a.length))
      extra.push({ root, rootType: 'content', orderEntryName: name, priority: ++priority })
  }
  if (extra.length === 0) return { ...model, libraries: [], jdk: null, roots: ownContentRoots }
  const sortedExtra = [...extra].sort((a, b) => b.root.length - a.root.length)
  const extraRootOf = (file: string): ScopeRootDescriptor | null => {
    if (isAbsolutePath(file)) return null
    for (const entry of sortedExtra) if (isUnder(entry.root, file)) return entry
    return null
  }
  return {
    ...model,
    contentRoots: [...model.contentRoots, ...extra.map(entry => entry.root)],
    libraries: [],
    jdk: null,
    roots: mergeRootContainers([ownContentRoots, extra]),
    isInContent: file => model.isInContent(file) || extraRootOf(file) !== null,
    contentRelativePath: file => {
      const own = model.contentRoots.find(root => isUnder(root, file) && !isAbsolutePath(file))
      const other = extraRootOf(file)
      if (own === undefined && other === null) return null
      if (own === undefined) return relativeTo(other!.root, file)
      if (other === null || own.length >= other.root.length) return relativeTo(own, file)
      return relativeTo(other.root, file)
    },
    libraryNameOf: () => null,
    libraryRelativePath: () => null,
    isInJdk: () => false,
    rootDescriptorOf: file => {
      const own = model.rootDescriptorOf(file)
      if (own) return own
      return extraRootOf(file)
    },
  }
}

/** 库/SDK 根（反向依赖作用域里 `isSearchInLibraries()` 恒 false，这些一律剔掉）。 */
function isContentRoot(root: ScopeRootDescriptor): boolean {
  return root.rootType === 'content' || root.rootType === 'source'
}

/**
 * `ModuleWithDependentsTestScope`：反向闭包 + 测试根
 * （`ModuleWithDependentsScope.getFileInfo(file, fromTests=true):148-161`：
 * 文件要么属于某个 production-on-test 依赖方，要么本身就是测试源）。
 * 本仓没有 production-on-test 边，所以等价于反向闭包本身 —— 测试根本来就在内容根内。
 */
export function moduleWithDependentsTestScope(model: ModuleScopeModel): ModuleScopeModel {
  return moduleWithDependentsScope(model)
}

/** `LibraryScopeBase`/`LibraryScope`：若干库的根集合。 */
export function libraryScope(libraries: readonly ScopeLibrary[]): ScopeLibrary[] {
  return libraries.filter(library => library.files.length > 0)
}

/**
 * `LibraryRuntimeClasspathScope`：运行时类路径 = 模块产出 + 库 + SDK。
 * 上游 `ModuleScopeProviderImpl.getModuleRuntimeScope`：`MODULES | LIBRARIES | TESTS?`。
 */
export function libraryRuntimeClasspathScope(model: ModuleScopeModel, includeTests: boolean): ModuleScopeModel {
  return moduleWithDependenciesScope(model, SCOPE_OPTION.MODULES | SCOPE_OPTION.LIBRARIES | (includeTests ? SCOPE_OPTION.TESTS : 0))
}

/** `JdkScope`：只有 SDK 根（工作区文件不在其中）。 */
export function jdkScope(jdk: { name: string; home: string } | null): { name: string; roots: readonly string[] } | null {
  if (!jdk || !jdk.home) return null
  return { name: jdk.name, roots: [normalize(jdk.home)] }
}

/**
 * `ModuleScopeUtil.calcModules`（`ModuleScopeUtil.kt:41-54`）的正向闭包那一半（roots3 补）：
 *   · 枚举器**无条件先** `recursively()`（`ModuleScopeUtil.kt:29`）—— 递归不是 `MODULES` 位开的才做；
 *   · `MODULES` 位没开 ⇒ `withoutDepModules()`（`:32`）⇒ 只剩根模块自己；
 *   · `COMPILE_ONLY` 位开着 ⇒ `exportedOnly()`（`:30`）⇒ 非 `isExported()` 的模块边整条不看
 *     （既不进集合，也不沿它继续递归：`OrderEnumerator.exportedOnly()` 滤的是被枚举的条目本身）；
 *   · 收进来的是 `ModuleOrderEntry.getModule()`（`:45-47`）与
 *     `ModuleSourceOrderEntry.getOwnerModule()`（`:48-50`，即根模块自己，恒排第一）。
 *
 * `ModuleWithDependenciesScope.kt:155-160` 的 `lazyModules` 就是把它按 (module, options) 挂着用。
 * 本仓默认没有边（单隐式模块）⇒ 任何选项下都只返 `[本模块]`，与改动前逐字一致。
 */
export function dependencyModuleClosure(model: ModuleScopeModel, options: number): string[] {
  const flags = scopeOptions(options)
  const modules = new Set<string>([model.moduleName])
  if (!flags.modules) return [...modules]
  const exportedOnly = flags.compileOnly
  const outgoing = new Map<string, ModuleOrderEntry[]>()
  for (const entry of model.moduleOrderEntries) {
    const list = outgoing.get(entry.from)
    if (list) list.push(entry)
    else outgoing.set(entry.from, [entry])
  }
  const queue: string[] = [model.moduleName]
  const seen = new Set<string>([model.moduleName])
  for (let i = 0; i < queue.length; ++i) {
    for (const entry of outgoing.get(queue[i]!) ?? []) {
      if (exportedOnly && !entry.exported) continue
      modules.add(entry.to)
      if (seen.has(entry.to)) continue
      seen.add(entry.to)
      queue.push(entry.to)
    }
  }
  return [...modules]
}

/**
 * `ModuleScopeUtil.calcModules` 的等价物（`:41-54`）。roots3 订正：此前两个分支都返
 * `[model.moduleName]`（`if (!flags.modules) return [x]; return [x]`）—— 那等于把上游
 * 「`MODULES` 位决定是否 `withoutDepModules()`」这一层判据钉死成恒等，传进来的边永远不会被走。
 * 现在与 `dependencyModuleClosure` 同一实现，不再各写一份。
 */
export function calcModules(model: ModuleScopeModel, options: number): string[] {
  return dependencyModuleClosure(model, options)
}

// ---------------------------------------------------------------- 给 `src/scopes.ts` 的文件系统视图

/**
 * `FilePatternPackageSet.fileMatcher`（:49-71）需要的三件事：
 *   1. 文件在不在 content 内（`myProjectFiles` 的正反面）；
 *   2. content 内文件的「相对内容根路径」；
 *   3. content 外文件的库名与「相对库根路径」（`PatternBasedPackageSet.matchesLibrary` + `getLibRelativePath`）。
 */
export interface ScopeFileSystem {
  isInContent(path: string): boolean
  contentRelativePath(path: string): string | null
  /** 文件所属库名（`matchesLibrary` 里比对 `LibraryOrderEntry.getLibraryName()`）。 */
  libraryNameOf(path: string): string | null
  /** 文件相对库根的路径（`FilePatternPackageSet.getLibRelativePath`）。 */
  libraryRelativePath(path: string): string | null
  /** 项目 SDK 名（`matchesLibrary` 的 `JdkOrderEntry.getJdkName()` 分支）。 */
  jdkName: string | null
}

/** 从模块作用域模型造出 `scopeMatches` 需要的文件系统视图。 */
export function scopeFileSystem(model: ModuleScopeModel): ScopeFileSystem {
  return {
    isInContent: path => model.isInContent(path),
    contentRelativePath: path => model.contentRelativePath(path),
    libraryNameOf: path => model.libraryNameOf(path),
    libraryRelativePath: path => model.libraryRelativePath(path),
    jdkName: model.jdk?.name ?? null,
  }
}
