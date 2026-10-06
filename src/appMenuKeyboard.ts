// 主菜单栏的键盘导航 —— App.vue 的 `focusMenu` / `onMenuKeydown`（原 806-835 行）。
// 2026-10-06 逐字搬入本文件：**按键集合**（ArrowDown/ArrowUp/ArrowLeft/ArrowRight/Home/End/Escape/Tab）、
// `stopPropagation` 与 `preventDefault` 的先后位置、Escape 之后把焦点还给
// `[aria-controls="menu-…"]` 那枚档位的按钮、左右换档与上下/ Home / End 的环形取模，
// 全部与搬走之前逐字一致；选择器字符串（`#menu-${kind} > button:not(:disabled)`）也一个字没改。
//
// 为什么能搬：这一段只做「给定按键 + 当前档位 ⇒ 焦点落到哪一颗 / 菜单开还是收」，
// 对装配根只有两处耦合：①`menu` 那个档位开关（它的联合类型住在宿主，所以用 open/close 两个回调注入），
// ②档位清单 `allMenuGroups`（声明在宿主更晚的位置，用 thunk 注入以免读到还没初始化的常量）。
import { nextTick } from 'vue'

export type MenuKeyboardDeps = {
  /** 当前所有档位（工具/窗口两档由 `src/menuUi.ts` 动态插入，所以清单必须是取用的而不是快照）。 */
  groups: () => readonly { menu: string }[]
  /** 打开某一档（宿主里等价于 `menu.value = kind`）。 */
  open: (kind: string) => void
  /** 收起菜单（宿主里等价于 `menu.value = null`）。 */
  close: () => void
}

/** 焦点在第一档 / 最后一档（`last = true` 由「按住上键打开菜单」那一条传入）。 */
export function createMenuKeyboard(deps: MenuKeyboardDeps) {
  function focusMenu(kind: string, last = false) {
    deps.open(kind)
    void nextTick(() => {
      const items = document.querySelectorAll<HTMLButtonElement>(`#menu-${kind} > button:not(:disabled)`)
      items[last ? items.length - 1 : 0]?.focus()
    })
  }
  function onMenuKeydown(event: KeyboardEvent, kind: string) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Tab'].includes(event.key)) return
    event.stopPropagation()
    if (event.key === 'Tab') { deps.close(); return }
    event.preventDefault()
    if (event.key === 'Escape') {
      deps.close()
      document.querySelector<HTMLButtonElement>(`[aria-controls="menu-${kind}"]`)?.focus()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const index = deps.groups().findIndex(group => group.menu === kind)
      const groups = deps.groups()
      const next = groups[(index + (event.key === 'ArrowRight' ? 1 : -1) + groups.length) % groups.length]!
      focusMenu(next.menu)
      return
    }
    const items = [...document.querySelectorAll<HTMLButtonElement>(`#menu-${kind} > button:not(:disabled)`)]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  return { focusMenu, onMenuKeydown }
}
