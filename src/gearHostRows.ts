// **齿轮组里那两条不在菜单索引的行** —— 上游对它们也是现造对象再 `group.add(...)`：
//   · `SpeedSearch`（`ToolWindowImpl.kt:869`）—— 它在 `PlatformActions.xml:146` 只是**顶层引用**
//     （只登记、不进任何菜单组），所以本仓不给它编菜单位置。
//   · `RemoveStripeButtonAction`（`ToolWindowImpl.kt:889`、`:914-925`）—— 私有 inner 类，也没进菜单。
// 两行都由宿主按各自的前置条件给：给不出就整行不出现，与"引用一个不存在的动作"同样处理。
import type { MenuRow } from './menus/types'

/** 能开速度搜索的那个列表（本仓是项目树）。 */
export interface SpeedSearchTarget {
  openSpeedSearch: () => void
}

/** `leftView === 'files'` 且项目树已挂上时才有这一行。 */
export function speedSearchGearRow(leftView: string, hasWorkspace: boolean,
                                   tree: SpeedSearchTarget | null | undefined): MenuRow | null {
  if (leftView !== 'files' || !hasWorkspace || !tree) return null
  return {
    id: 'window.speedSearch',
    title: '速度搜索',
    keys: 'Ctrl F',
    keywords: 'speed search filter 速度搜索',
    run: () => tree.openSpeedSearch(),
  }
}

/**
 * `RemoveStripeButtonAction` 那一行（`ToolWindowImpl.kt:889`、`:914-925`）。
 * 文案取自 `ActionsBundle.properties:1170-1171`（`Remove from Sidebar` /
 * `Remove the tool window button from the sidebar`），可见性 = 侧条上还有这个按钮
 * （`update`：`isEnabledAndVisible = isShowStripeButton`，`:918`）。
 * 它不在任何主菜单里 —— 上游那个类是 private inner，只被齿轮组 `group.add` 一次。
 */
export function removeStripeButtonGearRow(alreadyRemoved: boolean,
                                          remove: () => void): MenuRow | null {
  if (alreadyRemoved) return null
  return {
    id: 'window.removeStripeButton',
    title: '从侧栏移除',
    keywords: 'remove from sidebar stripe button 从侧栏移除',
    run: remove,
  }
}

/**
 * 齿轮组里那两行不在菜单索引的行合起来（宿主只调这一个）。
 * 参数都是**当前状态**而不是 ref：这个模块只管"给哪几行"，状态归 `toolWindowStripes.ts`。
 */
export function gearHostRows(leftView: string, hasWorkspace: boolean,
                              tree: SpeedSearchTarget | null | undefined,
                              stripeRemoved: boolean, removeStripeButton: () => void): Record<string, MenuRow> {
  const rows: Record<string, MenuRow> = {}
  const search = speedSearchGearRow(leftView, hasWorkspace, tree)
  if (search) rows[search.id] = search
  const remove = removeStripeButtonGearRow(stripeRemoved, removeStripeButton)
  if (remove) rows[remove.id] = remove
  return rows
}
