# 接线请求 2026-10-06 hlcache300 —— 语言服务结果缓存三处偏差的收尾线

本 lane 只动了 `src/codeLens.ts`、`src/lspHighlightingCache.ts`、`src/codeVisionProviders.ts`、
`src/docHoverContent.ts`、`src/codeLensSettings.ts`（注释）与 `tests/code-lens-refresh.test.mjs`。
下面四条落在**别人的/保留的**文件里，本 lane 一字未动，请按段照抄。

---

## W-1 `src/codeLensExtension.ts`：两处注释里的 "400ms" 要跟改成 300ms（黑名单：codelensfix 名下）

编辑档的实际数值已从 400 改为上游低优先级那一族共用的 300
（上游 `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:328`
`val LOW_PRIORITY_QUIESCENCE_DELAY: Duration = 300.milliseconds`，缺省由同文件 `:52` 的
`quiescenceDelay` 取用；`:324-327` 把 code lens 与 semantic tokens / document links / folding /
inlay hints / colors 点名在**同一族**）。数值变了，注释里写死的毫秒数现在是指不到东西的旧数。

**目标行 :11**，整行替换：

```ts
//   ① `schedule(trigger)` 按触发点取延迟（`codeLensRefreshDelay`）：打开 0ms / 编辑 300ms（上游低优先级那一族，见 `src/codeLens.ts` 的注释）/ 焦点 700ms（本仓自定档，上游无对应物）；
```

**目标行 :472-473**，那两句替换为（保持原缩进 4 空格）：

```ts
    // （`CodeEditor.vue:1054`/`:1079` ⇒ `change` 档 300ms），这个文件从来没答过一次的时候不该再等
    // 那 300ms。
```

上游依据同上（首拍不等窗口那一条在同文件 `:146` 的 `!isFirstPullFor(file)`，判断本体 `:161`）。

## W-2 `src/codeLensCache.ts`：两处注释里的 "400ms 去抖"（黑名单：codelensfix 名下）

**目标行 :143** 与 **目标行 :219** 里的 `400ms` 各改成 `300ms`，其余文字不动：

```ts
   * lens 的文件每次触发都算首拍** ⇒ 每次都跳过 300ms 去抖、每个字都立刻整文档问一次服务器。   // :143
      // lens 的文件每次触发都会跳过 300ms 去抖、每个字都立刻整文档问一次服务器。               // :219
```

## W-3 `docs/inventory/citation-anchors.json`：本 lane 新增 5 条全路径坐标，等快照重算（保留文件，本 lane 不写）

本 lane 把三处**裸文件名**引用换成完整上游路径（换成完整路径正是让引用门能自动咬的前提：
`tests/source-citations.test.mjs:86-88` 的收集器只收 `platform|plugins|java|...` 开头且带 `/` 的坐标）：

| 本仓位置 | 新增坐标 |
|----------|----------|
| `src/codeLens.ts:237` | `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:328` |
| `src/lspHighlightingCache.ts:169` 起 | 同文件 `:52`、`:321`、`:324-327`、`:146`、`:161` |
| `src/codeVisionProviders.ts:214` | `java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaReferencesCodeVisionProvider.kt:22` |
| `src/codeVisionProviders.ts:242` | 同文件 `:26` |
| `src/docHoverContent.ts:81` | `platform/lsp-impl/src/impl/features/documentation/LspDocumentationTargetProvider.kt:47` |

`tests/source-citation-anchors.test.mjs:16-17` 说明新增引用不入快照（只报数不拦），所以本 lane 收工时
那一条门是绿的；等各路在途文件落定后由主代理重算一次快照，这 5 条就进锚点保护：

```
TAOCODE_CITATION_ANCHORS=update node --test tests/source-citation-anchors.test.mjs
```

## W-4 `docs/batch-2026-10-06-findrep2.md:124`、`:152`：转述假坐标把共享引用门染红（不是本 lane 的文件）

那两行按原文抄了 `platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt:` 加六位数的行号，
`agent-rules.md` §5 末尾正是警告这个形状：**要批评某个假写法就去掉行号，别写完整形状**。
现在 `node --test tests/source-citations.test.mjs` 因这一条红（本 lane 的引用全通过）。
请 findrep2 的owner（或主代理）把那一处的行号去掉，门即复绿。

## 处理结果（wiring-backlog lane，2026-10-06）

- 目标为 `src/codeLens*.ts` / `src/lspHighlightingCache.ts` / `src/docHoverContent.ts` 等模块（本 lane 可改面）与 `src/components/CodeEditor.vue`（禁改）。登记为待办（见 problems2 W1 同族）。

结论：零接线（登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
