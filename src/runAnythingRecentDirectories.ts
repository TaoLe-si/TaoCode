// Run Anything 执行上下文的**最近目录缓存** —— 上游
// `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingContextRecentDirectoryCache.kt`
//   · `:13-14` `@Service(Service.Level.PROJECT)` + `@State(name = "RunAnythingContextRecentDirectoryCache", storages = [Storage(StoragePathMacros.WORKSPACE_FILE)])`
//     ⇒ **项目级**状态，跟着 workspace 文件走（`platform/projectModel-api/src/com/intellij/openapi/components/StoragePathMacros.java:25`
//     的 `WORKSPACE_FILE = "$WORKSPACE_FILE$"`，注释 `:22-23`「local to a particular environment and should not be
//     shared with other team members」那一档 ⇒ `.idea/workspace.xml`）；
//   · `:26-29` 状态本体 = `State.paths: MutableList<String>`（`@XCollection(elementName = "recentPaths")`）—— 只有这一个字段；
//   · 写它的唯一一处 = 选择器回值那里（`RunAnythingChooseContextAction.kt:139-147`：满了先 `removeAt(0)` 再 `add`，
//     条数取注册表 `run.anything.context.recent.directory.number` = 5，
//     `platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:170-171`），
//     入栈完还把那一档设成当前上下文（同文件 `:146` `selectedContext = RecentDirectoryContext(path)`）；
//   · 读它的唯一一处 = 候选表（同文件 `:238` `state.paths.map { RecentDirectoryContext(it) }`）——
//     **读出侧不截断、不去重**：条数上限只管入栈那一步，注册表被调小之后存着的老条目照样全部列出来。
//
// **本仓的等价落点**（不是猜的，读盘核过）：`projects.json` → `perProject[项目根]` 那一段，
// 前端 `project.settings.get` / `project.settings.update`（`native/projects.cpp:770-784` 读、`:820-844` 写，
// 写侧是 `merge_patch` ⇒ 只交自己那一个键不会动别家）。这一段就是本仓的「workspace 文件」：
// 同族的前例是 `src/editorFoldingState.ts:86`（上游也存项目的 workspace 文件、本仓落这一段）
// 与 `runConfigs` 的注释（`native/settings_schema.cpp:981-983`「Run configurations live with the project,
// the way IDEA keeps them in .idea/runConfigurations」）。落键名 `runAnythingRecentPaths`
// （服务名 + `@XCollection(elementName = "recentPaths")` 的两段合起来）。
//
// **迁移判据**（2026-10-06 那次把用户 projects.json 判损坏、项目打不开的事故换来的规矩）：
//   · 老存档**没有**这个键是合法形状 ⇒ 读侧补默认（空表）。所以这一项**不进** `project_defaults()`
//     （`native/settings_schema.cpp:432-479`），与 `foldingState` 同一档；`native/project_settings_state.cpp:107`
//     那句「按字段判损坏」只核 `excludedDirs` 一条，新增可选键不会撞上它；
//   · **不按条数判损坏**：存的条数比注册表上限多（注册表被调小之后的老存档）照旧读出来，只丢形状不对的条目；
//   · 键值是 `null` / 非数组 / 条目不是非空字符串 ⇒ 一律当「没记过」或逐条丢掉，**不抛错**
//     （原生读盘对 `null` 那一条本来就有 `native/project_settings_state.cpp:103-105` 的抹掉逻辑）。
// 原生侧只要求这个键在 `validate_project_patch` 的白名单里（`native/settings_schema.cpp:949-953`，
// 不在白名单 = 存它 `INVALID_SETTINGS`、读它 `STATE_CORRUPT`），形状由本文件的 `normalizeRecentDirectories` 兜。
import { computed, ref } from 'vue'
import { request } from './bridge.ts'
import { pushRecentDirectory } from './runAnythingContext.ts'

/** 项目级设置里那一个键（上游 `State.paths` 的 `@XCollection(elementName = "recentPaths")` 在本仓的名字）。 */
export const RUN_ANYTHING_RECENT_PATHS_KEY = 'runAnythingRecentPaths'

const stored = ref<string[]>([])
/** 当前项目的根（上游 `BrowseDirectoryItem` 开选择器时传的 `project.guessProjectDir()`，`RunAnythingChooseContextAction.kt:138`）。 */
const projectRoot = ref('')

/** 弹层吃的那一份：模块级单例 + 响应性。写入口只有下面 `importRunAnythingRecentDirectories` 与 `rememberRunAnythingRecentDirectory` 两个。 */
export const recentDirectoryPaths = computed<readonly string[]>(() => stored.value)

/**
 * 读出侧的归一（**迁移判据都在这一个函数里**）：缺键 / `null` / 非数组 ⇒ 空表；
 * 条目不是非空字符串 ⇒ 逐条丢掉；条数超过注册表上限 ⇒ 原样留着（上游读出侧不截断，`:238`）。
 * 任何形状都**不抛错** —— 这一份坏掉只意味着「这一档没记过」，不能把整个项目设置判损坏。
 */
export function normalizeRecentDirectories(record: unknown): string[] {
  if (!Array.isArray(record)) return []
  // 不 slice(0, 上限)：条数上限只管**入栈**那一步（`:139-144`），读出侧整份列（`:238`）。
  return record.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

/**
 * 换项目 / 关项目时灌进来的那一份（与 `importFoldState` 同一个时机，`src/workspaceLifecycle.ts:323`、`:434`）。
 * 订正留痕：这一处原本写 `:305`、`:413`（死 lane 留下的假坐标），读盘数过 —— `importFoldState(loaded?.foldingState)`
 * 在 `:323`、`importFoldState(undefined)` 在 `:434`，本模块的三处调用（换项目先清 `:316`、读回来灌进 `:326`、关项目清 `:435`）与它们同批。
 * `record` 传整个项目设置对象（`ProjectSettings` 里**没有**声明这个键 —— `src/settingsModel.ts` 是主代理保留面，
 * 加声明的粘贴件见 `docs/wiring-requests-2026-10-06-recentdirclose.md`），这里自己按 `RUN_ANYTHING_RECENT_PATHS_KEY` 取；
 * 传 `undefined` = 没有项目 ⇒ 清空（上一个项目的目录不能串过来）。
 */
export function importRunAnythingRecentDirectories(record: unknown, root = ''): void {
  const source = record && typeof record === 'object' ? (record as Record<string, unknown>)[RUN_ANYTHING_RECENT_PATHS_KEY] : undefined
  stored.value = normalizeRecentDirectories(source)
  projectRoot.value = typeof root === 'string' ? root : ''
}

/** 开目录选择器时给宿主的起始目录 = 项目根（上游 `:138`；拿不到就留空串，宿主用自己的默认目录）。 */
export function recentDirectoryChooserStart(): string { return projectRoot.value }

/** 落盘通道：默认走项目设置那一条 `project.settings.update`；判据注入一个假的以核「写出去的那一份长什么样」。 */
export type RecentDirectoriesWriter = (paths: readonly string[]) => void

/** 落盘的那一个键的补丁形状：只交这一个键（原生 `merge_patch` ⇒ 别家字段一个字都不动，`native/projects.cpp:833`）。 */
export function runAnythingRecentPathsPatch(paths: readonly string[]): Record<string, string[]> {
  return { [RUN_ANYTHING_RECENT_PATHS_KEY]: [...paths] }
}

/**
 * 落盘失败的后果只是「下次开机不记得」（会话内那一份已经更新，弹层这一档照样在）——
 * 与 `src/editorFoldingState.ts:135` 同口径；失败本身记在桥接的调用账上（`src/bridge.ts:899-903` 给那一条
 * `traces` 打上 `status:'error'` + 错误码，「操作输出」那一格列它，`src/App.vue:2203-2204`）——
 * **不是** `app.internalErrors`：那条读的是原生自己的错误账（`native/diagnostics.cpp:118-129`），
 * 而分派链的 `catch`（`native/main.cpp:1509-1515`）只把错误回给 JS、不写那本账（死 lane 原写错了，此处订正）。
 * 这里不炸界面：这一格是执行上下文的缓存，不是用户的数据。
 */
export const persistRunAnythingRecentDirectories: RecentDirectoriesWriter = paths => {
  void request('project.settings.update', runAnythingRecentPathsPatch(paths)).catch(() => undefined)
}

/**
 * 记一条「刚浏览过的目录」（`RunAnythingChooseContextAction.kt:139-144` 的等价物）：
 * 入栈规则（满了先摘最老的一条、条数取注册表默认值 5）在 `src/runAnythingContext.ts` 的
 * `pushRecentDirectory`，这里不重写；**不去重**（上游也不去重：同一个目录浏览两次就是两档）。
 * 返回入栈后的那一份，调用方（弹层）据此把当前上下文设成新加的那一档（同文件 `:146`）。
 */
export function rememberRunAnythingRecentDirectory(
  path: string,
  write: RecentDirectoriesWriter = persistRunAnythingRecentDirectories,
): readonly string[] {
  const picked = path.trim()
  if (!picked) return stored.value
  stored.value = pushRecentDirectory(stored.value, picked)
  write(stored.value)
  return stored.value
}
