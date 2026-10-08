# wiring-requests · recentdirclose（Run Anything 最近目录缓存收口批）

lane：`docs/batch-2026-10-06-recentdirclose.md`。上游参考树 =
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（仓内 `third_party/intellij-community` 是坏树，未用）。
**下面每一条的宿主行号都是本批自己 `grep -n` / `awk NR` 开文件数出来的**；前端一行都给了可以直接粘贴的原文。

保留文件余量（本批全部方案都按这个算）：`native/main.cpp` 现 1845 行 / 登记上限 2000（`tests/module-size.test.mjs:36-37`）；
`src/App.vue` 现 2706 行 / 上限 2737（同文件 `:107-108`）；`src/bridge.ts` 余量 1 行（本批一条都不动它）；
`native/settings_schema.cpp` 现 **1099 行 / 上限 1100**（未登记 ⇒ `NATIVE_REGISTERED` 之外的原生文件按
`NATIVE_DEFAULT_LIMIT = 1100`，同文件 `:28`、`:187-190`）⇒ **只有 1 行余量**，R3 因此不能就地加代码。

## R1（要宿主改，一行）· `dialog.pickDirectory` 的标题被写死，前端传的 `title` 没人读

- **哪一行**：`native/main.cpp:135-137`，今天长这样（逐字）：
  ```cpp
  routes.emplace("dialog.pickDirectory", [this](const Json& params) {
      return taocode::dialogs::select_directory(window, L"选择项目存放目录", params.value("initial", std::string()));
  });
  ```
  即：`title` 是宿主写死的一个字面量，`params` 里只取 `initial`。
- **改成什么**（+1 行；`wide()` 就在同一文件里用着，见 `native/main.cpp:141` 的 `fs::path(wide(path))`）：
  ```cpp
  routes.emplace("dialog.pickDirectory", [this](const Json& params) {
      const auto title = params.value("title", std::string());
      return taocode::dialogs::select_directory(window, title.empty() ? L"选择项目存放目录" : wide(title).c_str(),
                                               params.value("initial", std::string()));
  });
  ```
  回落值保持现在这个字面量 ⇒ **不传 `title` 的调用方（欢迎页/建项目那一支）一个字节都不变**，零回归。
- **为什么**：前端已经有四处传 `title`、全被丢掉：
  `src/components/ProblemsPanel.vue:524`（`{ title: '选择检查报告输出目录', initial: '' }`）、
  `src/fileChooserHostState.ts:95` 与 `src/fileChooserDescriptor.ts:307`（`descriptor.title`）、
  `src/App.vue:1464`（`pickDirectory: (title, initial) => chooseDirectory(withTitle(singleDirDescriptor(), title), initial)`）、
  以及本批这一支 `src/components/RunAnythingDialog.vue:124`。
  上游那一支（Run Anything 的「浏览目录…」）是 `RunAnythingChooseContextAction.kt:136` 的
  `FileChooserDescriptorFactory.createSingleFolderDescriptor()` = `FileChooserDescriptorFactory.java:128-130`
  → `singleDir()`（同文件 `:21-23`），**没有** `withTitle` ⇒ 标题取描述件默认值
  （`FileChooserDescriptor.java:58` `myTitle = IdeCoreBundle.message("file.chooser.default.title")`），
  也就是"通用选目录"那一档，而不是"选择项目存放目录"。所以今天这一格在任何调用方都是同一个错标题。
- **判据**：真机两条（宿主文件不在 JS 判据面上，`native/dialogs.cpp` 的 Win32 调用也测不了，前例见
  `native/dialogs.hpp:9-11` 的说明——它只把 `parse_file_filters` 这种纯函数拿出来测）：
  ① 「问题」面板导出 HTML → 选输出目录 → 标题必须是「选择检查报告输出目录」（今天红的：显示「选择项目存放目录」）；
  ② 欢迎页 → 新建项目 → 选存放目录（`src/workspaceLifecycle.ts:491`，不传 `title`）→ 标题仍是「选择项目存放目录」。
- **R1b（前端一行，等 R1 落地再改）**：`src/components/RunAnythingDialog.vue:124` 的
  `request<string | null>('dialog.pickDirectory', { initial: recentDirectoryChooserStart() })`
  → 加 `, title: '选择目录'`。文案不新造：'选择目录' 就是本仓目录框的既有默认标题
  （`src/fileChooserDescriptor.ts:83`，它对应的正是上游"未覆盖标题 ⇒ 用描述件默认"那一档）。
  **本批故意不先落这一行**：宿主不读 `title` 时它是一条没人消费的死参数，先落等于把"没修好"写成"修好了"。

## R2（要宿主重建，不改代码）· 新键的白名单只在**工作树**里，产物还没带上

- **哪一行**：`native/settings_schema.cpp:952` —— `"foldingState", "runAnythingRecentPaths"},`
  （`git diff` 显示这一行是**未提交的工作树改动**：HEAD 里只有 `"foldingState"`）。
- **改成什么**：不用改代码，**要重新构建并同步两份产物**（`build/` 与 `build-validation/`）。
- **为什么**：正在跑的宿主二进制里没有这个键 ⇒ `validate_project_patch`（`native/settings_schema.cpp:949-953`）
  会对 `project.settings.update` 回 `INVALID_SETTINGS`（`native/projects.cpp:823` 那道），而前端那一条
  `.catch(() => undefined)`（`src/runAnythingRecentDirectories.ts:90-92`）按设计把它吞掉 ⇒
  真机表现是"这一档当次会话有、重启就没了"，看起来像缓存没做。
  另外这一段是**硬教训位**：这个键**必须**待在 `validate_project_patch` 白名单里 —— 存进去之后下一次开机
  读盘会拿整份记录过同一条校验（`native/project_settings_state.cpp:106`），漏登 ⇒ 整份 `perProject` 判
  `STATE_CORRUPT` ⇒ 用户被打不开项目（2026-10-06 那次事故的同一个形状）。
- **判据**：重建后 ① Run Anything → 浏览目录 → 选一个目录 → 完全退出 → 再开同一个项目，下拉里那一档还在；
  ② 磁盘上 `projects.json` 的 `perProject[项目根]` 里能 grep 到 `"runAnythingRecentPaths"`；
  ③ 全量测试里 `node --test tests/settings-keys-parity.test.mjs tests/editor-folding-settings.test.mjs` 仍全绿（那两个文件是本仓仅有的设置键白名单判据，都不覆盖项目档那一段）；
  ④ 前端侧本批已经把这条钉进判据：`tests/run-anything-recent-dir-cache.test.mjs` 第 8 条直接读
  `native/settings_schema.cpp` 源码，核 `validate_project_patch` 的 known_keys 里含本模块导出的那个键名
  （白名单一被删掉，判据立刻红，不用等真机）。

## R3（可选，非阻塞）· 原生没有这个键的**形状**校验

- **哪一行**：`native/settings_schema.cpp:955` 那一段（`if (patch.contains("foldingState")) validate_folding_state(...)` 之后）。
- **改成什么**：**不要**在 `settings_schema.cpp` 里就地加函数 —— 该文件 1099 行、上限 1100，加不动。
  照 `foldingState` 的前例单开一对文件并在 `CMakeLists.txt` 登记（前例行：`native/folding_state_schema.cpp`、
  `native/folding_state_test.cpp`、`CMakeLists.txt` 里那两行的注册处）：
  ```cpp
  // native/recent_paths_schema.cpp —— 与 folding_state_schema.cpp 同族
  void validate_recent_paths(const Json& value) {
      if (!value.is_array()) fail("INVALID_SETTINGS", "runAnythingRecentPaths 必须是字符串数组。");
      if (value.size() > 32) fail("INVALID_SETTINGS", "runAnythingRecentPaths 最多 32 条（注册表默认是 5）。");
      for (const auto& entry : value)
          if (!entry.is_string() || entry.get_ref<const std::string&>().size() > 512)
              fail("INVALID_SETTINGS", "runAnythingRecentPaths 的每一项都要是 512 字节以内的路径字符串。");
  }
  ```
  再在 `validate_project_patch` 里加一行 `if (patch.contains("runAnythingRecentPaths")) validate_recent_paths(patch.at("runAnythingRecentPaths"));`
  ⇒ 这一行会让 `settings_schema.cpp` 变 1100 行（正好贴顶），**必须**同时把 `:950-952` 那三条长列表拆一行出来或
  先降别处，否则 `tests/module-size.test.mjs` 的"已登记的大文件不许继续变大/原生默认 1100"会红。
- **为什么**：今天的形状由前端兜（`src/runAnythingRecentDirectories.ts:51-55`，非数组 ⇒ 空表、坏条目逐条丢），
  且原生读盘本来就有两道兜底（`native/project_settings_state.cpp:103-105` 抹 `null`、`:123-124` 整份 1 MiB 上限），
  所以**手写坏值最坏结果是"这一档读成空"，不会损坏别家** ⇒ 不阻塞。
  真正的收益只有一条：坏值能被**存下来之前**拒掉，而不是静默存进 `projects.json`。
- **判据**：`native/recent_paths_test.cpp`（照 `native/folding_state_test.cpp:101-105` 的两档形状写：合法补丁过、
  `Json(7)` 拒），并挂进 `CMakeLists.txt` 的原生测试目标。

## R4（主代理保留面）· `ProjectSettings` 里没有这个键的声明

- **哪一行**：`src/settingsModel.ts:144`（`export interface ProjectSettings { ... }`，整条是一行）。
- **改成什么**：在那一行的 `{` 之后插一段（同行 ⇒ **+0 行**，不碰余量）：
  `/** Run Anything 执行上下文的最近目录（上游 State.paths，@XCollection(elementName="recentPaths")）。 */ runAnythingRecentPaths?: string[];`
- **为什么**：盘上确实会多出这个键（`native/projects.cpp:833` 的 `merge_patch` 存它、`:779-780` 读回来时
  `fill_defaults` 原样带出），类型却不说 ⇒ 下一个读 `ProjectSettings` 的人会以为它不存在。
  本批**不依赖**这条：前端从 `project.settings.get` 的原始对象里按键名取
  （`src/runAnythingRecentDirectories.ts:65-70`，形参是 `unknown`），所以不粘这一行功能也是通的。
  它**不进** `project_defaults()`（`native/settings_schema.cpp:432-479`）—— 与 `foldingState` 同一档：
  缺键 = 老存档 = 空表，绝不按"少一个键"判损坏。
- **判据**：`tests/run-anything-recent-dir-cache.test.mjs` 第 2 条钉住"缺键/null/非数组/坏条目/条数超上限
  一律不抛错"，第 8 条钉住原生白名单；粘完 R4 后 `npx vue-tsc -b --force` 的错误条数必须与本批基线一致。

## R5（本批不做，登记）· 目录框失败时没有可见提示

- **现状**：`src/components/RunAnythingDialog.vue:122-132`（`browseContextDirectory`）对宿主报错与用户取消
  都只把 `<select>` 的显示改回原先那一档，不弹提示。
- **为什么不做**：① 失败并非无痕 —— `request()` 会给那一条 `traces` 打上 `status:'error'` 与错误码
  （`src/bridge.ts:899-903`），「操作输出」那一格就列它（`src/App.vue:2203-2204`）；
  ② 上游这一支的失败是 IDEA 的异常处理器弹的气球，**不是**这一格自己的文案 ⇒ 中文措辞**无法核实**，
  不造句子（本仓纪律：文案要有出处）；③ 要一句可见提示就得由组装层把 `notify` 传进来 ——
  方案（不撑爆 `src/App.vue`，余量 31 行）：`src/App.vue:2667` 那一行 `<RunAnythingDialog ...>` 里加
  `:report-error="notify"`（同行 ⇒ +0 行），组件侧 `defineProps` 加一个可选的
  `reportError?: (message: string, error?: boolean) => void` 并在 `catch` 里调 ⇒ +2 行、不碰桥接。
  等主代理点了这条再落。

## 一批相关的"假坐标"订正（本批已改，留痕）

| 位置 | 原写 | 实际（自己开文件数的） | 处置 |
| --- | --- | --- | --- |
| `src/runAnythingRecentDirectories.ts` 的灌入时机 | `src/workspaceLifecycle.ts:305`、`:413` | `importFoldState(loaded?.foldingState)` 在 `:323`、`importFoldState(undefined)` 在 `:434`；本模块三处在 `:316`、`:326`、`:435` | 已改成真行号并写明是订正 |
| 同一处的失败可见性 | 「记在桥接的 traces 里（`app.internalErrors` 那条链能看见）」 | `app.internalErrors` 读的是**原生自己的**错误账（`native/diagnostics.cpp:118-129`，只有 `diagnostics::event(..., "ERROR", ...)` 会写它），而桥接分派的 `catch`（`native/main.cpp:1509-1515`）只把错误回给 JS、**不写那本账**；真正记着失败的是前端那本 `traces`（`src/bridge.ts:295`、`:899-903`，消费点 `src/App.vue:2203-2204`） | 已按真链路改写并留订正说明（`RunAnythingDialog.vue` 里同一条也改了） |
| `RunAnythingDialog.vue` 文件头的 provider 坐标 | 裸类名 `RunAnythingRunConfigurationProvider.java:56-58` | 参考树里**同名两份**：`runAnything/RunAnythingRunConfigurationProvider.java:56-58` 才是 `getExecutionContexts()` → `ContainerUtil.emptyList()`；`runAnything/activity/同名文件:56` 是 `getAdText()` | 已补全相对路径并写明歧义 |
| `StoragePathMacros` 的注释行 | `:22-24` | 那句话是 `:22-23`（`:24` 是 `*/`） | 已收紧 |
| 派单/死 lane 提到的 `pushRecentDirectory` 消费方 | 「要复用，别另写一份条数逻辑」 | 成立：`src/runAnythingContext.ts:210-219`，本模块 `:106` 就是唯一生产消费方 | 已由判据钉住（测试第 6 条的 `pushRecentDirectory(stored.value, picked)`） |
| 「起始目录 = 项目根」 | 上游 `RunAnythingChooseContextAction.kt` 的 `choose(project.guessProjectDir())` 那一支 | 该行是 `:138`（`.choose(project.guessProjectDir()) { ... }`）；`:139-147` 是回值里的那三步（141-143 满了摘最老、144 加、146 设为当前档） | 坐标成立，判据第 3 条钉住 |
| 注册表条数 5 | `intellij.platform.ide.core.impl.xml:170-171` | 成立（`defaultValue="5"` 在 `:170`） | 无需订正 |

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（`dialog.pickDirectory` 标题被写死）** —— 目标 `native/workspace.cpp` / `dialogs.cpp`（非本 lane）。跳过给 native owner。
- **R2 / R3** —— native 重建/校验，非本 lane。
- **R4（`ProjectSettings` 缺键声明）** —— 目标 `src/settingsModel.ts`（保留文件，非本 lane）。需 settings owner。
- **R5** —— 登记。

结论：零接线（全在 native/settingsModel）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（全在 native/settingsModel）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
