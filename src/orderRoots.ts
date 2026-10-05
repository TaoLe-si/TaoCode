// 序根枚举（上游 `OrderRootType` / `OrderEnumerator` / `OrderRootsCache` 的可移植子集）。
//
// 上游形状（逐条核过 `projectModel-impl/src/com/intellij/openapi/roots/impl/`）：
//   · `OrderRootType` 四类：SOURCES / CLASSES / JAVADOC / ANNOTATIONS（本仓只做这四类，
//     没有 `JavaSyntheticLibrary` 那种按类型贡献根的扩展点）；
//   · `OrderRootComputer.computeRoots`（`OrderRootComputer.java:51-100`）：按 `forEach` 的顺序收集，
//     模块自己的条目**先**出现 —— 源根（SOURCES）或编译输出（CLASSES，`:110-130` 的
//     `CompilerModuleExtension.getOutputRoots`）→ 模块依赖（上游是多模块，本仓单隐式模块）→
//     模块库（CLASSES/JAVADOC 根）→ SDK 根；结果进 `LinkedHashSet`，**首次出现为准**（:52）。
//   · `OrderRootsCache`（`OrderRootsCache.java`）：按（根类型 + flags）缓存，根的修改计数变了整批作废
//     （`ProjectRootModificationTracker.incModificationCount`）。
//
// 本仓的输入是单隐式模块的几样已被别处算好的路径：源根（`JavaProjectSettings.sourcePaths`）、
// 编译输出（`javaOutputPath`）、库（`referencedLibraries` glob 命中的 jar）、SDK（`jdkHome`）。
// **消费链路**：`src/projectBuild.ts` 的 `javacCommand` —— javac 的 `-cp` 就是"输出目录 + 库"的
// `OrderRootType.CLASSES` 枚举（`src/projectBuild.ts:188` 原先是手写这两段并集，现在走这里）。
// 运行期产物目录（`runtimeOutputPaths`）不走这里：它读的是构建工具实际写出的目录，不是模块输出根。

/** 根类型（上游 `OrderRootType` 的四个具体子类）。 */
export type OrderRootType = 'sources' | 'classes' | 'javadoc' | 'annotations'

/** 一个被枚举出来的根。`module` 是根所属的隐式模块名（空串 = 没有模块维度）。 */
export interface OrderRoot {
  type: OrderRootType
  path: string
  module: string
}

/** 枚举输入（都是已经算好的路径；本模块不发请求、不碰磁盘）。 */
export interface OrderRootsInput {
  /** 单隐式模块的名字（`OrderEnumerator.forModule` 的那个）。 */
  moduleName?: string
  /** 主源根（`ModuleRootManager.getSourceRoots()` 的 SOURCES）。 */
  sourceRoots?: readonly string[]
  /** 测试源根（`OrderEnumerator.productionOnly()` 为假时一起枚举；`collectModuleRoots` 的 includeTests）。 */
  testSourceRoots?: readonly string[]
  /** 模块编译输出（`CompilerModuleExtension.getOutputRoots`，CLASSES）。 */
  outputPaths?: readonly string[]
  /** 模块库（`Library.getRootFiles(type)`）：每个库的四类根。 */
  libraryRoots?: readonly LibraryRootSet[]
  /** 模块 SDK（`JdkOrderEntry.getRootFiles(type)`）。 */
  sdkRoots?: LibraryRootSet | null
  /** `OrderEnumerator.withoutSdk()` 的等价开关。 */
  withoutSdk?: boolean
}

export interface LibraryRootSet {
  classes?: readonly string[]
  sources?: readonly string[]
  javadoc?: readonly string[]
}

function pushRoots(result: OrderRoot[], type: OrderRootType, paths: readonly string[] | undefined, module: string) {
  if (!paths) return
  for (const raw of paths) {
    const path = (raw ?? '').trim()
    if (!path) continue
    result.push({ type, path, module })
  }
}

/**
 * `OrderRootComputer.computeRoots`（:51-100）的单模块等价物：
 * 按类型收集，模块自己的根在前，库在中，SDK 在后；**返回值按出现顺序去重**（上游 `LinkedHashSet`）。
 */
export function enumerateOrderRoots(input: OrderRootsInput, type: OrderRootType): OrderRoot[] {
  const module = input.moduleName ?? ''
  const rootsOf = (set: LibraryRootSet | null | undefined): readonly string[] | undefined => {
    if (!set) return undefined
    switch (type) {
      case 'sources': return set.sources
      case 'classes': return set.classes
      case 'javadoc': return set.javadoc
      case 'annotations': return undefined  // 本仓没有按类型贡献根的库（上游 JavaSyntheticLibrary 那一层）
    }
  }
  const collected: OrderRoot[] = []
  if (type === 'sources') {
    pushRoots(collected, 'sources', input.sourceRoots, module)
    pushRoots(collected, 'sources', input.testSourceRoots, module)
  } else if (type === 'classes') {
    pushRoots(collected, 'classes', input.outputPaths, module)
  }
  for (const library of input.libraryRoots ?? []) pushRoots(collected, type, rootsOf(library), module)
  if (!input.withoutSdk) pushRoots(collected, type, rootsOf(input.sdkRoots), module)
  const seen = new Set<string>()
  return collected.filter(root => {
    if (seen.has(root.path)) return false
    seen.add(root.path)
    return true
  })
}

/** 只要路径（上游 `OrderRootsEnumerator.getRoots()` 的 `VirtualFile[]` 形态）。 */
export function orderRootPaths(input: OrderRootsInput, type: OrderRootType): string[] {
  return enumerateOrderRoots(input, type).map(root => root.path)
}

/**
 * 编译类路径（`OrderEnumerator.classes()`）：模块输出 → 模块库 → SDK 根，去重（保留首次出现）。
 * javac 的 `-cp` 就是这个列表；分隔符由调用方拼（见 `src/projectBuild.ts`）。
 */
export function orderCompileClasspath(input: OrderRootsInput): string[] {
  return orderRootPaths(input, 'classes')
}

/** 源根顺序（`OrderEnumerator.sources()`）：主源根在前、测试源根在后，去重。 */
export function orderSourceRoots(input: OrderRootsInput): string[] {
  return orderRootPaths(input, 'sources')
}

/**
 * `ProjectRootModificationTracker` 的等价物：根模型改一次计数加一，缓存据此整批作废。
 */
export class RootModificationTracker {
  private count = 0
  get modificationCount(): number { return this.count }
  incModificationCount(): void { this.count += 1 }
}

/**
 * `OrderRootsCache`（`OrderRootsCache.java`）：按（根类型 + flags）缓存枚举结果；
 * 修改计数变了整批作废。上游缓存的键还带 module 与 flags，这里保持同一形状。
 */
export class OrderRootsCache {
  private stamp = -1
  private readonly values = new Map<string, readonly string[]>()
  getModificationCount(): number { return this.stamp }
  setModificationCount(value: number): void {
    if (this.stamp === value) return
    this.stamp = value
    this.values.clear()
  }
  /** `getOrComputeRoots(rootType, flags, computable)`：计数没变就取缓存，变了重算。 */
  getOrComputeRoots(input: OrderRootsInput, type: OrderRootType, flags: string, compute: () => readonly string[]): readonly string[] {
    const key = `${input.moduleName ?? ''}|${type}|${flags}`
    const cached = this.values.get(key)
    if (cached) return cached
    const next = [...compute()]
    this.values.set(key, next)
    return next
  }
  clear(): void { this.values.clear() }
}
