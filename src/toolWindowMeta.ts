// 工具窗口的**注册表** —— IDEA `ToolWindowEP` + `ToolWindowFactory` + `RegisterToolWindowTask`
// 那一层在本仓的等价物：**一个工具窗口 = 一条记录**（id / 条纹标题 / 图标 / 默认锚点 /
// 助记符 / 可用性），其余几张表全部由它派生。
//
// 上游形状（逐条核过）：
//   · `RegisterToolWindowTask`（`platform-api/.../wm/RegisterToolWindowTask.kt`）：registerToolWindow
//     拿到的是 id + anchor + `stripeTitle` + `canCloseContents` … 这一组**声明式**字段；
//   · `ToolWindowFactory.shouldBeAvailable(project)`（`platform-api/.../wm/ToolWindowFactory.kt`）：
//     给不出内容的窗口在条纹上灰着 —— 平台实现里带规则的例子是
//     `AbstractExternalSystemToolWindowFactory.java:32-34`（`!linkedProjectsSettings.isEmpty()`）；
//   · `ToolWindowId.java` 的 id 常量 + 各插件的 `<toolWindow id="…" anchor="…">` 注册（每个插件一份 XML）。
// 本仓没有 EP（没有插件运行时，硬规则 2），所以"注册"= 往下面这张表里加一条。
//
// **加一个工具窗口要改的地方**（这一批之后只剩两处）：
//   1) 本文件 `TOOL_WINDOW_REGISTRY` 加一条；
//   2) 内容挂载点（`ToolWindowView.vue` 的 `v-else-if="view === '…'"`）。
//   第 2 条在 IDEA 里是 `ToolWindowFactory.createToolWindowContent(project, toolWindow)` —— 本仓每个
//   视图组件的 props 各不相同（`VcsLog` 要 root、`FileTree` 要 entries…），所以那一半仍是模板链，
//   **没有假装数据化**：要它数据化得先给所有视图一个统一的 `content(ctx)` 契约
//   （登记在 `docs/source-todo.md` §12）。
//
// 原先这几张表各写一份、还互不一致（`toolWindowStripes` 把 vcslog/todo/debug 列在 left、
// `toolLayouts` 把锚点全写成 left）—— 现在**只有本文件定义**，其余地方 import。
import { Bell, Bookmark as BookmarkIcon, Boxes, Bug, Files, FolderTree, GitBranch, GitGraph, ListChecks, Search } from 'lucide-vue-next'
import { mnemonicBindings, mnemonicOf } from './toolWindows.ts'
import { beanToTask, type ToolWindowBean, type ToolWindowFactory, type RegisterToolWindowTask } from './toolWindowFactories.ts'

/** IDEA 的 `ToolWindowAnchor`（TaoCode 只用 left/right/bottom；FLOATING 没有宿主）。 */
export type ToolWindowAnchor = 'left' | 'right' | 'bottom'

/**
 * `ToolWindowFactory.shouldBeAvailable(project)` 能看到的那些输入（本仓的"项目状态"面）。
 * 传值而不是传 project：这个模块是纯数据，不持有任何状态。
 */
export interface ToolWindowAvailability {
  /** 桌面端（浏览器预览没有 git / 语言服务 / 外部系统通道）。 */
  isDesktop: boolean
  /** 打开了项目。 */
  hasWorkspace: boolean
  /** 语言服务是否就绪。 */
  lspReady: boolean
  /** 当前项目是不是已链接的 Gradle 项目。 */
  gradleAvailable: boolean
}

/**
 * 一条注册 = `ToolWindowEP` 的声明面（`ToolWindowBean`：id / anchor / icon / secondary /
 * canCloseContents / doNotActivateOnStart）+ `ToolWindowFactory` 的行为面（本仓叫
 * `available` / `applicable`，对应上游的 `shouldBeAvailable` `:54` 与 `isApplicableAsync` `:23-30`）。
 * 两个上游类型住在 `src/toolWindowFactories.ts`，装配规则也在那里（`beanToTask`）。
 */
export interface ToolWindowRegistration extends ToolWindowBean {
  /** `<toolWindow id="…">` 的 id，也是锚点表/顺序表/助记符表与持久化键里的键。 */
  id: string
  /** 条纹标题（`RegisterToolWindowTask.stripeTitle`；也被状态栏弹层与菜单用作文案）。 */
  title: string
  icon: unknown
  /** 默认停靠边（`<toolWindow anchor="…">` / `RegisterToolWindowTask.anchor`）。 */
  anchor: ToolWindowAnchor
  /**
   * 有没有 `Activate<Id>ToolWindow` 动作 —— **只有有**的才占 Alt+数字
   * （`ActivateToolWindowAction.Manager.getMnemonicForToolWindow` 读的是该动作的快捷键）。
   * 缺省 true；Gradle 与 Notifications 是 false（它们没有那个动作）。
   */
  numbered?: boolean
  /** 缺省 = 恒可用（上游没有 `shouldBeAvailable` 的那些窗口）。 */
  available?: (deps: ToolWindowAvailability) => boolean
  /**
   * `ToolWindowFactory.isApplicableAsync(project)`（`ToolWindowFactory.kt:23-30`，默认 true）：
   * **不通过 = 这条压根不注册**（条纹上没有它、菜单里也没有它），
   * 与上面 `available` 的"注册了但灰着"是两道不同的闸（上游 `ToolWindowSetInitializer.kt:350-355`）。
   * 本仓目前没有任何窗口答 false，所以这一位只由 `toolWindowTask()` 消费；
   * 把它写进类型是为了让第 1 件事与第 2 件事以后不再被合并回同一个谓词。
   */
  applicable?: (deps: ToolWindowAvailability) => boolean
}

/** 注册表。每条上方的注释就是这条记录的上游依据（`<toolWindow>` 注册的出处 / 可用性出处）。 */
export const TOOL_WINDOW_REGISTRY = [
  // 数组顺序 = **枚举顺序**，它同时决定三件事：菜单/状态栏弹层里的排列、各锚点内的默认次序
  // （按锚点过滤后的结果），以及 Alt+数字的编号（只数 `numbered !== false` 的那些）。
  // 所以这一列**不能按锚点重排**：结构与书签在 IDEA 的 keymap 里是 Alt+6 / Alt+7
  //（`$default.xml` 的 `ActivateOutlineToolWindow` / `ActivateBookmarksToolWindow`），
  // 按锚点分组会把它们的编号换掉 —— 那是用户看得见的行为。
  // `intellij.platform.lang.impl.xml` 的 `<toolWindow id="Project" anchor="left" …>`（项目视图）。
  // 可用性：上游没有 `shouldBeAvailable` —— 空项目也显示空态，所以恒可用。
  { id: 'files', title: '项目', icon: Files, anchor: 'left' },
  // IDEA 的 Commit 工具窗口（本仓的源代码管理面板就是它：信息 + 变更 + 提交动作）。
  // `CommitToolWindowFactory.isAvailable`（`vcsToolWindowFactories.kt:77-81`）要求项目里有 VCS 映射；
  // 本仓的等价物不能在渲染前问（要跑一次 git 才知道），所以维持"恒可用 + 面板自己报空态/错误"——
  // 真 exe 里打开一个没有 .git 的项目时它会如实说「读取 Git 日志失败…」（见 §AP 的取证记录）。
  { id: 'git', title: '源代码管理', icon: GitBranch, anchor: 'left' },
  // IDEA 的 Version Control / Log 窗口（`defaultToolWindowlayoutProvider.kt:246` 配在 bottom）。
  // `ChangeViewToolWindowFactory.isAvailable`（`vcsToolWindowFactories.kt:60-63`）= `canBeAvailableInProject`；
  // 本仓的等价物 = 桌面端 + 打开了项目（浏览器预览没有 git 通道，没有项目就没有仓库可读）。
  // `canCloseContents="true"`：`VcsExtensions.xml:193-194` 那条注册写了这个属性。本仓这一格目前只挂
  // 一条日志内容，所以这一位在界面上还问不出来（见报告「做不到」那节）。
  { id: 'vcslog', title: 'VCS 日志', icon: GitGraph, anchor: 'bottom', canCloseContents: true,
    available: deps => deps.isDesktop && deps.hasWorkspace },
  // IDEA 的 Find 窗口（`:246` 同一条 V1 默认布局）。
  { id: 'search', title: '搜索', icon: Search, anchor: 'bottom' },
  // `todo.xml` 的 `<toolWindow id="TODO" anchor="bottom" …>`（`:60-61`，那条注册写了 `canCloseContents="true"`）。
  { id: 'todo', title: '任务', icon: ListChecks, anchor: 'bottom', canCloseContents: true },
  // 结构视图：内容来自语言服务（`StructureView`）。上游没有对应的 `shouldBeAvailable`（IDEA 的结构
  // 窗口恒可用、只显示空态），这条是**本仓的映射**：没有语言服务就没有结构可给 ⇒ 灰着。
  // 它排在 TODO 之后不是随手写的：`$default.xml` 里 `ActivateOutlineToolWindow` 是 **Alt+6**、
  // 书签是 Alt+7，枚举顺序（= 助记符顺序）必须与那套键位一致。
  // `secondary="true"`：`intellij.platform.structureView.xml:55-56` 那条注册写的属性
  // （上游 `beanToTask` 把它写成 `sideTool`，`DesktopLayout.kt:46` 再拿它当 `WindowInfo.isSplit` 的初值 ⇒
  // 条纹按钮排在这一侧的**后半组**，`AbstractDroppableStripe.kt:59-61` 的 "side buttons in the end"）。
  { id: 'outline', title: '结构', icon: FolderTree, anchor: 'left', secondary: true, available: deps => deps.lspReady },
  // `bookmarks.xml` 的 `<toolWindow id="Bookmarks" anchor="left" secondary="true" …>`（`:47-48`）：
  // 本仓的书签是纯本地状态，恒可用。
  { id: 'bookmarks', title: '书签', icon: BookmarkIcon, anchor: 'left', secondary: true },
  // IDEA 的 Debug 窗口（`:248`）。本仓的调试器是 DAP 客户端，窗口恒在、内容空态。
  { id: 'debug', title: '调试', icon: Bug, anchor: 'bottom' },
  // `plugins/gradle/.../intellij.gradle.xml:228`：`<toolWindow id="Gradle" anchor="right" …>`。
  // `AbstractExternalSystemToolWindowFactory.java:32-34`：`shouldBeAvailable = !linkedProjectsSettings.isEmpty()`
  // —— 本仓的等价物是"这个项目是已链接的 Gradle 项目"。
  { id: 'gradle', title: 'Gradle', icon: Boxes, anchor: 'right', numbered: false,
    available: deps => deps.isDesktop && deps.hasWorkspace && deps.gradleAvailable },
  // `intellij.platform.ide.impl.xml:1210-1212`：`<toolWindow id="Notifications" anchor="right" secondary="true" …>`。
  // 没有 `ActivateNotificationsToolWindow` 动作 ⇒ 不占 Alt+数字。
  { id: 'notifications', title: '通知', icon: Bell, anchor: 'right', secondary: true, numbered: false },
] as const satisfies readonly ToolWindowRegistration[]

export type ToolWindowId = (typeof TOOL_WINDOW_REGISTRY)[number]['id']

type RegistryEntry = ToolWindowRegistration & { id: ToolWindowId }
const REGISTRY = TOOL_WINDOW_REGISTRY as readonly RegistryEntry[]
const BY_ID = new Map<string, RegistryEntry>(REGISTRY.map(entry => [entry.id, entry]))

/** 按 id 取注册项（`ToolWindowManager.getToolWindow(id)` 的那一半；查不到就是没有这个窗口）。 */
export function toolWindowRegistration(id: string): RegistryEntry | undefined {
  return BY_ID.get(id)
}

/**
 * `ToolWindowFactory.shouldBeAvailable(project)`：没有 `available` 的窗口恒可用。
 * 条纹按钮的"灰着但还在"（`ToolWindowImpl.isAvailable`）与菜单行的可用性都读这一条。
 */
export function shouldBeAvailable(id: ToolWindowId, deps: ToolWindowAvailability): boolean {
  const entry = BY_ID.get(id)
  return entry?.available ? entry.available(deps) : true
}

/** 由注册表派生一张 `Record<ToolWindowId, T>`（唯一的一处 `as`，不让它散到各处）。 */
function derived<T>(pick: (entry: RegistryEntry) => T): Record<ToolWindowId, T> {
  return Object.fromEntries(REGISTRY.map(entry => [entry.id, pick(entry)])) as Record<ToolWindowId, T>
}

/** 条纹标题表（菜单/状态栏弹层/工具窗口标题栏都读它）。 */
export const toolTitles: Record<ToolWindowId, string> = derived(entry => entry.title)

/** 图标表。`gradle` 用 lucide 的 Boxes：lucide 没有 Gradle 图标，用"模块/构件"语义代替。 */
export const toolIcons: Record<ToolWindowId, unknown> = derived(entry => entry.icon)

/**
 * 枚举顺序（三条磁贴、底部分页条、状态栏弹窗都按它列）= 注册表顺序，
 * 与助记符顺序解耦（见下面 `TOOL_MNEMONIC_ORDER`）。
 */
export const toolWindowOrder: ToolWindowId[] = REGISTRY.map(entry => entry.id)

/**
 * 每个窗口的**默认停靠边** —— 唯一来源（原先在 `toolWindowStripes` 与 `toolLayouts` 各有一份，
 * 后者会把所有窗口都摆到左侧）。
 */
export const DEFAULT_TOOL_ANCHORS: Record<ToolWindowId, ToolWindowAnchor> = derived(entry => entry.anchor)

/**
 * 每个停靠边内的**默认顺序** = 注册表顺序按锚点过滤。
 * 上游依据是 `defaultToolWindowlayoutProvider.kt:244-267` 的 V1/V2 默认布局
 * （left = Project → Commit → Structure → Bookmarks；bottom = Version Control → Find → TODO → Debug；
 * right = Gradle → Notifications）；这张派生结果与它一致这一点由判据锁住。
 */
export const DEFAULT_TOOL_ORDER: Record<ToolWindowAnchor, ToolWindowId[]> = {
  left: toolWindowOrder.filter(id => DEFAULT_TOOL_ANCHORS[id] === 'left'),
  bottom: toolWindowOrder.filter(id => DEFAULT_TOOL_ANCHORS[id] === 'bottom'),
  right: toolWindowOrder.filter(id => DEFAULT_TOOL_ANCHORS[id] === 'right'),
}

/**
 * EP 声明那三个布尔属性（`ToolWindowEP.java:78-82` 与 `:60-61`）在本仓的派生表。
 * 上游的去处逐条写在 `src/toolWindowFactories.ts`：
 *   · `secondary` → `RegisterToolWindowTaskData.sideTool`（`ToolWindowSetInitializer.kt:368`）
 *     → `WindowInfo.isSplit` 的初值（`DesktopLayout.kt:46`）→ 条纹按钮排在这一侧后半组
 *     （`AbstractDroppableStripe.kt:59-61`）；
 *   · `canCloseContents` → `canCloseContent`（`:369`）→ `ToolWindow.canCloseContents()`
 *     （`ToolWindowImpl.kt:647`）→ 关标签那一族的第一道闸（`ContentManagerImpl.java:139-141`、`:473`、
 *     `ContentTabLabel.java:170`、`CloseActiveTabAction.java:25/46`、`TabbedContentAction.java:87/114`）；
 *   · `doNotActivateOnStart` → `WindowInfo.isActiveOnStart`（`WindowInfoImpl.kt:165-170`）。
 * 三条都**由注册表派生**，别处不再按 id 判第二遍（这条由 `tests/tool-window-factories.test.mjs` 钉住）。
 */
export const toolSecondary: Record<ToolWindowId, boolean> = derived(entry => entry.secondary === true)
export const toolCanCloseContents: Record<ToolWindowId, boolean> = derived(entry => entry.canCloseContents === true)
/** `doNotActivateOnStart` 取反（同一个判据住在 `canActivateOnStart`，`WindowInfoImpl.kt:169`）。 */
export const toolActiveOnStart: Record<ToolWindowId, boolean> = derived(entry => entry.doNotActivateOnStart !== true)

/**
 * `ToolWindowManager.registerToolWindow(RegisterToolWindowTask)` 的**读的那一半**：
 * 把注册表里那一条（EP 声明 + 工厂谓词）按上游 `ToolWindowSetInitializer.kt:344-376` 装配成一条注册任务。
 * 返回 null = 这一条**不注册**（被档案压掉，或 `isApplicable` 答 false）。
 * `suppressedIds` 是上游的 `suppressedToolWindowIds`（`:350`）—— 本仓由 `src/toolLayoutProfiles.ts` 的
 * 档案覆盖表算（`hidden` = 上游 `register=false`），调用方传进来，本模块不读档案（避免注册表依赖持久层）。
 */
export function toolWindowTask(id: ToolWindowId, deps: ToolWindowAvailability, suppressedIds: readonly string[] = []): RegisterToolWindowTask | null {
  const entry = BY_ID.get(id)
  if (!entry) return null
  const factory: ToolWindowFactory | undefined =
    entry.available || entry.applicable
      ? {
          ...(entry.applicable ? { isApplicable: entry.applicable } : {}),
          ...(entry.available ? { shouldBeAvailable: entry.available } : {}),
        }
      : undefined
  // 上游 `:366`/`:367`：图标与锚点都可以由工厂覆盖。本仓的注册表里工厂不带这两维
  // （每个视图的 `createToolWindowContent` 那一半还是模板链，见文件头），所以只是原值。
  const task = beanToTask({ bean: entry, factory, deps, stripeTitle: entry.title, suppressedIds })
  return task ? { ...task, icon: entry.icon } : null
}

/**
 * `computeToolWindowBeans`（`ToolWindowSetInitializer.kt:379-409`）：一条项目状态过一遍注册表。
 * 顺序保持注册表顺序（= 枚举顺序，见上面那张表头的注释），装配不排第二遍。
 */
export function toolWindowTasks(deps: ToolWindowAvailability, suppressedIds: readonly string[] = []): RegisterToolWindowTask[] {
  const out: RegisterToolWindowTask[] = []
  for (const id of toolWindowOrder) {
    const task = toolWindowTask(id, deps, suppressedIds)
    if (task) out.push(task)
  }
  return out
}

/**
 * 底部面板的**标签顺序**：前面几个是固定的内容标签，后面跟着"停靠在底部的工具窗口"。
 *
 * `'about'` **不在**这里 —— IDEA 的「关于」是「帮助 › 关于」的**对话框**（`AboutAction`），
 * 不是工具窗口；本仓把它塞进底部面板是一处错放，已删除（`AboutDialog.vue` 本来就有）。
 *
 * `'blame'` 同样**不在**这里（2026-09-27 修正）—— IDEA 的「Annotate」不是内容标签：
 * `AnnotateToggleAction.java:139-153` 的 `doAnnotate(editor, …)` 拿到的是 `Editor`，注解由
 * `TextAnnotationGutterProvider`（同文件 `:18` 直接 import）画在**编辑器装订线**上；
 * `intellij.platform.ide.impl.xml` 的 `<toolWindow>` 清单里根本没有 Annotate，
 * 它出现在底部面板是一处错放。现在走 `src/editorBlameAnnotations.ts` 的 gutter，
 * 由 `CodeEditor.vue` 的 `:blame` 属性消费。
 */
export const BOTTOM_TABS = ['output', 'run', 'problems', 'references', 'hierarchy', 'terminal'] as const
export type BottomTabId = (typeof BOTTOM_TABS)[number]

/**
 * 助记符只用**有 Alt+数字 动作的那些**窗口（注册表里的 `numbered`）。
 * Gradle 工具窗口在 IDEA 里没有 `ActivateGradleToolWindow` 动作（插件注册里只有
 * `toolWindow id="Gradle" anchor="right"`，没有任何快捷键绑定），所以它不该出现在
 * Alt+数字 的编号里 —— 否则界面上会多出一个 IDEA 里不存在的 "Alt+11"。
 */
export const TOOL_MNEMONIC_ORDER: ToolWindowId[] = REGISTRY.filter(entry => entry.numbered !== false).map(entry => entry.id)

// IDEA's keymap also binds Alt+0 to the Commit tool window; TaoCode's 源代码管理 panel
// *is* the commit tool window (message box + changes + commit actions), so it answers
// Alt+0 in addition to its own stripe number (ActivateToolWindowAction.kt:88-111).
export const TOOL_MNEMONIC_ALIASES: Record<string, ToolWindowId> = { '0': 'git' }

export const TOOL_MNEMONIC_BINDINGS = mnemonicBindings(TOOL_MNEMONIC_ORDER, TOOL_MNEMONIC_ALIASES)

export function toolWindowMnemonic(id: ToolWindowId): string | undefined {
  return mnemonicOf(TOOL_MNEMONIC_ORDER, id)
}
