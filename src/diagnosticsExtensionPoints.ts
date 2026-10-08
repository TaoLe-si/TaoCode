// **pf/diagnostics 域的扩展点宿主接线** —— 把「特殊目录提供者 / 排障信息收集器」这两族上游本来就是
// EP 的接口，按 `src/extensionPoints.ts` 的 `EXTENSIONS` 宿主登记出来，并给出与上游**同名的方法面**。
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明）：
//   · `com.intellij.diagnostic.specialPathsProvider` ——
//     `platform/platform-api/resources/intellij.platform.ide.xml:132`
//     （`interface="com.intellij.diagnostic.specialPaths.SpecialPathsProvider"` dynamic="true"）；
//     方法面 `collectPaths(project: Project?): List<SpecialPathEntry>`（
//     `platform/platform-api/src/com/intellij/diagnostic/specialPaths/SpecialPathsProvider.kt:14`），
//     一条条目是 `SpecialPathEntry(name, originalPath, kind: File|Folder)`（同目录 `SpecialPathEntry.kt:10`）。
//     上游内置两条：`ApplicationSpecialPathsProvider`（系统/配置/Bin/Lib/Options/插件/临时/日志…）
//     与 `ProjectSpecialPathsProvider`（`PROJECT BasePath`），声明在
//     `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1667-1668`。
//   · `com.intellij.generalTroubleInfoCollector` —— `platform/platform-impl/resources/intellij.platform.ide.impl.xml:308`
//     （`interface="com.intellij.troubleshooting.GeneralTroubleInfoCollector"` dynamic="true"；
//     `GeneralTroubleInfoCollector.java:20` 的 `EP_SETTINGS`）；方法面 `getTitle()` + `collectInfo(Project)`。
//     上游内置六条（About/System/Display/Plugin/Project/GC），声明在 `:1325-1330`。
//   · `com.intellij.troubleInfoCollector` —— 同文件 `:307`
//     （`interface="com.intellij.troubleshooting.TroubleInfoCollector"` dynamic="true"；
//     `TroubleInfoCollector.java:20` 的 `EP_SETTINGS`）；方法面 `collectInfo(Project)`（项目级收集器，
//     上游平台自己没有内置实现，留给插件）。
//
// 本仓此前：特殊目录是宿主固定几张表（`native/diagnostics.cpp` 的 `app.specialPaths`，前端
// `src/components/SpecialPathsDialog.vue` 只读展示）、排障收集器是**写死的五条**
// （`src/troubleshootingCollectors.ts:19` 明写「`TroubleInfoCollector` 的插件贡献点没有宿主」）。
// 第三方（原版 IDEA 插件）按同名 id 挂进来时，**没有任何入口**。本文件补上那一层：声明三条 EP +
// 提供与上游同名的方法面 + 暴露 consume 函数；本仓内建的特殊目录与五条通用收集器在各自消费侧
// 作为 bundled 贡献登记（见 `installBundledSpecialPathsProvider` 与
// `installBundledGeneralTroubleInfoCollectors`），于是 EP 里看得见的就是真实在跑的那几条。
//
// 与上游的两处如实差异：
//   ① 上游的 `Project` 参数在本仓是**工作区根字符串或 null**（没有容器对象）；
//   ② 上游的条目 `SpecialPathEntry.path` 由 `Path.of` 解析成 `java.nio.Path`，本仓保留字符串
//      （存在性判定走宿主 `file.reveal` / 既有的 `exists` 字段，不在这一层造 IO）。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge），便于 `node --test` 直测。
//
// 判据：`tests/diagnostics-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** `SpecialPathsProvider.java`/`.kt` 的 `EP_NAME`（`SpecialPathsProvider.kt:9`）。 */
export const SPECIAL_PATHS_PROVIDER_EP = 'com.intellij.diagnostic.specialPathsProvider'
/** `GeneralTroubleInfoCollector.java:20` 的 `EP_SETTINGS`。 */
export const GENERAL_TROUBLE_INFO_COLLECTOR_EP = 'com.intellij.generalTroubleInfoCollector'
/** `TroubleInfoCollector.java:20` 的 `EP_SETTINGS`。 */
export const TROUBLE_INFO_COLLECTOR_EP = 'com.intellij.troubleInfoCollector'

/** `SpecialPathEntry.Kind`（`SpecialPathEntry.kt:12-15` 的 `File`/`Folder`）。 */
export type SpecialPathKind = 'file' | 'folder'

/**
 * 一条特殊目录（上游 `SpecialPathEntry` 的可移植子集：`name` / `originalPath` / `kind`）。
 * 本仓把 `originalPath` 直接叫 `path`（没有 `Path.of` 解析那一步）。
 */
export interface SpecialPathEntry {
  /** `SpecialPathEntry.name` —— 对话框里那一行的名字（如 `LOGS folder`）。 */
  name: string
  /** `SpecialPathEntry.originalPath` —— 系统相关路径字符串。 */
  path: string
  /** `SpecialPathEntry.Kind` —— 文件还是目录（决定点击时是打开还是定位）。 */
  kind: SpecialPathKind
}

/**
 * 一条特殊目录提供者（`SpecialPathsProvider` 的方法面，名字与上游逐字相同）。
 * 上游 `collectPaths(project)` 里 `project` 可空（应用级provider 忽略它）。
 */
export interface SpecialPathsProviderContribution {
  id: string
  /** `SpecialPathsProvider.collectPaths(project)`（本仓 `project` = 工作区根字符串或 null）。 */
  collectPaths: (project: string | null) => readonly SpecialPathEntry[]
}

/**
 * 一条通用排障收集器（`GeneralTroubleInfoCollector` 的方法面：`getTitle()` + `collectInfo(project)`）。
 * 上游把它显示在「General」段；本仓把每段拼成 `=== <Title> ===\n<info>\n\n`。
 */
export interface GeneralTroubleInfoCollectorContribution {
  id: string
  /** `GeneralTroubleInfoCollector.getTitle()`。 */
  getTitle: () => string
  /** `GeneralTroubleInfoCollector.collectInfo(project)`（本仓 `project` = 工作区根字符串或 null）。 */
  collectInfo: (project: string | null) => string
}

/**
 * 一条项目级排障收集器（`TroubleInfoCollector.collectInfo(project)`）。
 * 上游用 `toString()` 做标题呈现（`TroubleInfoCollector.java:14` 的类注释）；本仓给 `label()`。
 */
export interface TroubleInfoCollectorContribution {
  id: string
  /** `TroubleInfoCollector.collectInfo(project)`。 */
  collectInfo: (project: string | null) => string
  /** `toString()` 的等价物（段落标题）。 */
  label?: () => string
}

/** 三条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareDiagnosticsExtensionPoints(): void {
  for (const [id, name] of [
    [SPECIAL_PATHS_PROVIDER_EP, '特殊目录提供者'],
    [GENERAL_TROUBLE_INFO_COLLECTOR_EP, '通用排障信息收集器'],
    [TROUBLE_INFO_COLLECTOR_EP, '项目排障信息收集器'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareDiagnosticsExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖，与 `ExtensionPointHost.registerExtension` 同口径）。 */
export function registerDiagnosticsExtension<T>(
  extensionPoint: string,
  id: string,
  value: T,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterDiagnosticsExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

// ── 消费面 ───────────────────────────────────────────────────────────────────────────────

/** `SpecialPathsProvider.EP_NAME.getExtensionList()` 的等价物。 */
export function specialPathsProviders(scope: string = APPLICATION_SCOPE): SpecialPathsProviderContribution[] {
  return EXTENSIONS.extensionsOf<SpecialPathsProviderContribution>(SPECIAL_PATHS_PROVIDER_EP, scope)
}

/**
 * 全部提供者收上来的特殊目录（`BrowseSpecialPathsDialog` 展示的那张表）。
 * 去重按 `path`（大小写不敏感，Windows 语义）：先登记者赢、保持 EP 顺序。
 * 一个提供者抛错不吞掉别人的条目（第三方插件不能把整张表打空）。
 */
export function specialPathEntries(project: string | null = null, scope: string = APPLICATION_SCOPE): SpecialPathEntry[] {
  const out: SpecialPathEntry[] = []
  const seen = new Set<string>()
  for (const provider of specialPathsProviders(scope)) {
    let entries: readonly SpecialPathEntry[]
    try {
      entries = provider.collectPaths(project)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry || !entry.path) continue
      const key = entry.path.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ name: entry.name || entry.path, path: entry.path, kind: entry.kind === 'file' ? 'file' : 'folder' })
    }
  }
  return out
}

/** `GeneralTroubleInfoCollector.EP_SETTINGS.getExtensionList()` 的等价物。 */
export function generalTroubleInfoCollectors(scope: string = APPLICATION_SCOPE): GeneralTroubleInfoCollectorContribution[] {
  return EXTENSIONS.extensionsOf<GeneralTroubleInfoCollectorContribution>(GENERAL_TROUBLE_INFO_COLLECTOR_EP, scope)
}

/** `TroubleInfoCollector.EP_SETTINGS.getExtensionList()` 的等价物。 */
export function troubleInfoCollectors(scope: string = APPLICATION_SCOPE): TroubleInfoCollectorContribution[] {
  return EXTENSIONS.extensionsOf<TroubleInfoCollectorContribution>(TROUBLE_INFO_COLLECTOR_EP, scope)
}

/** 一段排障文本（标题 + 正文），空段在拼接时跳过。 */
export interface TroubleInfoSection {
  title: string
  info: string
}

/**
 * 按上游 `CompositeGeneralTroubleInfoCollector` 的顺序收集全部通用收集器的段落
 * （`getTitle()` 作标题、`collectInfo(project)` 作正文，trim 后为空即跳过）。
 */
export function generalTroubleInfoSections(project: string | null = null, scope: string = APPLICATION_SCOPE): TroubleInfoSection[] {
  const sections: TroubleInfoSection[] = []
  for (const collector of generalTroubleInfoCollectors(scope)) {
    let info = ''
    try {
      info = String(collector.collectInfo(project) ?? '').trim()
    } catch {
      continue
    }
    if (!info) continue
    sections.push({ title: safeTitle(collector), info })
  }
  return sections
}

/** 项目级收集器的段落（`TroubleInfoCollector` 一族，上游没有内置实现）。 */
export function projectTroubleInfoSections(project: string | null = null, scope: string = APPLICATION_SCOPE): TroubleInfoSection[] {
  const sections: TroubleInfoSection[] = []
  for (const collector of troubleInfoCollectors(scope)) {
    let info = ''
    try {
      info = String(collector.collectInfo(project) ?? '').trim()
    } catch {
      continue
    }
    if (!info) continue
    sections.push({ title: typeof collector.label === 'function' ? collector.label() : collector.id, info })
  }
  return sections
}

/** `CompositeGeneralTroubleInfoCollector.collectInfo` 的拼接格式：`=== <Title> ===\n<info>\n\n`。 */
export function compositeTroubleshootingReport(sections: readonly TroubleInfoSection[]): string {
  let report = ''
  for (const section of sections) {
    const info = section.info.trim()
    if (!info) continue
    report += `=== ${section.title} ===\n${info}\n\n`
  }
  return report.trimEnd()
}

/**
 * 一段完整的排障文本：通用收集器段 + 项目收集器段（上游对话框把两者分节显示，本仓顺次拼接）。
 * 没有可用数据时回空串。
 */
export function troubleshootingReportFromExtensions(
  project: string | null = null,
  scope: string = APPLICATION_SCOPE,
): string {
  return compositeTroubleshootingReport([...generalTroubleInfoSections(project, scope), ...projectTroubleInfoSections(project, scope)])
}

function safeTitle(collector: GeneralTroubleInfoCollectorContribution): string {
  try {
    const title = collector.getTitle()
    return title ? String(title) : collector.id
  } catch {
    return collector.id
  }
}

// ── bundled：把本仓在跑的那几张表作为贡献登记进来（消费侧调用，重复调用只覆盖同 id） ──────────

/**
 * 登记本仓的**应用级**特殊目录提供者（上游 `ApplicationSpecialPathsProvider` 的等价物）。
 * 宿主侧的特殊目录（系统/配置/Bin/日志…）由 `native/diagnostics.cpp` 的 `app.specialPaths` 给出，
 * 前端把已取回的那张表交进来；第三方的提供者按同一 EP 挂即可一起出现在对话框里。
 */
export function installBundledSpecialPathsProvider(
  entries: () => readonly SpecialPathEntry[],
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDiagnosticsExtension(SPECIAL_PATHS_PROVIDER_EP, 'taocode.applicationSpecialPaths', {
    id: 'taocode.applicationSpecialPaths',
    collectPaths: () => {
      try {
        return entries()
      } catch {
        return []
      }
    },
  }, { source: 'bundled', ...options })
}

/**
 * 登记本仓的**项目级**特殊目录提供者（上游 `ProjectSpecialPathsProvider` 的等价物：
 * `PROJECT BasePath` 一条）。没有打开工作区时返回空表。
 */
export function installBundledProjectSpecialPathsProvider(
  projectRoot: () => string | null,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDiagnosticsExtension(SPECIAL_PATHS_PROVIDER_EP, 'taocode.projectSpecialPaths', {
    id: 'taocode.projectSpecialPaths',
    collectPaths: () => {
      const root = projectRoot()
      return root ? [{ name: 'PROJECT BasePath', path: root, kind: 'folder' as const }] : []
    },
  }, { source: 'bundled', ...options })
}

/**
 * 把本仓写死的五条通用收集器（`src/troubleshootingCollectors.ts` 的
 * `createGeneralTroubleInfoCollectors`）登记成 bundled `GeneralTroubleInfoCollector` 贡献。
 * 贡献 id 用上游同名实现的短名（`AboutTroubleInfoCollector` → `About`…），于是「内置的那几条」
 * 在 EP 里看得见，第三方按同一 EP 挂的收集器会被 `generalTroubleInfoSections` 一并收上。
 */
export function installBundledGeneralTroubleInfoCollectors(
  collectors: () => readonly { title: string; collectInfo: () => string }[],
  options: RegisterExtensionOptions = {},
): ExtensionHandle[] {
  return collectors().map(collector => registerDiagnosticsExtension(
    GENERAL_TROUBLE_INFO_COLLECTOR_EP,
    `taocode.${collector.title || 'collector'}`,
    {
      id: `taocode.${collector.title || 'collector'}`,
      getTitle: () => collector.title,
      collectInfo: () => collector.collectInfo(),
    },
    { source: 'bundled', ...options },
  ))
}

/** 注销全部 bundled 通用收集器（id 前缀匹配，供测试与热重载用）。 */
export function uninstallBundledGeneralTroubleInfoCollectors(): number {
  let removed = 0
  for (const contribution of generalTroubleInfoCollectors()) {
    if (contribution.id.startsWith('taocode.')) removed += unregisterDiagnosticsExtension(GENERAL_TROUBLE_INFO_COLLECTOR_EP, contribution.id) ? 1 : 0
  }
  return removed
}

/** 登记一条第三方/内建项目级收集器。 */
export function registerTroubleInfoCollector(
  contribution: TroubleInfoCollectorContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDiagnosticsExtension(TROUBLE_INFO_COLLECTOR_EP, contribution.id, contribution, options)
}
