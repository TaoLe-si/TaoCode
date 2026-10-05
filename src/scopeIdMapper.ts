// 作用域的「序列化 id ↔ 显示名」映射 —— 上游
// `platform/ide-core/src/com/intellij/ide/util/scopeChooser/ScopeIdMapper.kt:15-47`
// （抽象类 + 十个硬编码 id）与 `ScopeIdMapperImpl.kt:16-42`（id ⇄ presentable name 两向 switch）。
//
// 上游为什么需要它（`ScopeIdMapper.kt:8-13` 的类注释原文）：历史上 IDE 拿**显示名**做序列化，
// 而显示名随语言环境变（中文包和英文包不一样），所以序列化必须用稳定的 id，显示时才过一层映射。
// **本仓同一个坑**：依赖规则与分析范围都持久化"作用域"，存名字就会在换语言时把存档打散，
// 所以这里也存 id、显示时映射 —— 这就是判词里"`ScopeIdMapper` 的 scope→id 映射（本仓直接存模式文本）"
// 那一条缺口在本仓的落点。
//
// id 常量逐条照 `ScopeIdMapper.kt:22-31`；显示名取本机 IDEA 2026.2 中文包
// （`localization-zh.jar` 里解出的 properties，每条在后面注明 key）：
//   · `All Places`                     —— CoreBundle `scope.name.all.places` = 所有位置
//   · `Project Files`                  —— CoreBundle `psi.search.scope.project` = 项目文件
//   · `Project Production Files`       —— AnalysisBundle `psi.search.scope.production.files` = 项目生产文件
//   · `Project Test Files`             —— AnalysisBundle `psi.search.scope.test.files` = 项目测试文件
//   · `Recently Viewed Files`          —— IdeBundle `scope.recent.files` = 最近查看的文件
//   · `Recently Changed Files`         —— IdeBundle `scope.recent.modified.files` = 最近更改的文件
//   · `Current File`                   —— IdeBundle `scope.current.file` = 当前文件
//   · `Tests`（包依赖 provider 用的那一档）—— AnalysisBundle `tests.scope.name` = 测试
//   · `Generated Files`                —— AnalysisBundle `generated.files.scope.name` = 生成的文件
//   · `All`                            —— AnalysisBundle `all.scope.name` = 全部
// `Project and Libraries` 与 `Scratches and Consoles` 两档本仓没有对应实体
// （单根工作区、库不参与依赖规则；本仓没有 Scratches），故**不进映射表**：
// 上游 `ScopeIdMapperImpl.kt:27` 对没命中的 id 就是原样返回 id，本仓的 `scopePresentableName`
// 同样退回 id 本身，行为一致。

/** `ScopeIdMapper.kt:22`。 */
export const ALL_PLACES_SCOPE_ID = 'All Places'
/** `ScopeIdMapper.kt:23`（本仓没有库作用域，不进映射表，见文件头）。 */
export const PROJECT_AND_LIBRARIES_SCOPE_ID = 'Project and Libraries'
/** `ScopeIdMapper.kt:24`。 */
export const PROJECT_FILES_SCOPE_ID = 'Project Files'
/** `ScopeIdMapper.kt:25`。 */
export const PROJECT_PRODUCTION_FILES_SCOPE_ID = 'Project Production Files'
/** `ScopeIdMapper.kt:26`。 */
export const PROJECT_TEST_FILES_SCOPE_ID = 'Project Test Files'
/** `ScopeIdMapper.kt:27`（本仓没有 Scratches，不进映射表）。 */
export const SCRATCHES_AND_CONSOLES_SCOPE_ID = 'Scratches and Consoles'
/** `ScopeIdMapper.kt:28`。 */
export const RECENTLY_VIEWED_FILES_SCOPE_ID = 'Recently Viewed Files'
/** `ScopeIdMapper.kt:29`。 */
export const RECENTLY_CHANGED_FILES_SCOPE_ID = 'Recently Changed Files'
/** `ScopeIdMapper.kt:30`（本仓没有"编辑器打开的文件"这一档作用域，不进映射表）。 */
export const OPEN_FILES_SCOPE_ID = 'Open Files'
/** `ScopeIdMapper.kt:31`。 */
export const CURRENT_FILE_SCOPE_ID = 'Current File'

/** `ScopeIdMapper.kt:37-41` 的 `standardNames`，去掉本仓没有对应实体的三档（见文件头）。 */
export const STANDARD_SCOPE_IDS: readonly string[] = [
  ALL_PLACES_SCOPE_ID, PROJECT_FILES_SCOPE_ID, PROJECT_PRODUCTION_FILES_SCOPE_ID, PROJECT_TEST_FILES_SCOPE_ID,
  RECENTLY_VIEWED_FILES_SCOPE_ID, RECENTLY_CHANGED_FILES_SCOPE_ID, CURRENT_FILE_SCOPE_ID,
  // 下面两个不是 `standardNames` 里的，而是包依赖那三个 provider 的 scope id
  // （`TestsScope.java:18` 的 `NAME = "Tests"`、`GeneratedFilesScope.java:15` 的 `ID = "Generated Files"`、
  //  `DefaultScopesProvider.java:29` 的 `getAllScope()`）。依赖规则和"分析依赖"要用它们。
  'Tests', 'Generated Files', 'All',
]

/** id → 中文显示名（未收录的 id 原样返回，同 `ScopeIdMapperImpl.kt:27`）。 */
const PRESENTABLE: ReadonlyMap<string, string> = new Map<string, string>([
  [ALL_PLACES_SCOPE_ID, '所有位置'],
  [PROJECT_FILES_SCOPE_ID, '项目文件'],
  [PROJECT_PRODUCTION_FILES_SCOPE_ID, '项目生产文件'],
  [PROJECT_TEST_FILES_SCOPE_ID, '项目测试文件'],
  [RECENTLY_VIEWED_FILES_SCOPE_ID, '最近查看的文件'],
  [RECENTLY_CHANGED_FILES_SCOPE_ID, '最近更改的文件'],
  [CURRENT_FILE_SCOPE_ID, '当前文件'],
  ['Tests', '测试'],
  ['Generated Files', '生成的文件'],
  ['All', '全部'],
])

/** `ScopeIdMapperImpl.getPresentableScopeName`（`:16-28`）。 */
export function scopePresentableName(scopeId: string): string {
  return PRESENTABLE.get(scopeId) ?? scopeId
}

/**
 * `ScopeIdMapperImpl.getScopeSerializationId`（`:30-42`）：显示名 → 序列化 id。
 * 命中不到就原样返回（上游同一条 `else -> presentableScopeName`）。
 * 同一档有两个中文名的（`Project Files` 与 `ProjectProduction`… 不存在这种重合），按映射表反查即可；
 * 名字与 id 相同时（未收录档）返回的就是那个 id。
 */
export function scopeSerializationId(presentableName: string): string {
  for (const [id, name] of PRESENTABLE) if (name === presentableName) return id
  return presentableName
}

/** 这个 id 是不是本仓认识的稳定序列化 id（上游 `standardNames` 的同一用途）。 */
export function isStandardScopeId(scopeId: string): boolean {
  return STANDARD_SCOPE_IDS.includes(scopeId)
}

/**
 * 「分析依赖」/「依赖规则」给出的那一档标准范围（上游包依赖的三个 `CustomScopesProvider`：
 * `DefaultScopesProvider.java:28-31`（ProjectFiles/All/NonProjectFiles/Scratches）、
 * `TestScopeProvider.java:24`（Tests）、`GeneratedFilesScopeProvider.java:18`（Generated Files））。
 * `NonProjectFiles` 与 `Scratches` 本仓没有对应实体，不列 —— 列出来永远是空集就是假控件。
 * `matching` 那一档接到 `src/packageDepsView.ts` 的路径分类（本仓没有 PSI 源根，见那边的文件头）。
 */
export type StandardDependencyScope = 'Project Files' | 'Project Test Files' | 'Generated Files' | 'All'

export interface DependencyScopeOption {
  /** 序列化用的稳定 id（存进存档的就是它，不是显示名）。 */
  id: StandardDependencyScope
  /** 界面文案（`scopePresentableName` 的结果，逐条对得上中文包）。 */
  title: string
  /** 这一档在**上游**是谁（给用户/验收看的说明，不渲染成按钮）。 */
  description: string
}

export const DEPENDENCY_SCOPE_OPTIONS: readonly DependencyScopeOption[] = [
  { id: 'Project Files', title: scopePresentableName(PROJECT_FILES_SCOPE_ID), description: '上游 ProjectFilesScope（`ProjectFilesScope.java:24-31`：内容根里的文件）' },
  { id: 'Project Test Files', title: scopePresentableName(PROJECT_TEST_FILES_SCOPE_ID), description: '上游 TestsScope（`TestsScope.java:24-26`：`TestSourcesFilter.isTestSources`）' },
  { id: 'Generated Files', title: scopePresentableName('Generated Files'), description: '上游 GeneratedFilesScope（`GeneratedFilesScope.java:20-24`）' },
  { id: 'All', title: scopePresentableName('All'), description: '上游 AllScope（`DefaultScopesProvider.java:29` 的 `getAllScope()`）' },
]
