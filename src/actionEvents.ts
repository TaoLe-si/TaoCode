// IDEA 的 `AnActionListener`（`platform/editor-ui-api/src/com/intellij/openapi/actionSystem/ex/AnActionListener.java`）
// 在本仓的等价物：动作执行**前/后**的广播管道。
//
// 上游形状：`AnActionListener` 有 `beforeActionPerformed(AnAction, AnActionEvent)` 与
// `afterActionPerformed(...)` 两个回调，`ActionManagerImpl` 每执行一个动作就遍历监听者广播一遍；
// 平台自己的内置消费者是宏录制 —— `ActionMacroManager`（`platform/lang-impl/.../macros/ActionMacroManager`）
// 在 `beforeActionPerformed` 里把这一步记进正在录的宏，与 `EditMacrosAction` 的回放配对。
//
// 本仓原先把宏录制**硬编码**在菜单分派里（`src/menuUi.ts` 两处直接调 `recordActionStep`）——
// 行为对，但那个接口本身没有落点：没有"谁来听"这一层。这个模块只做**纯管道**：
//   · `addActionListener` 登记监听者（返回注销函数）；
//   · `fireBeforeActionPerformed` / `fireAfterActionPerformed` 两个广播点。
// 监听者的装配在组合点：`src/menuUi.ts` 在模块加载时把宏录制登记进来（它就是上游消费这个接口的
// 那个角色），于是菜单分派本身不再知道宏的存在。管道与宏宿主**不互相 import**，所以这里能直接单测。
//
// 为什么 after 半也要建：它是上游接口的另一半，且判据能钉住执行顺序（before → run → after）。
// 本仓目前没有第二位消费者，但半条管道不叫广播 —— 顺序一旦被人改坏（比如 after 提前到 run 前），
// 将来的 after 消费者会静默拿到错的时序。
//
// 判据：`tests/action-events.test.mjs`（顺序、注销、多监听者、menuUi 的装配点）。
/** 一次动作执行的描述（上游 `AnAction` + `AnActionEvent` 里本仓真用得上的那三格）。 */
export interface AnActionStep {
  /** 动作 id（`MenuRow.id`，上游 `ActionManager.getId(action)`）。 */
  id: string
  title: string
  /** 菜单行上显示的键位文案（没有就不带）。 */
  keys?: string
}

export interface AnActionListener {
  beforeActionPerformed?: (step: AnActionStep) => void
  afterActionPerformed?: (step: AnActionStep) => void
}

const listeners = new Set<AnActionListener>()

/** 登记一个监听者；返回值是注销函数（上游 `MessageBusConnection.disconnect()` 的等价物）。 */
export function addActionListener(listener: AnActionListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** `ActionManagerImpl` 在 `actionPerformed` 之前的那一圈广播。 */
export function fireBeforeActionPerformed(step: AnActionStep): void {
  for (const listener of [...listeners]) listener.beforeActionPerformed?.(step)
}

/** `ActionManagerImpl` 在 `actionPerformed` 之后的那一圈广播。 */
export function fireAfterActionPerformed(step: AnActionStep): void {
  for (const listener of [...listeners]) listener.afterActionPerformed?.(step)
}
