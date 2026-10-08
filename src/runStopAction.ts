// exec/run-instances：多实例并存时「停止」这一格到底停谁 —— 上游 `StopAction` 的装配。
//
// 为什么单独成文件：这段是**纯函数**（入参是行模型的产物，不碰 reactive 状态），
// 而 `src/runInstances.ts` 贴着 900 行机检上限（`tests/module-size.test.mjs`）。
// 拆出来的是「停止那一格的状态/选择器/停谁」这一整块，逐条对照上游
// `platform/execution-impl/src/com/intellij/execution/actions/StopAction.java`：
//   · `:73-128` update()（全局位置 vs 工具窗口里那一格、计数徽标、Kill process 那一档）；
//   · `:134-229` actionPerformed（一条直接停、多条弹选择器、弹层开着再点 = 停全部）；
//   · `:199` 标题、`:213-215` 预选、`:158-168` 的 Stop All 那一条；
//   · `StoppableRunDescriptors.kt:17-63` 的清单（已结束的不进、新起在前、一个执行环境一条代表）；
//   · `RunContentManagerImpl.kt:788-826` 的同名已结束格复用判定（`chooseReuseInstance`）。
//
// 内容与拆分前**逐字相同**（只挪位置），判据 `tests/run-instance-rows.test.mjs` 仍从
// `src/runInstances.ts` 导入 —— 那边把这些名字原样再导出（re-export），调用方一行没改。

// ── 多实例并存时「停止」这一格到底停谁（上游 `StopAction` 的装配） ───────────────────────
//
// 上游坐标（`platform/execution-impl/src/com/intellij/execution/actions/StopAction.java`）：
//   · `:73-128` `update()`：全局位置（主菜单/主工具栏/运行工具条…，判定在 `:59-65`）时
//     `enable = stopCount >= 1`（`:79-81`）；`stopCount == 0` 且位置是新 UI 运行工具条 ⇒ **整格不可见**
//     （`:83-86`）；`stopCount > 1` ⇒ 文案加 `...`（`:88-89`）+ 图标上叠一个计数（`:90-92`，
//     计数文本在 `platform/execution-impl/src/com/intellij/execution/ui/RunToolbarPopup.kt:752-758`：
//     新 UI 工具条且 >9 就写 `9+`）；`stopCount == 1` ⇒ 文案换成 `stop.configuration.action.name`
//     （`:93-97`；`ExecutionBundle.properties:208` = `Stop ''{0}''`）；
//     非全局位置（工具窗口里那一格）时 `:99-111`：只有「没结束」才可点，正在结束的那档换成 Kill process。
//   · `:134-229` `actionPerformed`：只有一条 ⇒ **直接停它、不弹层**（`:141-143`）；多条 ⇒ 弹一个选择器
//     （`:152-181`），末尾追加一条「Stop All (…)」（`:158-168` 与 `:177-179`；文案
//     `ExecutionBundle.properties:209` = `Stop All ({0})`，`{0}` 是 `KeymapUtil.getFirstKeyboardShortcutText("Stop")`，
//     `:159`）；**弹层还开着时再点一次 = 停全部并收起**（`:169-174`）；标题：只有一项时
//     `confirm.process.stop`、否则 `stop.process`（`:199`；`ExecutionBundle.properties:491-492`）；
//     预选中的是那一条「最近打开的视图」（`:213-215` + `:279-290` 的 `getRecentlyStartedContentDescriptor`）。
//   · 清单本身：`platform/execution-impl/src/com/intellij/execution/StoppableRunDescriptors.kt:17-63`
//     —— 已结束的不进（`:24-26`），顺序是 `getAllDescriptors().asReversed()`（`:19`，**新起的那条在最前**），
//     一个执行环境（= 同一个运行配置的多个 descriptor）只出**一条代表**（`:51-62`，代表由
//     `DisplayDescriptorChooser` 扩展点选，本仓没有 EP 宿主 ⇒ 一个实例一条，如实登记）。

export const STOP_LABELS = {
  /** `ActionsBundle.properties:941`（`action.Stop.text=Stop`）。 */
  base: '停止',
  /** `ActionsBundle.properties:942`（`action.Stop.description=Stop the process`）。 */
  description: '停止进程',
  /** `ExecutionBundle.properties:208`（`stop.configuration.action.name=Stop ''{0}''`）。 */
  one: (name: string) => `停止『${name}』`,
  /** `StopAction.java:89` 的 `getText() + "..."`。 */
  many: '停止…',
  /** `ExecutionBundle.properties:209`（`stop.all=Stop All ({0})`），`{0}` 由宿主传键位文本。 */
  all: (shortcut: string) => (shortcut ? `停止全部（${shortcut}）` : '停止全部'),
  /** `ExecutionBundle.properties:491`（`stop.process=Stop Process`）。 */
  popupTitle: '停止进程',
  /** `ExecutionBundle.properties:492`（`confirm.process.stop=Confirm Process Stop`）。 */
  popupTitleSingle: '确认停止进程',
  /** `ExecutionBundle.properties:203` 与 `:529`（都是 `Kill process`）。 */
  kill: '杀死进程',
  /** `ExecutionBundle.properties:202`（`terminating.process.progress.title=Terminating ''{0}''`）。 */
  terminating: (name: string) => `正在结束『${name}』`,
} as const

/** 停止按钮所在的位置（`StopAction.java:59-65` 的 `isPlaceGlobal` 的两档 + 新 UI 运行工具条）。 */
export type StopActionPlace = 'global' | 'newUiRunToolbar' | 'local'

export interface StopActionState {
  enabled: boolean
  visible: boolean
  text: string
  description: string
  /** 图标上叠的计数文本（`StopAction.java:90-92`；没有就不叠）。 */
  badge: string
  /** 点击是弹选择器还是直接停（`:141-150`）。 */
  popup: boolean
  /** 目标那一条正在结束途中 ⇒ 图标/文案换成 Kill process（`:106-110`）。 */
  kill: boolean
  /** 可停的实例 id（选择器停全部时要用）。 */
  stoppableIds: number[]
}

export interface StopCandidate {
  id: number
  title: string
  stoppable: boolean
  kill?: boolean
}

/** 停止判定要吃的那几列（`runInstanceRows()` 的产物结构上就满足它）。 */
export interface StopRowInput {
  id: number
  title: string
  running: boolean
  stoppable: boolean
  kill?: boolean
}

/** 可停清单：过滤已结束（`StoppableRunDescriptors.kt:24-26`），**新起在前**（`:19` 的 `asReversed()`）。 */
export function stoppableCandidates(rows: readonly StopRowInput[]): StopCandidate[] {
  return rows.filter(row => row.stoppable && row.running)
    .map(row => ({ id: row.id, title: row.title, stoppable: true, kill: row.kill }))
    .reverse()
}

/** 计数文本（`RunToolbarPopup.kt:752-758`：新 UI 工具条且 >9 才收成 `9+`）。 */
export function stopCounterText(count: number, place: StopActionPlace): string {
  if (count <= 0) return ''
  if (place === 'newUiRunToolbar' && count > 9) return '9+'
  return String(count)
}

/**
 * 「停止」那一格的状态（`StopAction.update()` 的 `:73-128`）。
 * `rows` 传 `runInstanceRows()` 的产物即可；`selectedId` 是本地位置的当前实例
 * （上游非全局位置读的是数据键 `RUN_CONTENT_DESCRIPTOR`，拿不到就退回 `getSelectedContent()`，`:99-101`+`:279-290`）。
 */
export function stopActionState(
  rows: readonly StopRowInput[],
  place: StopActionPlace = 'global',
  selectedId: number = 0,
): StopActionState {
  const candidates = stoppableCandidates(rows)
  const count = candidates.length
  if (place === 'local') {
    const target = candidates.find(candidate => candidate.id === selectedId) ?? candidates[0]
    return {
      enabled: count > 0,
      visible: true,
      // `:117-122`：只要有一个描述符/配置，文案就是 `Stop ''{0}''`（不可点时也带着）。
      text: target ? STOP_LABELS.one(target.title) : STOP_LABELS.base,
      description: target?.kill ? STOP_LABELS.kill : STOP_LABELS.description,
      badge: '',
      popup: false,
      kill: target?.kill === true,
      stoppableIds: candidates.map(candidate => candidate.id),
    }
  }
  if (count === 0) {
    // `:83-86`：新 UI 运行工具条那一格在一条都没有时整格不见；其它全局位置只是不可点（`:125`）。
    return {
      enabled: false,
      visible: place !== 'newUiRunToolbar',
      text: STOP_LABELS.base,
      description: STOP_LABELS.description,
      badge: '',
      popup: false,
      kill: false,
      stoppableIds: [],
    }
  }
  if (count === 1) {
    return {
      enabled: true,
      visible: true,
      text: STOP_LABELS.one(candidates[0].title),
      description: candidates[0].kill ? STOP_LABELS.kill : STOP_LABELS.description,
      badge: '',
      popup: false,
      kill: candidates[0].kill === true,
      stoppableIds: candidates.map(candidate => candidate.id),
    }
  }
  return {
    enabled: true,
    visible: true,
    text: `${STOP_LABELS.base}…`,
    description: STOP_LABELS.description,
    badge: stopCounterText(count, place),
    popup: true,
    kill: false,
    stoppableIds: candidates.map(candidate => candidate.id),
  }
}

export interface StopChooserItem {
  id: number
  /** `stopAll` 那一条停的是**所有**行（`StopAction.java:158-168`）。 */
  kind: 'instance' | 'stopAll'
  text: string
  selected: boolean
}

export interface StopChooser {
  items: StopChooserItem[]
  title: string
}

/**
 * 停止选择器的条目（`StopAction.java:152-181` + `:199` + `:213-215`）。
 * `shortcutText` 由宿主从键位表取（`KeymapUtil.getFirstKeyboardShortcutText("Stop")`，`:159`）——
 * `src/keymap.ts` 是保留文件，这里不写死键位。
 */
export function stopChooserItems(candidates: readonly StopCandidate[], selectedId: number, shortcutText = ''): StopChooser {
  const items: StopChooserItem[] = candidates.map(candidate => ({
    id: candidate.id,
    kind: 'instance' as const,
    text: STOP_LABELS.one(candidate.title),
    selected: candidate.id === selectedId,
  }))
  if (candidates.length > 1) items.push({ id: 0, kind: 'stopAll', text: STOP_LABELS.all(shortcutText), selected: false })
  return { items, title: items.length === 1 ? STOP_LABELS.popupTitleSingle : STOP_LABELS.popupTitle }
}

/**
 * 点击「停止」时要停哪几条（`:141-174`）：
 *   · 只有一条 ⇒ 直接停它（`{popup:false, ids:[that]}`）；
 *   · 多条且**没有**打开的选择器 ⇒ 弹层（`{popup:true, ids:[]}`，停谁由用户点选决定）；
 *   · 多条且弹层**还开着** ⇒ 停全部并收起（`:169-174`）。
 */
export function resolveStopActionTargets(
  rows: readonly StopRowInput[],
  popupOpen: boolean,
): { popup: boolean; ids: number[] } {
  const candidates = stoppableCandidates(rows)
  if (candidates.length === 0) return { popup: false, ids: [] }
  if (candidates.length === 1) return { popup: false, ids: [candidates[0].id] }
  if (popupOpen) return { popup: false, ids: candidates.map(candidate => candidate.id) }
  return { popup: true, ids: [] }
}

/**
 * 「同名已结束的那一格要不要被复用」（上游 `chooseReuseContentForDescriptor`，
 * `RunContentManagerImpl.kt:788-826`：名字匹配优先 `:810-813`+`:839-846`，其次第一个「好」的 `:848-851`；
 * 条件在 `canReuseContent`（`:854-856`）：**没钉住** + **进程已结束** + 不是同一次执行；
 * 选中的那一格先查（`:834-838`））。
 *
 * 本仓**没有**自动接上：标签条是扁平的、按起跑顺序排，复用要「原地换内容」才能和上游一样
 * （`RunContentManagerImpl.kt:298-308` 保留 content、把 component 换成新 descriptor 的），
 * 摘掉旧格再排到末尾就不是同一件事了 ⇒ 判定先落成纯函数并测住，挂载与顺序方案见
 * docs/wiring-requests-2026-10-06-runinst.md R3。
 */
export function chooseReuseInstance(
  candidates: readonly { id: number; title: string; running: boolean; pinned?: boolean }[],
  title: string,
  executionId: number,
  selectedId: number = 0,
): number | null {
  const reusable = (candidate: { id: number; running: boolean; pinned?: boolean }) =>
    candidate.pinned !== true && !candidate.running && candidate.id !== executionId
  const ordered = [...candidates]
  const selected = ordered.find(candidate => candidate.id === selectedId)
  if (selected) {
    const index = ordered.indexOf(selected)
    ordered.splice(index, 1)
    ordered.unshift(selected)
  }
  const byName = ordered.find(candidate => reusable(candidate) && candidate.title === title)
  if (byName) return byName.id
  const firstGood = ordered.find(candidate => reusable(candidate))
  return firstGood?.id ?? null
}

