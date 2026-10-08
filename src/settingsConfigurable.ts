// 设置页的**契约层** —— 上游 `com.intellij.openapi.options` 那一族在 TaoCode 的等价物。
//
// 为什么需要它：本仓每一页都在模板里手写「脏态 / 校验 / 应用 / 搜索」，没有上游那层抽象
// （侦察报告把 `Configurable` 一族列为第 10 高价值缺口）。这里把上游那一层的**形状**与
// **生命周期编排**原样立起来，零 Vue、零 DOM，宿主（src/components/SettingsDialog.vue）按它接线。
//
// 上游出处（均 `platform/ide-core/src/com/intellij/openapi/options/`，除非另标；每个符号上方另有逐条行号）：
//   UnnamedConfigurable.java:24 · Configurable.java:133 · ConfigurableWithId.java:7
//   SearchableConfigurable.java:18 · SettingsEditor.java:25 · SettingsEditorListener.java:8
//   ConfigurationException.java:12 · ConfigurableEP.java:40 · ConfigurableProvider.java:13
//   BaseConfigurable.java:8 · CompositeSettingsEditor.java:20 · NoAutomaticReset.kt:16
//   platform-api/.../SettingsEditorConfigurable.java:9 · ex/ConfigurableWrapper.java:39
//   ex/Weighted.java:21 · ex/ConfigurableVisitor.java:95 · ex/ConfigurableCardPanel.java:184
//   newEditor/SettingsEditor.java:280（整轮 apply）· newEditor/ConfigurableEditor.java:241
//
// **与 `src/settingsDraft.ts` 的分工（不要重复实现）**：那边是「草稿层」—— 本仓的 OK/应用
// 一次性把若干页的草稿打包成 `SettingsDraft` 交给 `saveSettingsDraft`；这里是「契约层」——
// 一页的脏态/校验/搜索/释放**归它自己**。两者的接线点只有一个：`SettingsEditorConfigurable`
// 的 `apply()` 应调 `settingsDraft` 那条保存链，而不是各自再写一套「哪些字段变了」的判断。
// `settingsDraft.ts` 里的 `createSettingsDraftPages` / `createSettingsDraftActions` 就是本仓
// 「对话框级 Apply/OK 循环」的等价物，本模块不重复它。

/** 一页的表单组件。上游是 `javax.swing.JComponent`（`UnnamedConfigurable.java:36`）。 */
export type EditorComponent = unknown

/** 设置树的显示名（上游 `@NlsContexts.ConfigurableName`）。 */
export type DisplayName = string

/** 帮助主题（上游 `Configurable.getHelpTopic` 返回的 `@NonNls String`）。 */
export type HelpTopic = string

/**
 * `UnnamedConfigurable` — `UnnamedConfigurable.java:24-82`。
 *
 * 生命周期（`:14-20` 的文档注释逐字）：`createComponent()` → `reset()` →（其间 `isModified()`
 * 会被**频繁**调用，`:47-48` 要求它不能慢）→ `disposeUIResources()`（析构，之后不再调任何方法）。
 *
 * 契约要点：
 *   · `createComponent` 可返回 `null`（`:35-36`），且「这一处是设计来**分配资源**的」
 *     （订阅/监听器等，`:29-31`），与 `disposeUIResources` 成对。
 *   · `apply()` 抛 `ConfigurationException`（`:57-60`）—— 值不合法时**不写盘**，把错误交给对话框。
 *   · `reset()` / `disposeUIResources()` / `cancel()` 上游都有**默认空实现**（`:67-68` / `:74-75`
 *     / `:80-81`）⇒ 这里三个都是可选成员。
 */
export interface UnnamedConfigurable {
  /** `UnnamedConfigurable.java:36` — `@RequiresEdt @Nullable JComponent createComponent()`。 */
  createComponent?(): EditorComponent
  /** `UnnamedConfigurable.java:41-43` — 对话框出现时该聚焦的组件，默认 `null`。 */
  getPreferredFocusedComponent?(): EditorComponent | null
  /** `UnnamedConfigurable.java:51` — 被频繁调用，必须便宜。 */
  isModified(): boolean
  /** `UnnamedConfigurable.java:60` — 失败时抛 `ConfigurationException`。 */
  apply(): void
  /** `UnnamedConfigurable.java:67-68` — 默认空实现。 */
  reset?(): void
  /** `UnnamedConfigurable.java:74-75` — 默认空实现；析构。 */
  disposeUIResources?(): void
  /** `UnnamedConfigurable.java:80-81` — 默认空实现；点「取消」时调。 */
  cancel?(): void
}

/**
 * `Configurable` — `Configurable.java:133-389`。
 *
 * 比 `UnnamedConfigurable` 多出：显示名、帮助主题、以及一批标记接口
 * （`NoScroll` :181 / `NoMargin` :224 / `Beta` :188 / `Promo` :195 / `NewOptions` :207 …）。
 * 标记接口在 TaoCode 没有 Swing 装饰链可对应，这里只保留**会被逻辑读到**的两组：
 *   · `Composite`（`:172-175`）—— 有子页的配置项，`getConfigurables()` 现算子页；
 *   · `focusOn(label)`（`:286-288`）—— 搜索命中后请求把焦点给某个控件，默认什么都不做。
 */
export interface Configurable extends UnnamedConfigurable {
  /** `Configurable.java:149` — 必须与 XML 里的 `displayName` 一致（`:141-143`）。 */
  displayName: DisplayName
  /** `Configurable.java:152-154` — `@ApiStatus.Internal @Nullable`；默认就是 `getDisplayName()`。 */
  displayNameFast?: DisplayName | null
  /** `Configurable.java:162-164` — 默认 `null`。 */
  helpTopic?: HelpTopic | null
  /** `Configurable.java:173-175` — `Composite.getConfigurables()`。 */
  getConfigurables?(): Configurable[]
  /** `Configurable.java:286-288` — 默认空实现。 */
  focusOn?(label: string): void
}

/** `ConfigurableWithId.java:7-18` — 唯一 id，且必须与 XML 里的 `id` 相同（`:10-12`）。 */
export interface ConfigurableWithId extends Configurable {
  /** `ConfigurableWithId.java:17`。 */
  id: string
}

/**
 * `SearchableConfigurable` — `SearchableConfigurable.java:18-163`。
 *
 * ⚠️ **上游没有 `getSearchableOption` 这个方法。** 侦察报告里那一项按名搜不到：
 * `grep -rn "getSearchableOption" platform/` 与全树 `grep -rn "getSearchableOption" .` 都返回空。
 * 这一族真实的搜索契约只有下面三条（外加 `ConfigurableWithId.getId()`）；索引侧的另一半在
 * `platform/platform-api/src/com/intellij/ide/ui/search/SearchableOptionContributor.kt`。
 *
 * 搜索契约：
 *   · `enableSearch(option)`（`:24-26`）—— 用户在设置对话框里输入过滤词、这一页被打开时调；
 *     返回一个 `Runnable`，**由调用方决定何时执行**，它「可以选中这一页里匹配的那个控件」（`:21-23`）。
 *     返回 `null` = 这一页不做定位。
 *   · `isSearchableInActions()`（`:49-51`）—— 默认 `true`；`false` 时仍进设置搜索索引，
 *     但不作为 Find Action / Search Everywhere 的「Actions」页结果（`:44-47`）。
 *   · `getOriginalClass()`（`:39-41`）—— 建索引要知道哪个类造出了它，默认 `this.getClass()`。
 */
export interface SearchableConfigurable extends ConfigurableWithId {
  /** `SearchableConfigurable.java:24-26` — 默认返回 `null`。 */
  enableSearch?(option: string): (() => void) | null
  /** `SearchableConfigurable.java:39-41` — 默认 `this.getClass()`。 */
  getOriginalClass?(): unknown
  /** `SearchableConfigurable.java:49-51` — 默认 `true`。 */
  isSearchableInActions?(): boolean
}

/** `ConfigurableProvider.java:13-36` — 用 `provider=` 属性替代 `instance=` 的那条路。 */
export interface ConfigurableProvider {
  /** `ConfigurableProvider.java:15` — 返回 `null` 表示这次不提供配置页。 */
  createConfigurable(): Configurable | null
  /** `ConfigurableProvider.java:21-23` — 可选类型提示，避免为了判类型而先实例化（默认 `null`）。 */
  getConfigurableType?(): unknown
  /** `ConfigurableProvider.java:33-35` — 默认 `true`；为 `true` 时才会调 `createConfigurable()`。 */
  canCreateConfigurable?(): boolean
}

/** `Configurable.java:134-137` — 两个扩展点，`application` 全局 / `project` 随项目。 */
export const APPLICATION_CONFIGURABLE = 'com.intellij.applicationConfigurable'
export const PROJECT_CONFIGURABLE = 'com.intellij.projectConfigurable'

/**
 * `ConfigurationException` — `ConfigurationException.java:12-113`。
 *
 * 语义：**`apply()` 无法接受用户输入的值**（`:9-11`）时抛出。对话框拿到它以后
 * （`ConfigurableEditor.java:279-297`）把 `title` 加粗、后跟 `message` 显示成一条内联错误
 * （`:285-290`），并且**不关对话框**（`SettingsEditor.java:307-316` 选中出错的页并返回 `false`）。
 * 默认标题来自 `OptionsBundle.properties:2` = `Cannot Save Settings`
 * （`ConfigurationException.java:110-112` 的 `getDefaultTitle()`）。
 */
export class ConfigurationException extends Error {
  /** `ConfigurationException.java:13` — 默认标题。 */
  readonly title: string
  /** `ConfigurationException.java:94-100` — 出错页（可空），用来把树选中到真正出错的那一页。 */
  originator: Configurable | null
  /** `ConfigurationException.java:106-108` — 默认 `true`。 */
  shouldShowInDumbMode: boolean

  /** `ConfigurationException.java:21-23` / `:29-33` —— 单参版用默认标题，双参版给标题。 */
  constructor(message: string, title: string = DEFAULT_CONFIGURATION_ERROR_TITLE) {
    super(message)
    this.name = 'ConfigurationException'
    this.title = title
    this.originator = null
    this.shouldShowInDumbMode = true
  }
}

/** `OptionsBundle.properties:2` — `cannot.save.settings.default.dialog.title=Cannot Save Settings`。 */
export const DEFAULT_CONFIGURATION_ERROR_TITLE = 'Cannot Save Settings'

/** `ConfigurableEditor.java:285-290` 拼出的那条内联错误：**加粗标题 + 冒号 + 换行 + 消息**。 */
export function formatConfigurationError(error: ConfigurationException): string {
  return `${error.title}:\n${error.message}`
}

/**
 * `ConfigurableEP` — `ConfigurableEP.java:40-534`。
 *
 * 逐个属性（类型 / 默认值 / 出处）：
 *   · `displayName` `String|null` 默认 `null`（`:62`）；优先于 `key`+`bundle`（`:56-57`）。
 *   · `key` `String|null` 默认 `null`（`:68`）；`bundle` `String|null` 默认 `null`（`:74-75`），
 *     未写时回落到插件自己的 bundle（`:119-125`）。
 *   · `children` `ConfigurableEP[]|null` 默认 `null`（`:127-129`）；**内联子标签**，不是属性（`:119-126`）。
 *   · `childrenEPName` `String|null` 默认 `null`（`:136-137`）；用哪个扩展点现算子项。
 *   · `dynamic` `boolean` 默认 `false`（`:144-145`）；为真表示子项由 `Composite.getConfigurables()` 现算。
 *   · `parentId` `String|null` 默认 `null`（`:153-154`）；父配置项，**优先于 `groupId`**（`:106-107`）。
 *   · `id` `String|null` 默认 `null`（`:169-170`）；即 `SearchableConfigurable.getId()`（`:166`）。
 *   · `groupId` `String|null` 默认 `null`（`:207-208`）；不写就落到 Other Settings（`:173-174`）。
 *   · `searchableInActions` `boolean` 默认 **`true`**（`:219-221`）。
 *   · `groupWeight` `int` 默认 **`0`**（`:229-230`）。
 *   · `nonDefaultProject` `boolean` 默认 `false`（`:238-239`）；只对 `projectConfigurable` 有意义。
 *   · `implementationClass` `String|null` 默认 `null`（`:249-250`）；**已弃用**，行为同 `instance`（`:246-247`）。
 *   · `instanceClass` `String|null` 默认 `null`（`:261-262`）；实现类全限定名。
 *   · `providerClass` `String|null` 默认 `null`（`:274-275`）；`ConfigurableProvider` 全限定名。
 *   · `treeRendererClass` `String|null` 默认 `null`（`:277-278`）。
 *
 * 三者的**优先级**（`:306-320` 的 `createProducer`）：`provider` → `instance` → `implementation`；
 * 三个都空时抛 `PluginException("configurable class name is not set")`（`:319`）。
 */
export class ConfigurableEP {
  displayName: DisplayName | null
  key: string | null
  bundle: string | null
  children: ConfigurableEP[] | null
  childrenEPName: string | null
  dynamic: boolean
  parentId: string | null
  id: string | null
  groupId: string | null
  searchableInActions: boolean
  groupWeight: number
  nonDefaultProject: boolean
  implementationClass: string | null
  instanceClass: string | null
  providerClass: string | null
  treeRendererClass: string | null

  constructor(init: ConfigurableEPOptions = {}) {
    this.displayName = init.displayName ?? null
    this.key = init.key ?? null
    this.bundle = init.bundle ?? null
    this.children = init.children ?? null
    this.childrenEPName = init.childrenEPName ?? null
    this.dynamic = init.dynamic ?? false
    this.parentId = init.parentId ?? null
    this.id = init.id ?? null
    this.groupId = init.groupId ?? null
    this.searchableInActions = init.searchableInActions ?? true
    this.groupWeight = init.groupWeight ?? 0
    this.nonDefaultProject = init.nonDefaultProject ?? false
    this.implementationClass = init.implementationClass ?? null
    this.instanceClass = init.instanceClass ?? null
    this.providerClass = init.providerClass ?? null
    this.treeRendererClass = init.treeRendererClass ?? null
  }

  /**
   * `ConfigurableEP.getDisplayName()` — `:77-104`。顺序是 `displayName` → bundle 里的 `key`
   * → 回落成类名（`:82-100`，并在 key/bundle 缺一时 `LOG.warn`）。
   * 这里同样在键缺失时把类名当显示名（上游那两条 warning 只记日志，不改返回值）。
   */
  getDisplayName(resolveKey?: (bundle: string, key: string) => string | null): DisplayName {
    if (this.displayName !== null) return this.displayName
    if (this.bundle !== null && this.key !== null && resolveKey) {
      const resolved = resolveKey(this.bundle, this.key)
      if (resolved !== null) return resolved
    }
    return this.implementationClass ?? this.instanceClass ?? this.providerClass ?? ''
  }

  /** `ConfigurableEP.java:241-243` — `nonDefaultProject` 为真且当前是模板项目时不可用。 */
  isAvailable(isDefaultProject = false): boolean {
    return !this.nonDefaultProject || !isDefaultProject
  }

  /** `ConfigurableEP.java:306-320` — `provider` → `instance` → `implementation`，全空则报错。 */
  producerKind(): 'provider' | 'instance' | 'implementation' | 'none' {
    if (this.providerClass !== null) return 'provider'
    if (this.instanceClass !== null) return 'instance'
    if (this.implementationClass !== null) return 'implementation'
    return 'none'
  }

  /**
   * `ConfigurableEP.canCreateConfigurable()` — `:389-391`（`producer.canCreateElement()`）。
   * `ProviderProducer` 转发给 provider 的 `canCreateConfigurable()`（`:429-432`），
   * `ClassProducer` 恒为 `true`（`:468-471`）；未设类名时 `createProducer` 抛错（`:319`）⇒ `false`。
   */
  canCreateConfigurable(provider?: ConfigurableProvider | null): boolean {
    switch (this.producerKind()) {
      case 'none': return false
      case 'provider': return provider?.canCreateConfigurable?.() ?? true
      default: return true
    }
  }

  /** `ConfigurableEP.getConfigurableType()` — `:399-401`；`provider` 时问 provider（`:435-437`）。 */
  getConfigurableType(provider?: ConfigurableProvider | null): unknown {
    return this.producerKind() === 'provider' ? (provider?.getConfigurableType?.() ?? null) : null
  }

  /**
   * `ConfigurableEP.createConfigurable()` — `:354-362`，外层还套着 `SafeProducerWrapper`
   * （`:486-533`）：生产者的任何异常都被吞掉并记日志，返回 `null` 而不是把设置对话框炸掉。
   */
  createConfigurable(host: ConfigurableEPHost): Configurable | null {
    try {
      if (this.producerKind() === 'provider') {
        const provider = host.instantiateProvider(this.providerClass as string)
        if (provider === null) return null
        return provider.canCreateConfigurable?.() === false ? null : provider.createConfigurable()
      }
      const className = this.instanceClass ?? this.implementationClass
      if (className === null) return null
      return host.instantiateConfigurable(className)
    } catch {
      return null
    }
  }

  /** `ConfigurableEP.instantiateConfigurableProvider()` — `:331-335`。 */
  instantiateConfigurableProvider(host: ConfigurableEPHost): ConfigurableProvider | null {
    return this.providerClass === null ? null : host.instantiateProvider(this.providerClass)
  }
}

/**
 * `ConfigurableEP` 的构造入参 —— 就是它的全部属性，都可省（省略即取上游默认值，见类头）。
 * 从类上直接派生，免得两张字段表漂移。
 */
export type ConfigurableEPOptions = Partial<Omit<ConfigurableEP,
  'getDisplayName' | 'isAvailable' | 'producerKind' | 'canCreateConfigurable' | 'getConfigurableType'
  | 'createConfigurable' | 'instantiateConfigurableProvider'>>

/**
 * `ConfigurableEP` 造实例需要的宿主能力 —— 上游是 `ComponentManager.instantiateClass`
 * （`:331-335` / `:454`）。TaoCode 没有类名字符串 → 构造函数的反射链，所以宿主直接给按类名查构造器的表。
 */
export interface ConfigurableEPHost {
  instantiateProvider(className: string): ConfigurableProvider | null
  instantiateConfigurable(className: string): Configurable | null
}

/**
 * `ConfigurableWrapper` — `ConfigurableWrapper.java:39-497`。
 *
 * 它把 EP 包成一个 `SearchableConfigurable`，并**惰性**造真身（`:171-189`）：
 * `getConfigurable()` 第一次被调时才 `createConfigurable`，之后缓存；`disposeUIResources()`
 * （`:256-263`）把缓存**清成 `null`**（下次再进来会重新造）。
 *
 * `wrapConfigurable` 的分流（`:46-55`）是这一层的关键判据：只有当 EP 带
 * `displayName` / `key` / `parentId` / `groupId` 之一（或调用方要 settings 形态）时才包 wrapper；
 * 否则直接返回真身。**`dynamic` / `children` / `childrenEPName` 任一存在就换成 `CompositeWrapper`**。
 */
export class ConfigurableWrapper implements SearchableConfigurable {
  readonly ep: ConfigurableEP
  private readonly host: ConfigurableEPHost
  private weight: number
  private raw: Configurable | null
  private kids: Configurable[] | null

  constructor(ep: ConfigurableEP, host: ConfigurableEPHost, kids: Configurable[] | null = null) {
    this.ep = ep
    this.host = host
    this.weight = ep.groupWeight // :162
    this.raw = null
    this.kids = kids
  }
  /** `ConfigurableWrapper.getConfigurable()` — `:171-189`：惰性造 + 缓存。 */
  getConfigurable(): Configurable | null {
    if (this.raw === null) this.raw = this.ep.createConfigurable(this.host)
    return this.raw
  }

  /** `ConfigurableWrapper.getRawConfigurable()` — `:167-169`：**不触发**构造。 */
  getRawConfigurable(): Configurable | null {
    return this.raw
  }

  get displayName(): DisplayName {
    // :201-219 —— XML 有 displayName/key 就用它，否则才去造真身取名（上游此时会 LOG.error）。
    if (this.ep.displayName === null && this.ep.key === null) return this.getConfigurable()?.displayName ?? ''
    return this.ep.getDisplayName()
  }

  /** `:196-199` — `displayNameFast`：EP 没写名字就返回 `null`，避免为取名而实例化。 */
  get displayNameFast(): DisplayName | null {
    return this.ep.displayName === null && this.ep.key === null ? null : this.ep.getDisplayName()
  }

  /** `:274-293` — XML 的 `id` 优先；否则问真身；再否则按 provider→instance→implementation 回落。 */
  get id(): string {
    if (this.ep.id !== null) return this.ep.id
    const configurable = this.getConfigurable()
    if (configurable !== null && isSearchable(configurable)) return configurable.id
    return this.ep.providerClass ?? this.ep.instanceClass ?? this.ep.implementationClass ?? ''
  }

  /** `:229-233` / `:299-302` / `:191-194`（`myWeight = ep.groupWeight`）。 */
  get helpTopic(): HelpTopic | null {
    return this.getConfigurable()?.helpTopic ?? null
  }

  get parentId(): string | null {
    return this.ep.parentId
  }

  get groupWeight(): number {
    return this.weight
  }

  isModified(): boolean {
    return this.getConfigurable()?.isModified() ?? false // :241-244
  }

  apply(): void {
    this.getConfigurable()?.apply() // :246-249 —— 不吞异常，ConfigurationException 照抛
  }

  reset(): void {
    this.getConfigurable()?.reset?.() // :251-254
  }

  /** `:256-263` — 释放后把真身缓存清空（下次访问会重新构造）。 */
  disposeUIResources(): void {
    const configurable = this.raw
    if (configurable !== null) {
      configurable.disposeUIResources?.()
      this.raw = null
    }
  }

  cancel(): void {
    this.raw?.cancel?.() // :265-271 —— 只对已造出来的真身调
  }

  createComponent(): EditorComponent | null {
    return this.getConfigurable()?.createComponent?.() ?? null // :236-239
  }

  /** `:314-318` — 只有真身是 SearchableConfigurable 时它才有搜索动作。 */
  enableSearch(option: string): (() => void) | null {
    const configurable = this.getConfigurable()
    return configurable !== null && isSearchable(configurable) ? (configurable.enableSearch?.(option) ?? null) : null
  }

  /** `:330-339` — 真身说了算；真身不是 SearchableConfigurable 时用 EP 的 `searchableInActions`。 */
  isSearchableInActions(): boolean {
    const configurable = this.raw
    if (configurable !== null && isSearchable(configurable)) return configurable.isSearchableInActions?.() ?? true
    return this.ep.searchableInActions
  }

  /** `CompositeWrapper.getConfigurables()` — `:366-440`：`dynamic` → `children` → 内联子项，再按权重排。 */
  getConfigurables(isDefaultProject = false): Configurable[] {
    if (this.kids !== null) return this.kids
    const list: Configurable[] = []
    if (this.ep.dynamic) list.push(...(this.getConfigurable()?.getConfigurables?.() ?? [])) // :374-382
    for (const child of this.ep.children ?? []) {
      if (!child.isAvailable(isDefaultProject)) continue // :384-389 —— 不可用的子项不进树
      list.push(new ConfigurableWrapper(child, this.host))
    }
    // :390-415 的 childrenEPName 那条路要查扩展点注册表，TaoCode 无此表；宿主按需自行展开。
    return (this.kids = list.length > 1 ? sortConfigurables(list) : list)
  }
}

/**
 * `Weighted.COMPARATOR` — `Weighted.java:21-33`：**权重降序**，权重相同按显示名自然序。
 * `CompositeWrapper` 用它排子项（`ConfigurableWrapper.java:418-421`），
 * 且只有在有子项权重非零时才排（`:424-432`）。
 */
export function compareConfigurables(left: Configurable, right: Configurable): number {
  const leftWeight = weightOf(left)
  const rightWeight = weightOf(right)
  if (leftWeight !== rightWeight) return rightWeight - leftWeight
  return naturalCompare(safeDisplayName(left), safeDisplayName(right))
}

export function sortConfigurables(items: readonly Configurable[]): Configurable[] {
  return [...items].sort(compareConfigurables)
}

/** `ConfigurableWrapper.java:191-194` / `:423-432` —— 权重只来自 `groupWeight`。 */
export function weightOf(configurable: Configurable): number {
  return configurable instanceof ConfigurableWrapper ? configurable.groupWeight : 0
}

/**
 * `StringUtil.naturalCompare` — `platform/util/src/com/intellij/openapi/util/text/StringUtil.java:2691`
 * （`NaturalComparator.INSTANCE`）：数字段按数值比，其它按码元。`Intl.Collator` 的 `numeric`
 * 就是同一口径，仓库里 `src/branchPopup.ts:44-50` 已是这个写法。
 */
const NATURAL_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' })

export function naturalCompare(left: string, right: string): number {
  return NATURAL_COLLATOR.compare(left, right)
}

/** `SearchUtil.kt:799-801` 的 `getDisplayNameSafely`：取名失败不算致命（`runSafely` 吞异常）。 */
export function safeDisplayName(configurable: Configurable): string {
  try {
    return configurable.displayName
  } catch {
    return ''
  }
}

/** `ConfigurableVisitor.java:95-99` / `SearchableConfigurable.Delegate.java:107-111` 的 id 口径。 */
export function getConfigurableId(configurable: Configurable): string {
  return isSearchable(configurable) ? configurable.id : Object.getPrototypeOf(configurable)?.constructor?.name ?? ''
}

/** 结构化判断：有没有 `getId()`（上游 `instanceof SearchableConfigurable`）。 */
export function isSearchable(configurable: Configurable): configurable is SearchableConfigurable {
  return typeof (configurable as SearchableConfigurable).id === 'string'
}

/**
 * `SearchableConfigurable.Delegate` — `SearchableConfigurable.java:99-162`：
 * 把一个普通 `Configurable` 包成可搜索的（`getId()` 回落成类名，`:107-111`），
 * 其余成员逐个转发。`SpotlightPainter.kt:107` 就是拿它去 `enableSearch` 的。
 */
export function searchableDelegate(configurable: Configurable): SearchableConfigurable {
  const own = isSearchable(configurable) ? configurable : null
  return {
    displayName: configurable.displayName,
    id: getConfigurableId(configurable),
    helpTopic: configurable.helpTopic ?? null,
    createComponent: () => configurable.createComponent?.() ?? null,
    isModified: () => configurable.isModified(),
    apply: () => configurable.apply(),
    reset: () => configurable.reset?.(),
    disposeUIResources: () => configurable.disposeUIResources?.(),
    cancel: () => configurable.cancel?.(),
    enableSearch: option => own?.enableSearch?.(option) ?? null,
    getOriginalClass: () => own?.getOriginalClass?.() ?? configurable,
    isSearchableInActions: () => own?.isSearchableInActions?.() ?? true,
  }
}

/**
 * `Configurable.isFieldModified(JTextField, String)` — `Configurable.java:333-335`：**两侧 `trim()` 后比较**。
 * `isCheckboxModified` — `:357-359`：勾选态是否与初值不同。
 */
export function isFieldModified(current: string, initial: string): boolean {
  return current.trim() !== initial.trim()
}

export function isCheckboxModified(current: boolean, initial: boolean): boolean {
  return current !== initial
}

/**
 * `ConfigurableEditor.updateCurrent` — `ConfigurableEditor.java:241-248`：
 * Apply/Reset 两个动作的可用性**只由 `isModified()` 决定**（`:242-244`）；
 * `reset === true` 且未修改时顺手清掉旧错误（`:245-247`）。
 * 返回的 `clearError` 就是那一步（宿主据此把上一轮的错误提示收掉）。
 */
export function updateActionsFor(configurable: Configurable | null, afterReset = false): { applyEnabled: boolean; resetEnabled: boolean; clearError: boolean } {
  const modified = configurable !== null && isModifiedSafely(configurable) === true
  return { applyEnabled: modified, resetEnabled: modified, clearError: afterReset && !modified }
}

/**
 * `SettingsEditor.isModifiedSafely` — `newEditor/SettingsEditor.java:675-685`：
 * `isModified()` 抛异常时记日志并**当作「无法判断」（`null`）**，而不是把对话框带崩。
 */
export function isModifiedSafely(configurable: Configurable): boolean | null {
  try {
    return configurable.isModified()
  } catch {
    return null
  }
}

/** `ConfigurableEditor.java:328-339` 的 `static apply`：只吞 `ConfigurationException`，其余照抛。 */
export function applyConfigurable(configurable: Configurable | null): ConfigurationException | null {
  if (configurable === null) return null
  try {
    configurable.apply()
    return null
  } catch (error) {
    if (error instanceof ConfigurationException) return error
    throw error
  }
}

/**
 * 整轮 Apply —— `newEditor/SettingsEditor.java:280-322` 的循环逐条：
 *   1. 只遍历 `filter.context.getModified()` 那一集合（`:287`）；
 *   2. 逐个 `ConfigurableEditor.apply(configurable)`（`:296`），收 `ConfigurationException`（`:297-299`）；
 *   3. `apply()` 之后若 `!isModified()`（值已被写回、脏态自动清了）就把它从「已修改」集合里移除
 *      并记进 `modifiedIds`（`:300-303`）；
 *   4. 有错误时**选中最先出错的那一页**（有 `originator` 就用它）并返回 `false`（`:307-316`）；
 *   5. 全部成功才返回 `true`，并广播 `afterApply`（`:317-321`）。
 *
 * `SettingsDialog.java:240-251` 的 OK 走的就是这条：`editor.apply()` 为真才真的关窗。
 */
export function applyModifiedConfigurables(
  configurables: readonly Configurable[],
): { ok: boolean; errors: ConfigurationException[]; modifiedIds: string[]; originator: Configurable | null } {
  const errors: ConfigurationException[] = []
  const modifiedIds: string[] = []
  for (const configurable of configurables) {
    const error = applyConfigurable(configurable)
    if (error !== null) {
      errors.push(error)
      continue
    }
    if (!isModifiedSafely(configurable)) modifiedIds.push(getConfigurableId(configurable))
  }
  const first = errors[0]
  const originator = first === undefined ? null : first.originator
  return { ok: errors.length === 0, errors, modifiedIds, originator }
}

/**
 * `newEditor/SettingsEditor.java:577-581` 的 Reset All：对每一页调 `configurable.reset()`；
 * 单页的版本在 `ConfigurableEditor.java:155-161`（`ConfigurableCardPanel.reset` 之后才 `updateCurrent`）。
 * `ConfigurableCardPanel.java:219-232` 的 `reset` 吞掉异常并记日志 —— 一页的 reset 失败不该拦住其它页。
 */
export function resetConfigurables(configurables: readonly Configurable[]): void {
  for (const configurable of configurables) {
    try {
      configurable.reset?.()
    } catch {
      // ConfigurableCardPanel.java:225-227 —— LOG.error("cannot reset configurable")，不向上抛。
    }
  }
}

/**
 * `ConfigurableCardPanel.dispose` — `ConfigurableCardPanel.java:184-202`：
 * 释放时逐页调 `disposeUIResources()`，同样吞异常（`:195-197`）。
 */
export function disposeConfigurables(configurables: readonly Configurable[]): void {
  for (const configurable of configurables) {
    try {
      configurable.disposeUIResources?.()
    } catch {
      // ConfigurableCardPanel.java:195-197 —— LOG.error("cannot dispose configurable")，不向上抛。
    }
  }
}

/**
 * `SettingsEditorListener` — `SettingsEditorListener.java:8-10`：
 * 只有一个 `stateChanged(editor)`，编辑器内部状态一变就回调（`SettingsEditor.java:173-180` 派发）。
 */
export type SettingsEditorListener<T> = (editor: SettingsEditor<T>) => void

/** `CompositeSettingsEditor.getSnapshot()` 那一层宿主（`:97-103` 的 `setOwner` / `:89-95`）。 */
export interface SettingsEditorOwner<T> {
  getSnapshot(): T
}

/**
 * `SettingsEditor<Settings>` — `SettingsEditor.java:25-189`。
 *
 * 它是「某个抽象数据类型的**事务性**编辑器提供者」（`:17-18`）。契约：
 *   · `getComponent()` 必须在 `resetFrom(...)` **之前**被调用（`:19-20` 的类注释）；
 *     `getComponent()` 内部第一次调用时才 `createEditor()` 并挂监听（`:132-138`）。
 *   · 子类只实现三个钩子：`resetEditorFrom`（`:45`，UI ← 数据）、
 *     `applyEditorTo`（`:50`，数据 ← UI，**可抛 `ConfigurationException`**）、`createEditor`（`:52`）。
 *   · `resetFrom`（`:109-114`）与 `bulkUpdate`（`:116-126`）成对：整个重置包在一次 bulk update 里，
 *     期间**不派发**状态变化（`:173-176`），结束才 `fireEditorStateChanged()`（`:125`）。
 *   · `applyTo`（`:128-130`）直接转发 `applyEditorTo`，不做 try/catch —— 异常交给调用方
 *     （`SettingsEditorConfigurable.apply()` 就靠它把错误抛给对话框）。
 *   · `getSnapshot`（`:89-95`）：有 owner 就用 owner 的快照（复合编辑器里所有子编辑器看到同一份），
 *     否则用工厂造一份再 `applyTo` 填进去。没有工厂时上游会 NPE，这里改成抛一句明确的错。
 *   · `isSpecificallyModified`（`:182-184`）/ `isReadyForApply`（`:186-188`）默认 `false` / `true`。
 */
export abstract class SettingsEditor<T> {
  private readonly settingsFactory: (() => T) | null
  private readonly listeners: Array<SettingsEditorListener<T>> = [] // :26
  private inUpdate = false // :28
  private component: EditorComponent | null = null // :31
  private owner: SettingsEditorOwner<T> | null = null // :30

  /** `SettingsEditor.java:62-87` —— 两个构造器（无工厂 / 有工厂）合成一个可选参数。 */
  constructor(settingsFactory: (() => T) | null = null) {
    this.settingsFactory = settingsFactory
  }

  /** `SettingsEditor.java:45` —— UI ← 数据。 */
  protected abstract resetEditorFrom(settings: T): void
  /** `SettingsEditor.java:50` —— 数据 ← UI；失败抛 `ConfigurationException`。 */
  protected abstract applyEditorTo(settings: T): void
  /** `SettingsEditor.java:52` —— 造 UI。 */
  protected abstract createEditor(): EditorComponent
  /** `SettingsEditor.java:59-60` —— 默认空实现。 */
  protected disposeEditor(): void {
    // 默认什么都不做（上游 :59-60）。
  }

  /** `SettingsEditor.java:89-95` —— 有 owner 走 owner，否则用工厂造一份再 `applyTo`。 */
  getSnapshot(): T {
    if (this.owner !== null) return this.owner.getSnapshot()
    if (this.settingsFactory === null) throw new Error('SettingsEditor: no settings factory, cannot take a snapshot')
    const settings = this.settingsFactory()
    this.applyTo(settings)
    return settings
  }

  /** `SettingsEditor.java:97-99` / `:101-103`。 */
  setOwner(owner: SettingsEditorOwner<T> | null): void {
    this.owner = owner
  }

  getOwner(): SettingsEditorOwner<T> | null {
    return this.owner
  }

  getFactory(): (() => T) | null {
    return this.settingsFactory
  }

  /** `SettingsEditor.java:109-114` —— 先保证组件存在（`:111`），再在 bulk update 里重置。 */
  resetFrom(settings: T): void {
    this.bulkUpdate(() => {
      if (this.component === null) this.getComponent()
      this.resetEditorFrom(settings)
    })
  }

  /** `SettingsEditor.java:116-126` —— 期间抑制状态广播（`:118-123`），收尾统一派发一次（`:125`）。 */
  bulkUpdate(runnable: () => void): void {
    const wasInUpdate = this.inUpdate
    try {
      this.inUpdate = true
      runnable()
    } finally {
      this.inUpdate = wasInUpdate
    }
    this.fireEditorStateChanged()
  }  /** `SettingsEditor.java:128-130` —— 不吞异常。 */
  applyTo(settings: T): void {
    this.applyEditorTo(settings)
  }

  /** `SettingsEditor.java:132-138` —— 懒造组件（第一次调用时才 `createEditor`）。 */
  getComponent(): EditorComponent {
    if (this.component === null) this.component = this.createEditor()
    return this.component
  }

  /** `SettingsEditor.java:165-171`。 */
  addSettingsEditorListener(listener: SettingsEditorListener<T>): void {
    this.listeners.push(listener)
  }

  removeSettingsEditorListener(listener: SettingsEditorListener<T>): void {
    const index = this.listeners.indexOf(listener)
    if (index >= 0) this.listeners.splice(index, 1)
  }

  /** `SettingsEditor.java:173-180` —— bulk update 期间不派发。 */
  protected fireEditorStateChanged(): void {
    if (this.inUpdate) return
    for (const listener of this.listeners) listener(this)
  }

  /** `SettingsEditor.java:182-184`。 */
  isSpecificallyModified(): boolean {
    return false
  }

  /** `SettingsEditor.java:186-188`。 */
  isReadyForApply(): boolean {
    return true
  }

  /**
   * `SettingsEditor.java:140-143` 清监听；`:80-86` 的 Disposer 回调另外调 `disposeEditor()`。
   * TaoCode 没有 Disposer，这里把两步合成一次（先清监听、再释放子类资源），顺序与上游一致。
   */
  dispose(): void {
    this.listeners.length = 0
    this.disposeEditor()
  }
}

/**
 * `BaseConfigurable` — `BaseConfigurable.java:8-27`：脏态存在字段里，由子类 `setModified` 维护。
 * `SettingsEditorConfigurable` 正是靠它把编辑器的 `stateChanged` 折成 `isModified()`。
 */
export abstract class BaseConfigurable implements Configurable {
  private modified = false // :9
  abstract displayName: DisplayName
  abstract apply(): void
  isModified(): boolean {
    return this.modified // :11-13
  }
  protected setModified(modified: boolean): void {
    this.modified = modified // :15-17
  }
}

/**
 * `SettingsEditorConfigurable<Settings>` — `SettingsEditorConfigurable.java:9-60`。
 *
 * 这是 `SettingsEditor` 与 `Configurable` 之间**唯一的桥**，四条对应关系：
 *   · 构造时挂监听：编辑器状态一变就 `setModified(true)`（`:17-23`）；
 *   · `createComponent()` 就是 `editor.getComponent()`（`:27-29`）；
 *   · `apply()` = `editor.applyTo(settings)` 然后 `setModified(false)`（`:32-35`）——
 *     **抛出的 `ConfigurationException` 直接冒到对话框**，此时 `setModified(false)` 不执行；
 *   · `reset()` = `editor.resetFrom(settings)` 然后 `setModified(false)`（`:37-41`）；
 *   · `disposeUIResources()` 摘监听 + `Disposer.dispose(editor)`，并把引用置空（`:43-50`）。
 *
 * 上游这个类是 `abstract`（`getDisplayName` 留给子类，`:9`），这里保持一致。
 */
export abstract class SettingsEditorConfigurable<T> extends BaseConfigurable {
  private editor: SettingsEditor<T> | null
  private readonly settings: T
  private readonly listener: SettingsEditorListener<T>

  constructor(editor: SettingsEditor<T>, settings: T) {
    super()
    this.editor = editor
    this.settings = settings
    this.listener = () => {
      this.setModified(true) // :17-23
    }
    editor.addSettingsEditorListener(this.listener)
  }

  createComponent(): EditorComponent | null {
    return this.getEditor().getComponent() // :27-29
  }

  apply(): void {
    this.getEditor().applyTo(this.settings) // :32-35 —— 抛错时不 setModified(false)
    this.setModified(false)
  }

  reset(): void {
    this.getEditor().resetFrom(this.settings) // :37-41
    this.setModified(false)
  }

  /** `:43-50` —— 摘监听、释放编辑器、引用置空。 */
  disposeUIResources(): void {
    const editor = this.editor
    if (editor !== null) {
      editor.removeSettingsEditorListener(this.listener)
      editor.dispose()
    }
    this.editor = null
  }

  getEditor(): SettingsEditor<T> {
    if (this.editor === null) throw new Error('SettingsEditorConfigurable: editor already disposed') // :53-55
    return this.editor
  }

  getSettings(): T {
    return this.settings // :57-59
  }
}

/**
 * `SettingsEditorGroup` 的等价物：一张「标签名 → 编辑器」的表（`SettingsEditorGroup.java:13-41`），
 * 自己的 `resetEditorFrom` / `applyEditorTo` **什么都不做**（`:32-35`）—— 标签宿主只负责收集，
 * 真正干活的是每个子编辑器。这里用纯数据表达，宿主自己渲染成页签。
 */
export interface SettingsEditorTab<T> {
  name: string
  editor: SettingsEditor<T>
}

/**
 * `CompositeSettingsEditor.SynchronizationController` — `CompositeSettingsEditor.java:107-145`：
 * 某个子编辑器变了，**300 ms 后**（`:125`）用整份快照重置**其它**子编辑器（`:128-144`），
 * 这样一页上的两处编辑（「配色方案字体」与「控制台字体」）不会互相覆盖。变化集在同步开始时
 * 清空（`:141`），同步中再来的变化被忽略（`:113-115`）。
 */
export const COMPOSITE_SYNC_DELAY_MS = 300 // CompositeSettingsEditor.java:125

export class CompositeSynchronizer<T> {
  private readonly editors: readonly SettingsEditor<T>[]
  private readonly snapshot: () => T
  private readonly changed = new Set<SettingsEditor<T>>()
  private inSync = false

  constructor(editors: readonly SettingsEditor<T>[], snapshot: () => T) {
    this.editors = editors
    this.snapshot = snapshot
  }

  /** `:112-127` —— 记录变化者，重新排 300 ms 的同步（每次变化都把上一次的请求取消掉）。 */
  handleStateChange(editor: SettingsEditor<T>): void {
    if (this.inSync) return // :113-115
    this.changed.add(editor) // :117
  }

  /** `:128-144` —— 同步一次：只重置**没变过**的那些编辑器。 */
  sync(): void {
    this.inSync = true
    try {
      const snapshot = this.snapshot() // :131
      for (const editor of this.editors) {
        if (!this.changed.has(editor)) editor.resetFrom(snapshot) // :132-136
      }
    } finally {
      this.changed.clear() // :141
      this.inSync = false // :142
    }
  }

  /** 供测试与宿主判断有没有待同步的变化（上游没有对应方法，是 `myChangedEditors` 的只读投影）。 */
  pendingCount(): number {
    return this.changed.size
  }
}

/**
 * `NoAutomaticReset.kt:16` 的标记接口：失去焦点时未修改、之后因**外部/后台变化**变脏的页，
 * 设置窗口重新获得焦点时上游会**自动 reset**（`newEditor/SettingsEditor.java:715-729`）；
 * 实现这个标记的页要求**不要**自动重置（例如正在等浏览器授权）。
 */
export const NO_AUTOMATIC_RESET = 'noAutomaticReset'

/** 该不该在窗口重获焦点时自动重置这一页（`newEditor/SettingsEditor.java:715-729`）。 */
export function shouldAutoReset(isModifiedNow: boolean | null, leaveStateUnmodified: boolean, hasMarker: boolean): boolean {
  if (isModifiedNow === null) return false // :720
  if (!leaveStateUnmodified || !isModifiedNow) return false // :722
  return !hasMarker // :723-725
}
