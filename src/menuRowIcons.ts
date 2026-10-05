// 菜单行图标位 —— `MenuRow.icon`（`src/menus/types.ts`）到像素的那一段。
//
// 形态照抄本仓既有的那处先例 `src/components/ContentComboLabel.vue:40-44,77`：
// 一张 `Record<string, Component>` + 一个 `iconOf` 解析器，模板里
// `<component :is="…" v-if="…" :size="iconSize.menu" aria-hidden="true" />` 放进
// 那个已经在用的 `.menu-item-icon` 槽（`src/style.css` 的 `flex: 0 0 14px`）。
// 行本身是「图标 + 文字」的行，不是纯图标按钮，所以图标给 `aria-hidden`（行名由文字给出），
// 不套纯图标按钮那条 `title` + `aria-label` + `padding: 0` 的规矩。
//
// 尺寸一律从 `src/uiIcons.ts` 的阶梯取（`iconSize.menu` = 13，上游出处见
// `ICON_SIZE_PROVENANCE.menu`）—— 不在模板里写 `:size="14"`。
import type { Component } from 'vue'
import { Folder } from 'lucide-vue-next'

/**
 * 图标名 → 组件。键是 `MenuRow.icon` / `ActionDescriptor.icon` 的取值口径（lucide 组件名）。
 *
 * **这张表现在只有一个键，是有原因的，不要随手往里加**：
 * `MenuRow.icon` 与 `ActionDescriptor.icon` 两处都已经落到位（`actionRow()` 会转发），
 * 但**全仓没有任何一处生产者给它赋值** —— `ACTIONS.register` 的 5 个调用点
 * （`actionRegistry.ts:144` 的键位动作、`macroHost.ts:230` 的命名宏、
 * `buildMenu.ts:21/26/31/36`、`localHistory.ts:28`）**一个都没写 `icon`**。
 *
 * 而上游那张菜单表也拿不到依据：`platform/platform-impl/resources/idea/PlatformActions.xml`
 * 里 `icon=` 属性只有 2 处命中（菜单动作基本不写图标），说明 IDEA 的
 * `Presentation.getIcon()` 不来自这份 XML；其推导入口 `IconLoader.getIcon(path, actionClass)`
 * 在**本 checkout 里按文件名与包路径都搜不到**。也就是说给某一行配图标必须先读到
 * 那个动作自己的类，在本 checkout 里做不到 —— 按取证口径不编，故此处留空而不猜。
 *
 * `'Folder'` 不是猜的：它是本仓**已有的** `icon:` 取值口径（`src/runAnythingContext.ts:132/134`
 * 的 Run Anything 上下文项），先登记进来，解析器与渲染位才是真跑通的。
 */
export const MENU_ROW_ICONS: Record<string, Component> = {
  Folder,
}

/**
 * 解析一行的图标名。没给名字、或名字不在表里 → null（模板 `v-if` 掉，不占槽）。
 * 走不到的那条分支与 `ContentComboLabel.iconOf`（`:41-44`）同一条口径。
 */
export function menuRowIcon(name: string | undefined): Component | null {
  if (!name) return null
  return MENU_ROW_ICONS[name] ?? null
}
