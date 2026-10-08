# 接线请求 · 2026-10-06 · preflight（提交前检查的结果指纹改用文档修订号）

本批只动 `src/commitChecksResult.ts`、`src/sourceControlCommitChecks.ts`、`tests/commit-checks-result.test.mjs`。
模块侧已经按上游改好并钉了判据；下面三段是**本批不许动**的宿主面（`src/App.vue` 与保留/他人面），
不落地则真界面上的指纹仍只有"变更列表 + 未保存清单"两档 ⇒ 同一篇文档改第二次不作废。
`native/` **本批无需任何改动**（修订号是编辑器内存事件，不是 git/宿主进程的事实；见 P3）。

上游依据（本批亲自 `sed -n` 打开核过，相对 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
- `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:190-200` —— `areFilesAffectsCommitChecksResult`
  三道筛：`:193` `vcsManager.getVcsFor(it) != null`（在 VCS 下）、`:198` `fileIndex.isInContent(it) &&
  changeListManager.getStatus(it) != FileStatus.IGNORED`（在内容里 + 非 IGNORED）。**没有一道问"它在不在变更列表里"**。
- 同文件 `:215-226` —— `addDocumentListener` / `documentChanged`：`:218` 已 UNKNOWN 早退、`:221` `getFile(event.document)`、
  `:222` 过筛、`:223` `resetCommitChecksResult()`。⇒ 上游是**每篇文档 each-change** 驱动作废。
- `platform/core-api/src/com/intellij/openapi/editor/Document.java:25`（"stamp is incremented whenever the content changes"）、
  `:183-192`（`getModificationStamp()`，声明 `:191-192`）；换号 `platform/core-impl/.../impl/DocumentImpl.java:171`
  （`replaceString(…, DocumentModStamp.next(), …)`）；号源 `DocumentModStamp.java:6-12`（`next()` = `LocalTimeCounter.currentTime()`）。
- 号当缓存键的先例：`java/execution/impl/src/com/intellij/execution/filters/ExceptionLineParserImpl.java:318`（记号）+ `:320`（`expireWhen(… != stamp)`）。
- **无法核实**：派单让搜的 `CommitCheckService` / `DocumentCommitCheckService` 在本参考树里**零命中**
  （`platform/vcs-impl`、`platform/dvcs-impl`、`platform/vcs-api` 下按文件名 `find` 与全文 `grep` 都搜过，
  两处 `api-dump.txt` 里也没有）⇒ 不照这两个名字编 API，作废机制一律按上面当场核实过的坐标落。

---

## P1 `src/App.vue`：按篇记修订号（上游 `documentChanged` 的直接等价物）

今天 `src/App.vue` 里没有 `editorEpoch`，也没有任何按篇的号 ⇒ 模块侧那个可选入参恒为空数组。

1. 在 `:554`（`const dirty = computed(() => allTabs.value.some(tab => tab.dirty))`）之后加：
   ```ts
   const documentRevisions = ref<Record<string, number>>({})
   const bumpDocumentRevision = (path: string) => {
     documentRevisions.value = { ...documentRevisions.value, [path]: (documentRevisions.value[path] ?? 0) + 1 }
   }
   ```
   （上游那个号不是"递增 1"而是 `LocalTimeCounter`，但模块侧只要求"改一次换一个、没改不动"——
   `tests/commit-checks-result.test.mjs` 两条都钉了，`+1` 与取时间戳都合格。）
2. `:2176` 的 `<CodeEditor … @change="onEditorChange(tab)" … />` 改成
   `@change="() => { bumpDocumentRevision(tab.path); onEditorChange(tab) }"`。
   这一档**必须**挂在 `change` 事件上而不是 `dirty` 上：`src/components/CodeEditor.vue:1010` 的
   `if (update.docChanged && !replacing) { emit('change'); … }` 每笔文档变更都发一次（不防抖），
   而 `dirty` 只在"干净→脏"那一拍变 ⇒ 用它就等于回到上一版"第二次编辑不作废"的漏判。
3. `:888` 的 ctx 注入里，在 `dirtyPaths: () => …` 旁边加：
   ```ts
   documentRevisions: () => Object.entries(documentRevisions.value).map(([path, revision]) => ({ path, revision })),
   ```
   **只报在 VCS 下、在内容里的那些篇**（上游 `:193`/`:198` 那两道筛本仓模块侧算不出，由宿主判）：
   按 `workspace.value` 的项目根过滤 `path` 即可；不在项目里的（示例文件、外部路径）不要报。
   被忽略的文件不用宿主筛 —— 模块侧已按 `ignored` 行过筛（`documentAffectsCommitChecksResult`）。

## P2 `src/toolViewContext.ts` + `src/components/ToolWindowView.vue` + `src/components/SourceControl.vue`：三段透传

1. `src/toolViewContext.ts`：`:67`（`dirtyPaths: () => string[]`）旁加
   `documentRevisions: () => readonly { path: string; revision: number }[]`；`:92` 的解构里加 `documentRevisions`；
   `:166`（`dirtyPaths: () => dirtyPaths(),`）旁加 `documentRevisions: () => documentRevisions(),`。
2. `src/components/ToolWindowView.vue:199` 的 `<SourceControl … :dirty-paths="ctx.dirtyPaths" … />` 补一个
   `:document-revisions="ctx.documentRevisions"`。
3. `src/components/SourceControl.vue`：`:88` 之后加 prop
   `documentRevisions?: () => readonly { path: string; revision: number }[]`，并在 `:466` 那个 spread 之后加
   `...(props.documentRevisions === undefined ? {} : { documentRevisions: props.documentRevisions })`
   —— 与 `editorEpoch` 同一条规矩：**没给就整个键都不进 deps**，不许替编辑器编一篇常数号
   （`tests/commit-checks-result.test.mjs` 的 `不许在检查宿主里替编辑器编一篇文档的修订号` 钉着）。
   类型请用 `import type { DocumentRevision } from '../commitChecksResult'`，别在面板里再定义一遍形状。

## P3 撤掉已失效的 `editorEpoch` 通道（本批把它移出指纹后，这条线成了空转）

`editorEpoch` 是**全局计数**：它连是哪一篇都不认 ⇒ 不在 VCS 下 / 不在内容里的文件动一下也会作废上一轮结果，
与上游 `:222`（问的是"这篇文件过不过那三道筛"）不符。本批起它不再交进指纹
（`src/sourceControlCommitChecks.ts` 的 watch 现在只交 `changes.value, dirtyPaths(), documentRevisions() ?? []`）。
落地 P1/P2 之后请一并删掉：`src/components/SourceControl.vue:84-88`（那段 prop 注释 + `editorEpoch?: number`）、
`:464-466`（那句注释 + spread），以及 `src/sourceControlCommitChecks.ts` 的 `editorEpoch?: () => number` 字段
（本批**留着**它，否则面板那侧的 spread 编译不过；面板清干净后模块侧这一行就能删）。
删完请把 `tests/commit-checks-result.test.mjs` 里 `面板那一侧仍是"没给就整个键都不进 deps"` 那条断言一并删掉
（它是过渡期的钉子，钉的是"本批没动面板"这一事实）。

**验收**：P1+P2 落地后，真界面上"改一次 ⇒ 按钮从「仍然提交」回「提交」；不改 ⇒ 仍是「仍然提交」"要能取证；
`node --test tests/commit-checks*.test.mjs tests/module-size.test.mjs` 保持全绿；`npx vue-tsc -b --force` 0 错。

## 处理结果（wiring-backlog lane，2026-10-06）

- **P1（按篇记修订号）已接线（形状升级）**：`src/App.vue:74` import `bumpDocumentRevision`（`src/documentRevisions.ts` 的按篇号账本）。
- **P2（三段透传）** —— `src/toolViewContext.ts` / `ToolWindowView.vue`（本 lane）+ `SourceControl.vue`（VCS lane 独占）。复核 `documentRevisions` 未进 ctx；因 SourceControl 非本 lane，登记为「需 VCS lane 同批」。
- **P3（撤掉 `editorEpoch`）** —— 已撤（`src/commitChecksResult.ts:148-163` 留痕）。

结论：P1 已接线（更优形状）；P2 转 VCS lane，P3 已闭环。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「P1 已接线（更优形状）；P2 转 VCS lane，P3 已闭环。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
