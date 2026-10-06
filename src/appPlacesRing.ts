// 「最近位置」那两条环 —— App.vue 的 `places` / `changePlaces` / `rememberPlace`（原 892-904 行）。
// 2026-10-06 逐字搬入本文件：去重键（同文件 + 同行）、插入到表头、60 条上限、
// 以及「只有带 `edited` 标记的位置才进第二条环」这四件事与搬走之前逐字一致。
//
// 为什么能搬：这是纯粹的「往一条有上限的表头插一条并摘掉同键旧项」，不读别的 ref、不发宿主请求。
// 两条环的**所有权**跟着搬（模块自持那两个 ref），装配根只解构同名变量，
// 所以 `createLspNavigation` / `createBookmarkActions` / `createKeymap` / `createWorkspaceLifecycle`
// 那四处注入的仍是同一份引用，行为与搬走之前完全一致。
import { ref, type Ref } from 'vue'
import type { Place } from './lspNavigation.ts'

export type PlacesRing = {
  places: Ref<Place[]>
  changePlaces: Ref<Place[]>
  rememberPlace: (place: Place) => void
}

export function createPlacesRing(): PlacesRing {
  // IDEA's "Recent Places" collects every place the caret has been: files, symbols and
  // bookmarks alike, most recent first.
  const places = ref<Place[]>([])
  // IdeDocumentHistory keeps navigation and change places as two rings; TaoCode records
  // one list and flags the entries that came from an edit, so "Show edited only" (the
  // checkbox in IDEA's RecentLocations) filters within it.
  const changePlaces = ref<Place[]>([])
  function rememberPlace(place: Place) {
    const rest = places.value.filter(item => !(item.path === place.path && item.line === place.line))
    places.value = [place, ...rest].slice(0, 60)
    if (place.edited) {
      const kept = changePlaces.value.filter(item => !(item.path === place.path && item.line === place.line))
      changePlaces.value = [place, ...kept].slice(0, 60)
    }
  }
  return { places, changePlaces, rememberPlace }
}
