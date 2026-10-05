<script setup lang="ts">
// 变量/监视树行的动作弹层。上游这些动作挂在 `XDebuggerTree` 的右键菜单上
// （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/actions/`：
// `XCopyValueAction`/`XCopyNameAction`/`XAddToWatchesTreeAction`/`EvaluateInConsoleFromTreeAction`…）。
// 本仓的树是 DOM，没有右键菜单宿主，所以行尾按钮开这个弹层承载同一组动作 ——
// 动作清单由调用方（DebugPanel）按行能力算好，本组件只负责画与收起。
//
// 定位沿用复制弹层的老办法：fixed + 点击处视口坐标 + 全屏 backdrop 收点击。
defineProps<{
  x: number
  y: number
  /**
   * 条目顺序即渲染顺序；`disabled` 的条目可见但点不动。
   * `hint` 是禁用原因 —— 挂 `title`，让禁用条目把「为什么不能点」说出来，
   * 而不是留一个点不动的按钮。清单由 `src/debugRowActions.ts` 生成。
   */
  items: Array<{ mode: string; label: string; disabled?: boolean; hint?: string }>
}>()
const emit = defineEmits<{ (event: 'pick', mode: string): void; (event: 'close'): void }>()

function pick(mode: string, disabled?: boolean) {
  if (disabled) return
  emit('pick', mode)
}
</script>

<template>
  <div class="debug-menu-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')"></div>
  <div class="debug-menu" role="menu" aria-label="变量动作" :style="{ left: `${x}px`, top: `${y}px` }">
    <button v-for="item in items" :key="item.mode" role="menuitem" :disabled="item.disabled" :title="item.hint ?? item.label" @click="pick(item.mode, item.disabled)">{{ item.label }}</button>
  </div>
</template>

<style scoped>
/* 与 DebugPanel 的复制弹层同款（fixed 定位在点击处，backdrop 收点击）。 */
.debug-menu-backdrop { position: fixed; inset: 0; z-index: 40; }
.debug-menu { position: fixed; z-index: 41; display: flex; flex-direction: column; min-width: 132px; padding: 2px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.debug-menu button { text-align: left; }
.debug-menu button:disabled { color: var(--muted); opacity: .6; }
</style>
