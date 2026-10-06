// 「最近位置」那两条环 —— App.vue 的 `places` / `changePlaces` / `rememberPlace`（原 892-904 行）。
// 2026-10-06 逐字搬入本文件；同日 nav3 一批把**两档的归属、上限、合并规则**改成上游的形状（留痕）：
//
//   · 原写「两条环都收同一个位置（第二条只多一个 edited 过滤）」、实际
//     `IdeDocumentHistoryImpl.kt:285-294` 是**一条命令只进一档**：
//     导航命令结束才 `commitBackPlace`（`:388-402` → `putLastOrMerge(isChanged = false)`），
//     有改动的命令结束才 `setCurrentChangePlace`（`:311-341` → `putLastOrMerge(isChanged = true)`）。
//     ⇒ 打字留下的位置只进「更改的位置」那一档，不再混进「最近位置」列表。
//   · 原写「同文件同行全局去重」、实际写入侧只与**最新一条**合并
//     （`putLastOrMerge`：`IdeDocumentHistoryImpl.kt:659-666`，`isSame` 见 `:738-745` = 同文件 + 同一导航态）；
//     全局去重发生在**读出的那一步**（`RecentLocationsDataModel.kt:95` 的 `result.none { isSame(...) }`），
//     所以下面 `recentPlacesList` 里保留全局去重，用户可见的结果与改之前一致（列表里不会出现重复行）。
//   · 原写 60 条上限（搬走前的字面量，无上游依据）、实际环的上限是注册表
//     `editor.navigation.history.stack.size` 的默认值 **150**
//     （`platform/util/resources/misc/registry.properties:494`，读它的两行常量在
//     `platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:76-77`）。
//   · 新增弹层一档的上限 **25** = `UISettings.recentLocationsLimit` 的默认值
//     （`platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:57`），
//     用它的地方是 `platform/platform-impl/src/com/intellij/ide/actions/RecentLocationsDataModel.kt:91`（取上限）
//     与 `:98-100`（够数就 break）。
//
// 顺序口径的差异（**有意保留**，不是漏做）：上游两条环是「最旧在前」的队列，
// 取列表时 `ContainerUtil.reverse`（`RecentLocationsDataModel.kt:92`）倒过来；本仓的 ref 一直是
// 「最新在前」（App.vue 的注释与既有消费方都按这个口径写），所以这里的合并/截断方向与上游镜像：
// 合并对表头那一条、截断从表尾摘。两条环的**所有权**仍在本模块（自持 ref），
// 装配根只解构同名变量 ⇒ `createLspNavigation` / `createBookmarkActions` / `createKeymap` /
// `createWorkspaceLifecycle` 注入的仍是同一份引用。
import { ref, type Ref } from 'vue'
import type { Place } from './lspNavigation.ts'

/** 环的上限：注册表 `editor.navigation.history.stack.size` 的默认值 150。 */
export const PLACES_RING_LIMIT = 150

/** 弹层一次最多列多少条：`UISettings.recentLocationsLimit` 的默认值 25。 */
export const RECENT_PLACES_LIMIT = 25

/**
 * `isSame`（`IdeDocumentHistoryImpl.kt:738-745`）在本仓的形状：同文件 + 同一导航态。
 * 本仓的导航态只有「第几行」，所以键 = 文件 + 行；标签（书签名/符号名）不参与判定。
 * 参数顺序写成 `(place, item)` 是给两处调用共用一条规则：写入侧比表头那一条、读出侧比已列出的每一条。
 */
export const isSamePlace = (place: Place, item: Place): boolean => item.path === place.path && item.line === place.line

/**
 * `putLastOrMerge`（`IdeDocumentHistoryImpl.kt:655-674`）—— 最新在前的镜像版：
 *   · 表头那条与 newcomer 同一个位置 ⇒ 先摘掉表头（上游 `list.removeLast()`），
 *     **不合并**标签，新那条整条替换旧位置（上游换的就是新的 PlaceInfo）；
 *   · 其余情况直接插到表头；
 *   · 超过上限从表尾摘（上游 `list.removeFirst()`，方向镜像）。
 */
export function putPlaceOnTop(places: readonly Place[], place: Place, limit = PLACES_RING_LIMIT): Place[] {
  const head = places.length && isSamePlace(places[0]!, place) ? places.slice(1) : [...places]
  return [place, ...head].slice(0, Math.max(0, limit))
}

/**
 * 「最近位置」弹层那一条列表 = `createPlaceLinePairs`（`RecentLocationsDataModel.kt:83-104`）：
 * 按顺序走一遍环，**全局**跳过与已列出条目同位置的那些（`:95`），攒够 `recentLocationsLimit` 就停（`:98-100`）。
 * 上游是「倒着走队列」，本仓的环本来就是最新在前 ⇒ 正着走，结果同序。
 */
export function recentPlacesList(places: readonly Place[], limit = RECENT_PLACES_LIMIT): Place[] {
  const out: Place[] = []
  for (const place of places) {
    if (!out.some(listed => isSamePlace(listed, place))) out.push(place)
    if (out.length >= limit) break
  }
  return out
}

export type PlacesRing = {
  places: Ref<Place[]>
  changePlaces: Ref<Place[]>
  rememberPlace: (place: Place) => void
}

export function createPlacesRing(): PlacesRing {
  // 「最近位置」= 导航过的位置（文件、符号、书签都算），最新在前。
  const places = ref<Place[]>([])
  // 「更改的位置」= 编辑落点（上游 changePlaces）。两档互不写入：见文件头 `:285-294` 那一条。
  const changePlaces = ref<Place[]>([])
  function rememberPlace(place: Place) {
    if (place.edited) {
      changePlaces.value = putPlaceOnTop(changePlaces.value, place)
      return
    }
    places.value = putPlaceOnTop(places.value, place)
  }
  return { places, changePlaces, rememberPlace }
}
