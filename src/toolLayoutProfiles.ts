// 工具窗口**布局档案** —— IDEA `ToolWindowLayoutProfileProvider` + `ProjectFrameToolWindowLayoutService`
// 那一层在本仓的等价物。
//
// 上游两件事（`platform/platform-impl/src/com/intellij/toolWindow/`）：
//   1. `ToolWindowLayoutProfileProvider.kt`：为一个**项目框架档案**（`profileId`）解析一套布局，
//      用于"这个项目还没有存过自己的布局时"给窗口上种（seed）。它带两个开关 ——
//      `getApplyMode()`（`ToolWindowLayoutApplyMode.SEED_ONLY` / `FORCE_ONCE`）与 `getMigrationVersion()`：
//        · `SEED_ONLY`：**只有**项目还没存过布局时才应用；
//        · `FORCE_ONCE`：存档里的迁移版本比档案的小，就**强推一次**（然后写上版本号，此后不再推）。
//   2. `ProjectFrameToolWindowLayoutService.getProfile()`：把 EP 上那棵
//      `ProjectFrameToolWindowLayoutBean`（`applyMode` / `migrationVersion` + 每个窗口一组可空属性
//      `anchor`/`visible`/`showStripeButton`/`weight`/`contentUiType`/`split`/`sideWeight`，还有
//      `register=false` 表示这个档案里**不注册**这个窗口）叠在**出厂默认布局**上
//      （`createLayout()` 先 `ToolWindowDefaultLayoutManager.getLayoutCopy()` 再逐窗口覆盖）。
//
// 本仓的等价物就是下面这个纯函数：`profile.layout` 是"与出厂默认不同的那些覆盖"，
// `resolveProjectLayout()` 回答"这个项目该用哪一套、要不要落盘、要不要写迁移版本"。
// 它刻意**不碰存储**：读写由 `src/toolWindowStripes.ts`（项目级键）负责，判据直接跑这个纯函数。
//
// 本仓目前的档案只有一个（`default`）：出厂默认布局本身。上游是按产品/框架各注册一份
// （`com.intellij.projectFrameToolWindowLayout` 扩展点）。本仓没有 EP（没有插件运行时），
// 所以将来"某个框架一套默认布局"就是往 `PROJECT_FRAME_PROFILES` 里加一条 ——
// 这也是 §C 第 10 条剩下的那一半（登记在 docs/source-todo.md §13）。
import type { ToolWindowId, ToolWindowAnchor } from './toolWindowMeta.ts'
import { resolveContentUiType, type ToolWindowContentUiType } from './toolWindowContentUi.ts'

/** `ToolWindowLayoutApplyMode`（`ToolWindowLayoutProfileProvider.kt:36-46`）。 */
export type ToolWindowLayoutApplyMode = 'seedOnly' | 'forceOnce'

/**
 * 一个工具窗口在布局里的状态 —— IDEA `WindowInfoImpl`（`openapi/wm/impl/WindowInfoImpl.kt`）在本仓的那几个字段。
 * 上游字段面与默认值（`:34-105`）：`anchor` = LEFT、`isVisible` = false、`isShowStripeButton` = true、
 * `weight` = 0.33、`sideWeight` = 0.5、`isSplit` = false、`contentUiType` = TABBED、`order` = -1。
 *
 * 本仓能兑现的（只写这几个，别的登记在 `docs/source-todo.md` §15）：
 *   · `anchor` / `order` —— 停靠边与条纹次序（`src/toolWindowStripes.ts` 的两张运行时表由它派生）；
 *   · `showStripeButton` —— 上游同名字段（`RemoveStripeButtonAction` 把它置 false，本仓的"从侧栏移除"）；
 *   · `contentUiType` —— 内容条是标签还是下拉（`src/toolWindowContentUi.ts`）；
 *   · `visible` —— 每窗口可见性 + 打开项目时恢复（`ToolWindowSetInitializer` 那一半）；
 *   · `type` / `autoHide` —— 视图模式的两个自由度（2026-10-06 第八桶：`src/toolWindowViewMode.ts`）；
 *   · `split` —— `WindowInfoImpl.isSplit`（`:91-92`，XML 属性名 `side_tool`，默认 false）：这一位是
 *     「条纹上的**后半组**（side tool）」，初值来自 EP 的 `secondary`（`DesktopLayout.kt:46`），
 *     用户把按钮拖过分隔线时由 `setSideToolAndAnchor`（`AbstractDroppableStripe.kt:255`）改写。
 *     读写法在 `src/toolWindowStripes.ts` 的 `isSplitOf`/`setSideTool`。
 * 没兑现的：`weight`/`sideWeight`
 * （本仓的"每个窗口各自尺寸"是另一条路：`panelResize.ts` 的 `rememberSizeForEachToolWindow`，
 * 存的也是像素而不是权重 —— 判词 §B-5 那条差异）。
 */
export interface WindowInfo {
  anchor?: ToolWindowAnchor
  /** `WindowInfoImpl.order`（默认 -1 = 还没排过）。 */
  order?: number
  /** `isShowStripeButton`（默认 true）。 */
  showStripeButton?: boolean
  /** `contentUiType`（默认 TABBED）。 */
  contentUiType?: ToolWindowContentUiType
  /**
   * `WindowInfoImpl.isVisible`（默认 **false**）：这个窗口此刻是不是展开的。
   * 打开项目时按它恢复"上次开着的那几个窗口"（上游 `ToolWindowSetInitializer` 装配时读的就是这个字段）。
   */
  visible?: boolean
  /**
   * `WindowInfoImpl.type`（`:74`，默认 DOCKED）：停靠 / 浮动 / 滑动 / 独立窗口。
   * XML 里没有 `@Attribute` ⇒ 属性名就是字段名 `type`。
   */
  type?: ToolWindowType
  /** `WindowInfoImpl.isAutoHide`（`:46-47`，默认 false，XML 属性名 `auto_hide`）。 */
  autoHide?: boolean
  /**
   * `WindowInfoImpl.isSplit`（`:91-92`，默认 false，XML 属性名 `side_tool`）：条纹上的后半组。
   * 本仓的属性名沿用字段名 `split`（我们的存档是自己的 JSON，不是 `<window_info>`）。
   * **只有显式写过才是"用户拖过"**：没写 = 这一位由注册表的 EP `secondary` 定初值
   * （`DesktopLayout.kt:46` 的 `info.isSplit = task.sideTool`）。
   */
  split?: boolean
  /**
   * `WindowInfoImpl.floatingBounds`（`:49-53`）：「浮动」那一档下窗口的矩形。
   * 上游那条 `skipNullWhenLoading` 的谓词把"全 0 矩形"也当成没存过（`:53`），
   * 读法在 `src/toolWindowViewMode.ts` 的 `floatingBoundsStored`。
   */
  floatingBounds?: { x: number; y: number; width: number; height: number } | null
}

/**
 * `WindowInfo.type` / `WindowInfo.isAutoHide` 在本仓的形状（`src/toolWindowViewMode.ts` 的
 * `WindowTypeState`：视图模式 = 这两个自由度的函数）。这里重复声明一遍是为了
 * **不让 profiles 模块去 import 视图模式模块**（那条 import 会绕回 toolWindowContentUi，
 * 一个键的读法不该有环）。
 */
export type ToolWindowType = 'docked' | 'floating' | 'sliding' | 'windowed'

/** 上游默认值里本仓会用到的那几个（`anchor`/`order` 的默认在注册表与顺序表里）。 */
export const WINDOW_INFO_DEFAULTS = { showStripeButton: true, contentUiType: 'tabbed', visible: false } as const

/** 空记录（"这个窗口在布局里还没有任何显式状态"）。 */
export function windowInfoOf(layout: StoredProjectLayout | null, id: string): WindowInfo {
  return layout?.windows?.[id] ?? {}
}

/** `WindowInfoImpl.isShowStripeButton` 的默认值 true ⇒ 只有显式 false 才是"摘掉了"。 */
export function stripeButtonShown(info: WindowInfo): boolean {
  return info.showStripeButton !== false
}

/** `WindowInfoImpl.contentUiType`：没写就是 TABBED（`resolveContentUiType` 也兜底到它）。 */
export function contentUiTypeOf(info: WindowInfo): ToolWindowContentUiType {
  return resolveContentUiType(info.contentUiType)
}

/** `WindowInfoImpl.isVisible`：没写就是 false（**只有显式 true 才算"这个窗口开着"**）。 */
export function windowVisible(info: WindowInfo): boolean {
  return info.visible === true
}

/**
 * `WindowInfoImpl.type` 的默认值是 DOCKED（`:74` 的 `by enum(ToolWindowType.DOCKED)`）。
 * 坏值不猜：认不出来就当 DOCKED（与 `resolveContentUiType` 同一条口径）。
 */
export function toolWindowTypeOf(info: WindowInfo): ToolWindowType {
  return info.type === 'floating' || info.type === 'sliding' || info.type === 'windowed' ? info.type : 'docked'
}

/** `WindowInfoImpl.isAutoHide`：只有显式 true 才算开（默认 false，`:46-47`）。 */
export function autoHideOf(info: WindowInfo): boolean {
  return info.autoHide === true
}

/** 视图模式的两个自由度合起来读（`ToolWindowViewModeAction.ViewMode.fromWindowInfo` 的输入）。 */
export function windowTypeStateOf(info: WindowInfo): { type: ToolWindowType; autoHide: boolean } {
  return { type: toolWindowTypeOf(info), autoHide: autoHideOf(info) }
}

/** `WindowInfoImpl.floatingBounds`：没存过 / 存成全 0 ⇒ null（`:53` 那条谓词）。 */
export function floatingBoundsOf(info: WindowInfo): { x: number; y: number; width: number; height: number } | null {
  const raw = info.floatingBounds
  if (!raw || typeof raw !== 'object') return null
  const { x, y, width, height } = raw
  if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) return null
  if (width === 0 && height === 0 && x === 0 && y === 0) return null
  return { x, y, width, height }
}

/**
 * 存档里**显式**写过可见性的那些窗口（`visible` 字段出现过）。
 * "有没有显式写过"决定打开项目时要不要恢复：没写过（新项目/刚播种）就不动宿主的默认。
 */
export function hasExplicitVisibility(layout: StoredProjectLayout | null): boolean {
  return Object.values(layout?.windows ?? {}).some(info => typeof info.visible === 'boolean')
}

/** 存档里显式标为可见的那些窗口 id（按存档顺序）。 */
export function visibleWindowIds(layout: StoredProjectLayout | null): string[] {
  return Object.entries(layout?.windows ?? {}).filter(([, info]) => windowVisible(info)).map(([id]) => id)
}

/** 写一个窗口的一段状态（不改原对象）。 */
export function withWindowInfo(layout: StoredProjectLayout, id: string, patch: WindowInfo): StoredProjectLayout {
  return { ...layout, windows: { ...layout.windows, [id]: { ...windowInfoOf(layout, id), ...patch } } }
}

/** 一个窗口在档案里的覆盖项 —— 与 `WindowInfo` 同一形状（含 `visible`），没写的就沿用出厂默认。 */
export interface ProfileWindowOverride extends WindowInfo {
  /** `showStripeButton = false`：这个档案里不注册这个窗口（`createLayout` 里 `infos.remove(id)`）。 */
  hidden?: boolean
}

/** 布局档案（上游 `ProjectFrameToolWindowLayoutBean` + `ToolWindowLayoutProfile` 的合体）。 */
export interface ProjectFrameProfile {
  /** EP 的 `id`（`ProjectFrameToolWindowLayoutBean.id`）——「哪个框架用哪套」。 */
  id: string
  applyMode: ToolWindowLayoutApplyMode
  /** 迁移版本（`migrationVersion`）：`FORCE_ONCE` 拿它跟存档里的比。 */
  migrationVersion: number
  /** 与**出厂默认**不同的那些覆盖；空表 = 就是出厂默认。 */
  windows?: Partial<Record<ToolWindowId, ProfileWindowOverride>>
}

/**
 * 本仓唯一的档案：出厂默认布局。上游的 `defaultToolWindowlayoutProvider.kt:244-281` 给的 V1/V2 默认
 * 已经落在 `src/toolWindowMeta.ts` 的注册表里（`anchor` 字段），所以这里不需要覆盖任何窗口。
 *
 * `applyMode` 取上游 bean 的**默认值** `SEED_ONLY`（`ProjectFrameToolWindowLayoutBean.applyMode`
 * 的默认就是它）：项目存过布局就不再动它。
 */
export const DEFAULT_PROJECT_FRAME_PROFILE: ProjectFrameProfile = {
  id: 'default',
  applyMode: 'seedOnly',
  migrationVersion: 0,
}

/** 已归档的档案表（本仓目前只有 default；加一条 = 支持一个框架的默认布局）。 */
export const PROJECT_FRAME_PROFILES: readonly ProjectFrameProfile[] = [DEFAULT_PROJECT_FRAME_PROFILE]

export function projectFrameProfile(id: string): ProjectFrameProfile | undefined {
  return PROJECT_FRAME_PROFILES.find(profile => profile.id === id)
}

/**
 * 项目里存过的那套布局（键是项目根）：**按窗口一条记录**（上游 `ToolWindowManagerState` 存的就是
 * 一串 `<window_info>`，每个窗口一条），不再是"锚点表 / 顺序表 / 隐藏集"三张投影。
 */
export interface StoredProjectLayout {
  windows: Record<string, WindowInfo>
}

/** 旧版的**机器级**布局（改版前 `taocode.toolAnchors` 那一套）。只在迁移那一次被采纳。 */
export type LegacyMachineLayout = StoredProjectLayout

export interface ResolveLayoutInput {
  /** 厂默认 + 这个项目自己的存档（存档缺失/坏值都当成"没存过"）。 */
  stored: StoredProjectLayout | null
  /**
   * 这个档案**强推（FORCE_ONCE）做到哪一版了**：上游存在应用级 `PropertiesComponent` 的
   * `toolwindow.layout.profile.migration.<profileId>` 里（`ToolWindowLayoutProfileMigrationHelper.kt:13/57-63`），
   * 语义是"该档案已应用的迁移版本"，不是项目级的。
   */
  appliedVersion: number
  /**
   * 旧版的机器级布局 + 那条**本仓特有的**迁移是否已做过。
   * 上游没有"机器级布局"这个东西（它一开始就是 per-project 的）——这是本仓改存储形状时的一次性迁移：
   * 做完置标记，别把用户现有的布局悄悄丢掉，也别把它复制到之后每个项目上。
   */
  legacy: { layout: LegacyMachineLayout | null; alreadyMigrated: boolean }
  profile?: ProjectFrameProfile
}

export interface ResolveLayoutResult {
  /** 这次给窗口用哪一套（`anchors`/`order`/`hidden` 由调用方叠到出厂默认上）。 */
  layout: StoredProjectLayout
  /** 该不该落盘（`SEED_ONLY` 命中、`FORCE_ONCE` 命中、或迁移命中时为真）。 */
  persist: boolean
  /** 旧版机器级布局这次被采纳了（调用方要置那条本仓特有的迁移标记）。 */
  migrated: boolean
  /** 强推之后要把这个版本写进迁移标记；不写就是 null（上游只有 FORCE_ONCE 那条路会写）。 */
  writeAppliedVersion: number | null
  /** 为什么这么判（判据与真 exe 取证都直接看它）。 */
  reason: 'stored' | 'forced-profile' | 'seeded-profile' | 'legacy-migration'
}

/**
 * 上游 `ToolWindowLayoutProfileProviderService.getProfile()` + `ToolWindowLayoutApplyMode` 的判定：
 *
 * | 情况 | 结果 |
 * |---|---|
 * | 项目存过布局，且版本 ≥ 档案版本 | 用存的那套，**不**落盘（`stored`） |
 * | 项目存过布局，但版本 < 档案版本且 `applyMode = FORCE_ONCE` | 强推档案，落盘并写新版本（`forced-profile`） |
 * | 项目没存过布局，旧版机器级布局还在且没迁过 | 采纳旧版机器级布局（一次性），落盘 + 置迁移标记（`legacy-migration`） |
 * | 项目没存过布局（其余） | 用档案（= 出厂默认 + 覆盖），落盘并写版本（`seeded-profile`） |
 */
export function resolveProjectLayout(input: ResolveLayoutInput): ResolveLayoutResult {
  const profile = input.profile ?? DEFAULT_PROJECT_FRAME_PROFILE
  const stored = input.stored
  const applied = Number.isFinite(input.appliedVersion) ? input.appliedVersion : 0
  // `SEED_ONLY`（上游默认）：项目存过布局就**不碰**它（`ToolWindowLayoutProfileProviderService` 的语义，
  // 也是 `applyProjectFrameLayoutPolicy` 里 `SEED_ONLY -> return` 那一支）。
  if (stored && profile.applyMode === 'seedOnly') {
    return { layout: stored, persist: false, migrated: false, writeAppliedVersion: null, reason: 'stored' }
  }
  // `FORCE_ONCE` + 迁移版本（上游 `ToolWindowLayoutProfileMigrationHelper.kt:52-70`）：
  // 已应用版本 ≥ 档案版本 ⇒ 什么都不做；否则**强推一次**并记下版本。
  if (profile.applyMode === 'forceOnce') {
    if (applied >= profile.migrationVersion) {
      return stored
        ? { layout: stored, persist: false, migrated: false, writeAppliedVersion: null, reason: 'stored' }
        : { layout: seededLayout(profile), persist: true, migrated: false, writeAppliedVersion: profile.migrationVersion, reason: 'seeded-profile' }
    }
    return { layout: seededLayout(profile), persist: true, migrated: false, writeAppliedVersion: profile.migrationVersion, reason: 'forced-profile' }
  }
  if (!input.legacy.alreadyMigrated && input.legacy.layout) {
    return { layout: input.legacy.layout, persist: true, migrated: true, writeAppliedVersion: null, reason: 'legacy-migration' }
  }
  return { layout: seededLayout(profile), persist: true, migrated: false, writeAppliedVersion: null, reason: 'seeded-profile' }
}

/** 档案的布局 = 出厂默认 + 覆盖（上游 `createLayout()` 的等价物）。 */
function seededLayout(profile: ProjectFrameProfile): StoredProjectLayout {
  const windows: Record<string, WindowInfo> = {}
  for (const [id, override] of Object.entries(profile.windows ?? {}) as Array<[ToolWindowId, ProfileWindowOverride]>) {
    const { hidden, ...info } = override
    if (hidden) info.showStripeButton = false
    windows[id] = info
  }
  // `order` 不写：顺序的出厂默认在注册表里（`DEFAULT_TOOL_ORDER`），调用方铺的时候会补齐。
  return { windows }
}

/**
 * 应用级迁移标记的键（上游 `TOOL_WINDOW_LAYOUT_MIGRATION_PROPERTY_PREFIX` +
 * `profileId`，`ToolWindowLayoutProfileMigrationHelper.kt:13`）。值 = 该档案已应用的迁移版本。
 */
export function layoutMigrationKey(profileId: string): string {
  return `taocode.toolLayoutMigration:${profileId}`
}
