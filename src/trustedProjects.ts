// 受信任项目（IDEA `com.intellij.ide.trustedProjects` 一族在本仓的落点）。
//
// 上游要解决的问题：打开一个陌生目录时，项目里的构建脚本 / 运行配置可能在用户还没看清之前
// 就被 IDE 执行。`TrustedProjects.kt:79-95` 的 `getProjectTrustedState` 是唯一判据，
// 执行侧各自读它：`BuildManager.java:765`（编译）、`ProjectStartupRunner.kt:106`（启动任务）、
// `ExternalSystemUtil.java:310`（导入 / 自动同步）、`LspClientImpl.kt:314`（语言服务）。
// 没被信任 = 安全模式：项目照常打开、编辑，但构建 / 运行 / 调试 / 终端一律不跑，并说明原因。
//
// 存储形态：上游 `TrustedPaths`（`impl/TrustedPaths.kt`）是应用级 `trusted-paths.xml` 里的
// 一张 `Map<Path, Boolean>`（显式信任 true、显式不信任 false），`TrustedProjectsStateStorage.kt:29-38`
// 按**最近祖先**取答案（越具体越优先）。本仓没有独立的存储层，把它落成应用级
// `generalSettings.trustedPaths`（native 键表 + 默认值 + 校验 + 预览白名单四处登记，同 `audioCuesMode`）。
//
// 纯函数都在这里：路径归一、最近祖先判定、清单增改、拦截文案；宿主只负责弹框与请求。
// 同一套规则在 `native/trusted_paths.cpp` 里还有一份原生副本 —— 那是执行侧的**硬边界**
// （前端被绕开时 run.start / term.create / 调试仍会被拒），两份必须同步改。

/** 一条信任记录：`path` 归一后存放，`trusted` 为假表示「用户明确选了不信任」（不再问）。 */
export interface TrustedPathEntry {
  path: string
  trusted: boolean
}

/** 上游 `ThreeState`：YES / NO / UNSURE（`TrustedProjects.kt:74-95`）。 */
export type TrustState = 'trusted' | 'untrusted' | 'unknown'

/** 打开陌生目录时的选择（上游 `OpenUntrustedProjectChoice`：TRUST_AND_OPEN / OPEN_IN_SAFE_MODE / CANCEL）。 */
export type TrustChoice = 'trust' | 'distrust' | 'cancel'

/** 路径归一：正斜杠、去尾斜杠、小写。Windows 路径大小写不敏感，上游用 `PathPrefixTree` 同一口径。 */
export function normalizeTrustedPath(path: string): string {
  let normalized = path.trim().replace(/\\/g, '/')
  while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  // 盘符根（`C:/`）去掉尾斜杠后成了 `c:`，它不再是任何路径的祖先（会误配 `c:foo`）——补回一个斜杠。
  if (/^[a-z]:$/i.test(normalized)) normalized += '/'
  return normalized.toLowerCase()
}

/**
 * `child` 是否落在 `ancestor` 之内。
 *
 * 按**路径段**判，不是字符串前缀：`/a/bc` 不在 `/a/b` 里。两者相等也算（自身被信任）。
 */
export function isPathInside(child: string, ancestor: string): boolean {
  if (!ancestor) return false
  if (child === ancestor) return true
  return child.startsWith(ancestor.endsWith('/') ? ancestor : ancestor + '/')
}

/** 清单里与 `path` 匹配的**最近祖先**（上游 `getAncestorEntries(path).maxByOrNull { nameCount }`）。 */
export function closestTrustEntry(path: string, entries: readonly TrustedPathEntry[] | undefined): TrustedPathEntry | undefined {
  const normalized = normalizeTrustedPath(path)
  if (!normalized) return undefined
  let best: TrustedPathEntry | undefined
  let bestLength = -1
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.path !== 'string') continue
    const ancestor = normalizeTrustedPath(entry.path)
    if (!ancestor || !isPathInside(normalized, ancestor)) continue
    if (ancestor.length > bestLength) { best = entry; bestLength = ancestor.length }
  }
  return best
}

/** 该路径的信任状态：显式不信任胜过更短的显式信任（越具体越优先），没有记录 = `unknown`。 */
export function trustedStateFor(path: string, entries: readonly TrustedPathEntry[] | undefined): TrustState {
  const entry = closestTrustEntry(path, entries)
  if (!entry) return 'unknown'
  return entry.trusted ? 'trusted' : 'untrusted'
}

/** 未信任的项目**不弹框也能读**的判据（执行入口用它，`TrustedProjects.isProjectTrusted` 的等价物）。 */
export function isProjectTrusted(path: string | undefined | null, entries: readonly TrustedPathEntry[] | undefined): boolean {
  if (!path) return false
  return trustedStateFor(path, entries) === 'trusted'
}

/**
 * 把一次「以后不再问」的选择写进清单（上游 `TrustedPaths.setProjectTrustedState`）：
 * 同一条路径就地更新，别的条目保持原样（显式不信任不因列表重排而丢）。
 */
export function rememberTrust(entries: readonly TrustedPathEntry[] | undefined, path: string, trusted: boolean): TrustedPathEntry[] {
  const normalized = normalizeTrustedPath(path)
  const next = (entries ?? []).filter(entry => entry && typeof entry.path === 'string' && normalizeTrustedPath(entry.path) !== normalized)
  if (!normalized) return next
  next.push({ path: normalized, trusted })
  return next
}

/** 持久清单 + 本次会话的临时答案（没勾「不再问」时只活到关掉应用）。 */
export function mergeTrustEntries(persisted: readonly TrustedPathEntry[] | undefined, session: readonly TrustedPathEntry[] | undefined): TrustedPathEntry[] {
  return [...(persisted ?? []), ...(session ?? [])]
}

/** IDEA 的确认框文案（`untrusted.project.open.dialog.*` 一族）。 */
export const TRUST_DIALOG_TITLE = '不受信任的项目'
export function trustDialogMessage(name: string, root: string): string {
  return `项目「${name || root}」位于你尚未信任的位置。项目里的构建脚本与运行配置可能在你确认之前被执行；选择「信任并打开」才会运行它们，选择「以安全模式打开」则只浏览与编辑。`
}
export const TRUST_BUTTONS = { trust: '信任并打开', distrust: '以安全模式打开', cancel: '取消' } as const
export const TRUST_REMEMBER_LABEL = '以后不再询问'

// ── 打开外部链接前的那一句（`BrowserLauncherImpl.kt:59-87` 的 `canBrowse`）────────────
//
// 上游那条链是：`BrowserLauncher.browse(uri)` → `canBrowse(project, uri)`：
//   · 项目已信任 → 直接开（`:69-71`），**不问**；
//   · 项目没信任 → 一个警告框，三个按钮（`:72-80`）：
//       `external.link.confirmation.yes.label` = "Open"（`IdeBundle.properties:3152`）、
//       `external.link.confirmation.trust.label` = "Trust Project and Open"（`:3153`）、
//       `CommonBundle.getCancelButtonText()` = "Cancel"；默认按钮是 **Open**（`:79`），
//       但**焦点**落在「信任项目并打开」（`:80`）；
//   · 答 Open → 开，但**不**写信任清单（`:82`）；答 Trust Project and Open →
//     `setProjectTrusted(true)` 然后开（`:83`）；其它（含 Esc/关窗）→ 不开（`:84`）。
// 标题 `external.link.confirmation.title` = "Open Link"（`:3149`），
// 正文 `external.link.confirmation.message.0`（`:3151`）把 URL 放在最后一行。
//
// 上游另有一条**文件级**的那一支（`confirmOpeningUntrustedFile` `:89-108`，按钮
// `external.link.confirmation.trust.file.label` = "Trust File and Open" `:3154`）：
// 本仓的信任存储只有项目/目录级（`generalSettings.trustedPaths`），没有单文件那一档
// （`native/trusted_paths.cpp` 的三道硬边界也全是按目录判的），所以这里只落项目级，
// 文件级如实登记为做不到。

/** `external.link.confirmation.title`（`IdeBundle.properties:3149`）。 */
export const EXTERNAL_LINK_TITLE = '打开链接'
/** 那三个按钮：Open / Trust Project and Open / Cancel（`:3152-3153` + `CommonBundle.getCancelButtonText()`）。 */
export const EXTERNAL_LINK_LABELS = { open: '打开', trust: '信任项目并打开', cancel: '取消' } as const
export type ExternalLinkChoice = 'open' | 'trust' | 'cancel'

/** `external.link.confirmation.message.0`（`:3151`）：一句问话 + URL 单独一行。 */
export function externalLinkMessage(url: string): string {
  return `确定要在浏览器或关联的应用里打开这个链接吗？\n\n${url}`
}

/**
 * 该不该问这一句（`:60-71`）：项目已信任就不问（返回 null）；
 * 没信任就给一组按钮文案 —— 默认按钮是「打开」，**焦点**在「信任项目并打开」（`:79-80`）。
 */
export function externalLinkPrompt(
  url: string, root: string | undefined | null, entries: readonly TrustedPathEntry[] | undefined,
): { message: string; labels: typeof EXTERNAL_LINK_LABELS; focused: ExternalLinkChoice } | null {
  if (isProjectTrusted(root, entries)) return null
  return { message: externalLinkMessage(url), labels: EXTERNAL_LINK_LABELS, focused: 'trust' }
}

/**
 * 答完之后要做的事：开不开、信任清单要不要改。
 * `trust` 走 `rememberTrust`（与启动时那个确认框同一份存储，`:83` 的 `setProjectTrusted`）；
 * `open` 什么都不写（`:82`）；`cancel` 不开也不写（`:84`）。
 */
export function externalLinkOutcome(
  choice: ExternalLinkChoice, root: string | undefined | null, entries: readonly TrustedPathEntry[] | undefined,
): { open: boolean; entries: TrustedPathEntry[] } {
  const current = (entries ?? []).filter(entry => entry && typeof entry.path === 'string')
  if (choice === 'trust' && root) return { open: true, entries: rememberTrust(entries, root, true) }
  return { open: choice !== 'cancel', entries: current }
}

// —— 确认框里的「始终信任来自此来源的项目」（上游 `TrustedProjectStartupDialog` 的 trust-all 勾选）——
//
// 上游 `TrustedProjectsDialog.kt:64-71`：
//   if (openChoice == TRUST_AND_OPEN) {
//     TrustedProjects.setProjectTrusted(locatedProject, true)
//     if (projectRoot.parent != null && dialog.isTrustAll) {
//       service<TrustedPathsSettings>().addTrustedPath(projectRoot.parent.toString())
//     }
//   }
// 注意它写进的是 **用户手管的** `TrustedPathsSettings`（`trusted-paths.xml`，全部条目隐式为 true），
// 不是确认框那份 `TrustedPaths` —— 所以它立刻出现在「设置 › 受信任位置」那张表里，与
// `TrustedHostsConfigurable.getMergedTrustedPaths()`（`:66-71`）读的是同一份。本仓只有一个
// 应用级清单 `generalSettings.trustedPaths`，两张表合一，所以下面直接把父目录写进同一份清单。
//
// **本仓不渲染这个勾选**（不假控件）：勾选后的落库点是 `App.vue` 的 `resolveTrustPrompt`
// （`App.vue:2653` 挂的 `@resolve`），而 `src/App.vue` 本批只读（余量 57 行）。规则先落地，
// 接线请求见本批报告。

/** 勾选框文案（上游是 `IdeBundle` 的一条 message，键名见 `TrustedProjectStartupDialog` 资源包）。 */
export const TRUST_ALL_LABEL = '始终信任来自此来源的项目'

/** 项目的**父目录**（`projectRoot.parent`）；盘符根与相对路径没有父目录，给 null。 */
export function trustedLocationParent(projectRoot: string): string | null {
  const normalized = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized) return null
  const at = normalized.lastIndexOf('/')
  if (at < 0) return null
  const parent = normalized.slice(0, at)
  // `C:` 这样的裸盘符就是根，`C:/foo` 的父目录正是它（上游 `Path.getParent()` 同样给 `C:\`）。
  return /^[a-z]:$/i.test(parent) ? `${parent}/` : parent
}

/**
 * `TrustedProjects.isProjectLocationOfferedForTrust`（`TrustedProjects.kt:103-107`）：
 * 只有当**父目录不在 IDE 自己的配置目录里**时才可以提供「信任这个位置」。
 * 上游的理由写在 `:98-102`：存在配置目录里的项目与所有同类项目共用一个父目录
 * （前端镜像项目就是这种，`ThinClientProjectUtil.createProjectDir`），信任它会连带信任
 * 现有的和将来的全部，还把一个 IDE 内部路径塞进用户的受信任位置清单。
 */
export function isProjectLocationOfferedForTrust(projectRoot: string, configDir: string | null | undefined): boolean {
  const parent = trustedLocationParent(projectRoot)
  if (!parent) return false
  if (!configDir) return true
  return !isPathInside(normalizeTrustedPath(parent), normalizeTrustedPath(configDir))
}

/**
 * 一次确认的结果要往清单里记哪些路径（上游 `TrustedProjectsDialog.kt:64-71` 的逐行等价物）。
 * 返回空数组 = 什么都不记。
 *   · 选了「信任并打开」→ 记项目根；额外勾了 trust-all 且这一项**允许**提供（`:66` 的
 *     `projectRoot.parent != null`，外加 `isProjectLocationOfferedForTrust` 的门禁）→ 再记父目录。
 *   · 选了「以安全模式打开」→ 记项目根为**不信任**（`:73` `setProjectTrusted(locatedProject, false)`），
 *     且**不**接受 trust-all（上游那段 `if` 整个在 `TRUST_AND_OPEN` 分支里）。
 *   · 取消 → 什么都不记（`:95` 直接 return false，不碰状态）。
 */
export function trustDecisionPaths(
  choice: TrustChoice, projectRoot: string, trustAll: boolean, configDir?: string | null,
): { path: string; trusted: boolean }[] {
  if (choice === 'cancel') return []
  const root = normalizeTrustedPath(projectRoot)
  if (!root) return []
  const trusted = choice === 'trust'
  const out = [{ path: root, trusted }]
  if (trusted && trustAll && isProjectLocationOfferedForTrust(projectRoot, configDir)) {
    const parent = trustedLocationParent(projectRoot)
    if (parent) out.push({ path: normalizeTrustedPath(parent), trusted: true })
  }
  return out
}

/**
 * 把一次确认的结果落进清单（`rememberTrust` 的批量版，逐条走同一套归一与覆盖规则）。
 * 同一条路径出现两次时后写的赢 —— trust-all 的父目录恰好可能已在清单里。
 */
export function applyTrustDecision(
  entries: readonly TrustedPathEntry[] | undefined, decision: readonly { path: string; trusted: boolean }[],
): TrustedPathEntry[] {
  // 拷一份可变的：入参是只读清单，而 rememberTrust 逐条返回新数组（不原地改）。
  let next: TrustedPathEntry[] = [...(entries ?? [])]
  for (const item of decision) next = rememberTrust(next, item.path, item.trusted)
  return next
}

/**
 * 未信任时执行入口的**可见原因**（IDEA 的 `UntrustedProjectNotificationProvider` 那张编辑器横幅
 * 只说「Trust Project」，本仓在动作被挡下的那一次直接说清是哪条路、怎么解）。
 */
export function trustBlockedMessage(action: string, root: string, name?: string): string {
  const label = name || root || '当前项目'
  return `安全模式：${label} 尚未被信任，已阻止${action}。在项目打开时选择「信任并打开」，或先关闭再用受信任的方式重开。`
}

/** 执行入口在调用前问一句：`null` = 放行，字符串 = 拦截并用它提示。未打开项目时不拦（各入口自报错）。 */
export function trustBlockReason(action: string, root: string | undefined | null, entries: readonly TrustedPathEntry[] | undefined, name?: string): string | null {
  if (!root) return null
  return isProjectTrusted(root, entries) ? null : trustBlockedMessage(action, root, name)
}

/** 该打开动作要不要弹确认框（上游：状态已知就不问，「已信任」直接复用）。 */
export function needsTrustPrompt(root: string | undefined | null, entries: readonly TrustedPathEntry[] | undefined): boolean {
  if (!root) return false
  return trustedStateFor(root, entries) === 'unknown'
}

// —— 设置页「受信任位置」（上游 `TrustedHostsConfigurable`，应用级 `trusted.hosts`，
//    `intellij.platform.ide.impl.xml:783-786` 注册在 groupId="appearance"）——
// 上游那张表是**两个存储的并集**：用户手管的 `TrustedPathsSettings` + 确认框里勾了
// 「不再询问」的 `TrustedPaths`（`getMergedTrustedPaths`），新增走文件选择器、删除/去重后
// 按差集发信任事件（`applyMergedTrustedPaths`）。本仓只有一个应用级清单
// `generalSettings.trustedPaths`，所以这里是它的列表呈现与增删改（去重按归一后的路径）。

/**
 * 设置页那一张清单其实是**两个存储**并起来看的（上游
 * `platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:61-69`：
 * 「用户手管的 `TrustedPathsSettings`」+「在确认框里当场答应过的 `TrustedPaths`」，
 * 顺序就是**先设置里的、后对话框里的那一份**）。
 * 本仓第一档落 `generalSettings.trustedPaths`（落盘），第二档是**会话级**的这份模块内数组
 * （不落盘，与上游 `TrustedPaths` 的「应用级但由确认框写」同源；上游那份是持久存储，
 * 本仓的会话答案上游也是「没勾不再询问就只活这一次」，见 `src/workspaceLifecycle.ts` 的 `sessionTrust`）。
 */
export type TrustedLocationSource = 'settings' | 'explicit'

const sessionTrustedLocations: TrustedPathEntry[] = []

/** 会话里「当场答应过」的那些路径（拷贝出去，别让调用方改到内部数组）。 */
export function sessionTrustEntries(): TrustedPathEntry[] {
  return sessionTrustedLocations.map(entry => ({ ...entry }))
}

/** 记一条会话级信任（`TrustedPaths` 那一档；不落盘）。空路径不记。 */
export function rememberSessionTrust(path: string, trusted: boolean): void {
  const normalized = normalizeTrustedPath(path)
  if (!normalized) return
  const at = sessionTrustedLocations.findIndex(entry => entry.path === normalized)
  if (at >= 0) sessionTrustedLocations.splice(at, 1, { path: normalized, trusted })
  else sessionTrustedLocations.push({ path: normalized, trusted })
}

/** 整表替换会话级那一档（设置页应用差集时用，`applyMergedTrustedPaths` 的等价动作）。 */
export function replaceSessionTrust(entries: readonly TrustedPathEntry[]): void {
  sessionTrustedLocations.length = 0
  for (const entry of entries) if (entry && typeof entry.path === 'string' && entry.path) sessionTrustedLocations.push({ ...entry })
}

/** 设置页里的一行：归一后的路径 + 状态文案 + 它来自哪个存储（上游那一张表也是两个存储并的）。 */
export interface TrustedLocationRow {
  path: string
  trusted: boolean
  label: string
  /** `settings` = 用户手管的那一份；`explicit` = 只在确认框里答应过的那一份。 */
  source: TrustedLocationSource
}

/**
 * 清单 → 列表行。**两个存储并一张表**（`TrustedHostsConfigurable.kt:66-69` 的
 * `settingsPaths + explicitlyTrustedPaths` 那个拼接顺序）：先 `entries`，再补 `extra` 里没出现过的。
 * 同一路径只出现一行：同一份存储里后写的覆盖先写的（与 `closestTrustEntry` 的
 * 「越具体越优先」同口径），跨存储时**设置里的那一份赢**（上游也是用户手管的优先）。
 * `extra` 不给时默认取会话级那份（设置页要的并集）；传 `[]` 可以只看持久清单。
 */
export function trustedLocationRows(
  entries: readonly TrustedPathEntry[] | undefined,
  extra: readonly TrustedPathEntry[] = sessionTrustedLocations,
): TrustedLocationRow[] {
  const index = new Map<string, TrustedLocationRow>()
  const collect = (list: readonly TrustedPathEntry[] | undefined, source: TrustedLocationSource): void => {
    for (const entry of list ?? []) {
      if (!entry || typeof entry.path !== 'string') continue
      const path = normalizeTrustedPath(entry.path)
      if (!path) continue
      if (source === 'explicit' && index.has(path)) continue
      const trusted = entry.trusted !== false
      index.set(path, { path, trusted, label: trusted ? '已信任' : '不信任（不再询问）', source })
    }
  }
  collect(entries, 'settings')
  collect(extra, 'explicit')
  return [...index.values()]
}

/**
 * 把设置页那张表应用回**两个存储**（上游 `applyMergedTrustedPaths` `:80-89` 的差集口径）：
 *   · 表里还留着、原本就在持久清单里的 → 继续留在持久清单；
 *   · 表里新出现的（两个存储都没有过）→ 算用户手加的，进**持久清单**
 *     （`:88` 的 `it in settingsBefore || it !in explicitBeforeSet`）；
 *   · 表里还留着、但只来自「当场答应过」那一档 → 留在那一档（`:89`）；
 *   · 表里被删掉的 → 两边都没了（删一条会话项不该把用户手管的那条一起删掉，反之亦然）。
 */
export function applyMergedLocations(
  entries: readonly TrustedPathEntry[] | undefined,
  extra: readonly TrustedPathEntry[],
  kept: readonly string[],
): { entries: TrustedPathEntry[]; session: TrustedPathEntry[] } {
  const keptPaths = new Set(kept.map(path => normalizeTrustedPath(path)).filter(Boolean))
  const settingsList = (entries ?? []).filter(entry => entry && typeof entry.path === 'string')
  const settingsPaths = new Set(settingsList.map(entry => normalizeTrustedPath(entry.path)))
  const explicitList = extra.filter(entry => entry && typeof entry.path === 'string')
  const explicitPaths = new Set(explicitList.map(entry => normalizeTrustedPath(entry.path)))
  const persisted = settingsList.filter(entry => keptPaths.has(normalizeTrustedPath(entry.path)))
  for (const path of kept) {
    const normalized = normalizeTrustedPath(path)
    if (!normalized || settingsPaths.has(normalized) || explicitPaths.has(normalized)) continue
    persisted.push({ path: normalized, trusted: true })
  }
  return {
    entries: persisted,
    session: explicitList.filter(entry => keptPaths.has(normalizeTrustedPath(entry.path))),
  }
}

/** 输入框里敲的路径：空/纯空白不算路径（上游的 OK 门禁也是「选了非空路径才能加」）。 */
export function parseTrustedLocationInput(text: string): { path: string } | { error: string } {
  const path = normalizeTrustedPath(text)
  if (!path) return { error: '请输入要信任的文件夹路径。' }
  return { path }
}

/** 加一条：已在清单里的路径不重复添加（上游按 Set 去重）。返回新清单或一条可见错误。 */
export function addTrustedLocation(entries: readonly TrustedPathEntry[] | undefined, path: string): { entries: TrustedPathEntry[] } | { error: string } {
  const parsed = parseTrustedLocationInput(path)
  if ('error' in parsed) return parsed
  const current = entries ?? []
  if (current.some(entry => entry && typeof entry.path === 'string' && normalizeTrustedPath(entry.path) === parsed.path))
    return { error: `「${parsed.path}」已在清单里。` }
  return { entries: [...current, { path: parsed.path, trusted: true }] }
}

/** 删一条（按归一后的路径匹配；不在清单里的路径原样返回，不报错 —— 幂等）。 */
export function removeTrustedLocation(entries: readonly TrustedPathEntry[] | undefined, path: string): TrustedPathEntry[] {
  const target = normalizeTrustedPath(path)
  return (entries ?? []).filter(entry => !entry || typeof entry.path !== 'string' || normalizeTrustedPath(entry.path) !== target)
}

/** 改一条的信任状态（「不信任（不再询问）」要能从设置页改回信任，上游靠差集发 onProjectTrusted）。 */
export function setTrustedLocationState(entries: readonly TrustedPathEntry[] | undefined, path: string, trusted: boolean): TrustedPathEntry[] {
  const target = normalizeTrustedPath(path)
  return (entries ?? []).map(entry =>
    entry && typeof entry.path === 'string' && normalizeTrustedPath(entry.path) === target ? { path: target, trusted } : entry)
}
