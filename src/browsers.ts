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
  /** `IdeBundle.message("browsers.<id>")` 的英文名（`BrowserFamily.java:16`/`:22`/`:29` 的第四个构造参数）。 */
  label: string
  /** `BrowserFamily` 构造参数的第二/三/四个：windows / unix / mac 执行路径（`:16-29`）。 */
  windows: string
  unix: string | null
  mac: string | null
}

/**
 * 四个家族的执行路径（`BrowserFamily.java:16` CHROME、`:22` FIREFOX、`:28` EXPLORER、`:29` SAFARI）。
 * `EXPLORER` 与 `SAFARI` 的 unix 路径是 `null`（`:28-29` 的第三个构造参数）——
 * 那两个家族只在本平台上有意义，`executionPathFor` 因此在别的系统上返回 null。
 */
export const BROWSER_FAMILY_TABLE: readonly FamilyDescriptor[] = [
  { id: 'chrome', label: 'Google Chrome', windows: 'chrome', unix: 'google-chrome', mac: 'Google Chrome' },
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

