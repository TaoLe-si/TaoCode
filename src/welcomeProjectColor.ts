// 最近项目那一行的**项目颜色**（`pv/welcome` 族缺的那一条）—— 上游
// `ChangeProjectColorActionGroup` / `ChangeProjectColorAction` 的等价物。
//
// 上游那一族在**项目窗口标题栏**的菜单里（不在最近项目这一行上）；
// `ChangeProjectColorActionGroup.kt:33-44` 是九个具名颜色 + 一条分隔线 +
// `ChooseCustomProjectColorAction`：
//
//     ChangeProjectColorAction(projectPath, …Amber.title,  0, projectName)
//     …Rust… 1   …Olive… 2   …Grass… 8   …Ocean… 7
//     …Sky…  3   …Cobalt… 4  …Violet… 6  …Plum… 5
//     Separator()
//     ChooseCustomProjectColorAction()
//
// 注意那九个 **index 的次序不是 0..8**（是 0,1,2,8,7,3,4,6,5）：显示顺序按冷暖排，
// 存进 ProjectColorStorage 的却是各自在 `ProjectIconPalette.gradients` 里的槽位。
// 本仓照抄这个次序 —— 排序本身就是可见行为。
//
// 文案取自 `platform/platform-api/resources/messages/IdeBundle.properties:3219-3229`
// 的中文包（`plugins/localization-zh/lib/localization-zh.jar` 的 `messages/IdeBundle.properties`）：
// 琥珀色 / 钴蓝色 / 草绿色 / 海蓝色 / 橄榄色 / 紫红色 / **Rust**（上游这条没翻）/ 天蓝色 / 紫色，
// `{0}（当前）` 是 `action.ChangeProjectColorAction.Current.title`。
// 槽位与渐变值来自 `RecentProjectIconHelper.kt:468-487`（`ProjectIconPalette.gradients`，
// 取的是那对 `JBColor` 的**亮色**一档）。
//
// 存储：上游写进项目的 workspace 文件（`ProjectWindowCustomizerService` 的
// `ProjectColorStorage`）。本仓的 `ProjectSettings`（`src/settingsModel.ts`）没有这一节，
// 而那一份是保留文件不归本桶改，所以按应用级用户数据的既有口径（`src/notificationDoNotAsk.ts`、
// 本文件同族的 `taocode.branch:<path>`）存在 localStorage，按项目路径分键。
// 落点是「这一台机器上这个项目用哪个颜色」—— 与上游那份落在项目里的语义一致。

/** 上游 localStorage 的最小面（node --test 与隐私模式下传 null / 假对象即可）。 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null

const COLOR_KEY = 'taocode.projectColor'

/**
 * 九对渐变，逐字取自 `RecentProjectIconHelper.kt:469-486` 的 `ProjectIconPalette.gradients`
 * （每条 `JBColor.namedColor(…, JBColor(light, dark))` 的**亮色**那一档）。
 * 下标就是 `ChangeProjectColorActionGroup.kt:33-41` 传进去的 `colorIndex`。
 */
export const PROJECT_ICON_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#DB3D3C', '#FF8E42'], // 0 RecentProject.Color1.Avatar（Amber）
  ['#F57236', '#FCBA3F'], // 1 RecentProject.Color2.Avatar（Rust）
  ['#2BC8BB', '#36EBAE'], // 2 RecentProject.Color3.Avatar（Olive）
  ['#359AF2', '#57DBFF'], // 3 RecentProject.Color4.Avatar（Sky）
  ['#8379FB', '#85A8FF'], // 4 RecentProject.Color5.Avatar（Cobalt）
  ['#7E54B5', '#9486FF'], // 5 RecentProject.Color6.Avatar（Plum）
  ['#D63CC8', '#F582B9'], // 6 RecentProject.Color7.Avatar（Violet）
  ['#954294', '#C87DFF'], // 7 RecentProject.Color8.Avatar（Ocean）
  ['#E75371', '#FF78B5'], // 8 RecentProject.Color9.Avatar（Grass）
]

/** 一个可选颜色：槽位 + 中文名 + 那一对渐变。 */
export interface ProjectColorChoice { index: number; name: string }

/**
 * 九个可选颜色的**显示顺序**（`ChangeProjectColorActionGroup.kt:33-41` 逐行照抄：
 * Amber 0 · Rust 1 · Olive 2 · Grass 8 · Ocean 7 · Sky 3 · Cobalt 4 · Violet 6 · Plum 5）。
 * 名字取中文包，`Rust` 那条上游没翻，保留原样。
 */
export const PROJECT_COLOR_CHOICES: readonly ProjectColorChoice[] = [
  { index: 0, name: '琥珀色' },
  { index: 1, name: 'Rust' },
  { index: 2, name: '橄榄色' },
  { index: 8, name: '草绿色' },
  { index: 7, name: '海蓝色' },
  { index: 3, name: '天蓝色' },
  { index: 4, name: '钴蓝色' },
  { index: 6, name: '紫色' },
  { index: 5, name: '紫红色' },
]

/** `action.ChangeProjectColorAction.Current.title` = `{0} (Current)`。 */
export const PROJECT_COLOR_CURRENT_LABEL = '（当前）'

/** 那一行的菜单里，这个条目叫什么（上游 `ChangeProjectColorActionGroup` 的组标题）。 */
export const PROJECT_COLOR_MENU_LABEL = '项目颜色'

/** 恢复成"按路径自动生成"的那个条目 —— 上游没有这一条（上游只有 9 个颜色 + 自定义取色器）。 */
export const PROJECT_COLOR_AUTO_LABEL = '自动（按项目路径生成）'

/**
 * `ChangeProjectColorAction.transformToCurrentIfNeeded`（`:79-85`）：当前这个颜色在菜单里
 * 标成「名字（当前）」，其余只显示名字。
 */
export function projectColorLabel(choice: ProjectColorChoice, currentIndex: number | undefined): string {
  return choice.index === currentIndex ? `${choice.name}${PROJECT_COLOR_CURRENT_LABEL}` : choice.name
}

// --- 没选过颜色时的自动生成 -----------------------------------------------------------------

/**
 * `RecentProjectIconHelper.kt:289-326`（`ProjectIconPalette.gradient(path)` /
 * `getGeneratedNonLocalProjectIcon` 的 `abs(id.hashCode() % 9)`）：按路径哈希落到九对渐变之一。
 * 上游那个 `hashCode()` 是 Java String 的 31 乘法哈希，本仓用同一套算法，槽位分布才一致。
 */
export function avatarTone(path: string): number {
  let hash = 0
  for (let i = 0; i < path.length; i += 1) hash = (hash * 31 + path.charCodeAt(i)) | 0
  return Math.abs(hash) % PROJECT_ICON_GRADIENTS.length
}

/** 那一行现在的渐变（用户选过就用选的，没选过按路径生成）。 */
export function projectGradient(path: string, store?: Store): readonly [string, string] {
  const chosen = projectColorOverride(path, store)
  return PROJECT_ICON_GRADIENTS[chosen ?? avatarTone(path)]!
}

// --- 用户选的颜色（按项目路径存）---------------------------------------------------------------

function storage(store?: Store): Store {
  if (store !== undefined) return store
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** `{<项目路径>: <槽位>}`；存坏了一半就只认槽位在 0..8 里的那些条目。 */
function readOverrides(target: Store): Record<string, number> {
  try {
    const raw = target?.getItem(COLOR_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [path, index] of Object.entries(parsed as Record<string, unknown>)) {
      // 上游 `ProjectColorStorage` 存的就是 `setAssociatedColorsIndex` 那个 index，
      // 越界说明是别的版本写坏的 —— 丢掉这一条，不让它去索引渐变表。
      if (typeof index !== 'number' || !Number.isInteger(index)) continue
      if (index < 0 || index >= PROJECT_ICON_GRADIENTS.length) continue
      out[path] = index
    }
    return out
  } catch { return {} }
}

function writeOverrides(target: Store, overrides: Record<string, number>) {
  try { target?.setItem(COLOR_KEY, JSON.stringify(overrides)) } catch { /* 存不下就只当本次会话 */ }
}

/** 用户给这个项目选过颜色吗（`ProjectWindowCustomizerService.getAssociatedColorIndex`）。 */
export function hasProjectColorOverride(path: string, store?: Store): boolean {
  if (!path) return false
  return readOverrides(storage(store))[path] !== undefined
}

/** 选过的槽位；没选过返回 undefined（= 走 `avatarTone` 自动生成那一支）。 */
export function projectColorOverride(path: string, store?: Store): number | undefined {
  if (!path) return undefined
  return readOverrides(storage(store))[path]
}

/**
 * `ChangeProjectColorAction.actionPerformed`（`:87-93`）：清掉旧颜色、写下新槽位、重画。
 * 本仓的"重画"就是列表那一行的头像重新算渐变（下一行的 `projectGradient` 读的就是它）。
 */
export function setProjectColorOverride(path: string, index: number, store?: Store): void {
  if (!path) return
  if (!Number.isInteger(index) || index < 0 || index >= PROJECT_ICON_GRADIENTS.length) return
  const target = storage(store)
  const overrides = readOverrides(target)
  overrides[path] = index
  writeOverrides(target, overrides)
}

/**
 * 恢复自动生成（上游 `clearToolbarColorsAndInMemoryCache` 之后 `setAssociatedColorsIndex` 传
 * 的那个"没有关联颜色"状态；用户可见的一面就是菜单里那一项重新变回可点）。
 */
export function clearProjectColorOverride(path: string, store?: Store): void {
  if (!path) return
  const target = storage(store)
  const overrides = readOverrides(target)
  if (overrides[path] === undefined) return
  delete overrides[path]
  writeOverrides(target, overrides)
}
