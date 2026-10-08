# wiring-requests · 2026-10-06 · ssreplace（配合项，我没动的文件）

## 1) `src/components/VcsLogTable.vue` —— 速度搜索追加仍丢（需消费者侧配合）
本批已在共享件 `src/components/SpeedSearchBar.vue` 补上「打开即把焦点收进输入框 + 关闭交回列表」，
`BookmarksPanel`（命中只做 `scrollIntoView`、不抢焦点）的多字符追加因此已修复。

`VcsLogTable` 只吃到了共享件这半边，但追加**仍不通**：它命中后走
`selectRow → focusHash(commit.hash)`（`VcsLogTable.vue:92-98`），`focusHash` 里
`const row = list.value?.querySelector(...); row?.focus()`（`:96-97`）会把焦点从搜索框抢回那一张
**行元素**。于是下一个字符又落到行/容器的 `keys()` → `searchOpen=true; onSearchInput(event.key)`
（`:178-182`）→ `search.value = 单字符`（`:132-133`），每敲一个字符都替换而非追加。

请求（归 vcsLog lane，`src/vcsLog*` 在我这条 lane 的并发黑名单里，未动）：
- 速度搜索处于激活态（`searchOpen===true`）期间，命中定位只做 `scrollIntoView`，
  **不要** `row?.focus()`（焦点应留在 `SpeedSearchBar` 的 `<input>` 里才能追加）；
  收起时再按上游把焦点交回列表（现由 `SpeedSearchBar` 关闭分支负责）。
- 或改 `onSearchInput` 走 `src/speedSearch.ts` 的 `speedSearchNextInput` 状态机（`TodoPanel.vue:174-175` 已有先例），
  使"框在场=追加"由同一真源决定，不依赖 DOM 焦点是否守住。

判据（供该 lane 落地时用）：在列表上连打两个字符，搜索框应显示两位串并按整串命中，而不是只留最后一个字符。

## 2) `src/components/FileTree.vue` —— 手动 focus 现变冗余（可选清理，非必须）
`FileTree.vue:231` 在 `openSpeedSearch()` 里自己 `querySelector('.speed-search-input').focus()`。
该焦点收放本批已上移到 `SpeedSearchBar.vue`（`watch(open)`），FileTree 这处因此冗余但**无害**，
且它原本追加就是好的（未受本批影响）。是否删这行由 project-tree/fileTree lane 自决；
删的话 `speed-search-wiring.test.mjs:57-67` 那条只钉接线存在、不钉这行，不影响判据。

## 处理结果（wiring-backlog lane，2026-10-06）

- **1（VcsLogTable 速度搜索追加）** —— 目标 `src/components/VcsLogTable.vue`（本 lane 可改面，属 VCS 半区），登记。
- **2（FileTree 手动 focus 冗余）** —— `src/components/FileTree.vue`（本 lane），可选清理，登记。

结论：零接线（登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
