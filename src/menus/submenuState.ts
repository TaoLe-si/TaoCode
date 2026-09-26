// 子菜单（ActionGroup popup="true"）的展开状态与定位，对应 IDEA 菜单里弹出二级浮层的那部分
// 行为。状态与计算从 App.vue 拆出（桃 2026-09-26：不要全写在一个 vue 里，模仿 IDEA 拆分引用）。
// 模板里的浮层 Teleport 到 body —— 父级 motion.div 的动画会留下 transform，transformed 祖先
// 会让 position:fixed 退化成相对弹层定位，浮层必须挂在 document.body 上。
import { ref } from 'vue'
import type { MenuRow } from './types'

export interface SubmenuStyle { left: string; top?: string; bottom?: string; maxHeight: string }

export function useSubmenuState() {
  const hasSubmenu = (row: MenuRow) => Boolean(row.children?.length)
  const submenuRow = ref<string | null>(null)
  const submenuPlacement = ref<'below' | 'above'>('below')
  const submenuStyle = ref<SubmenuStyle>({ left: '0px', maxHeight: '320px' })
  // 子菜单在父行的右侧展开（IDEA 的 Swing 菜单也是这个方向）；放不下时**向上翻转**，
  // 两种朝向都把 maxHeight 夹在视口内，长列表（例如「布局」）靠自身滚动，不顶出屏幕。
  function openSubmenu(row: MenuRow, event: Event) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const margin = 8
    const below = window.innerHeight - box.bottom - margin
    const above = box.top - margin
    const left = `${Math.max(margin, Math.min(Math.round(box.right - 4), window.innerWidth - 264))}px`
    if (below >= 180 || below >= above) {
      submenuPlacement.value = 'below'
      submenuStyle.value = { left, top: `${Math.round(box.top - 4)}px`, maxHeight: `${Math.max(160, Math.round(below))}px` }
    } else {
      submenuPlacement.value = 'above'
      // 向上翻转时用 bottom 锚定，让浮层贴着父行下缘往上长。
      submenuStyle.value = { left, bottom: `${Math.round(window.innerHeight - box.bottom + 4)}px`, maxHeight: `${Math.max(160, Math.round(above))}px` }
    }
    submenuRow.value = row.id
  }
  function closeSubmenu() { submenuRow.value = null }
  // 鼠标从父行移向浮层的路上不能立刻关 —— 延迟 250ms，进入浮层就取消（IDEA 同款行为）。
  let closeTimer: number | undefined
  function scheduleSubmenuClose() {
    if (closeTimer) window.clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => { closeTimer = undefined; closeSubmenu() }, 250)
  }
  function cancelSubmenuClose() {
    if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = undefined }
  }
  return { hasSubmenu, submenuRow, submenuPlacement, submenuStyle, openSubmenu, closeSubmenu, scheduleSubmenuClose, cancelSubmenuClose }
}
