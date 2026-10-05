// 动作注册表 —— 上游 `com.intellij.openapi.actionSystem` 一族在本仓的等价物：
//   · `ActionManager.registerAction(replaceAction)` / `getAction(id)` / `unregisterAction`
//       —— 本仓的 `ActionRegistry.register/has/get/unregister`，id 全局唯一，重复注册 = 替换
//          （上游 `ActionManagerImpl.registerAction` 对重复 id 抛异常，`replaceAction` 才是覆盖；
//          本仓是单页应用、模块可能重复装配，所以 register 就是"最后写入赢"并 bump 世代）。
//   · `AnAction.update(AnActionEvent)` + `Presentation`
//       —— 本仓 `enabled()` / `checked()` 两个谓词（`present()` 返回它们的当前值）。
//   · `ActionUpdateThread`（BGT/EDT）与 `ActionManagerImpl` 的 presentation 失效
//       —— 本仓谓词是同步纯函数、按需实时求值，等价物是**世代号** `presentationVersion`：
//          宿主改了谓词依赖的状态后 `bumpPresentation()`，订阅者据此重绘（`menuUi` 的 computed
//          本来就依赖 `actionList`，逐行 `enabled()` 每次求值，行为不变）。
//   · `AnActionListener` 的 before/after 广播在 `src/actionEvents.ts`（已落地，消费点是宏录制）。
//     注册表**不**复制这条管道：`run()` 只管执行，广播仍由菜单分派（`menuUi.ts`）负责；
//     键位尾部走注册表执行（原先也不广播，行为不变）。
//
// 为什么要有它（判词 pf/actions 的缺口）：本仓动作原先散在三处 —— 菜单行数据（静态行表里
// title/enabled/checked/run 四格重复写）、`keymap.ts` 的 `tailActions`（id → 动作的第五份映射）、
// `pluginCommands` 的 action id 校验。同一个动作 id 在几处各写一半，改一处漏一处。
// 注册表把「id → 标题 / 图标 / 可用性谓词 / 勾选态 / 处理器」收成一份，菜单行用 `actionRow(id)`
// 取，键位尾部用 `ACTIONS.run(id)` 分派，插件命令入口用 `ACTIONS.has(id)` 校验。
//
// 判据：`tests/action-registry.test.mjs`。
import type { KeyBinding, KeyBindingState } from './keymapBindings.ts'
import { keymapKeys } from './keymapBindings.ts'
import type { MenuRow } from './menus/types.ts'

/** 动作的来源（排查与断言用；与上游的 action 注册者不是同一概念）。 */
export type ActionSource = 'menu' | 'keymap' | 'plugin' | 'toolbar' | 'other'

export interface ActionDescriptor {
  /** 全局唯一 id（上游 `ActionManager.getId(action)`）。 */
  id: string
  /** 菜单文案（`Presentation.text`）；函数形式支持随状态变化。 */
  title: string | (() => string)
  /** 「查找操作」的关键字别名。 */
  keywords?: string
  /**
   * 图标名（lucide 图标名口径，须取自 `src/uiIcons.ts` 的阶梯）。
   * 数据侧已落到 `MenuRow.icon`（`actionRow()` 转发）；**渲染层未接** —— `src/menuUi.ts` 的行模板
   * 没有图标位（它不在本 lane 的文件清单里），所以这一栏目前只到数据不通到像素。
   */
  icon?: string
  /** `AnAction.update` 的可用性：false 时菜单置灰、`run()` 拒绝执行。缺省 = 总是可用。 */
  enabled?: () => boolean
  /** `Presentation.checked`：勾选态（切换类动作用）。缺省 = 不勾选。 */
  checked?: () => boolean
  /** 动作体（`AnAction.actionPerformed`）。 */
  run: () => void
  /** 注册来源（默认 other）。 */
  source?: ActionSource
}

export interface ActionState {
  id: string
  title: string
  enabled: boolean
  checked: boolean
}

export class ActionRegistry {
  private descriptors = new Map<string, ActionDescriptor>()
  /** presentation 世代：谓词依赖的外部状态变了就 bump（上游 presentation 失效的等价物）。 */
  presentationVersion = 0

  /** 注册（同 id 覆盖 —— 见文件头的口径说明）。 */
  register(descriptor: ActionDescriptor): void {
    if (!descriptor.id) throw new Error('动作 id 不能为空。')
    this.descriptors.set(descriptor.id, { source: 'other', ...descriptor })
    this.bumpPresentation()
  }

  /** 别名：读起来更贴近上游的 `replaceAction`（行为与 register 相同）。 */
  replace(descriptor: ActionDescriptor): void { this.register(descriptor) }

  unregister(id: string): boolean {
    const removed = this.descriptors.delete(id)
    if (removed) this.bumpPresentation()
    return removed
  }

  has(id: string): boolean { return this.descriptors.has(id) }

  get(id: string): ActionDescriptor | undefined { return this.descriptors.get(id) }

  ids(): string[] { return [...this.descriptors.keys()] }

  get size(): number { return this.descriptors.size }

  titleOf(id: string): string {
    const descriptor = this.descriptors.get(id)
    if (!descriptor) return ''
    return typeof descriptor.title === 'function' ? descriptor.title() : descriptor.title
  }

  /** `AnAction.update` + `Presentation` 的当前值（动作未注册时返回 null）。 */
  present(id: string): ActionState | null {
    const descriptor = this.descriptors.get(id)
    if (!descriptor) return null
    return {
      id,
      title: this.titleOf(id),
      enabled: descriptor.enabled ? descriptor.enabled() !== false : true,
      checked: descriptor.checked ? descriptor.checked() === true : false,
    }
  }

  /**
   * 执行动作（`ActionManagerImpl.actionPerformed` 的最小子集）。
   * 不可用时返回 false 并且**不执行**（键位上等价于该动作没绑；上游 keymap 也不会触发
   * 被 update 关掉的动作）。
   */
  run(id: string): boolean {
    const descriptor = this.descriptors.get(id)
    if (!descriptor) return false
    if (descriptor.enabled && descriptor.enabled() === false) return false
    descriptor.run()
    return true
  }

  /** 谓词依赖的状态变化后调用（上游 presentation 失效）。 */
  bumpPresentation(): number { this.presentationVersion += 1; return this.presentationVersion }

  /** 快照（调试/测试用；不含处理器）。 */
  describe(): ActionState[] {
    return this.ids().map(id => this.present(id)!)
  }
}

/** 进程内唯一的注册表（与 `ActionManager` 一样是应用级单例）。 */
export const ACTIONS = new ActionRegistry()

/**
 * 键位尾部动作的注册（`src/keymap.ts` 调用）：把 `KEY_BINDINGS` 的每一条注册成描述符 ——
 * 标题取键位表的 `label`，可用性谓词 = `when` 对**实时**状态的求值（与 `findKeyBinding` 同一输入面）。
 */
export function registerKeymapActions(
  bindings: readonly KeyBinding[],
  handlerOf: (binding: KeyBinding) => (() => void) | undefined,
  state: () => KeyBindingState,
): void {
  for (const binding of bindings) {
    const handler = handlerOf(binding)
    if (!handler) continue
    ACTIONS.register({
      id: binding.id,
      title: binding.label,
      source: 'keymap',
      enabled: () => !binding.when || binding.when(state()),
      run: handler,
    })
  }
}

/**
 * 菜单行 ← 注册表：`title`/`keywords`/`enabled`/`checked`/`run` 全部从描述符取，菜单这一侧
 * 不再各写一份。`keys` 按 `keymapId`（默认同 id）查键位表 —— 显示串与分派是同一份数据。
 * 动作未注册时**抛错**：注册表驱动下，菜单行指向不存在的动作是装配 bug（上游同样拿不到 action）。
 */
export function actionRow(id: string, overrides: Partial<MenuRow> & { keymapId?: string } = {}): MenuRow {
  const descriptor = ACTIONS.get(id)
  if (!descriptor) throw new Error(`动作 ${id} 未注册，不能生成菜单行。`)
  const { keymapId, ...rest } = overrides
  const keys = rest.keys ?? keymapKeys(keymapId ?? id)
  const row: MenuRow = {
    id,
    title: descriptor.title,
    keywords: descriptor.keywords,
    ...(descriptor.icon ? { icon: descriptor.icon } : {}),
    ...(descriptor.enabled ? { enabled: () => descriptor.enabled!() } : {}),
    ...(descriptor.checked ? { checked: () => descriptor.checked!() } : {}),
    run: () => { ACTIONS.run(id) },
    ...(keys ? { keys } : {}),
    ...rest,
  }
  return row
}
