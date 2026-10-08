// SDK 表 —— 上游 `ProjectJdkTable` / `ProjectJdkImpl` 的可移植子集（pm/roots ① 与 lp/roots ③ 的前半）。
//
// 判词里 pm/roots 记的缺口：「`ProjectJdkImpl` 的 SDK 表（本仓项目 SDK 只是 java 设置里的字符串，
// `native/jdk.cpp` 只探测，没有 SDK 对象与多 SDK 选择）」。这一域补的就是那张表：
// 名字 + 类型 + 家目录 + 版本 + 按根类型分的根，加增删改与三件监听回调。
//
// 上游依据（逐条核过）：
//   · `platform/projectModel-api/src/com/intellij/openapi/projectRoots/ProjectJdkTable.java:24`
//     `ProjectJdkTable` 是 `@ApiStatus.NonExtendable` 的抽象类（不是接口）；
//     `:28-30` 全局单例 `getInstance()`；`:32-38` 另有一个**按项目去重**的视图 `getInstance(project)`
//     （「The SDKs in the provided table are unique by their name and type」—— 本仓只有一张表，
//      去重规则按 (name, type) 记在 `findJdk(name, type)` 上，注释里写清差异）；
//     `:40-46` `findJdk(name)` / `findJdk(name, type)` / `getAllJdks` / `getSdksOfType`；
//     `:48-50` `findMostRecentSdkOfType` = `getSdksOfType(type).stream().max(type.versionComparator()).orElse(null)`；
//     `:52-69` `addJdk` / `removeJdk` / `updateJdk`（都要写锁）；
//     `:71-80` `Listener` 的三个回调 `jdkAdded` / `jdkRemoved` / `jdkNameChanged`；
//     `:82-86` `getDefaultSdkType` / `getSdkTypeByName` / `createSdk`；
//     `:88-92` `preconfigure()` —— 「This method may automatically detect Sdk if none are configured」。
//   · `platform/projectModel-impl/src/com/intellij/openapi/projectRoots/impl/ProjectJdkImpl.java:71-127`
//     一个 SDK 的取值面：`getSdkType` / `getName` / `setName` / `getVersionString` / `setVersionString`
//     / `getHomePath` / `setHomePath`；`:49-51` 三参构造器 `(name, sdkType, homePath, version)`。
//   · `OrderRootType.java:34/:44` SDK 的 CLASSES / SOURCES 根；`:54-55` 内建持久类型就这两个。
//   · `platform/lang-impl/src/com/intellij/openapi/projectRoots/impl/SdkConfigurationUtil.java:269-277`
//     建 SDK 的唯一入口 `createSdk(…)`：名字**先过** `createUniqueSdkName(suggestedName, allSdks)`（`:429-436`）；
//     `:429-431` 那一档用 `SdkType.suggestSdkName(null, home)` 取名 ⇒ 本仓等价物是宿主 `suggest_name`
//     （`native/jdk.cpp:133-172`，两台 JDK 21 都叫 `21`）。
//   · `platform/util/src/com/intellij/util/text/UniqueNameGenerator.java:96-121`
//     `generateUniqueName(defaultName, "", "", " (", ")", validator, 2)`：编号从 2 起；
//     原名已带 ` (N)` 时从 N+1 接着编（`:110-116`）；判等是精确串（HashSet）。
//
// 明确不做的（别当成漏抄）：
//   · **SDK 下载/安装**（`JdkInstaller` / `JdkDownloadTask` / `RuntimeChooser*` / `UnknownSdkFix*`）：
//     本仓没有下载通道也没有后端（与 `pf/update` 同因），表里因此**没有**「下载」这个动作。
//   · `SdkModificator`（`ProjectJdkImpl.java:167-174`）那套「脱离 modificator 改值就 LOG.error」
//     的写动作纪律：DOM 表没有写通道，留着只会变成永远不触发的断言，改由 `isWritable` 表达。
//   * `getRoots(rootType)` 的真实内容（`ProjectJdkImpl.java:220-225` 委托给 modificator）：
//     宿主探测只给家目录，本仓的 SDK 根是**由家目录派生**的（见 `sdkRootsOf`），不是用户逐条加的。

import type { OrderRootType } from './orderRoots.ts'

/** SDK 类型 id（上游 `SdkTypeId` / `Sdk.getSdkType().getName()`）。本仓只有一种：`JAVA_SDK`。 */
export const JAVA_SDK_TYPE = 'JavaSDK'

export interface Sdk {
  readonly name: string
  readonly type: string
  /** 家目录（`ProjectJdkImpl.getHomePath`）；空串 = 只登记了名字、还没定家目录。 */
  readonly homePath: string
  /** 版本串（`getVersionString`）；探测不到就是空串，不编。 */
  readonly versionString: string
  /** 显式登记的根（按类型分组，`LibraryStateSnapshot.kt:102-109` 同形）。 */
  readonly roots: Readonly<Partial<Record<OrderRootType, readonly string[]>>>
  /** 从宿主 `app.jdks` 探测进来的（区别于用户/配置里写下的）。 */
  readonly detected?: boolean
}

/** `ProjectJdkImpl.java:49-51` 的三参构造器等价物。 */
export function createSdk(name: string, type: string, homePath = '', versionString = '', extra: Partial<Sdk> = {}): Sdk {
  return { name, type, homePath, versionString, roots: {}, ...extra }
}

/** `ProjectJdkTable.Listener`（`:71-80`）折成一张判别联合（本仓没有消息总线）。 */
export type SdkTableEvent =
  | { type: 'added'; sdk: Sdk }
  | { type: 'removed'; sdk: Sdk }
  | { type: 'nameChanged'; sdk: Sdk; previousName: string }

export type SdkTableListener = (event: SdkTableEvent) => void

const sameHome = (left: string, right: string) => left.replace(/[\\/]+$/, '').toLowerCase() === right.replace(/[\\/]+$/, '').toLowerCase()

/**
 * 一次比较版本串（`SdkType.versionComparator()` 的可移植子集）。
 *
 * 上游 `SdkTypeImpl` 的比较器是**分段数值**比较：`21` < `21.0.1` < `22`；带后缀的
 * （`21-ea`、`1.8.0_392`）按「数字段」逐段比、非数字后缀不比。上游那棵树里
 * `SdkTypeImpl` 的实现体在 platform-impl 的 Java SDK 插件里（不是本仓能核的路径），
 * 所以这里只写能核的最小口径：**逐段把能解析成整数的段当数字比，解析不出来的段按字符串比**，
 * 段数少的在前（`21` 早于 `21.0.1`）。不认的形态退回字符串比较，不假装是语义化版本。
 */
export function compareSdkVersions(left: string, right: string): number {
  const a = left.trim().split(/[.\-_]/)
  const b = right.trim().split(/[.\-_]/)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index]
    const y = b[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number.parseInt(x, 10)
    const ny = Number.parseInt(y, 10)
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1
    } else if (x !== y) {
      return x.toLowerCase() < y.toLowerCase() ? -1 : 1
    }
  }
  return 0
}

/**
 * `getRoots(rootType)` 的派生口径（`ProjectJdkImpl.java:220-225` 那条委托的**结果**形态）：
 * 一个 JDK 家目录的 CLASSES 根就是它自己（`javac`/JDT 都按「家目录即类根」用），
 * SOURCES 根是家目录下的 `lib/src.zip`（现代 JDK 的源码就在这）。
 * 家目录为空 = 没有可派生的根（返回空数组，不编路径）。
 */
export function sdkRootsOf(sdk: Sdk): Record<OrderRootType, string[]> {
  const home = sdk.homePath.replace(/[\\/]+$/, '')
  if (!home) return { sources: [], classes: [], javadoc: [], annotations: [] }
  const classes = sdk.roots.classes?.length ? [...sdk.roots.classes] : [home]
  const srcZip = `${home.replace(/\\/g, '/')}/lib/src.zip`
  const sources = sdk.roots.sources?.length ? [...sdk.roots.sources] : [srcZip]
  return { sources, classes, javadoc: [...(sdk.roots.javadoc ?? [])], annotations: [...(sdk.roots.annotations ?? [])] }
}

/**
 * `SdkConfigurationUtil.createUniqueSdkName`（`SdkConfigurationUtil.java:429-436`）的等价物：
 * 那里逐字调的是 `UniqueNameGenerator.generateUniqueName(suggestedName, "", "", " (", ")", o -> !nameList.contains(o))`
 * （`UniqueNameGenerator.java:96-100` 转发给 `:101-121` 那颗带 `startingNumber` 的实现）。
 *
 * 规则逐条照 `:101-121`：
 *   · 先试原样名字（`defaultFullName` = `(prefix + name + suffix).trim()`；本仓 prefix/suffix 都是空串）；
 *   · 被占用了就从 **2** 开始编号：`名字 + " (" + n + ")"`；
 *   · 原名自己已经带 ` (<1-9 位数字>)` 时（`:110-116` 的 `Pattern.compile("(.+?) \\(\\d{1,9})")` + `matches()`
 *     那一支）**从那个数字接着往后编**（`21 (2)` 被占 ⇒ 下一个是 `21 (3)`，不是 `21 (2) (2)`）；
 *   · 数字位数超过 9 位不认这一支（正则只吃 1-9 位），整串当基名 —— 与上游同形，不"顺手修正"。
 * 判等是**精确字符串**（上游 `e -> !nameList.contains(o)` 走 HashSet，区分大小写）。
 *
 * 为什么本仓需要它：宿主探测给的名字是 `JdkUtil.suggestJdkName` 的结果（`native/jdk.cpp:133-172`
 * 的 `suggest_name`；两台 JDK 21 安装都叫 `21`），而本仓 `addJdk` 同名同类型是**替换** ——
 * 不去重就只剩最后一台 JDK 在表里。
 */
export function uniqueSdkName(suggestedName: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames)
  const preferred = suggestedName.trim()
  if (!taken.has(preferred)) return preferred
  let base = suggestedName          // 上游 `baseName = defaultName`：这一支用的是**未 trim** 的原名
  let index = 2                     // `generateUniqueName`（非 OneBased）从 2 起（`UniqueNameGenerator.java:99`）
  const numbered = /^(.+?) \((\d{1,9})\)$/.exec(base)
  if (numbered) {
    base = numbered[1]!
    index = Number(numbered[2]) + 1
  }
  for (;;) {
    const name = `${base} (${index++})`.trim()
    if (!taken.has(name)) return name
  }
}

/** SDK 表（`ProjectJdkTable`，`:24-98`）。 */
export class SdkTable {
  private readonly sdks: Sdk[] = []
  private readonly listeners = new Set<SdkTableListener>()

  /** `findJdk(name)`（`:40`）：先按名字；多个同名时给第一个（上游同样不保证唯一）。 */
  findJdk(name: string): Sdk | null {
    return this.sdks.find(sdk => sdk.name === name) ?? null
  }
  /** `findJdk(name, type)`（`:42`）：名字 + 类型都对上。 */
  findJdkOfType(name: string, type: string): Sdk | null {
    return this.sdks.find(sdk => sdk.name === name && sdk.type === type) ?? null
  }
  /** `getAllJdks`（`:44`）。 */
  getAllJdks(): Sdk[] { return [...this.sdks] }
  /** `getSdksOfType`（`:46`）。 */
  getSdksOfType(type: string): Sdk[] { return this.sdks.filter(sdk => sdk.type === type) }
  /** `getDefaultSdkType`（`:82`）：本仓只有 Java SDK。 */
  getDefaultSdkType(): string { return JAVA_SDK_TYPE }
  /** `getSdkTypeByName`（`:84`）：认不出的类型名**不隐式创建**，返 null。 */
  getSdkTypeByName(name: string): string | null { return name === JAVA_SDK_TYPE ? JAVA_SDK_TYPE : null }
  /** `createSdk`（`:86`）。 */
  createSdk(name: string, sdkType: string): Sdk { return createSdk(name, sdkType) }

  /**
   * `findMostRecentSdkOfType`（`:48-50`）：取该类型里版本最大的那个。
   * 版本串为空的一律排在最后（空串没有可比的大小，`compareSdkVersions('','21')` 返回 -1，
   * 但两个都空时要给稳定的「后者为准」才能在重复登记时收敛到一条）。
   */
  findMostRecentSdkOfType(type: string): Sdk | null {
    const candidates = this.getSdksOfType(type)
    if (!candidates.length) return null
    return candidates.reduce((best, sdk) => (compareSdkVersions(sdk.versionString, best.versionString) >= 0 ? sdk : best))
  }

  /** 按家目录寻址（上游没有这个方法；本仓加它是为了把「项目设置里的 jdkHome 字符串」接回表）。 */
  findJdkByHome(homePath: string): Sdk | null {
    if (!homePath.trim()) return null
    return this.sdks.find(sdk => sameHome(sdk.homePath, homePath)) ?? null
  }

  /**
   * `addJdk`（`:52-53`）。**同 (name, type) 就是替换**（`getAllJdks` 的 javadoc 说可以有多个同名同类型，
   * 但 `findJdk(name, type)` 只返一个 —— 真要并存就得靠类型或名字区分；本仓按替换处理，
   * 否则 `findJdk` 的返回是不确定的）。
   */
  addJdk(sdk: Sdk): void {
    const at = this.sdks.findIndex(existing => existing.name === sdk.name && existing.type === sdk.type)
    if (at >= 0) this.sdks.splice(at, 1, sdk)
    else this.sdks.push(sdk)
    this.fire({ type: 'added', sdk })
  }

  /** `removeJdk`（`:65-66`）。 */
  removeJdk(sdk: Sdk): boolean {
    const at = this.sdks.findIndex(existing => existing.name === sdk.name && existing.type === sdk.type && sameHome(existing.homePath, sdk.homePath))
    if (at < 0) return false
    const [removed] = this.sdks.splice(at, 1)
    this.fire({ type: 'removed', sdk: removed! })
    return true
  }

  /**
   * `updateJdk(original, modified)`（`:68-69`）。
   * 改名要发 `jdkNameChanged`（`:78`）而不是 `changed` —— 上游的 `Listener` 只有那三个方法，
   * 监听方靠事件类型区分「新增 / 删除 / 改名」，本仓不多造第四种。
   */
  updateJdk(original: Sdk, modified: Sdk): boolean {
    const at = this.sdks.indexOf(original)
    if (at < 0) return false
    this.sdks.splice(at, 1, modified)
    this.fire(modified.name === original.name
      ? { type: 'added', sdk: modified }
      : { type: 'nameChanged', sdk: modified, previousName: original.name })
    return true
  }

  addListener(listener: SdkTableListener): void { this.listeners.add(listener) }
  removeListener(listener: SdkTableListener): void { this.listeners.delete(listener) }
  private fire(event: SdkTableEvent): void { for (const listener of this.listeners) listener(event) }
  clear(): void { this.sdks.length = 0 }

  /**
   * `SdkConfigurationUtil.createAndAddSDK`（`:269-277`）里**造名字那一步**的等价物：
   * `createUniqueSdkName(suggestedName, allSdks)`（`:429-436`）先按表里现有的 SDK 名字去重，再 `addJdk`。
   * 上游所有「检测 / 新建 SDK」的入口都走这条路，所以表里不会出现两条同名同类型 ——
   * 本仓的 `addJdk` 是「同 (name,type) 替换」（撞名就顶掉一条），**唯独这条路先去重**。
   */
  createAndAddJdk(suggestedName: string, homePath: string, versionString = '', extra: Partial<Sdk> = {}): Sdk {
    const name = uniqueSdkName(suggestedName, this.sdks.map(sdk => sdk.name))
    const sdk = createSdk(name, JAVA_SDK_TYPE, homePath, versionString, extra)
    this.addJdk(sdk)
    return sdk
  }

  /**
   * `preconfigure()`（`:88-92`）的可移植部分：**一个 SDK 都没配时**把宿主探测到的那些灌进来。
   * 已经配过就原样返回（`preconfigure` 的语义是「if none are configured」）。
   *
   * 每一条都走 `createAndAddJdk`（上游检测/新建 SDK 的入口都是先 `createUniqueSdkName` 再 add）：
   * 两台 JDK 21 安装的 `suggest_name` 都是 `21`，直接 `addJdk` 会**后者顶掉前者**（一台 JDK 从表里消失）；
   * 去重后是 `21` + `21 (2)`，两台都在。同一个家目录重复喂进来不重复登记
   * （宿主的 `find_all()` 已按路径去重，这里再挡一层幂等）。
   */
  preconfigure(detected: readonly Sdk[]): Sdk[] {
    if (!this.sdks.length) {
      for (const sdk of detected) {
        if (this.findJdkByHome(sdk.homePath)) continue
        const { name, ...rest } = sdk
        this.createAndAddJdk(name, sdk.homePath, sdk.versionString, { ...rest, detected: true })
      }
    }
    return this.getAllJdks()
  }

  /**
   * 把「项目设置里的 jdkHome 字符串」接回表：表里没有这个家目录就按
   * `ProjectJdkImpl.java:49-51` 的构造器登记一条（名字取家目录末段，版本留空 —— 不编）。
   * 返回登记后的那条。没有家目录就返回 null（调用方自己决定「SDK 默认」那条路怎么走）。
   *
   * 名字同样过 `createAndAddJdk` 的去重（上游建 SDK 的入口只有那一条）：两个目录同名末段
   * （`D:\a\jdk-21` 与 `D:\b\jdk-21`）时是同名两条，不是后者顶掉前者。
   */
  ensureJdkForHome(homePath: string, versionString = ''): Sdk | null {
    const home = homePath.trim()
    if (!home) return null
    const existing = this.findJdkByHome(home)
    if (existing) return existing
    const name = home.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || home
    return this.createAndAddJdk(name, home, versionString)
  }
}

/** SDK 行的显示口径（`OrderEntry.getPresentableName()` 那一路，见 `src/externalLibraries.ts:61-63`）。 */
export function sdkPresentableName(sdk: Sdk): string {
  return sdk.name || (sdk.versionString ? `JDK ${sdk.versionString}` : sdk.homePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'JDK')
}
