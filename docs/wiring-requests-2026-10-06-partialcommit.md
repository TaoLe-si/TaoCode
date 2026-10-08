# 接线请求 2026-10-06 · partialcommit（部分提交「提交文件…」）

归属：`docs/batch-2026-10-06-partialcommit.md` §7.4 那四条"没落码的结构性缺口"。
本 lane **没有** 改 `src/App.vue`、`src/bridge.ts`、`native/main.cpp`、`native/git.cpp`（约束②），
所以下面每条都写成可照抄的形状：**哪一行 → 改成什么 → 为什么 → 判据**。
每条自带"不撑爆 App.vue / bridge.ts"的核算。

## 0. 预算核算（实测，不是抄任务书）

门控 `tests/module-size.test.mjs` 用 `readFileSync(...).split('\n').length` 数行（**比 `wc -l` 多 1**）：

| 文件 | 现在 | 登记上限 | 余量 |
| --- | --- | --- | --- |
| `src/App.vue` | **2707** | 2737（`tests/module-size.test.mjs:108`） | **30 行**（任务书说的"31"是按 `wc -l` 的 2706 算的，两种数法都对得上，本文件一律按门控的数） |
| `src/bridge.ts` | **905** | 905（`tests/module-size.test.mjs:127`） | **0 行** ⇒ 本批**四条请求没有一条需要动 `bridge.ts`**（下面逐条写明为什么不用动） |
| `native/main.cpp` | 1846 | 2000 | 154 行 |
| `native/git.cpp` | 861 | 1100（未登记，走 `NATIVE_DEFAULT_LIMIT`） | 239 行 |
| `native/git_test.cpp` | 764 | 1300（`_test.cpp` 专属） | 536 行 |

`bridge.ts` 不需要动的理由（实测）：`Method` union 里 `'git.commit'` 早就有了
（`src/bridge.ts:109`，`git.status | git.diff | git.patch | git.stage | git.unstage | git.commit | …`），
而 `git.commit` 的 `paths` 是** params 里的一个可选键**（宿主侧 `native/main.cpp:1175`
`params.value("paths", std::vector<std::string>())`），前端那侧请求体由
`src/commitChecks.ts:559-563` 的 `commitRequestParams` 生成、返回的是 `Record<string, unknown>`
⇒ 类型面上没有新符号要加。W1 传的是**已有 prop**（`src/components/SourceControl.vue:92`
`commitPaths?: readonly string[]`），也不是新键。

---

## W1（组装层 · 项目视图多选 → 提交范围）

**要解决的问题**：上游 `CheckinFiles` 的**主要入口不是提交面板的右键菜单**，而是带多选的上下文：
`platform/vcs-impl/resources/META-INF/VcsActions.xml:187`（`ChangesViewPopupMenu` 第一行）、
`:541`（`VcsActions.KeymapGroup`）、`:660`（`Vcs.Operations.Popup`）、
`plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml:163`（`Git.FileActions` 组第一条，
该组被 `:184` `Git.MainMenu.FileActions` / `:349` `Git.Menu` / `:358` `Git.ContextMenu` 引用）。
本仓现在只有面板里那一行（`src/components/SourceControl.vue:236` `case 'commitFile': return setCommitScope(path)`），
`commitPaths` 这个 prop **没有任何调用方传它**（实测 `grep -rn commitPaths src` 只命中组件自己的声明与消费；
`App.vue` 零命中；面板渲染点 `src/components/ToolWindowView.vue:199` 那一行没有 `:commit-paths`）。
⇒ 从项目视图多选进来那一档（上游最常见的用法）现在到不了面板。

**逐条改动（5 处，全部可照抄）**：

1. `src/components/FileTree.vue:200`
   现：`  if (!entry.path.startsWith('\u0000')) emit('context', { entry, x: event.clientX, y: event.clientY })`
   改：`  if (!entry.path.startsWith('\u0000')) emit('context', { entry, paths: [...selection], x: event.clientX, y: event.clientY })`
   为什么：多选本来就是树模型自持的（同文件 `:253` 的 `defineExpose({ …, selection })`、`:54` 的
   `const { rows, expanded, selected, selection, … } = model`），只是 `context` 事件没带上它。
   行数：**+0**（同一行内加一个属性）。

2. `src/explorerActions.ts:62` 与 `src/treeActions.ts:104`：把那个 payload 类型从
   `{ entry: Entry; x: number; y: number }` 改成 `{ entry: Entry; paths: string[]; x: number; y: number }`
   （两处同一行内改，`+0` 行）。`treeActions.ts:104` 的 `onTreeContext` 里那句
   `treeMenu.value = payload` 不用动 —— 它整体存 payload，字段自动跟着走。

3. `src/App.vue`（模板那段项目视图右键菜单，现有行从 `:2457` 起）
   在 `:2476` 那对「剪切/复制」**之前**插入一行：
   ```html
           <button v-if="gitAvailable && workspace" :disabled="!treeSelectionHasChange()" @click="commitSelectedFiles(); treeMenu = null; treeSubmenu = null; showView('git')">提交文件…</button>
   ```
   同时在 `<script setup>` 里、紧挨已有的 `gitChangeFor`（`src/App.vue:576`，它已经是
   `function gitChangeFor(path: string) { return findGitChange(workspace.value?.root ?? '', path, gitChanges.value) }`）
   之后加两行：
   ```ts
   const commitScopeFromTree = ref<string[] | null>(null)
   const treeSelectionPaths = () => treeMenu.value?.paths ?? []
   const treeSelectionHasChange = () => treeSelectionPaths().some(path => Boolean(gitChangeFor(path)))
   const commitSelectedFiles = () => { commitScopeFromTree.value = treeSelectionPaths().map(path => gitChangeFor(path)?.path ?? path) }
   ```
   为什么：`commitScopeFromTree` 是**一次性快照**（点了「提交文件…」才写，提交完由面板自己收回），
   这正是上游的形状 —— `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:636-644`
   的 `resetState()`（`clearCommitContext()` 在 `platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitWorkflow.kt:197-199`）
   会在提交结果处理后把 commit state 换回默认，而不是把上下文里的选择留着当下一轮的默认范围。
   ⚠️ **不要**做成"响应式地一直跟着树的选择走"：面板的 `clearCommitScope()`
   （`src/components/SourceControl.vue:280`）只清自己那份 `scopedCommit`，压不住一个会自己回来的 prop，
   结果是「恢复提交全部」点了没效果。
   ⚠️ 换算照 `src/appGitChangeLookup.ts:14` 的 `findGitChange`（树里是工作区相对、git 里是仓库相对，
   两边都归绝对再比 —— 上面那两行已经复用它），**不要**新造第三个换算函数。
   行数：**+5**（模板 1 行 + 脚本 4 行）。App.vue 余量 30 ⇒ 用掉 5，剩 25。**不新增持久化键**（约束⑥）。

4. `src/toolViewContext.ts`：在返回对象里（`gitCompareWith`、`dirtyPaths` 那一族附近，
   现有形状见 `:142`、`:160`、`:166`）加一行
   `commitScopePaths: commitScopeFromTree.value ?? undefined,`
   并把 `commitScopeFromTree` 加进 `:92` 那个解构（同一行内 ⇒ `+0`）。
   ⚠️ 还差一小步：`createToolViewContext(…)` 的**调用点**在 `src/App.vue:885-888` 那个长行对象里
   （同一族里已经有 `fileTreeRef`、`notifyFromPanel`、`showToolWindow`），
   加一个属性 `commitScopeFromTree,` 就够 ⇒ **同一行内**，App.vue **+0 行**。
   为什么：`fileTreeRef`、`workspace`、`gitChanges` 都已经在 ctx 里，这一步只是把快照递给面板。

5. `src/components/ToolWindowView.vue:199`：在已有的那一条 `<SourceControl …>` 长行里加一个属性
   `:commit-paths="ctx.commitScopePaths"`（同一行内 ⇒ **+0 行**，且 `ToolWindowViewContext` 是
   `export type`/接口就声明在同文件里 ⇒ 类型面加 1 行）。
   判据要求：面板的 `commitSelection`（`src/components/SourceControl.vue:263-264`）
   已经写成 `scopedCommit.value ?? (props.commitPaths?.length ? [...props.commitPaths] : null)` ⇒
   prop 一到就生效，**面板一行都不用改**。

**判据（接线落地后必须新加/翻转的用例，写在本仓的测试里）**：
- 新用例（建议进 `tests/commit-scope.test.mjs`，它已经是这一族的判据面）：
  ```js
  test('宿主通道：项目视图多选 ⇒ 面板拿到范围，且只提交对得上变更的那些', () => {
    const app = read('src/App.vue'), ctx = read('src/toolViewContext.ts'), tw = read('src/components/ToolWindowView.vue')
    assert.match(app, /const commitSelectedFiles = \(\) => \{ commitScopeFromTree\.value = treeSelectionPaths\(\)/,
      '菜单那一行写的是**一次性快照**，不是响应式跟手（否则「恢复提交全部」点了没效果）')
    assert.match(app, /gitChangeFor\(path\)\?\.path \?\? path/, '树里的路径先归成仓库相对（复用 findGitChange，不造第三个换算）')
    assert.match(ctx, /commitScopePaths: commitScopeFromTree\.value \?\? undefined/)
    assert.match(tw, /:commit-paths="ctx\.commitScopePaths"/)
  })
  ```
- 反向验证：把 `commitSelectedFiles` 里的 `commitScopeFromTree.value = …` 换成
  `computed(() => treeSelectionPaths())`（即"响应式跟手"那种写法），上面第一条断言必须红。
- 端到端：`node --test tests/commit-scope.test.mjs tests/commit-check*.test.mjs tests/stage*.test.mjs tests/module-size.test.mjs`
  必须仍 0 红，且 `App.vue` 的门控行数 ≤ 2737（预期 2712）。
- 真机（可选，主代理做）：项目视图 Ctrl 多选两篇变更 → 右键「提交文件…」→ 面板出现
  `本次只提交 2 个变更`，提交后通知是 `2 个文件已提交`，第三篇已暂存的仍留在暂存区
  （口径与 `native/git_test.cpp:415` 那条 case 相同）。

---

## W2（组装层 · Git 菜单 / VCS 快速列表那一档入口）

上游把 `CheckinFiles` 也挂在 `VcsActions.xml:541`（KeymapGroup，即可搜索/可绑键）与 `:660`
（`Vcs.Operations.Popup` = Alt+` 那个快速列表），以及
`plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml:163` 的 `Git.FileActions` 第一条
（`Git.Menu` 的组头几条之一）。本仓对应面：`src/menus/gitMenu.ts:34`（`git.commit`「提交项目…」）
之后**没有**「提交文件…」这一行。

- 哪一行：`src/menus/gitMenu.ts`，在现有 `:34` 之后插入一行
  ```ts
  { id: 'git.commitFiles', title: '提交文件…', keywords: 'commit checkin files selected 提交文件 部分提交', enabled: () => Boolean(ctx.workspace.value) && ctx.gitAvailable.value && ctx.hasCommitScopeSelection(), run: () => ctx.commitSelectedFiles() },
  ```
- 为什么：`CommonCheckinFilesAction.kt:33` 那句 `pathsToCommit.any { Manager.isActionEnabled(project, it) }`
  就是"选择里一个可提交的都没有 ⇒ 整条动作不启用"，所以这一行必须带 `enabled`，
  不能摆一个点了没反应的假控件（约束⑧）。文案与 `COMMIT_SCOPE_LABEL`
  （`src/commitScope.ts:82`）同一真源也可（`import { COMMIT_SCOPE_LABEL } from '../commitScope.ts'`）。
- **键位**：不写 `keys` —— 实测参考树里 `CheckinFiles` 没有任何 `keyboard-shortcut`
  （`grep -rn "CheckinFiles" --include=*.xml | grep -i shortcut` = 0 命中），
  本 lane 也不许编键位（约束①）。上游把它放进 `VcsActions.KeymapGroup` 只是让它**可搜索/可自定义**。
- 依赖：`ctx` 需要 `hasCommitScopeSelection()` 与 `commitSelectedFiles()` 两个方法
  ⇒ 就是 W1 第 3 步那两行的同一对函数；`createGitMenuRows` 的 ctx 装配点在
  `src/App.vue:1556` 那一长行（对象字面量，**同一行内**加两个属性 ⇒ `+0` 行）。
- 判据：新用例钉
  `assert.match(gitMenu, /id: 'git\.commitFiles'.*enabled: \(\) => .*hasCommitScopeSelection\(\)/)`，
  并把 `hasCommitScopeSelection` 打桩成恒 `false` 反向验证"这一行在不该给的时候不给"。
  菜单口的消费链实测在 `src/App.vue:149`（`import { createGitMenuRows, type GitMenuContext } from './menus/gitMenu'`）
  与 `src/App.vue:1613`（`const gitMenuRows = createGitMenuRows(gitMenuContext)`）⇒
  新行必须进同一份行表，`keywords` 的写法照同文件 `:34` 那条（它带中文"提交"，这条也要带"提交文件"），
  不另立第二条菜单通道。落地后重跑 `tests/main-menu-parity.test.mjs` 与
  `tests/menu-keyboard.test.mjs`（这两个是本仓已有的菜单面门控）。
- 顺带（同一条请求里）：`src/components/SourceControl.vue:509` 那句注释写的是
  `CommitChecksDeps.commitScope`，`:88 那一档`；实测该字段在 `src/sourceControlCommitChecks.ts:87`
  （`:88` 是 `}`）。**差一行、不扑空**。本 lane 不改（该文件在另一路 lane 的并发面上，
  且 `tests/commit-check.test.mjs:81-82` 逐字钉着它的两行原文），留主代理顺手订正。

---

## W3（native · `checked_pathspec` 缺"pathspec 通配/魔术"那一道）

**实测依据（临时仓，只跑 git，没动本仓历史）**：
- `git commit --only -m glob -- '*.ts'` ⇒ 一次提交走了 `a.ts` **和** `b.ts` 两篇；
- `git commit --only -m bracket -- 'foo[1].ts'` ⇒ 一次提交走了 `foo[1].ts` **和** `foo1.ts` 两篇；
- 未跟踪那一发用的 `git add -- <path>`（`native/git.cpp:521-524`）同样吃 pathspec，同一条风险。
⇒ "只提交选中的路径"会变成"提交得比选中的多"。上游没有这个问题：它**不发 pathspec**，
改的是 index（`plugins/git4idea/backend/src/checkin/GitCheckinEnvironment.kt:393-434` +
`plugins/git4idea/backend/src/util/GitFileUtils.kt:156-179`），所以本仓这条差异是**短路方案带来的**，
必须自己补闸。
**前端已经先严**：`src/commitChecks.ts:503`（`PATHSPEC_MAGIC_RE`）+ `:516`，判据在
`tests/commit-scope.test.mjs`（`星号会匹配到没选的文件…` 等 5 条）。native 没接之前，
宿主直接递进来的非法子集（不走 `commitRequestParams` 的任何调用方）仍是漏的一面。

- 哪一行：`native/git.cpp`，在 `checked_pathspec()` 现有那个字符循环之后（现在 `:282-284` 是
  ```cpp
      for (const char character : path)
          if (static_cast<unsigned char>(character) < 0x20 || character == '\\')
              throw WorkspaceError("INVALID_REQUEST", "提交路径只能是仓库相对的 POSIX 写法。");
  ```
  ）加：
  ```cpp
      // 2026-10-06 partialcommit W3：git 的 pathspec 里 `*` `?` `[` 是**通配**、`:` 开头是**魔术**，
      // 不是字面量。实测 `git commit --only -- 'foo[1].ts'` 一次提交走 `foo[1].ts` 和 `foo1.ts`
      // 两篇，`-- '*.ts'` 把所有 .ts 都提交走 ⇒ "只提交选中的"会提交得比选中的多。前端
      // （src/commitChecks.ts 的 PATHSPEC_MAGIC_RE）已经先拒，这一道把同一口径落到 native。
      if (path.find_first_of("*?[") != std::string::npos || path.front() == ':' ||
          path.find(":(") != std::string::npos)
          throw WorkspaceError("INVALID_REQUEST", "提交路径只能是字面量，不能含 git 的 pathspec 通配或魔术前缀。");
  ```
  行数：+6（`native/git.cpp` 余量 239）。
  **另一条实现路线**（更贴上游语义、代价是要在**每一发**命令上都改）：把 pathspec 交给
  git 时包成 `:(literal)<path>`，这样文件名里真带 `[` 的那一篇也提交得动（本仓前端现在的口径是
  拒掉它，登记为"改走暂存 + 整份提交"）。若主代理选这条：
  ① 前端 `src/commitChecks.ts:516` 那一道要放宽成**只拒 `:` 魔术**、放行 `*?[]`；
  ② `tests/commit-scope.test.mjs` 里那句
     `assert.doesNotMatch(native, /:\(literal\)/, 'native 那道闸**还没有**这一条（W3 待接）…')`
     必须翻成 `assert.match(...)`（这条断言是**故意**钉"还没接"的，接了不翻就会红，不会假绿）。
- 为什么：约束②不许本 lane 动 native；且这条闸的**语义**（是拒还是转义）归宿主/native 侧定。
- 判据（**本 lane 没跑 ctest**，按约束只写请求）：`native/git_test.cpp` 第 499 行那条
  `run("partial commit: pathspec must be a repo-relative POSIX path", …)` 里的 `rejected` 表
  追加三条，形状照现有条目：
  ```cpp
      {"*.ts", "通配：实测一条 pathspec 能提交得比选中的多"},
      {"sc-bracket[1].ts", "字符类：实测连 sc-bracket1.ts 一起提交走"},
      {":(exclude)sc-ok.txt", "pathspec 魔术：反向把选中的排除掉"},
  ```
  该 case 已有的三条检查（`refused` / `code == "INVALID_REQUEST"` / 提交前后 HEAD 不变）
  对新增条目自动生效 ⇒ 只要 ctest 里那条用例仍 `passed`，这一道就是**拒得住并且不落提交**；
  表下面那条"反向对照"（`put(scope / "sc-ok.txt")` + 一次合法提交）保证它不是"谁都拒"。

---

## W4（native · 512 字节与 500 条上限这两道**有闸没判据**）

`native/git.cpp:494` 的 `paths.size() > 500` 与 `native/git.cpp:261` 的 `path.size() > 512`
都在（前端镜像在 `src/commitChecks.ts:477`/`:480`，`tests/commit-scope.test.mjs` 已钉"同一个数"），
但 `native/git_test.cpp` 那四条 partial commit 用例覆盖的是子集/未跟踪/重命名成对/六种非法形状，
**没有一条打到这两个上限**。⇒ 只能证明"数字一样"，证明不了"native 真按这个数拒"。

- 哪一行：`native/git_test.cpp`，在 `run("partial commit: pathspec must be a repo-relative POSIX path", …)`
  （`:499`）这条 case 的 `rejected` 循环**之后**加一段（同一条 case 里最省事）：
  ```cpp
      // 两条上限：都在调 git 之前拒，且 HEAD 不动（上面那个 tip_before 的写法照搬）。
      const std::string too_long = std::string(513, 'a') + ".ts";
      const auto tip = taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>();
      bool too_long_refused = false;
      try { scoped_commit("sc: must not run", {too_long}); }
      catch (const taocode::WorkspaceError& error) { too_long_refused = std::string(error.code) == "INVALID_REQUEST"; }
      check(too_long_refused, "单条 pathspec >512 **字节**要拒（注意是字节：中文路径 171 个汉字 = 513 字节）");
      check(taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>() == tip,
            "超长那一发没生成提交");
      std::vector<std::string> too_many;
      for (int i = 0; i < 501; ++i) too_many.push_back("sc-many-" + std::to_string(i) + ".ts");
      bool too_many_refused = false;
      try { scoped_commit("sc: must not run", too_many); }
      catch (const taocode::WorkspaceError& error) { too_many_refused = std::string(error.code) == "INVALID_REQUEST"; }
      check(too_many_refused, "501 条 pathspec 要拒（与前端 MAX_COMMIT_PATHS = 500 同一个数）");
      check(taocode::git::log(scope, "", 1).at("commits")[0].at("hash").get<std::string>() == tip,
            "超条数那一发同样没生成提交");
  ```
  行数：+18（`native/git_test.cpp` 余量 536）。
- 为什么：`path.size()` 数的是字节，与本 lane 刚对齐的前端 `utf8ByteLength`（`src/commitChecks.ts:501-506`）
  是同一个口径；用例里那句"171 个汉字 = 513 字节"就是为了让后来人别把它改回按字符数。
- 判据：`ctest` 里这条用例名（`partial commit: pathspec must be a repo-relative POSIX path`）
  必须仍 `passed`；**本 lane 没跑 ctest**（约束：native 侧只写请求）。

---

## W5（登记，不请求改动）：三道闸之间的已知不对称

1. 空串：native 判非法（`native/git.cpp:261` `path.empty()`），前端当"没选"滤掉
   （`src/commitScope.ts:85-87` 的 `normalizeCommitSelection`）⇒ 同一份输入两个结果，
   **有意不同**，已写进注释与判据（`tests/commit-scope.test.mjs` 边界三那句"全空白 = 没选 ⇒ 不发 paths 键"）。
   不改：把空白项报错会把"用户其实什么都没选"变成一条看不懂的错误行。
2. 含 `..` 一刀切：`a..b.ts` 这种合法文件名**两侧都拒**（同源同数 ⇒ 不漂，但要放开得两边一起放，
   native 不许本 lane 动）。若以后要放，正确形状是只拒**路径段等于 `..`** 的（`/../`、开头 `../`、结尾 `/..`），
   前端 `src/commitChecks.ts:511` 与 native `native/git.cpp:263` 同一批改。
3. `ignored`（被忽略的文件）只有前端能判：`native/git.cpp` 的 `status()` 走
   `git status --porcelain`，默认不列被忽略的行 ⇒ native 那条"这个路径没有可提交的变更"
   （`native/git.cpp:515`）会替它兜底，但**文案**不同。本仓的判据面在前端
   （`src/commitChecks.ts:543` 拒 + `src/commitCheck.ts:80` 不数它），native 不需要动。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1（项目视图多选 → 提交范围）** —— 目标 `src/App.vue`（本 lane）+ `FileTree.vue` + `SourceControl.vue`（VCS lane）。因末端在 SourceControl，登记为「需 VCS lane 同批」。
- **W2（Git 菜单/VCS 快速列表入口）** —— `src/menus/gitMenu.ts`（本 lane）+ SourceControl，同上。
- **W3 / W4** —— native，非本 lane。**W5** —— 登记。

结论：零接线（W1/W2 转 VCS lane，W3/W4 非本 lane）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W1/W2 转 VCS lane，W3/W4 非本 lane）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
