# 接线请求 · 2026-10-06 · commitfpclose（提交检查结果指纹：程序性整篇改写那一档）

本域（提交检查的结果指纹 = 按篇文档修订号）在 commitfp + commitfpclose 之后，**键入那一档已经闭环**，
剩下唯一没闭环的是**程序性整篇改写**（`setDraft`）那一档：它被 `src/components/CodeEditor.vue:468` 的
`replacing = true` 闸拦住，**不发** `@change`（`:1010` 的 `if (update.docChanged && !replacing) { emit('change'); … }`），
而换号的两个生产入口都挂在 `@change` / 手工补记上 ⇒ 界面上那 11 处"正文真的被整篇换掉"不会让上一轮检查结果作废。

下面 3 段就是这件事。**每条都自带不撑爆行数预算的方案**（预算见 §0，与派单给的数字不同，已订正）。
`native/` 本域**无需任何改动**（修订号是编辑器内存事实，不是 git / 宿主进程的事实）。

---

## 0. 行数预算（当场用门禁同一把尺子量的，不是 `wc -l`）

`tests/module-size.test.mjs:157` 的尺子是 `readFileSync(path,'utf8').split('\n').length`，
判定在 `:176`（`lines > limit` 即红）。所以**末行换行符会多算出一段空行** ⇒ `wc -l` 比门禁少 1。

| 宿主文件 | 现值（门禁尺） | 登记上限（`tests/module-size.test.mjs`） | **真实余量** | 派单给的余量 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `src/App.vue` | 2707 行 | `:108` `limit: 2737` | **30 行** | 31 | 订正：`wc -l` = 2706 少算 1 段 |
| `src/bridge.ts` | 905 行 | `:127` `limit: 905` | **0 行**（已经贴顶） | 1 | 订正：**再加 1 行就会把 `已登记的大文件不许继续变大` 打红** |
| `src/components/CodeEditor.vue` | 1145 行 | `:136` `limit: 1147` | **2 行** | 3 | 订正：同 `wc -l` 少 1 段 |

规则照旧：上限只能降不能升（本域不碰 `tests/module-size.test.mjs`）。所以 W1 的方案**刚好占满 2 行**，
W3 的结论是**桥接面一行都不要**。

---

## 1. 为什么要接（上游依据，本 lane 当场逐行开过）

参考树根：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

- `platform/core-api/src/com/intellij/openapi/editor/Document.java:25` —— 号挂在**文档**上
  （"Document is also a `ModificationTracker` whose stamp is incremented whenever the content changes"）；
  `:183-192` 是 `getModificationStamp()` 本体（声明 `:191-192`，`:185` 明说"not related to the file modification time"）。
- `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:170-171` ——
  **`replaceString` 这个"整篇/整段替换正文"的动作本身就领一个新号**（`:171` 传 `DocumentModStamp.next()`）。
  ⇒ 上游没有"用户敲的才算、程序换的就不算"这一说：**换正文 = 换号**。
- `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:215-226` —— 提交检查的作废是
  `DocumentListener.documentChanged` 驱动的（`:218` 已 UNKNOWN 早退、`:221` 取文件、`:222` 过筛、`:223` `resetCommitChecksResult()`），
  而 `documentChanged` 对程序性改动同样发；同一文件的 VFS 那一半（`:202-213`）管磁盘侧。
  两道都在问**这篇文件**过不过 `:191-199` 那三道筛（`:193` 在 VCS 下、`:198` 在内容里 + `!= FileStatus.IGNORED`），
  **都不问"改动是谁发起的"**。
- 号当缓存键的先例：`java/execution/impl/src/com/intellij/execution/filters/ExceptionLineParserImpl.java:318` + `:320`。

本仓对应物已经就位（不需要新 API、不需要新的持久化键）：
账本 `src/documentRevisions.ts:42-46`（`bumpDocumentRevision`）、`:53-55`（快照），
消费方 `src/commitChecksResult.ts:186-195`（指纹第三段）、`src/sourceControlCommitChecks.ts:80` + `:150-153`（必填入参 + watch），
生产方 `src/lspNavigation.ts:255`（键入）、`src/editorFileOps.ts:171`（缩进转换的手工补记）。
**缺的只是"其余 11 处整篇换正文没人记号"。**

---

## W1（首选）`src/components/CodeEditor.vue`：**+2 行**，把 `setDraft` 变成唯一漏斗

现状（`src/components/CodeEditor.vue:465-472`）：

```ts
  setDraft: (value: string) => {
    const editor = view
    if (!editor || editor.state.doc.toString() === value) return
    replacing = true
    try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }) }
    finally { replacing = false }
    if (props.lspEnabled) void request('lsp.change', { path: props.path, text: value }).catch(() => undefined)
  },
```

落地方案（**净 +2 行**，正好等于 §0 的余量）：

1. **第 1 行**：在 import 段末尾加一行（该文件的 import 从 `:2` 一直排到 **`:90`**（最后一条是
   `import { editorLanguageExtension } from '../editorLanguage'`），跟同目录的 `SourceControl.vue:24` 一样用不带扩展名的写法）：
   ```ts
   import { bumpDocumentRevision } from '../documentRevisions'
   ```
2. **第 2 行**：在 `if (!editor || editor.state.doc.toString() === value) return` 之后、`replacing = true` 之前插一行（注释写在同一行行尾，不额外占行）：
   ```ts
       bumpDocumentRevision(props.path) // 整篇换正文也是"内容变了"（DocumentImpl.java:170-171）；setDraft 被上面的 replacing 闸拦住不发 @change（:1010），所以号在这里记
   ```

要点与不变量：

- **早退闸就是"真的变了才换号"**：`editor.state.doc.toString() === value` 时一行都不走 ⇒ 判据 B
  （"没编辑 ⇒ 号不动 ⇒ 指纹逐字不变 ⇒ 结果仍复用"，`tests/commit-checks-result.test.mjs:279-291` / `:415-447`）不受影响，
  不会出现"每拍都作废"。
- **`props.path` 就是账本的键**：`src/App.vue:2176` 传的是 `:path="tab.path"`，与
  `bumpDocumentRevision(tab.path)`（`src/lspNavigation.ts:255`）同一套键，不引入第二种路径口径。
- **一次覆盖 12 个调用点**（而不是让每个调用方自己记得补）：
  `src/App.vue:1094`、`:1118`、`:1124`；`src/diskSync.ts:96`、`:188`；`src/editorFileOps.ts:77`、`:166`、`:216`；
  `src/lspNavigation.ts:514`；`src/semanticActions.ts:268`、`:592`；`src/sessionSnapshot.ts:132`。
  其中只有 `editorFileOps.ts:166`（缩进转换）今天已经由 `:171` 手工补记过 ⇒ **其余 11 处都是漏的**。
- **不要**顺手把 `setDraft` 改成 `emit('change')`（看着更"同源"，实际会带出副作用）：`src/lspNavigation.ts:250-252` 的
  `onEditorChange` 会把 `tab.dirty = true`、`tab.preview = false`，而 `src/App.vue:1094` 的顺序是
  `open.dirty = false; editorFor(path)?.setDraft(...)` ⇒ 回滚刚清掉的脏标记会被重新点亮（保存前那两处
  `:1118`/`:1124` 同理）。`replacing` 那道闸（`:468`）存在的意义就是不重放这一串 ⇒ **只记号，不发事件**。

**W1 之后的两处"重复换号"（可以不管，也可以随后一起清）**：`src/editorFileOps.ts:171` 那笔手工补记会变成第二次
（`setDraft` 已经记了一次）。两次只影响号的具体数值、不影响判据：上游的号本来就是
`DocumentModStamp.next()` = `LocalTimeCounter.currentTime()`（`DocumentModStamp.java:10-11`），不要求"递增 1"，
本域也只钉"改一次就换一个、没改就不动"（`tests/commit-checks-result.test.mjs:285-286`）。
**要清的话得同一批改**：删 `src/editorFileOps.ts:168-171` 那三行注释 + 那一笔，同时把
`tests/commit-checks-result.test.mjs:247-249` 那条钉"缩进转换自己也得记一笔"的断言改成钉
"漏斗在 `CodeEditor.vue` 的 `setDraft`" —— 别只删实现留着判据，也别只改判据留着实现。

---

## W2（退路）`src/App.vue`：**+4 行**，仅当 W1 被否

如果宿主侧不许动 `CodeEditor.vue`，就在**调用方**补记。**覆盖面只有 3/11**（其余 8 处在别的模块里，
本域会另开请求；那些模块现在各有在飞 lane，别撞车），所以这是退路不是首选。

1. `src/App.vue` 的 import 块加 1 行：
   ```ts
   import { bumpDocumentRevision } from './documentRevisions'
   ```
2. `:1094` 行尾（同一个 `if (open) { … }` 里，`setDraft` 之后）加 1 行调用
   `bumpDocumentRevision(path)`；
3. `:1118` 与 `:1124` 各自那一行 `if (….changed) { …; editorFor(tab.path)?.setDraft(…) }` 后面各加 1 行
   `bumpDocumentRevision(tab.path)` —— 这两处已经有 `.changed` 闸，正好等于上游"真的变了才换号"。

合计 **+4 行**（30 行预算里占 4 行，剩下仍够）。注意 `:1094` 没有 `.changed` 闸：那里是"回滚到历史快照"，
正文确实整篇换过 ⇒ 换号是对的；但同一值重复回滚会多算几笔号，与 W1 一样**只影响数值不影响判据**。
**W1 与 W2 二选一，别同时落**（同时落 = 每处两次换号，虽然无害，但判据里"改一次换一个"的语义会被数字搞糊）。

---

## W3 `src/bridge.ts`：**0 行，本域不需要桥接**（并且它的余量已经是 0）

- 证据：`src/documentRevisions.ts` 的全部 import 是 `vue` 的 `ref` 与本域类型（`:32-33`），没有任何 `request`/`bridge` 调用；
  修订号是"这一次会话里这一篇被敲过几下"的前端内存事实，宿主进程不知道也不该知道 ⇒
  没有桥接方法要加，`Method` union 不动。
- 更硬的约束：`src/bridge.ts` 现值 905 行 = 登记上限 905 行 ⇒ **任何**新增都会把
  `已登记的大文件不许继续变大`（`tests/module-size.test.mjs:172-179`）打红。
  以后确实要往 `bridge.ts` 加东西，**必须先等额减行或拆模块**（`:128-133` 那条 note 写的就是拆分方向），
  再谈新增；不许抬上限。
- 顺带登记：`docs/wiring-requests-2026-10-06-preflight.md` 的 **P1/P2 已作废**（本域不再走
  "账本做在 `App.vue` + 经 `toolViewContext`/`ToolWindowView` 两层 prop 透传"那条路：面板自己
  `import { documentRevisionList } from '../documentRevisions'`（`src/components/SourceControl.vue:24`）
  并在 `:519` 直接交进 `createCommitChecks`）。它的 **P3**（撤 `editorEpoch`）已经落完
  （`tests/commit-checks-result.test.mjs:223-234` 钉"删干净"）。**下一位请照本文档，别再照 P1/P2 接一遍。**

---

## 验收（落地时按这个顺序跑，别只看一条）

```bash
node --test tests/commit*.test.mjs tests/stage*.test.mjs tests/module-size.test.mjs   # 全绿；module-size 是 W1/W2 的预算闸
npx vue-tsc -b --force                                                                # 本域文件 0 错
node .tools/find-orphan-modules.mjs --gate                                            # src/documentRevisions.ts 不许进孤儿名单
node --test tests/source-citations.test.mjs                                           # 全绿
```

真界面取证（W1 或 W2 落地后才成立，本域现在**还差这一口**）：

1. 打开一个**git 侧干净**的工作区文件，点「运行提交检查」跑到全过 ⇒ 结果 `PASSED`；
2. 让**保存时动作**把正文整篇换掉（`App.vue:1118`/`:1124` 那两条：开「Actions on Save」里的格式化，或让文件带行尾空白触发清理），
   或者在外部改磁盘触发 `diskSync.ts:96`/`:188` 的重载 ⇒ 上一轮结果必须回 `UNKNOWN`：
   按钮名从「仍然提交」回到「提交」，失败行与刷新按钮不消失；
3. 同一篇不动，只切标签页 / 重复执行一次"值相同"的 `setDraft` ⇒ 结果仍 `PASSED`（判据 B，不许每拍作废）；
4. 现状（W1/W2 都没落）跑第 2 步会看到结果**不作废** —— 那正是本请求要修的缺陷，不是环境噪声。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1（首选，`CodeEditor.vue` 的 `setDraft` 唯一漏斗）** —— 目标 `src/components/CodeEditor.vue`（禁改清单）。需 CodeEditor owner。复核 `bumpDocumentRevision` 在生产侧已有 `src/App.vue:74` / `src/diskSync.ts:15` / `src/editorFileOps.ts:20` 三处（本 lane 复核），但 `setDraft` 那 11 处漏记仍未补。
- **W2（退路，`App.vue` 补记 3 处）** —— 目标 `src/App.vue`（本 lane）。因 W1 与 W2 二选一、且 W2 只覆盖 3/11，本 lane 未落（避免与 W1 同时落造成双记）。登记为待办：若 CodeEditor owner 否掉 W1，本 lane 可落 W2。
- **W3** —— 0 行，无需桥接。

结论：零接线（W1 转 CodeEditor owner，W2 登记待办）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W1 转 CodeEditor owner，W2 登记待办）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
