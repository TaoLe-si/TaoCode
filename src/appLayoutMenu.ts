// 「窗口 › 布局」子菜单的行构造（App.vue 的 `layoutMenuRows` computed 主体，2026-10-06 逐字搬入）。
//
// 为什么能搬：这一段是 `(布局档 + 六个动作) => MenuRow[]`。它读的是传进来的
// `ToolLayoutStore` 快照与回调，自己不碰 ref、不碰 DOM、不发宿主请求；
// 「哪个档是当前布局」由调用方在 `computed` 里重新取值，因此行上的 `checked` 闭包语义不变。
//
// 上游坐标（随注释一起搬，未改）：
//   · IDEA 的 Window › LayoutsGroup 是一个**子菜单**（`<group id="LayoutsGroup" popup="true">`，
//     PlatformActions.xml:641）：出厂默认 · 命名布局列表（每项是 toggle，点即应用）· 分隔 ·
//     RestoreDefaultLayout(Shift+F12) · StoreDefaultLayout · StoreNewLayout。
//   · CustomLayoutActionGroup 每个布局名下的 Apply/Restore/Save/Rename/Delete 子菜单在本仓收敛为
//     「当前布局的重命名/删除」加两条全局 Store —— 这是一张菜单能表达的部分中不发明第二种点击含义的做法。
import type { MenuRow } from './menus/types.ts'
import { isFactoryLayoutActive, layoutNames, type ToolLayoutStore } from './toolLayout.ts'

/** 布局子菜单要调用的六个动作（装配根提供，本模块只负责"长什么样"）。 */
export type LayoutMenuActions = {
  useFactoryToolLayout: () => void
  applyNamedToolLayout: (name: string) => void
  restoreCurrentToolLayout: () => void
  storeCurrentToolLayout: () => void
  openLayoutNameDialog: (mode: 'newLayout' | 'renameLayout') => void
  deleteCurrentToolLayout: () => void
}

/** 命名布局组的全部行；返回值仍是一条带 `children` 的父行（`window.layouts`）。 */
export function createLayoutMenuRows(store: ToolLayoutStore, actions: LayoutMenuActions): MenuRow[] {
  const children: MenuRow[] = [
    { id: 'window.factoryLayout', title: '默认布局', keywords: 'default tool window layout factory reset 默认布局 出厂', checked: () => isFactoryLayoutActive(store), run: actions.useFactoryToolLayout },
    { id: 'window.ruleLayoutsList', rule: true },
  ]
  for (const name of layoutNames(store))
    children.push({ id: `window.layout.${name}`, title: name, keywords: `tool window layout ${name} 布局`, checked: () => store.active === name, run: () => actions.applyNamedToolLayout(name) })
  children.push({ id: 'window.ruleLayoutsActions', rule: true })
  children.push({ id: 'window.restoreLayout', title: '恢复当前布局', keys: 'Shift F12', keywords: 'restore current layout reset 恢复布局 重置', run: actions.restoreCurrentToolLayout })
  children.push({ id: 'window.storeLayout', title: '将更改保存到当前布局', keywords: 'save changes in current layout 保存布局', run: actions.storeCurrentToolLayout })
  children.push({ id: 'window.storeLayoutAs', title: '将当前布局另存为新布局…', keywords: 'save current layout as new 另存为 新建布局', run: () => actions.openLayoutNameDialog('newLayout') })
  // Rename/Delete only exist for a stored layout: the factory default is not an entry in the map,
  // which is also why `DeleteNamedLayoutAction` disables itself on the active layout.
  if (!isFactoryLayoutActive(store)) {
    children.push({ id: 'window.renameLayout', title: '重命名当前布局…', keywords: 'rename layout 重命名布局', run: () => actions.openLayoutNameDialog('renameLayout') })
    children.push({ id: 'window.deleteLayout', title: '删除当前布局', keywords: 'delete layout remove 删除布局', run: actions.deleteCurrentToolLayout })
  }
  return [{ id: 'window.layouts', title: '布局', keywords: 'layouts tool window layout 布局', children }]
}
