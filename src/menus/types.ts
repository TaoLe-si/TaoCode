// IDEA 的菜单是一棵 ActionGroup 树（PlatformActions.xml），每个组是一个类。
// TaoCode 侧对应的行模型：MenuRow ≈ 一个 action / 一个 popup group。
// 这份类型原来长在 App.vue 里；拆分菜单相关模块后统一从这里引用。
export interface MenuRow {
  id: string
  // IDEA 的菜单是一棵 ActionGroup 树：`<group popup="true">` 打开的是**子菜单**
  // （PlatformActions.xml 里 LayoutsGroup / ViewAppearanceGroup / FindMenuGroup /
  //  FilePropertiesGroup / ExportImportGroup / Macros / HelpDiagnosticTools 等十几处）。
  // 这里用 children 表达同一层结构，而不是把子菜单的行拍平到父菜单里。
  children?: MenuRow[]
  // IDEA 的 ActionGroup 是**动态**的：`getChildren(null)` 每次打开菜单都能返回不同的行
  // （例如「已保存的宏」随用户新增宏而变化）。静态 `children` 表达不了这种情况 ——
  // 早先用「装配时按当前状态生成」绕过去，结果宏表一变菜单就不刷新。
  // 需要动态子菜单时用 `childrenOf`，渲染与扁平化都优先取它。
  childrenOf?: () => MenuRow[]
  title?: string | (() => string)
  keywords?: string
  keys?: string
  /**
   * 图标名（lucide 图标名口径，对应上游 `Presentation.getIcon()` 的槽位）。
   *
   * 数据侧：`src/actionRegistry.ts` 的 `ActionDescriptor.icon` 由 `actionRow()` 落到这里。
   * 渲染侧：**主菜单**已接（`src/App.vue:94` import `menuRowIcon`，`:2088`/`:2095`/`:2100` 三处
   * `<component :is="menuRowIcon(row.icon)">`），但「查找操作」面板的行模板（`src/menuUi.ts`）
   * 没有图标位（2026-10-08 订正：原注释整条写成「渲染层还没接」，与 App.vue 实况不符）。
   * 图标名取值必须来自 `src/uiIcons.ts` 的阶梯，不许在菜单里写死尺寸。
   */
  icon?: string
  section?: string
  rule?: boolean
  recent?: boolean
  enabled?: () => boolean
  checked?: () => boolean
  run?: () => void
}
