# wiring-requests-2026-10-06-refview3 — 需要主代理接的线（用法树行模型）

本 lane 只交纯模型 + 判据，**没动** `src/components/ReferencePanel.vue` 的模板、没加任何 UI 控件、
没动 `src/App.vue` / `src/bridge.ts` / `src/components/CodeEditor.vue` / `native/main.cpp` / `docs/inventory/*`。
下面三条都是"模型已经算好、界面还没用上"的线，逐条给可照抄的替换。

---

## R-1 面板 `v-for` 的 `:key` 换成行 id（去掉 `index`）

- 目标文件：`src/components/ReferencePanel.vue`
- 目标行：第 87 行（`<div v-for="(row, index) in rows" v-else :key="…">` 那一行）
- 现状（读盘原文，逐字）：

```html
      <div v-for="(row, index) in rows" v-else :key="`${row.key}:${index}`" class="ref-row" role="listitem"
```

- 替换为：

```html
      <div v-for="row in rows" v-else :key="row.id" class="ref-row" role="listitem"
```

- 依据：`row.id` 就是本批 `src/usageViewTreeModel.ts` 的 `usageTreeRowIds`（②）算出来的**内容派生** id
  （组行 = 组键、叶子 = `usage + NUL + 路径 + NUL + 行:列`，同一份内容出现第二遍起追加 `NUL#n`），
  `src/referenceContents.ts` 的 `referenceRows` 已经在生产链路上把它贴到每一行上
  （类型 `UsageTreeModelRow = UsageTreeRow & { id: string; level: UsageTreeLevel }`，
  对 `ToolWindowView.vue` 的 prop 类型 `UsageTreeRow[]` 是**加字段**，不破坏现有绑定）。
  现在的 `:key="key:index"` 里那个 `index` 会让"上面任何一行增删/重排"把后面整列 DOM 重挂 ——
  这正是上游要避免的：上游插入新节点时二分定位 + `swingChildren.sort` 后立刻按**位置**发插入事件
  （`platform/usageView-impl/src/com/intellij/usages/impl/GroupNode.java:99-114`、
  `platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:767-769`），不重挂已有的行。
- 判据已就位：`tests/usage-view-tree-model.test.mjs` 里 ② 的三条（重排后 id 不变 / 重复内容不撞 id /
  半批结果补成全批后同一行 id 不变）+ 生产链路那一条（`referenceRows` 每行 id 唯一）。
- 改完请跑：`node --test tests/usage*.test.mjs tests/reference*.test.mjs` 与 `npx vue-tsc -b --force`。

## R-2 要不要把"重建后展开两层"这一档打开（上游那一档 vs 本仓既有档）

- 目标文件：`src/referenceContents.ts`（`referenceRows` 那一条 computed，本批已把它包成
  `usageTreeRows(usageRowsForQuery(...))`）
- 可照抄的替换：把
  ```ts
  })))
  ```
  （即 `usageTreeRows(usageRowsForQuery(...)` 的收尾）改成
  ```ts
  }), { expandLevels: 2 }))
  ```
- 语义：`expandLevels` = 树重建（换档 / 增量结果 / 符号迟到）之后，**新出现**的组只默认展开到第几层。
  传 2 = 上游那一档：`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1317-1319`
  （`expandTreeAfterReset() = expandTree(2)`）与 `:1291-1302`（根下那一层的组一律展开）；
  不传（默认 `Infinity`）= 本仓既有档「重建后全展开」。
- ⚠ 这是**产品决定**，本 lane 没有擅自打开：既有判据 `tests/usage-view-panel-rows.test.mjs:51`
  钉的就是"默认全展开"（`groups(rows).map(row => row.collapsed)` 全 false），
  打开之后那条会红 —— 要打开就同批把那条判据改成钉"上游两层"的形状（`deepEqual` 不松成 `includes`），
  并同步看 `:134-135`、`:158-159` 那两条"全部折叠"的账。
- 模型侧两条都已测到（`tests/usage-view-tree-model.test.mjs` ③ 第二条同时钉 2 与默认两档），
  所以打开/不打开都不会让判据空转。

## R-3 想让 ③ 真的跨重建沿用到"上一屏"，`previous` 必须**按内容 id 分档**

- 目标文件：`src/referenceContents.ts`
- 现状：`usageTreeRows(...)` 没传 `previous` ⇒ 折叠态沿用是"这一屏自己跟自己核对账"
  （只做纠错：空壳组不再挂着「已收起」的说明；见 `carryUsageTreeExpansion` 头注第四条）。
- 要接的形状（**必须**每条内容一份，否则 `tests/usage-view-panel-rows.test.mjs:185-191`
  「收一条不动另一条」那条判据会红 —— 它钉的就是两份内容各有一份折叠态）：
  ```ts
  // 与 collapsedUsageGroups 同一分档口径：上一屏渲染出来的那一列行，按内容 id 存一份。
  const previousUsageRows = ref<Record<number, UsageTreeRow[]>>({})
  export const referenceRows = computed<UsageTreeRow[]>(() => {
    const id = selectedId.value ?? -1
    const rows = usageTreeRows(usageRowsForQuery(referenceUsageTree.value, referencesSpeedSearch.value, {
      collapsed: new Set(carriedUsageGroupKeys(referenceUsageTree.value, id)),
      showDirectories: referencesGroupByDirectory.value,
    }), { previous: previousUsageRows.value[id] ?? [] })
    previousUsageRows.value = { ...previousUsageRows.value, [id]: rows }
    return rows
  })
  ```
  并在 `forgetUsageGroups(ids)` 里把 `previousUsageRows` 的同批 id 一起丢掉（与那份折叠集同生同死），
  `resetReferences()` 里清空。
- 依据：上游沿用的单位就是"这条用法还在不在"（`impl/UsageViewImpl.java:1280-1283` 抓 usage 本尊、
  `:2427-2441` 用 `myUsageNodes.get(usage)` 在新树里查到再贴回父组展开态），
  每条 Content 一棵 model 树 ⇒ 分档与 `UsageViewContentManagerImpl.java:149-192` 一条搜索一条内容同口径。

## R-4 本批没有新增持久化键

`src/usageViewTreeModel.ts` 与 `src/referenceContents.ts` 的改动**没写任何新的 localStorage 键**，
也没有新增全局选择器/动效/裸 hex。上一批（`refview2`）加的 `taocode.usagesExpandedAll` 不在本批账上。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R-1 已接线**：`src/components/ReferencePanel.vue` 的 `v-for` 已改成 `v-for="row in rows" :key="row.id"`（去掉 `index`），prop 类型从 `UsageTreeRow[]` 收紧为 `readonly UsageTreeModelRow[]`（`src/usageViewTreeModel.ts:195` 的稳定 id）；宿主 `src/components/ToolWindowView.vue:19/:164` 的类型同步。判据 `tests/usage-view-tree-model.test.mjs` / `usage-view-panel-rows.test.mjs` / `tool-window-view-panels.test.mjs` **pass 38 / fail 0**，`vue-tsc` 0 错。
- **R-2 / R-3** —— 目标 `src/referenceContents.ts`（本 lane 可改面），登记为待办（口径需 owner 定）。
- **R-4** —— 无新增持久化键。

结论：R-1 已接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「R-1 已接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
