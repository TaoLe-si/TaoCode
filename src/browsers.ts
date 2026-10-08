// 浏览器表（`ConfigurableWebBrowser` / `BrowserSettings` / `BrowserFamily` / `BrowserLauncher` 一族
// 在本仓的**规则侧**落点）。
//
// 判词 `pf/browsers` 的五项缺口里，③「`BrowserLauncherImpl` 的多浏览器启动」与 ②「`BrowserSelector`
// 的选择对话框」是**同一个根因**：宿主没有「用指定程序打开 URL」的通道 —— `shell.openUrl` 一律走系统
// 默认浏览器（`native/workspace.cpp` 的 `open_external`）。要按浏览器启动就得改宿主 `Method` 清单
// （`src/bridge.ts` 的 union 与 `native/main.cpp` 的 switch），两者都不在本 lane，如实登记为待办。
// ④内置预览服务器要宿主 HTTP 服务器（与 lp/webserver 同判），⑤菜单面在禁改的 `src/App.vue`。
//
// 能做且不依赖宿主的是**这张表与它的判定规则**，全部逐条对齐上游：
//   · `platform/platform-api/src/com/intellij/ide/browsers/BrowserFamily.java:15-29`
//       —— 家族只有 CHROME / FIREFOX / EXPLORER / SAFARI 四个，每个带 windows/unix/mac 三条执行路径；
//          `getExecutionPath()` `:53-63` 按当前系统挑一条。（**没有** EDGE / OPERA 家族成员 ——
//          Edge/Opera 是靠 `WebBrowserManager.isEdge` / `isOpera` 从名字与路径认出来的变体，
//          家族仍是 CHROME，见下面 `browserVariant`。）
//   · `platform/platform-impl/src/com/intellij/ide/browsers/ConfigurableWebBrowser.java:17-24`
//       —— 一行的字段：id / family / name / active / path / specificSettings；
//          `setPath` `:105-107` 把路径归一成系统无关分隔符。
//   · `platform/platform-impl/src/com/intellij/ide/browsers/WebBrowserManager.java:459-463`
//       `getFirstActiveBrowser()` —— 第一个 `isActive()` 且有路径的；
//          `:123-140` `checkNameAndPath`（名字 → 文件名 → 父目录名，父目录是 `bin` 时再上一级）；
//          `:108-121` `isYandexBrowser` / `isEdge` / `isOpera`。
//   · `platform/platform-impl/src/com/intellij/ide/browsers/DefaultBrowserPolicy.java:18-19`
//       `SYSTEM, FIRST, ALTERNATIVE`；`BrowserLauncherImpl.kt:54-57` `getDefaultBrowser()` 与
//       `:123-131` `substituteBrowser()` —— 策略为 `FIRST` 时用 `firstActiveBrowser`。
//   · `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:259-265`
//       `defaultBrowserCommand` —— 「交给系统默认浏览器」的**命令表**（Windows `cmd /c start ""`、
//       macOS `open`、其余 `xdg-open`，都没有就是 null）。
//
// 本模块**不发起任何启动**，只出数据与判定。判据：`tests/browsers.test.mjs`。

/** 上游 `BrowserFamily`（`BrowserFamily.java:15`）的四个常量，一一对应，不增不减。 */
export type BrowserFamily = 'chrome' | 'firefox' | 'explorer' | 'safari'

export const BROWSER_FAMILIES: readonly BrowserFamily[] = ['chrome', 'firefox', 'explorer', 'safari']

interface FamilyDescriptor {
  id: BrowserFamily
  /**
   * `family.getName()`（`BrowserFamily.java:31`/`:42` 的字段与 getter `:65-67`）= 构造子的
   * **第一个**参数 `IdeBundle.message("browsers.<id>")`（`BrowserFamily.java:16`/`:22`/`:28`/`:29`）。
   * 四个值都在 `platform/platform-api/resources/messages/IdeBundle.properties` 里逐字读过：
   * `browsers.chrome=Chrome`（`:27`）、`browsers.firefox=Firefox`（`:26`）、
   * `browsers.explorer=Internet Explorer`（`:24`）、`browsers.safari=Safari`（`:25`）。
   * 原写「第四个构造参数」与 `'Google Chrome'`（那是 chrome 的 **mac** 执行路径，`BrowserFamily.java:16`
   * 的第四个参数）—— 2026-10-06 trust5 按 `IdeBundle.properties:27` 订正，见本批报告 §1 的订正留痕。
   */
  label: string
  /** `BrowserFamily` 构造参数的第二/三/四个：windows / unix / mac 执行路径（`:16-29`）。 */
  windows: string
  unix: string | null
  mac: string | null
}

/**
 * 四个家族的执行路径（`BrowserFamily.java:16` CHROME、`:22` FIREFOX、`:28` EXPLORER、`:29` SAFARI）。
 * `EXPLORER` 与 `SAFARI` 的 unix 路径是 `null`（`:28-29` 的第三个构造参数）——
 * 那两个家族只在本平台上有意义，`executionPathFor` 因此在别的系统上返回 null
 * （`BrowserFamily.getExecutionPath()` `:53-63`）。
 */
export const BROWSER_FAMILY_TABLE: readonly FamilyDescriptor[] = [
  { id: 'chrome', label: 'Chrome', windows: 'chrome', unix: 'google-chrome', mac: 'Google Chrome' },
  { id: 'firefox', label: 'Firefox', windows: 'firefox', unix: 'firefox', mac: 'Firefox' },
  { id: 'explorer', label: 'Internet Explorer', windows: 'iexplore', unix: null, mac: null },
  { id: 'safari', label: 'Safari', windows: 'safari', unix: null, mac: 'Safari' },
]

/** 本仓的平台口径（宿主只跑 Windows/macOS/Linux 桌面；上游 `SystemInfo` 的等价物）。 */
export type HostOs = 'windows' | 'mac' | 'linux'

/** `BrowserFamily.getExecutionPath()`（`BrowserFamily.java:53-63`）：按当前系统挑一条，没有就是 null。 */
export function executionPathFor(family: BrowserFamily, os: HostOs): string | null {
  const row = BROWSER_FAMILY_TABLE.find(item => item.id === family)
  if (!row) return null
  if (os === 'windows') return row.windows
  if (os === 'mac') return row.mac
  return row.unix
}

/** `ConfigurableWebBrowser.specificSettings`（`BrowserLauncherAppless.kt:220-221` 读的就是这两项）。 */
export interface BrowserSpecificSettings {
  /** `additionalParameters`（`BrowserLauncherAppless.kt:220`）—— 附加命令行参数。 */
  additionalParameters?: readonly string[]
  /** `environmentVariables`（`BrowserLauncherAppless.kt:221`）。 */
  environmentVariables?: Readonly<Record<string, string>>
}

/** 一行浏览器（`ConfigurableWebBrowser.java:17-24` 的字段）。 */
export interface ConfigurableWebBrowser {
  /**
   * 上游的 `UUID` 稳定键（`ConfigurableWebBrowser.java:18`）。注释在 `:42` 说它必须
   * 「跨所有 IDE 版本、所有机器、所有用户保持不变」—— `WebBrowserManager.kt` 的六个内置浏览器
   * 就靠它认「这一行是内置的、不能删」（`BrowserSettingsPanel.kt:116` `isRemovable`）。
   * 用户新增的行 `id` 为 `undefined`（上游给随机 UUID，见 `ConfigurableWebBrowser.java:28`）。
   */
  id?: string
  /** 上游用 `UUID` 当稳定键；本仓的表格增删改按名字走（见 `addBrowser`/`updateBrowser`）。 */
  name: string
  family: BrowserFamily
  /** `path`（`ConfigurableWebBrowser.java:22`）—— 已归一成系统无关分隔符。 */
  path: string | null
  /** `active`（`:21`）—— 上游表格里每个浏览器前面的勾选框。 */
  active: boolean
  specificSettings?: BrowserSpecificSettings
}

/** `ConfigurableWebBrowser.setPath`（`:105-107`）：反斜杠转正斜杠 + 空串归 null。 */
export function normalizeBrowserPath(path: string | null | undefined): string | null {
  const normalized = (path ?? '').trim().replace(/\\/g, '/')
  return normalized ? normalized : null
}

/**
 * `WebBrowserManager.checkNameAndPath`（`WebBrowserManager.java:123-140`）：
 * 名字含（忽略大小写）→ 命中；否则取路径的**文件名**判；再否则取父目录名判，
 * 父目录名是 `bin` 时**再上一级**判（`/usr/bin/chromium` → `chromium` → `bin` → `usr`）。
 */
export function checkNameAndPath(what: string, browser: Pick<ConfigurableWebBrowser, 'name' | 'path'>): boolean {
  if (browser.name.toLowerCase().includes(what.toLowerCase())) return true
  const path = browser.path
  if (!path) return false
  const segments = path.split('/')
  const fileName = segments[segments.length - 1]!
  if (fileName.toLowerCase().includes(what.toLowerCase())) return true
  let parentName = segments[segments.length - 2] ?? ''
  if (parentName === 'bin') parentName = segments[segments.length - 3] ?? ''
  return parentName.toLowerCase().includes(what.toLowerCase())
}

/** 上游从 CHROME 家族里认出来的变体（`ConfigurableWebBrowser.getIcon()` `:61-86` 的判据 + `WebBrowserManager`）。 */
export type BrowserVariant = 'chromium' | 'canary' | 'opera' | 'vivaldi' | 'brave' | 'nwjs' | 'edge' | 'yandex' | 'default'

/**
 * 变体识别（`ConfigurableWebBrowser.getIcon()` `ConfigurableWebBrowser.java:61-86` +
 * `WebBrowserManager.isOpera` `:119-121` / `isEdge` `:112-117` / `isYandexBrowser` `:108-110`）：
 * Edge / Yandex / Opera 必须是 CHROME 家族（上游 `:109`/`:113` 明确判了 family），
 * Opera 例外 —— 上游 `isOpera` 只判名字与路径，不限家族。
 * `Dartium`/`Chromium`/`Canary`/`Vivaldi`/`Brave`/`node-webkit`/`nw`/`nwjs` 按 `checkNameAndPath` 判。
 */
export function browserVariant(browser: Pick<ConfigurableWebBrowser, 'name' | 'path' | 'family'>): BrowserVariant {
  const isChrome = browser.family === 'chrome'
  if (isChrome && checkNameAndPath('Yandex', browser)) return 'yandex'
  if (isChrome && checkNameAndPath('Edge', browser)) return 'edge'
  if (checkNameAndPath('Opera', browser)) return 'opera'
  if (!isChrome) return 'default'
  if (checkNameAndPath('Chromium', browser) || checkNameAndPath('Dartium', browser)) return 'chromium'
  if (checkNameAndPath('Canary', browser)) return 'canary'
  if (checkNameAndPath('Vivaldi', browser)) return 'vivaldi'
  if (checkNameAndPath('Brave', browser)) return 'brave'
  if (checkNameAndPath('nwjs', browser) || checkNameAndPath('node-webkit', browser) || checkNameAndPath('nw', browser)) return 'nwjs'
  return 'default'
}

/** `WebBrowserManager.getFirstActiveBrowser()`（`WebBrowserManager.java:459-463`）：第一个「勾了且有路径」。 */
export function firstActiveBrowser(browsers: readonly ConfigurableWebBrowser[]): ConfigurableWebBrowser | null {
  return browsers.find(browser => browser.active && browser.path !== null) ?? null
}

/** `DefaultBrowserPolicy`（`DefaultBrowserPolicy.java:18-19`），三个常量不多不少。 */
export type DefaultBrowserPolicy = 'system' | 'first' | 'alternative'

/**
 * 该用哪个浏览器（上游 `BrowserLauncherImpl.getDefaultBrowser()` `BrowserLauncherImpl.kt:54-57` +
 * `substituteBrowser()` `:123-131`）：
 *   · 策略 `first` → `firstActiveBrowser`（表里第一个勾了且有路径的）；
 *   · 其它策略 → `null`，意思是**交给系统**（`BrowserLauncherAppless.kt:259-265` 的
 *     `defaultBrowserCommand`）。
 * 本仓宿主只有「系统默认」那一条出口（`shell.openUrl`），所以返回 `null` 时调用方只能走系统默认 ——
 * 这正是 pf/browsers ③ 做不到的根因。
 */
export function selectDefaultBrowser(
  browsers: readonly ConfigurableWebBrowser[], policy: DefaultBrowserPolicy = 'system',
): ConfigurableWebBrowser | null {
  return policy === 'first' ? firstActiveBrowser(browsers) : null
}

/**
 * 「交给系统默认浏览器」的命令表（`BrowserLauncherAppless.kt:259-265`）——
 * Windows `[cmd.exe, /c, start, ""]`、macOS `[open]`、Linux `[xdg-open]`，都没有就是 null。
 * 本仓宿主实际用的是 `ShellExecute`（`native/workspace.cpp` 的 `open_external`，等价于这一行的效果），
 * 所以这张表在这里只作**口径对照**：判它与宿主行为一致，不新增一条启动通道。
 */
export function systemDefaultBrowserCommand(os: HostOs): string[] | null {
  if (os === 'windows') return ['cmd.exe', '/c', 'start', '""']
  if (os === 'mac') return ['open']
  return ['xdg-open']
}

// ── 表格的增删改（上游 `BrowserSettingsPanel` / `WebBrowserManager` 的那张表）────────

/** 一行输入的校验结果：要么一条浏览器，要么一条可见错误。 */
export type BrowserInputResult = { browser: ConfigurableWebBrowser } | { error: string }

const NAME_ERROR = '请填写浏览器名称。'

/**
 * 「添加浏览器」对话框的一行 → 浏览器（上游 `BrowserSettingsPanel` 的新增行：名称、路径、家族）。
 * 家族不给时按 `BrowserFamily` 的执行路径反查（能唯一对上就是它，对不上要用户选，上游行为）。
 * `active` 默认按上游表格语义给 true —— 不勾的浏览器 `getFirstActiveBrowser` 会跳过它。
 */
export function parseBrowserInput(
  input: { name: string; path: string; family?: BrowserFamily },
  existing: readonly ConfigurableWebBrowser[] = [],
  os: HostOs = 'windows',
): BrowserInputResult {
  const name = input.name.trim()
  if (!name) return { error: NAME_ERROR }
  if (existing.some(browser => browser.name === name)) return { error: `已存在名为「${name}」的浏览器。` }
  const path = normalizeBrowserPath(input.path)
  const family = input.family ?? familyOfPath(path, os)
  if (!family) return { error: '认不出这是哪个家族的浏览器，请在下拉里选一个。' }
  return { browser: { name, family, path, active: true } }
}

/** 从路径反查家族：与 `BROWSER_FAMILY_TABLE` 的执行路径逐条比（大小写不敏感的包含）。
 *  对不上返回 null —— 上游这里是让用户在家族下拉里手选，不猜。 */
export function familyOfPath(path: string | null, os: HostOs): BrowserFamily | null {
  if (!path) return null
  const lower = path.toLowerCase()
  let found: BrowserFamily | null = null
  for (const row of BROWSER_FAMILY_TABLE) {
    const execution = executionPathFor(row.id, os)
    if (!execution) continue
    const token = execution.toLowerCase().split('/').pop()!
    if (lower.includes(token) && !found) found = row.id
  }
  return found
}

/**
 * 加一行（同名不接受；上游表格按 name 唯一）。
 * 新行**不带**内置 id —— 上游给的是 `UUID.randomUUID()`（`ConfigurableWebBrowser.java:28`、
 * `BrowserSettingsPanel.kt:84-86` 的 `clone`），语义就是「不是内置行」；这里用 `id: undefined` 表达同一件事。
 */
export function addBrowser(browsers: readonly ConfigurableWebBrowser[], browser: ConfigurableWebBrowser): { browsers: ConfigurableWebBrowser[] } | { error: string } {
  if (browsers.some(item => item.name === browser.name)) return { error: `已存在名为「${browser.name}」的浏览器。` }
  return { browsers: [...browsers, { ...browser, id: undefined }] }
}

/** 删一行（幂等）。 */
export function removeBrowser(browsers: readonly ConfigurableWebBrowser[], name: string): ConfigurableWebBrowser[] {
  return browsers.filter(browser => browser.name !== name)
}

/** 改一行（改名要重新查重；路径过一遍 `normalizeBrowserPath`，与 `setPath` 同口径）。 */
export function updateBrowser(
  browsers: readonly ConfigurableWebBrowser[], name: string, patch: Partial<Omit<ConfigurableWebBrowser, 'name'>> & { name?: string },
): { browsers: ConfigurableWebBrowser[] } | { error: string } {
  const index = browsers.findIndex(browser => browser.name === name)
  if (index < 0) return { error: `找不到名为「${name}」的浏览器。` }
  const nextName = patch.name?.trim() ?? name
  if (!nextName) return { error: NAME_ERROR }
  if (nextName !== name && browsers.some(browser => browser.name === nextName)) return { error: `已存在名为「${nextName}」的浏览器。` }
  return {
    browsers: browsers.map((browser, at) => (at === index ? { ...browser, ...patch, name: nextName, ...('path' in patch ? { path: normalizeBrowserPath(patch.path) } : {}) } : browser)),
  }
}

/** 勾/不勾一行（`ConfigurableWebBrowser.setActive` `ConfigurableWebBrowser.java:122-124`）。 */
export function setBrowserActive(
  browsers: readonly ConfigurableWebBrowser[], name: string, active: boolean,
): ConfigurableWebBrowser[] {
  return browsers.map(browser => (browser.name === name ? { ...browser, active } : browser))
}

/** 设置页那一行的摘要（上游表格是「名称 / 路径 / 参数」三列，本仓一行一句给列表用）。 */
export function browserSummary(browser: ConfigurableWebBrowser): string {
  const args = browser.specificSettings?.additionalParameters?.length
    ? ` ${browser.specificSettings.additionalParameters.join(' ')}`
    : ''
  return `${browser.name}：${browser.path ?? '（未设置路径）'}${args}`
}

// —— 内置浏览器清单（上游 `WebBrowserManager.getPredefinedBrowsers()` `WebBrowserManager.java:76-91`）——
//
// ⚠️ **本仓没有可落地的消费方，这一整段是「有据但接不上」的模型**，理由见模块头与族判词：
// 这张表的唯一用途是决定**用哪个可执行文件**打开 URL（`selectDefaultBrowser` → `BrowserLauncherImpl`），
// 而宿主唯一的 URL 出口是 `shell.openUrl`（`native/workspace.cpp` 的 `open_external`），
// 一律交给系统默认浏览器 —— 选出来的行没有地方去。设置页因此**不渲染**这张表（不假控件）。
// 保留它是为了：① 把六个内置 id / 默认勾选态钉在上游坐标上，宿主通道落地时直接可用；
// ② `WebBrowserManager.java:43-50` 的 UUID 是跨版本跨机器的稳定键，不该重新编。

/**
 * 六个内置浏览器的稳定 id（`WebBrowserManager.java:43-50`）。
 * `:42` 的注释明确要求它们跨 IDE 版本/机器/用户不变 —— 唯一一处例外是旧版 Edge
 * （`PREDEFINED_OLD_EDGE_ID` `:49`）已不在 `PREDEFINED_BROWSER_IDS`（`:52-59`）里，即**不再是内置行**。
 */
export const PREDEFINED_BROWSER_IDS = {
  chrome: '98CA6316-2F89-46D9-A9E5-FA9E2B0625B3',
  firefox: 'A7BB68E0-33C0-4D6F-A81A-AAC1FDB870C8',
  safari: 'E5120D43-2C3F-47EF-9F26-65E539E05186',
  opera: '53E2F627-B1A7-4DFA-BFA7-5B83CC034776',
  explorer: '16BF23D4-93E0-4FFC-BFD6-CB13575177B0',
  edge: '37cae5b9-e8b2-4949-9172-aafa37fbc09c',
} as const

export type PredefinedBrowserKey = keyof typeof PREDEFINED_BROWSER_IDS

/**
 * `WebBrowserManager.PREDEFINED_OLD_EDGE_ID`（`WebBrowserManager.java:49`，字面值
 * `B2A9DCA7-9D0B-4E1E-98A8-AFB19C1328D2`）：旧版 Edge 那一行**已经不是内置行**
 * （不在 `PREDEFINED_BROWSER_IDS` `:52-59` 里），读档时遇到它整条丢（`:288`）。
 * 本仓的 `normalizeBrowserSettings` 以前不认这个 id ⇒ 旧档里那一行会当成用户行留下。
 */
export const PREDEFINED_OLD_EDGE_ID = 'B2A9DCA7-9D0B-4E1E-98A8-AFB19C1328D2'

const PREDEFINED_ID_SET: ReadonlySet<string> = new Set<string>(Object.values(PREDEFINED_BROWSER_IDS))

/** `isPredefinedBrowser`（`WebBrowserManager.java:142-145`）：id 在那张表里就是内置行。 */
export function isPredefinedBrowser(browser: Pick<ConfigurableWebBrowser, 'id'>): boolean {
  return browser.id !== undefined && PREDEFINED_ID_SET.has(browser.id)
}

/** `WebBrowserManager.getEdgeExecutionPath()`（`:64-74`）：Edge 不在 `BrowserFamily` 里（它属 CHROME 家族）。 */
export function edgeExecutionPath(os: HostOs): string {
  if (os === 'windows') return 'msedge'
  if (os === 'mac') return 'Microsoft Edge'
  return 'microsoft-edge'
}

/**
 * 家族是否带「专属设置」子页（`BrowserFamily.createBrowserSpecificSettings()` `BrowserFamily.java:18-27`/`:49-51`）：
 * CHROME → `ChromeSettings`、FIREFOX → `FirefoxSettings`；EXPLORER/SAFARI 走基类返回 **null**。
 * 这个 null 直接决定设置表里那一行能不能编辑（`BrowserSettingsPanel.kt:111-113` `isEditable`）。
 */
export function familyHasSpecificSettings(family: BrowserFamily): boolean {
  return family === 'chrome' || family === 'firefox'
}

/**
 * 六个内置浏览器（`WebBrowserManager.java:76-91`），顺序逐条照抄。
 * 名字/路径的来源分两种，别混：
 *   · CHROME / FIREFOX 走两参构造（`ConfigurableWebBrowser.java:31-33`）= 名字与路径取
 *     `family.getName()` / `family.getExecutionPath()`，`active=true`，并带上家族专属设置；
 *   · SAFARI / OPERA / EXPLORER / EDGE 走六参构造（`:35-49`）逐个给值，其中
 *     Opera 显式 `specificSettings = null`（`:83`）、SAFARI/EXPLORER 的 `createBrowserSpecificSettings()`
 *     经基类返回 null（`BrowserFamily.java:49-51`）。
 * `active` 里的 `SystemInfo.isMac` / `isWindows` 由本仓的 `HostOs` 形参给出（宿主只跑桌面三平台）。
 */
export function predefinedBrowsers(os: HostOs): ConfigurableWebBrowser[] {
  const familyRow = (family: BrowserFamily) => {
    const row = BROWSER_FAMILY_TABLE.find(item => item.id === family)!
    return { label: row.label, path: executionPathFor(family, os) }
  }
  const chrome = familyRow('chrome')
  const firefox = familyRow('firefox')
  const safari = familyRow('safari')
  const explorer = familyRow('explorer')
  return [
    { id: PREDEFINED_BROWSER_IDS.chrome, name: chrome.label, family: 'chrome', path: chrome.path, active: true },
    { id: PREDEFINED_BROWSER_IDS.firefox, name: firefox.label, family: 'firefox', path: firefox.path, active: true },
    { id: PREDEFINED_BROWSER_IDS.safari, name: safari.label, family: 'safari', path: safari.path, active: os === 'mac' },
    { id: PREDEFINED_BROWSER_IDS.opera, name: 'Opera', family: 'chrome', path: os === 'mac' ? 'Opera' : 'opera', active: false },
    { id: PREDEFINED_BROWSER_IDS.explorer, name: explorer.label, family: 'explorer', path: explorer.path, active: false },
    { id: PREDEFINED_BROWSER_IDS.edge, name: 'Edge', family: 'chrome', path: edgeExecutionPath(os), active: os === 'windows' },
  ]
}

// ── 「用指定浏览器打开」的那一条宿主通道（pf/browsers ①②③ 缺的最后一环）──────────
//
// 本仓宿主目前只有一条 URL 出口（`shell.openUrl` → `native/workspace.cpp` 的 `open_external`
// = 系统默认浏览器），所以这张表选完没地方去。规则侧缺的就是「把选出来的那一行折算成
// 一次真正的启动请求」，落点在这里；通道本身（`shell.openUrlWithBrowser` + 那两个设置键）
// 是保留文件（`native/main.cpp` / `native/browser_launch.cpp` / `CMakeLists.txt` /
// `src/bridge.ts` / `native/settings_schema.cpp`），写在 `docs/wiring-requests-2026-10-06-welcome.md` 里。
//
// 上游的折算就是 `platform/platform-api/src/com/intellij/ide/BrowserUtil.java:92-133` 的
// `getOpenBrowserCommand(browserPathOrName, url, parameters, newWindowIfPossible)`：
//   · 路径**是个真文件**时（`:124-130`，走不到 `:101` 那个 `Files.isRegularFile` 分支）
//     → `[browserPath, ...parameters, url]`；
//   · 路径不是真文件时 macOS 退成 `[open, -a, 名字, (url), --args, ...]`（`:102-114`）、
//     Windows 退成 `[cmd, /c, start, "", 名字, ...parameters, url]`（`:115-121`）；
//   · 参数来自 `browser.specificSettings?.additionalParameters`
//     （`platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:220`），
//     URL 先 `trim()`（`:96`）；
//   · 路径是空的就根本不启动，报错走 `showError`（`:214-218`）。

/** 一次「用指定浏览器打开」的宿主请求体（`shell.openUrlWithBrowser` 的 `{ path, args }`）。 */
export interface BrowserLaunchPayload {
  /** 可执行文件路径（已归一成系统无关分隔符；宿主自己转回系统分隔符）。 */
  path: string
  /** 参数：先 `additionalParameters`，最后一条是 URL（`BrowserUtil.java:126-128` 的次序）。 */
  args: string[]
}

/** `error.0.browser.path.not.specified`（`platform/platform-api/resources/messages/IdeBundle.properties:18`，
 *  原文 `{0} browser path is not specified.`）的直译 —— 上游那一格就是
 *  `ConfigurableWebBrowser.getBrowserNotFoundMessage()`（`ConfigurableWebBrowser.java:159-161`），
 *  被 `BrowserLauncherAppless.kt:215-218` 在「路径空得连启动都发不出去」时使用。 */
export const browserPathNotSpecifiedMessage = (name: string): string => `未指定 ${name} 的浏览器路径。`

/**
 * 选出来的那一行 + 一条 URL → 启动载荷。
 * 三个如实的边界：① 本仓 TS 侧没有 `stat`，判不出「路径是不是真文件」，所以只给
 * `:124-130` 那一条主形（宿主拿到 `path` 后自己判存在性，不存在就按上游 `:214-218` 报错，
 * 不要悄悄退回系统默认浏览器）；② 上游的 `environmentVariables`（`BrowserLauncherAppless.kt:221`）
 * 本仓的桥载荷里没有那一格 ⇒ 不带，登记为做不到（不假装环境变量生效了）；
 * ③ `browser` 为 `null`/`undefined` 在上游是「没指定浏览器」＝ 交给系统默认
 * （`BrowserLauncherAppless.kt:88-112` 的 `browser = null` 那一路 → `:124` `settings.useDefaultBrowser`），
 * **不是**错误；这里报错只表示「调用方明确要用某一行了，可那一行没选出来」，
 * 也就是 `DefaultBrowserPolicy.FIRST` 在表里找不到任何「勾了且有路径」的行
 * （`WebBrowserManager.java:459-463` 给 null）⇒ 该由调用方退回系统默认，不该拿这个载荷去启动。
 */
export function browserLaunchPayload(
  browser: ConfigurableWebBrowser | null | undefined, url: string,
): BrowserLaunchPayload | { error: string } {
  if (!browser) return { error: '没有可用的浏览器：表里没选出任何一行（应退回系统默认浏览器）。' }
  const path = normalizeBrowserPath(browser.path ?? null)
  if (!path) return { error: browserPathNotSpecifiedMessage(browser.name) }
  const trimmed = url.trim()
  const extra = (browser.specificSettings?.additionalParameters ?? [])
    .map(parameter => parameter.trim())
    .filter(Boolean)
  return { path, args: trimmed ? [...extra, trimmed] : extra }
}

// ── 那两个新设置键的读盘口径（`browserList` / `defaultBrowserPolicy`）────────────────
//
// 规约：新增持久化键必须给**旧存档缺键**补默认，且不许按字段数量判损坏。
// 默认值照上游：写出去时「整表等于内置表」就一个 `<browser>` 都不落
// （`WebBrowserManager.getState()` `:178`），读回来时缺的内置行再补回去（`:318-332`）
// —— 两条合起来才是完整往返，所以**空表的读盘结果就是那六个内置浏览器**，不是空表
// （本仓以前只做了前一半，读回来是空的，等于把内置那几行在重启后全丢了）。
// 策略默认 `system`（`DefaultBrowserPolicy.java:18-19` 的 `FIRST` 是显式选项，
// 上游 `BrowserLauncherImpl.kt:54-57` 只在 `FIRST` 时才用表里第一个）。

/**
 * 家族字段能吃下的值（上游 `WebBrowserManager.readFamily` `:208-223`）：
 *   · `'OPERA'` 这个**老值**映射成 CHROME（`:210`，上游 Opera 从来不是一个家族，`getPredefinedBrowsers()` `:83`
 *     给的就是 `BrowserFamily.CHROME`）；
 *   · 否则按枚举名比（`:210` `BrowserFamily.valueOf(value)`，本仓的存储用 lowercase id，两边都吃）；
 *   · 枚举名对不上时再按**家族显示名**大小写不敏感比一次（`:215-219`）；
 *   · 都对不上给 null ⇒ 调用方整行跳过（`:282-285`）。
 */
export function familyOfRegistrationValue(value: unknown): BrowserFamily | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (text.toUpperCase() === 'OPERA') return 'chrome'
  const byId = BROWSER_FAMILIES.find(id => id.toUpperCase() === text.toUpperCase())
  if (byId) return byId
  return BROWSER_FAMILY_TABLE.find(row => row.label.toLowerCase() === text.toLowerCase())?.id ?? null
}

/** `<settings>` 子元素（`getState()` `:194-201` 的元素名就是 `settings`）→ 本仓的 `specificSettings`。
 *  只有**带专属设置的家族**才留这一格：`loadState()` `:293-296` 拿的是 `family.createBrowserSpecificSettings()`，
 *  EXPLORER / SAFARI 走基类拿到 null（`BrowserFamily.java:49-51`）⇒ 那一行根本不会有设置。
 *  上游写出去时还过一遍 `SkipDefaultValuesSerializationFilters`（`:197`）⇒ 空设置不落，本仓同口径：
 *  空的就不带这个键（别让「什么都没配」在存档里占一格）。 */
function readRegisteredSpecificSettings(value: unknown, family: BrowserFamily): BrowserSpecificSettings | undefined {
  if (!familyHasSpecificSettings(family)) return undefined
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const parameters = Array.isArray(source.additionalParameters)
    ? source.additionalParameters.filter((parameter): parameter is string => typeof parameter === 'string' && parameter.trim() !== '')
    : []
  const rawEnvironment = source.environmentVariables
  const environment: Record<string, string> = {}
  if (rawEnvironment && typeof rawEnvironment === 'object' && !Array.isArray(rawEnvironment)) {
    for (const [name, item] of Object.entries(rawEnvironment as Record<string, unknown>))
      if (typeof item === 'string') environment[name] = item
  }
  if (!parameters.length && !Object.keys(environment).length) return undefined
  return {
    ... (parameters.length ? { additionalParameters: parameters } : {}),
    ... (Object.keys(environment).length ? { environmentVariables: environment } : {}),
  }
}

/**
 * `WebBrowserManager.readId`（`:225-255`）里有两手本仓**不采**的做法，留痕在这里：
 *   · `id` 属性为空时按家族补成内置 id（`:228-236` 的 switch）—— 那是给「pre-UUID 时代的老档」用的迁移，
 *     补出来的行从此就是「内置行、不可删」（`isRemovable` `BrowserSettingsPanel.kt:115-117`）。
 *     本仓这张表的行由 `addBrowser` 现造、**故意不带 id**（`ConfigurableWebBrowser.java:28` 的
 *     `UUID.randomUUID()` 语义就是「不是内置行」，见本文件 `addBrowser` 的注释），照那一手会把用户
 *     自己加的第二个 CHROME 家族行认成内置 Chrome、再被下一手（去重）当成重复行**静默丢掉** ⇒ 不采；
 *   · 同批里 id 重复的行跳过（`:238-243` "duplicated entry, skip"）与旧版 Edge 那一行直接丢
 *     （`:288` + `PREDEFINED_OLD_EDGE_ID` `:49`）—— 这两手照抄。
 */
const PREDEFINED_OLD_EDGE_ID_KEY = PREDEFINED_OLD_EDGE_ID.toLowerCase()

/** 内置行的 id 比较：上游用 `UUID`（`fromString` 大小写不敏感 `:248`），本仓按小写串比。 */
function idKey(id: string): string {
  return id.trim().toLowerCase()
}

/**
 * 读回那张表：按上游 `web-browsers.xml` 的**字段缺省口径**读，缺键一律补默认，绝不判损坏。
 * 上游写出去（`WebBrowserManager.getState()` `:160-206`）与读回来（`loadState()` `:257-335`）是成对的，
 * 省掉的字段必须在读的时候按同一套规则补回来，否则「存下去省掉的 = 读回来坏的」：
 *   · `path` **只在它不等于家族执行路径时才写**（`:186-188`）⇒ 缺这一格要补 `family.getExecutionPath()`
 *     （`:305-308`）；补不回来（EXPLORER/SAFARI 在非本平台上 `:53-63` 给 null）那一行才是真的没路径；
 *   · `active` 只在 **false** 时写（`:190-192`）⇒ 缺省 = 勾着（`:314`）；
 *   · `id` 是内置行的稳定键（`:42-43` 的注释），旧版 Edge 那一行直接丢（`:288` + `:49`），
 *     同一批里 id 重复的行也丢（`:238-243` "duplicated entry, skip"）；
 *     `id` 缺省**不**按家族补回来（那一手是 pre-UUID 老档的迁移，本仓采不得，理由见上面 `readId` 的留痕）；
 *   · 表里**少了内置的那几行要补回来**（`:318-332` "add removed/new predefined browsers"）：
 *     `getState()` `:178` 在「整表等于内置表」时一个 `<browser>` 都不写，两条合起来才是完整往返
 *     ⇒ 空表读回来就是那六个内置浏览器（旧的「空表读回来是空表」把上游这一半丢了）；
 *   · 策略 `defaultBrowserPolicy` 只有不是 SYSTEM 时才写（`:162-164`），坏值被 catch 之后保持默认（`:259-275`）。
 * 两处如实的做不到（不假装读出来了）：
 *   · `name` 缺省上游补 `family.getName()`（`:312`）—— 本仓这张表**按 name 寻址**
 *     （`addBrowser`/`updateBrowser`/`removeBrowser` 都以 name 为键，上游以 UUID 为键），
 *     补出一个与内置行同名的行会让查重失效 ⇒ 这里仍然要求非空 name，坏行整条丢；
 *   · 上游另有 `serverReloadMode` / `previewReloadMode`（`:165-170`）与 `showHover` / `showHoverXml`
 *     （`:171-176`）四个字段，本仓没有内置预览服务器与浏览器悬浮的落点 ⇒ 不读、不写、不渲染。
 */
export function normalizeBrowserSettings(
  raw: unknown, os: HostOs = 'windows',
): { browserList: ConfigurableWebBrowser[]; defaultBrowserPolicy: DefaultBrowserPolicy } {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const list = Array.isArray(source.browserList) ? source.browserList : []
  const browsers: ConfigurableWebBrowser[] = []
  const takenIds = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const family = familyOfRegistrationValue(row.family)
    if (!family) continue                                       // `:282-285`
    if (typeof row.name !== 'string' || !row.name.trim()) continue  // 见上面「name 缺省不采」那一条
    // `id` 缺省**不**按家族补（见上面 `readId` 那一段的留痕），只把大小写归一到比较用的键上。
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : undefined
    const key = id ? idKey(id) : ''
    if (key === PREDEFINED_OLD_EDGE_ID_KEY) continue               // `:288` 旧版 Edge 那一行直接丢
    if (key && takenIds.has(key)) continue                         // `:238-243` "duplicated entry, skip"
    const specific = readRegisteredSpecificSettings(row.settings ?? row.specificSettings, family)
    browsers.push({
      id,
      name: row.name.trim(),
      family,
      path: normalizeBrowserPath(row.path === null || row.path === undefined ? null : String(row.path))
        ?? executionPathFor(family, os),                          // `:305-308`
      active: row.active !== false,                              // `:314`
      ... (specific ? { specificSettings: specific } : {}),
    })
    if (key) takenIds.add(key)
  }
  // `:318-332`：内置行缺了就补回来（追加在表尾，与上游 `list.add()` 的位置一致）。
  // `predefinedBrowsers(os)` 那六行每一行都带内置 id（`WebBrowserManager.java:78-89` 的构造参数一是
  // `PREDEFINED_*_ID`），所以这里只需要把类型上的「可选」吃掉，不是运行时可能缺。
  for (const predefined of predefinedBrowsers(os)) {
    const predefinedKey = predefined.id ? idKey(predefined.id) : ''
    if (predefinedKey && !browsers.some(browser => browser.id && idKey(browser.id) === predefinedKey))
      browsers.push(predefined)
  }
  const stored = typeof source.defaultBrowserPolicy === 'string' ? source.defaultBrowserPolicy.trim().toLowerCase() : ''
  // 上游只认那三个常量（`DefaultBrowserPolicy.java:18-19`），认不出就保持 SYSTEM（`:273-275` 的 catch）。
  const policy: DefaultBrowserPolicy = stored === 'first' || stored === 'alternative' ? stored : 'system'
  return { browserList: browsers, defaultBrowserPolicy: policy }
}

// ── 「在浏览器里打开」之前那一步的可用性判定 ────────────────────────────────────
//
// 上游那一条出口（`platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:88-112`）
// 在真的启动之前有四道判定，顺序就是它写的顺序：
//   1. `:91-94` —— `jar:` 开头**根本不碰浏览器**，上游只 `LOG.info("ignoring 'jar:' URL")` 就 return，
//      没有给用户看任何一句话（本仓照这一条：不开、也不编一句提示）；
//   2. `:96` —— 先 `trim`（`signUrl(url.trim { it <= ' ' })`）；
//   3. `:101-105` —— `VfsUtil.toUri` 解析不出 ⇒ `showError(IdeBundle.message("error.malformed.url", signedUrl))`；
//   4. `:106-109` —— `file:` 且**带 host**（UNC）⇒ `showError(IdeBundle.message("error.unc.not.supported", uri))`。
// 两句文案的原文在 `platform/platform-api/resources/messages/IdeBundle.properties`：
// `error.malformed.url=Malformed URL: {0}`（`:15`）、`error.unc.not.supported=UNC paths are not supported: {0}`（`:16`）。
// 通知的标题走 `BrowserLauncherImpl.kt:133-149` 的 `showError`（`notification.title.cannot.open`
// = `Cannot open a URL`，`IdeBundle.properties:13`）—— 本仓没有通知中心那一条通道，
// 这两句由 `src/externalLinkLauncher.ts` 抛给五个调用点自己显示（它们本来就各自 catch 成一句可见提示）。

/** `error.malformed.url`（`IdeBundle.properties:15`，原文 `Malformed URL: {0}`）的直译。 */
export const MALFORMED_URL_MESSAGE = 'URL 格式不正确：{0}'
/** `error.unc.not.supported`（`:16`，原文 `UNC paths are not supported: {0}`）的直译。 */
export const UNC_URL_MESSAGE = '不支持 UNC 路径：{0}'

/** 把上游那两句 `{0}` 模板填成成品（本仓没有 bundle，模板与原文一起留在上面）。 */
export function formatUrlMessage(template: string, url: string): string {
  return template.replace('{0}', url)
}

/**
 * 协议名语法：RFC 3986 的 `scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"`，冒号必须在。
 * 与本仓宿主那条硬边界**逐字同口径** —— `native/workspace.cpp:1205-1220` 的 `has_url_scheme`，
 * 连「单字母协议名后面紧跟 `/` 或 `\` 就算盘符」那一手也一样（`native/workspace.cpp:1212-1214`）：
 * `C:/tools/x.exe` 完全符合上面的语法，而宿主 `ShellExecuteW(L"open", …)` 会把它当程序**执行**掉
 * （`native/workspace.cpp:1206-1207` 原话），那是安全边界上最容易漏的一种输入。
 * 上游**没有**这一层：`VfsUtil.toUri("calc.exe")` 会解析成一个没有 scheme 的相对 URI
 * （`VfsUtil.java:248-258`：没有冒号就走 `new URI(uri)`），随后被交给
 * `cmd /c start ""` 真的执行（`BrowserLauncherAppless.kt:129` → `:199-208` → `:259-265`）。
 * ⇒ 这一条采宿主、不采上游：判定只会更严，不会放行得更多。
 */
export function hasLaunchUrlScheme(url: string): boolean {
  const colon = url.indexOf(':')
  if (colon <= 0) return false
  if (!/^[a-z]/i.test(url[0])) return false
  // 单字母 + 冒号 + `/` 或 `\` 不是 scheme，是 Windows **盘符路径**：必须拒。
  // 放行它的后果是宿主那一头 `cmd /c start ""` 直接把这条路径当东西执行
  // （上游 `VfsUtil.java:248-258` 不判这一档 ⇒ 这里采宿主口径，只更严不更松）。
  if (colon === 1 && (url[2] === '/' || url[2] === '\\')) return false
  return /^[a-z][a-z\d+.-]*$/i.test(url.slice(0, colon))
}

/** 一条 URL 被拒的三种形状：`ignored` = 上游那一种「不碰浏览器、也不说一句话」。 */
export type ExternalLaunchRejection =
  { code: 'ignored'; message: null } | { code: 'malformed' | 'unc'; message: string }

/**
 * 这条 URL 该不该被「在浏览器里打开」这一步拒掉。返回 `null` = 放行。
 * 顺序照上游 `browse()`（见上面那四条坐标），差别只有一处并且是**故意更严**：
 * 没有协议名的串（`calc.exe`、`C:/x.exe`、相对路径）在上游会一路走到 `cmd /c start`，
 * 在本仓宿主必被 `native/workspace.cpp:1231` 拒（错误码 `INVALID_PATH`），
 * 而本仓的「未信任项目先问那一句」又长在启动之前（`BrowserLauncherImpl.kt:59-87`）
 * ⇒ 判定装在问句之前，才不会出现「问都问了、信任也记了，链接照样打不开」。
 * `mailto:` 不在这里拒：上游把它单独交给 `Desktop.mail`（`BrowserLauncherAppless.kt:146-161`），
 * 本仓宿主的 `ShellExecute` 干的是同一件事（系统邮件关联）⇒ 放行；
 * `file:` **不带 host** 的本地路径同样放行（上游 `:106-109` 只拒带 host 的那一种）。
 */
export function externalLaunchRejection(url: string): ExternalLaunchRejection | null {
  const trimmed = url.trim()                                     // `:96`
  if (trimmed.toLowerCase().startsWith('jar:')) return { code: 'ignored', message: null }  // `:91-94`
  if (!trimmed || !hasLaunchUrlScheme(trimmed))
    return { code: 'malformed', message: formatUrlMessage(MALFORMED_URL_MESSAGE, trimmed) }  // `:101-105` + 宿主 `:1225`/`:1231`
  let parsed: URL | null = null
  try { parsed = new URL(trimmed) }
  catch { parsed = null }
  if (!parsed)
    return { code: 'malformed', message: formatUrlMessage(MALFORMED_URL_MESSAGE, trimmed) }  // `:101-105`
  if (parsed.protocol === 'file:' && parsed.hostname)
    return { code: 'unc', message: formatUrlMessage(UNC_URL_MESSAGE, trimmed) }               // `:106-109`
  return null
}

