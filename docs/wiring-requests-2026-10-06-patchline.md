# 接线请求 2026-10-06 — lane `patchline`

本批**不需要新接线**：改动落在一道既有闸的覆盖面里，消费链路早已存在且端到端通：

```
src/patchApply.ts:346  isAlreadyApplied        ← src/patchApply.ts:460 / :507（planPatchApplication 的两条路）
                                              ← src/patchApply.ts:410 planPatchApplication
                                              → src/patchApplyHost.ts:64（if (!plan.ok) 一条都不写）
                                              → src/components/SourceControl.vue（变更行右键菜单「应用补丁…」「从剪贴板应用补丁」）
```

导出口名（**都是仓里真实存在的符号**，本批未新增任何出口）：
`isAlreadyApplied`、`planPatchApplication`、`applyHunksToText`、`applyHunksFlexible`、`parseUnifiedPatch`。

## R1（唯一一条）：账本订正 —— `docs/inventory/verdict-platform_rest.md:149` 的 `vc/diff` 行

`docs/inventory/**` 是保留文件（本 lane 只读），请主代理把下面这一句并进那一行的「本轮补…」段落：

> 2026-10-06 再补：块头/正文账目闸的**覆盖面**扩到「已应用」判定 —— `src/patchApply.ts:347`
> 的 `isAlreadyApplied` 先核账（`hunkCountsMismatch`），账目不符 ⇒ 不许判成 `alreadyApplied`，
> 于是 `planPatchApplication` 给 `status:'failure'` + `plan.ok:false`，宿主那条「计划不 ok 一个字节都不写」
> 才真的挡住半截补丁；原先这一档会被判成「已经应用过」而让整批落盘（改名档还会写出没打过补丁的原文）。
> 上游依据 `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/GenericPatchApplier.java:121-122`
> （FAILURE 排在 `:124`/`:134` 的 ALREADY_APPLIED 之前）。判据 `tests/patch-hunk-counts.test.mjs` 末尾两条用例。

同一行里那句「**仍缺**：… GNU patch 的『吃掉上下文行』那一档 fuzz …」保持不变：那一档本批没做，
也不是本 lane 的题面（`apply/GenericPatchApplier.java:209-223`/`:312-322`/`:363-393` 会**改写**匹配处文本，
本仓 `src/patchApply.ts:29-32` 已写明不引入的理由）。

## 附：本域红名单订正（给主代理核对，不是请求）

- 派单里说的「`tests/patch-hunk-counts.test.mjs` 跑出 2 条真红」**已过期**：接手时 16/16 全绿（实现早在
  `src/patchApply.ts:252-267`/`:290-291`/`:369-372` 落过，判据在 `tests/patch-hunk-counts.test.mjs:357-371`）。
  本批做的 2 条新用例**也**是 2 条红起步 ⇒ 两个「2」是巧合，别当成同一条账。
- `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` 的 3 条红**不在本域**，
  分别属 `docs/batch-2026-10-06-findrep2.md`（`ConsoleViewImpl.kt:999999-999999` 占位行号）、
  `src/commitChecks.ts`、`src/components/ProblemsPanel.vue` ×2、`src/runStartupFocus.ts`（四条 `moved`）；
  后三处文件在我的并发黑名单里（`src/commit*`、`src/run*`），故只登记不动。

## 处理结果（wiring-backlog lane，2026-10-06）

- R1 —— 账本订正（`docs/inventory/*`），非本 lane。

结论：零接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
