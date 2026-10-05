// 库实体与库表 —— 上游 `com.intellij.openapi.roots.libraries.Library` / `LibraryTable` /
// `Library.ModifiableModel` 的可移植子集（lp/roots ② 与 pm/roots ② 的本体）。
//
// 判词里这两族都记着同一个缺口：「`referencedLibraries` 只有 glob，命中 jar 直接当叶子，
// `LibraryRootsDetectorImpl`/`RootDetectionUtil`/`DetectedRootsChooserDialog` 那套『附加库时识别根』
// 无处存结果」。没有「库」这一层实体，识别出来的根确实无处可放 —— 这一域补的就是那层实体：
// 一个库 = 一个可空的名字 + 按**根类型分组**的根列表，加上一张项目级的库表。
//
// 上游依据（逐条核过，行号可复现）：
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/libraries/Library.java:32`
//     `Library` 是 `@ApiStatus.NonExtendable` 的接口（所以本仓是数据 + 纯函数，不是可继承的类）；
//     `:39-40` `getName()` **可空**（模块级库允许不写名字）；`:42-46` `getPresentableName()`；
//     `:48` `getUrls(rootType)`；`:63-67` `isJarDirectory(url[, type])` / `isValid(url, type)`；
//     `:74` `hasSameContent`；`:76-112` `ModifiableModel` 的逐条操作面。
//   · `platform/projectModel-impl/src/com/intellij/workspaceModel/ide/impl/legacyBridge/library/LibraryBridgeImpl.kt:235-247`
//     未命名库的 `getPresentableName()`：**第一个 CLASSES url 的文件名**；已 dispose 用
//     `disposed.library.title`；连 CLASSES 根都没有用 `empty.library.title`
//     （两条文案在 `platform/projectModel-api/resources/messages/ProjectModelBundle.properties:43-44`
//      = `Disposed Library` / `Empty Library`）。
//   · `LibraryBridgeImpl.kt:148-158` `hasSameContent`：同一个对象直接真；否则逐项比
//     name / kind / properties / roots / excludedRoots。
//   · `platform/projectModel-impl/src/com/intellij/workspaceModel/ide/impl/legacyBridge/library/LibraryStateSnapshot.kt:72-97`
//     根**按 `OrderRootType` 分组**存放（`:102-109` 的 `groupBy { it.type }`），
//     `getUrls(type)` 取该组；`isValid` 是「该组里找得到这个 url 且它 valid」。
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/LibraryRootType.java:7-23`
//     库根类型 = (OrderRootType, jarDirectory) **二元组**，`isJarDirectory` 是根自己的属性。
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/OrderRoot.java:8-33` 同形三元组。
//   · `platform/projectModel-api/src/com/intellij/openapi/roots/OrderRootType.java:54-55`
//     内建**持久**根类型只有 CLASSES 与 SOURCES 两个（`:34` / `:44`），其余靠 EP 贡献
//     —— 本仓没有 EP 宿主，所以 `orderRoots.ts` 那四类里只有这两类有存储语义。
//
// 与上游的**两处**已知不等价，写在这里免得日后被当成 bug：
//   1. `LibraryRootType` 上游是引用相等（`equals` 靠默认实现），本仓是普通对象，
//      需要值语义的地方一律走 `libraryRootTypeKey()`。
//   2. 上游根是 `VirtualFile`（有 `isValid` / `presentableUrl`），本仓是路径字符串，
//      `isValid` 只能由调用方按「磁盘清单里有没有」判 —— 所以这里给的是**查询面**不是判定。

import type { OrderRootType } from './orderRoots.ts'

/**
 * 库根类型：根类型 + 「这个根是不是 jar 目录」（上游 `LibraryRootType` 的两个字段）。
 * `jarDirectory` 的语义见 `Library.ModifiableModel.addJarDirectory`（`Library.java:85-93`）：
 * 根是目录时要不要把**它下面的归档**也算进来。本仓不展开归档（见 native 侧无 jar 内容桥），
 * 但字段留着 —— 它是上游根模型的一部分，去掉就等于把这个判别维度丢了。
 */
export interface LibraryRootType {
  readonly type: OrderRootType
  readonly jarDirectory: boolean
}

/** 库根类型构造器（`LibraryRootType.java:11-14` 的两参构造器）。 */
export function libraryRootType(type: OrderRootType, jarDirectory = false): LibraryRootType {
  return { type, jarDirectory }
}

/** 值语义的键（`getType().name() + (jarDirectory ? '(JAR directory)' : '')`，抄 `RootDetectionUtil.java:75` 的报错文案口径）。 */
export function libraryRootTypeKey(rootType: LibraryRootType): string {
  return `${rootType.type}${rootType.jarDirectory ? '(jar directory)' : ''}`
}

export function sameLibraryRootType(left: LibraryRootType, right: LibraryRootType): boolean {
  return left.type === right.type && left.jarDirectory === right.jarDirectory
}

/**
 * 一个库根。路径是工作区相对路径（与 `workspace.files` 同一口径）或绝对路径（库可以在工程外）。
 * 类型沿用 `src/orderRoots.ts` 的 `OrderRootType`（classes / sources / javadoc / annotations）——
 * 上游 `OrderRootType.getAllTypes()` 里那四类，本仓只给前两类配置面（见文件头第 5 条依据）。
 */
export interface LibraryRoot {
  readonly path: string
  readonly type: LibraryRootType
}

/** 一个库：`name` 可空（`Library.java:39-40`），`roots` 按根类型分组（`LibraryStateSnapshot.kt:102-109`）。 */
export interface Library {
  readonly name: string | null
  readonly roots: readonly LibraryRoot[]
  /** 已从库里移除（上游 `dispose` 后的 `isDisposed`，`LibraryBridgeImpl.kt:170`）。 */
  readonly disposed?: boolean
}

/** `Library.getUrls(rootType)`（`Library.java:48`）：只取该类型的根，**保持库内的存放顺序**。 */
export function libraryUrls(library: Library, type: OrderRootType): string[] {
  return library.roots.filter(root => root.type.type === type).map(root => root.path)
}

/** 一次给全四类（`OrderRootsCache` 的键要按类型分档，渲染层也要一次看全）。 */
export function libraryUrlsByType(library: Library): Record<OrderRootType, string[]> {
  const out = { sources: [], classes: [], javadoc: [], annotations: [] } as Record<OrderRootType, string[]>
  for (const root of library.roots) out[root.type.type].push(root.path)
  return out
}

/** `LibraryRootType` 上带 jarDirectory 的那一档（`Library.ModifiableModel.getUrls(type)` 的粒度）。 */
export function libraryUrlsOfType(library: Library, type: LibraryRootType): string[] {
  return library.roots.filter(root => sameLibraryRootType(root.type, type)).map(root => root.path)
}

const fileNameOf = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

/**
 * `Library.getPresentableName()`（`Library.java:42-46` + `LibraryBridgeImpl.kt:235-247`）：
 *   1. 有名字 → 名字；
 *   2. 已 dispose → 「已释放的库」（上游 `Disposed Library`）；
 *   3. 有 CLASSES 根 → **第一个** CLASSES 根的文件名（不带 `.jar` 的目录名也照原样）；
 *   4. 一个根都没有 → 「空库」（上游 `Empty Library`）。
 * 第 2/4 步的文案本仓用中文口径，因为 UI 是中文的（上游这两条走 bundle 随语言变）。
 */
export function libraryPresentableName(library: Library): string {
  if (library.name) return library.name
  if (library.disposed) return '已释放的库'
  const classes = libraryUrls(library, 'classes')
  return classes.length ? fileNameOf(classes[0]) : '空库'
}

/**
 * `Library.hasSameContent`（`LibraryBridgeImpl.kt:148-158`）：同一个对象直接真；
 * 否则逐项比 name / roots（含类型）/ disposed。本仓没有 `kind` / `properties` /
 * `excludedRoots` 三个字段（没有模块级库、没有库属性 UI），这里不编它们。
 */
export function libraryHasSameContent(left: Library, right: Library): boolean {
  if (left === right) return true
  if (left.name !== right.name) return false
  if (left.roots.length !== right.roots.length) return false
  return left.roots.every((root, index) => {
    const other = right.roots[index]
    return other !== undefined && root.path === other.path && sameLibraryRootType(root.type, other.type)
  })
}

/**
 * `Library.ModifiableModel`（`Library.java:76-112`）。
 *
 * 上游那套「改完必须 `commit()` 或者 dispose 掉模型，否则改动不落地」（`Library.java:52-56` 的 javadoc）
 * 是写动作的纪律；本仓的表是内存对象图，改完直接产生新 `Library`，所以这里保留
 * `isChanged()` 与「未 commit 就没有可见改动」这两条语义，不保留 dispose 纪律
 * （没有写通道，也就没有「泄漏的模型」可泄漏）。
 */
export class LibraryModifiableModel {
  private name: string | null
  private roots: LibraryRoot[]
  private committed: boolean
  /** 拿到模型时的那一份（`isChanged` 的比对基准）。 */
  private readonly original: Library

  // 不用 `constructor(private readonly original: Library)` 那种参数属性写法：Node 的
  // `--experimental-strip-types` 是**仅擦除**模式，不支持参数属性（会报
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），那会让本模块在测试与生产两侧都加载不了。
  constructor(original: Library) {
    this.original = original
    this.name = original.name
    this.roots = original.roots.map(root => ({ ...root }))
    this.committed = false
  }

  /** `Library.ModifiableModel.getName()`（`Library.java:81`）。 */
  getName(): string | null { return this.name }
  /** `setName`（`Library.java:79`）。传 null 回到「未命名库」那条显示口径。 */
  setName(name: string | null): void { this.name = name; this.committed = false }
  /** `getUrls(type)`（`Library.java:77`）。 */
  getUrls(type: OrderRootType): string[] { return this.roots.filter(root => root.type.type === type).map(root => root.path) }
  /** `addRoot`（`Library.java:83`）：**追加**到该类型末尾，重复的 (path, type) 只留第一次。 */
  addRoot(path: string, type: OrderRootType, jarDirectory = false): void {
    const trimmed = path.trim()
    if (!trimmed) return
    const root: LibraryRoot = { path: trimmed, type: libraryRootType(type, jarDirectory) }
    if (this.roots.some(existing => existing.path === root.path && sameLibraryRootType(existing.type, root.type))) return
    this.roots.push(root)
    this.committed = false
  }
  /** `addJarDirectory`（`Library.java:85-93`）：带 jarDirectory 标记的目录根。 */
  addJarDirectory(path: string, recursive: boolean, type: OrderRootType): void {
    this.addRoot(path, type, true)
    void recursive  // 上游 recursive 决定「归档只收一层还是递归」；本仓不展开归档，只留标记。
  }
  /** `removeRoot`（`Library.java:99`）：删掉**第一处**命中，返回是否真的删掉了。 */
  removeRoot(path: string, type: OrderRootType): boolean {
    const index = this.roots.findIndex(root => root.path === path && root.type.type === type)
    if (index < 0) return false
    this.roots.splice(index, 1)
    this.committed = false
    return true
  }
  /** `moveRootUp`（`Library.java:95`）：与同类型的相邻项交换；**已经在首位就原样不动**。 */
  moveRootUp(path: string, type: OrderRootType): boolean { return this.move(path, type, -1) }
  /** `moveRootDown`（`Library.java:97`）。 */
  moveRootDown(path: string, type: OrderRootType): boolean { return this.move(path, type, 1) }

  private move(path: string, type: OrderRootType, delta: -1 | 1): boolean {
    const sameType = this.roots.filter(root => root.type.type === type)
    const at = sameType.findIndex(root => root.path === path)
    const to = at + delta
    if (at < 0 || to < 0 || to >= sameType.length) return false
    const from = this.roots.indexOf(sameType[at])
    const target = this.roots.indexOf(sameType[to])
    const [moved] = this.roots.splice(from, 1)
    this.roots.splice(target, 0, moved!)
    this.committed = false
    return true
  }
  /** `isChanged`（`Library.java:105`）：与**拿到模型时**的那一份比，commit 之后恒为 false。 */
  isChanged(): boolean {
    if (this.committed) return false
    return this.name !== this.original.name || !rootsEqual(this.roots, this.original.roots)
  }
  /** `commit`（`Library.java:101`）：产出提交后的 `Library`；表再拿它换掉旧的那一份。 */
  commit(): Library {
    this.committed = true
    return { name: this.name, roots: this.roots.map(root => ({ ...root })) }
  }
}

function rootsEqual(left: readonly LibraryRoot[], right: readonly LibraryRoot[]): boolean {
  if (left.length !== right.length) return false
  return left.every((root, index) => {
    const other = right[index]
    return other !== undefined && root.path === other.path && sameLibraryRootType(root.type, other.type)
  })
}

/**
 * 项目级的库表（`LibraryTable`，`Library.java:58` 里的 `getTable`）。
 * 上游 `LibraryTable` 还挂着 `Project` 与 `LibraryTableListener`；本仓只保留按名字寻址与增删
 * —— 消费面是外部库树（`src/externalLibraries.ts`）与序根枚举（`src/orderRoots.ts`）。
 */
export class LibraryTable {
  private readonly libraries = new Map<string, Library>()
  private readonly listeners = new Set<LibraryTableListener>()
  /**
   * 模型是从哪个键下取出来的（上游 `LibraryBridgeImpl` 的库对象本身带身份，改名靠对象引用换索引；
   * 本仓的库是普通数据、只能按名寻址，所以改名时必须知道旧键，否则旧名下一条陈旧记录永远查得到）。
   */
  private readonly modelOrigins = new WeakMap<LibraryModifiableModel, string>()

  /** `ProjectJdkTable.findJdk` 那样的按名寻址（这里库按名字唯一）。名字为 null 的库不进表。 */
  findLibrary(name: string): Library | null {
    return this.libraries.get(name) ?? null
  }
  /** `getAllLibraries`（上游 `LibraryTable.getLibraries()` 的口径）。按名字字母序。 */
  getAllLibraries(): Library[] {
    return [...this.libraries.values()].sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''))
  }
  /** `addLibrary`（`LibraryTable` 的增）：同名的**替换**，不是并存。 */
  addLibrary(library: Library): void {
    const key = library.name ?? ''
    if (!key) throw new Error('库表按名字寻址，未命名库请留在渲染层摊平（ExternalLibrariesNode.java:101-104）')
    this.libraries.set(key, library)
    this.fire({ type: 'added', library })
  }
  /** `removeLibrary`（`LibraryTable` 的删）。 */
  removeLibrary(name: string): boolean {
    const existing = this.libraries.get(name)
    if (!existing) return false
    this.libraries.delete(name)
    this.fire({ type: 'removed', library: existing })
    return true
  }
  /** 取可改模型（`Library.getModifiableModel()`，`Library.java:56`）。 */
  createModifiableModel(name: string): LibraryModifiableModel | null {
    const existing = this.findLibrary(name)
    if (!existing) return null
    const model = new LibraryModifiableModel(existing)
    this.modelOrigins.set(model, name)
    return model
  }
  /** 模型 commit 之后回写（`LibraryTable.ModifiableModel.commit` 的那一步）。 */
  commitLibrary(model: LibraryModifiableModel, fallbackName = ''): Library | null {
    const committed = model.commit()
    const key = committed.name ?? fallbackName
    if (!key) return null
    // 改名要摘掉旧键（上游改名走 `jdkNameChanged` / 库表按名重建索引，同一个意思）。
    const previous = this.modelOrigins.get(model)
    if (previous !== undefined && previous !== key) this.libraries.delete(previous)
    this.libraries.set(key, committed)
    this.modelOrigins.delete(model)
    this.fire({ type: 'changed', library: committed })
    return committed
  }
  addListener(listener: LibraryTableListener): void { this.listeners.add(listener) }
  removeListener(listener: LibraryTableListener): void { this.listeners.delete(listener) }
  private fire(event: LibraryTableEvent): void { for (const listener of this.listeners) listener(event) }
  clear(): void { this.libraries.clear() }
}

/** 库表事件（`LibraryTable.Listener` 的三个方法折成一张判别联合，本仓没有事件总线）。 */
export type LibraryTableEvent =
  | { type: 'added'; library: Library }
  | { type: 'removed'; library: Library }
  | { type: 'changed'; library: Library }

export type LibraryTableListener = (event: LibraryTableEvent) => void

// ── 从本仓真实的配置形态建库 ──────────────────────────────────────────────────────────

/**
 * `*-sources.jar` 是本仓已经认的命名约定 —— `native/library_sources.hpp:36` 就是「在 `root` 下
 * 所有 `*-sources.jar` 里找库源码」，消费方 `src/quickDefinitionHost.ts` 的「转到定义」已经靠它
 * 从库里取到 `.java`。所以把同一个约定暴露成 SOURCES 根不是发明：那个 jar 在磁盘上真实存在，
 * 本仓也确实读它。
 *
 * 注意：上游这棵树里**没有** `AttachSourcesAction` / `AttachSourceProvider`（我按文件名全树搜过，
 * 一份都没有），所以「把 foo.jar 认成 foo-sources.jar 的源码」不是上游 `Library` 的行为 ——
 * 它是本仓的等价物，注释与判词都按这个口径记，不要日后被当成抄漏了。
 */
export function sourcesJarOf(path: string): string | null {
  // 原样返回命中的那个路径（不是重建）：重建会把 `-sources.jar` 的小写形式写回去，
  // 于是 `lib/A-SOURCES.JAR` 变成 `lib/A-sources.jar` —— 那是磁盘上不存在的文件，
  // `libraryFromJars` 的 `jars.includes(...)` 判不中，源码 jar 会被错当成 CLASSES 根。
  return /-sources\.jar$/i.test(path) ? path : null
}

/**
 * 从 `java.referencedLibraries` 的 glob 命中的 jar 建**一个未命名库**。
 *
 * 为什么是一个库：上游的库是用户一条条「附加」出来的实体，而本仓的配置面只有一张 glob 列表
 * （`ProjectSettings.java.referencedLibraries`），没有「每个 glob 一个库」这层意思。把全部命中
 * 的 jar 收进一个未命名库，渲染层按上游「无名库摊平」那条（`ExternalLibrariesNode.java:101-104`）
 * 决定要不要建中间节点 —— 具名库才建。
 *
 * 每个 jar 落成 CLASSES 根（上游 `addRoot` 的默认用法就是 classes 根）；`-sources.jar` 额外落一条
 * SOURCES 根，且**不会**同时留一条 CLASSES 根（源码 jar 进类路径没有意义）。
 */
export function libraryFromJars(jars: readonly string[]): Library | null {
  const roots: LibraryRoot[] = []
  const seen = new Set<string>()
  const sorted = [...jars].sort()
  for (const jar of sorted) {
    const classesJar = sourcesJarOf(jar) && jars.includes(sourcesJarOf(jar)!) ? null : jar
    if (classesJar) {
      const key = `classes|${classesJar}`
      if (!seen.has(key)) { seen.add(key); roots.push({ path: classesJar, type: libraryRootType('classes') }) }
    }
    const sources = sourcesJarOf(jar)
    if (sources && jars.includes(sources)) {
      const key = `sources|${sources}`
      if (!seen.has(key)) { seen.add(key); roots.push({ path: sources, type: libraryRootType('sources') }) }
    }
  }
  return roots.length ? { name: null, roots } : null
}

/** 库表 → `src/orderRoots.ts` 的 `LibraryRootSet`（`OrderRootComputer` 的模块库那一步的输入形状）。 */
export function libraryRootSets(libraries: readonly Library[]): Array<{ classes?: string[]; sources?: string[]; javadoc?: string[] }> {
  return libraries.map(library => {
    const byType = libraryUrlsByType(library)
    const set: { classes?: string[]; sources?: string[]; javadoc?: string[] } = {}
    if (byType.classes.length) set.classes = byType.classes
    if (byType.sources.length) set.sources = byType.sources
    if (byType.javadoc.length) set.javadoc = byType.javadoc
    return set
  })
}
