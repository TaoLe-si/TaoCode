// 专注模式的**会话状态**：谁在专注模式里、进之前用户的设置是什么、用户在专注模式里调过什么。
//
// 拆出来的原因：`App.vue` 加了这块逻辑就顶到机检上限（`tests/module-size.test.mjs`），
// 而它本身是**一个自洽的状态机**（三个 ref + 一个切换流程），不需要模板参与 —— 正合项目里
// "状态只被本域逻辑读写 → 状态模块"的判据。
//
// IDEA 的双向 before/after 语义与 TaoCode 能映射的 6 项在 `src/distractionFreeMode.ts`；
// 这里只管"什么时候调用它们"和"状态放哪"。

import { computed, ref, type Ref } from 'vue'
import {
  distractionFreeSettings, rememberAdjustments, restoredSettings, snapshotSettings,
  type DistractionFreeKey, type DistractionFreeSnapshot,
} from './distractionFreeMode'

/** 专注模式会动的设置是一个子集，读写都按这个子集来（不把整个设置对象塞进快照）。 */
export type DistractionFreeSettingsSlice = Partial<Record<DistractionFreeKey, boolean>>

export interface DistractionFreeSessionDeps {
  /** 读当前设置（通常是 `editorSettings.value`）。 */
  read: () => DistractionFreeSettingsSlice
  /** 写回设置（通常是 `saveSettingsPatch`，它内部有并发守卫）。 */
  write: (patch: DistractionFreeSettingsSlice) => Promise<unknown>
  /** 保存失败时的通气口（通常是 `notify(message, true)`）。 */
  onError: (message: string) => void
}

export interface DistractionFreeSession {
  /** 当前是否在专注模式里。 */
  enabled: Ref<boolean>
  /** 进入/退出一次。幂等由调用方保证（`toggle` 自己翻转）。 */
  toggle: () => Promise<void>
}

export function createDistractionFreeSession(deps: DistractionFreeSessionDeps): DistractionFreeSession {
  const enabled = ref(false)
  // 进之前的用户值（IDEA 的 `BEFORE.DISTRACTION.MODE.*`）与"用户在专注模式里改过的值"（`AFTER.*`）。
  let before: DistractionFreeSnapshot | undefined
  let after: DistractionFreeSnapshot = {}

  async function toggle() {
    const enter = !enabled.value
    try {
      if (enter) {
        // **顺序不能反**：先抄用户当前值，再套专注值 —— 反了就把专注值抄进快照，
        // 退出时会"恢复"出一份专注态（用户的原设置就丢了）。
        before = snapshotSettings(deps.read() as never)
        await deps.write(distractionFreeSettings(after))
      } else {
        // 退出：先记下"专注模式下的值"（用户可能在里头调过），再恢复进之前的值。
        after = { ...after, ...rememberAdjustments(snapshotSettings(deps.read() as never)) }
        await deps.write(restoredSettings(before, deps.read() as never))
        before = undefined
      }
      enabled.value = enter
    } catch (error) {
      deps.onError(error instanceof Error ? error.message : String(error))
    }
  }

  return { enabled, toggle }
}

// ---------------------------------------------------------------------------
// 沉浸模式的协调：三种"隐藏 chrome"来源（演示模式 / 专注模式 / Zen）之间的关系。
//
// 依据：IDEA 的 **Zen = 专注模式 AND 全屏**（`ToggleZenModeAction.kt:59-80` 的 `applyZenMode`
// 幂等地把两者设成同一个 state；`:19-30` 的 `isZenModeEnabled` = 专注模式开 且 窗口全屏）。
// 它**不是**"再叠一层隐藏"，所以 TaoCode 这里也不能让 Zen 自己维护一套隐藏逻辑。
//
// 这块逻辑跟专注模式的会话是同一域（都是"谁在要求进入沉浸状态"），所以放在同一个文件里，
// 而不是继续堆进 App.vue（那边顶着机检上限）。
// ---------------------------------------------------------------------------

export interface ImmersiveModeDeps {
  /** 专注模式的会话（见上面）。 */
  distractionFree: DistractionFreeSession
  /** Zen 标志（App 自持的 ref）。 */
  zenFlag: Ref<boolean>
  /** 全屏状态（App 自持的 ref，与宿主同步）。 */
  fullScreen: Ref<boolean>
  /** 切全屏，返回宿主实际状态；不可用时返回 null（对应 IDEA 的 `isFullScreenApplicable`）。 */
  setFullScreen: (state: boolean) => Promise<boolean | null>
  /** 读宿主当前的全屏状态（用于纠正本地镜像 —— 宿主可能在别处改过它）。 */
  readFullScreen: () => Promise<boolean | null>
  /** 是否处于演示模式（它是持久化设置，退出必须写回，否则重启又自动进入）。 */
  presentationMode: () => boolean
  exitPresentationMode: () => Promise<unknown>
}

export interface ImmersiveMode {
  /** 是否要隐藏所有 chrome —— **两个来源的"或"**，不能共用一个 ref。 */
  chromeHidden: Ref<boolean>
  /** 退出按钮的文案：按"最重"的来源命名。 */
  exitLabel: Ref<string>
  toggleZen: () => Promise<void>
  /** 切换全屏。失败由调用方兜（App 那边提示），这里只管状态与同步。 */
  toggleFullScreen: () => Promise<void>
  /** 退出所有沉浸来源（Esc / 退出按钮）。 */
  exitAll: () => Promise<void>
}

export function createImmersiveMode(deps: ImmersiveModeDeps): ImmersiveMode {
  const chromeHidden = computed(() => deps.zenFlag.value || deps.distractionFree.enabled.value)
  const exitLabel = computed(() => deps.presentationMode() ? '退出演示模式'
    : deps.distractionFree.enabled.value ? '退出专注模式' : '退出 Zen Mode')

  // IDEA 的 `applyZenMode`：把专注模式与全屏**幂等地**设成同一个 state。
  async function applyZen(state: boolean) {
    deps.zenFlag.value = state
    if (state !== deps.distractionFree.enabled.value) await deps.distractionFree.toggle()
    // 全屏不可用（例如窗口还没注册）时 Zen 的其余部分仍然生效 —— 与 IDEA 的
    // `isFullScreenApplicable()` 判断一致，不能因为全屏失败就整体回退。
    const applied = await deps.setFullScreen(state)
    if (applied !== null) deps.fullScreen.value = applied
  }

  async function exitAll() {
    if (deps.presentationMode()) await deps.exitPresentationMode()
    if (deps.distractionFree.enabled.value) await deps.distractionFree.toggle()
    deps.zenFlag.value = false
    if (deps.fullScreen.value) {
      const applied = await deps.setFullScreen(false)
      if (applied !== null) deps.fullScreen.value = applied
    }
  }

  // 切换全屏：先按本地镜像取反去问宿主，再读一次宿主状态纠正镜像 ——
  // 宿主可能在别处改过它（例如由窗口消息处理），只信本地会显示成错的勾选态。
  async function toggleFullScreen() {
    const applied = await deps.setFullScreen(!deps.fullScreen.value)
    if (applied !== null) deps.fullScreen.value = applied
    const actual = await deps.readFullScreen()
    if (actual !== null) deps.fullScreen.value = actual
  }

  return { chromeHidden, exitLabel, toggleZen: () => applyZen(!deps.zenFlag.value), exitAll, toggleFullScreen }
}
