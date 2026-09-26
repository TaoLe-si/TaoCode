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
  title?: string | (() => string)
  keywords?: string
  keys?: string
  section?: string
  rule?: boolean
  recent?: boolean
  enabled?: () => boolean
  checked?: () => boolean
  run?: () => void
}
