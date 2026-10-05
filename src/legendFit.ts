// 提交图例的「放不下就换紧凑形态」测量（上游 `CommitLegendPanel.adjustLegendToFitPanel`，
// `vcs/commit/CommitStatusPanel.kt:63-78`）：用一份完整图例的隐形探针量宽度，超过面板可用宽
// 就切紧凑形态；面板尺寸每次变化都重量一次（上游 `componentResized` 监听）。
//
// 这里只有 DOM 测量与观察这一件事，从 `SourceControl.vue` 拆出来（那个文件贴死 900 行上限）。
// 输入不可测（探针还没挂上、宽度为 0）时返回 `null`，调用方保持原形态、不要翻成紧凑。

/** 量一次：`true` = 放不下要紧凑，`null` = 现在还量不出来。 */
export function legendNeedsCompactForm(wrapper: HTMLElement | null, probe: HTMLElement | null): boolean | null {
  if (!wrapper || !probe) return null
  const style = getComputedStyle(wrapper)
  const available = wrapper.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  if (!(available > 0)) return null
  return probe.getBoundingClientRect().width > available
}

/**
 * 元素尺寸变化时回调（元素为空或运行时不支持 ResizeObserver 时不做任何事）。
 * 返回断开函数（组件卸载时调用）。
 */
export function observeResize(element: HTMLElement | null, onResize: () => void): () => void {
  if (!element || typeof ResizeObserver === 'undefined') return () => {}
  const observer = new ResizeObserver(() => onResize())
  observer.observe(element)
  return () => observer.disconnect()
}
