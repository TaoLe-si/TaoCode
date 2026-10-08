# 接线请求 · 桶 15（项目模型 / 外部系统 / 根与 SDK / 文件面 / VFS）· 2026-10-06

按 `docs/batches-2026-10-06-buckets.md` §4 的格式。本轮**没有**改任何保留文件；下面 3 条都要动保留文件
（`src/App.vue`、`src/main.ts`、`native/settings_schema.cpp`）。
行号是 2026-10-06 现树实测（工作区在并发变动中，落地前请重读目标区域）。
**App.vue 余量提醒**：现 2724 行 / 上限 2737（只剩 13 行）。W1 的写法是**净减行**的（16 行硬编码 `<option>` 换成 1 行 `v-for`），可以放心落。

---

## W1 · 新建文件对话框：让「用户自定义文件模板」真的参与，并把 16 个内建模板的清单交回唯一真源

- **目标文件**：`src/App.vue`
  - 第 **2523-2539** 行那个 `<select v-if="nameDialog.mode === 'createFile'">` 里的 16 个硬编码 `<option>`；
  - 第 **1771-1777** 行 `applyNameDialog()` 的 `else` 分支（现在只有 `request('file.create', { …, template: dialog.template })`）；
  - import 区（`src/App.vue:142` 那一行 `import { effectiveTemplates, languageFor, type Template } from './templates'` 之后）。
- **要接什么**：`src/fileTemplateRegistry.ts` 的 `HOST_FILE_TEMPLATE_KINDS`（`:152`，16 条内建 kind 的**唯一在册清单**，含 label 与 extension）
  与 `fileTemplatesState(scope, projectRoot)`（`:207`，返回 `{ templates, submit, remove, persist }`，`templates` 就是设置页写入 localStorage 的那份用户模板表）；
  `src/fileTemplateCreate.ts` 的 `createFileFromTemplate(input, io)`（`:150`，`file.create` 建目录/建文件 + `file.write` 写展开正文，返回 `FileTemplateCreatePlan`）。
- **为什么需要**：判词（`docs/inventory/verdict-platform_rest.md:165`）说「用户模板与 `${NAME}` 的展开结果没有落盘通道」——
  前半句成立、后半句不成立：通道就是我方 `fileTemplateCreate.ts`，**唯一缺口是这条对话框没接**（`src/App.vue:1773` 仍把 `dialog.template` 当宿主的 `template_kind` 传）。
  现状的可观察后果是：在「设置 › 实时模板 › 文件模板」里新建的自定义模板**在新建文件对话框里根本不出现**，用户只能拿到 16 个内建 kind。
- **上游依据**：`platform/lang-impl/src/com/intellij/ide/actions/CreateFileFromTemplateAction.java:68-120`
  （名字里带 `/` 先 `MkDirs` 建目录 `:76-79`；正文与变量交给 `FileTemplateUtil.createFromTemplate` `:85`；额外变量在这一步并进模板属性 `:84`；成功后 `openFile` `:93-97`；
  Velocity 解析失败包成 `IncorrectOperationException("Error parsing Velocity template: …")` `:105-106`）；
  模板自己的扩展名决定文件类型 = `platform/lang-impl/src/com/intellij/ide/fileTemplates/FileTemplateUtil.java:384`。

### 可照抄的整段替换

**(a) import（加在 `src/App.vue:142` 那行之后，2 行）**

```ts
import { HOST_FILE_TEMPLATE_KINDS, fileTemplatesState } from './fileTemplateRegistry.ts'
import { createFileFromTemplate } from './fileTemplateCreate.ts'
```

**(b) 计算属性（加在 `const nameDialog = …`（`src/App.vue:227`）附近；4 行）**

```ts
// 新建文件对话框的模板项：16 个宿主内建 kind（唯一真源在 fileTemplateRegistry，别再抄第二份）
// + 用户在 设置 › 实时模板 › 文件模板 里登记的自定义模板（值前缀 `user:`，走 fileTemplateCreate 的展开与落盘）。
const nameDialogTemplates = computed(() => [
  { value: '', label: '空文件' },
  ...HOST_FILE_TEMPLATE_KINDS.map(item => ({ value: item.kind, label: item.label })),
  ...fileTemplatesState('project', workspace.value?.root ?? null).templates.value
    .map(item => ({ value: `user:${item.id}`, label: `${item.name}（自定义模板）` })),
])
```

> 若 `nameDialog` 打开后用户才在设置页改模板，重开对话框即可刷新（`fileTemplatesState` 每次调用都从 localStorage 现读，
> 与设置页写的是同一份表）。

**(c) `<select>` 的 16 行 `<option>` ⇒ 1 行（`src/App.vue:2524-2539` 整段替换）**

```html
        <select v-if="nameDialog.mode === 'createFile'" v-model="nameDialog.template" class="rename-input" style="margin-top: 8px;" aria-label="文件模板">
          <option v-for="item in nameDialogTemplates" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
```

> 可见文案差异（如实提醒）：换成唯一真源后 3 条标签会跟着注册表——「Java 记录」→「Java 记录类」、
> 「Vue 组件」→「Vue 单文件组件」，并多出「Kotlin 数据类」等原本就硬编码在 App.vue 的同名项（内容一致）。
> 注册表那份是设置页显示用的同一张表，两处不再漂移。

**(d) `applyNameDialog()` 的 `else` 分支（`src/App.vue:1771-1777` 整段替换）**

```ts
    } else {
      const target = dialog.dir ? `${dialog.dir}/${name}` : name
      const userTemplate = (dialog.template ?? '').startsWith('user:')
        ? fileTemplatesState('project', workspace.value?.root ?? null).templates.value
            .find(item => `user:${item.id}` === dialog.template)
        : undefined
      if (userTemplate) {
        // 自定义模板：本仓走「建空文件 + 写展开正文」（fileTemplateCreate），宿主只认 16 个内建 kind。
        const plan = await createFileFromTemplate(
          { template: userTemplate, directory: dialog.dir ?? '', fileName: name, projectName: workspace.value?.name ?? '', user: document.title },
          { create: (path, directory) => request('file.create', { path, directory }), write: (path, content) => request('file.write', { path, content }) },
        )
        await refreshTree()
        await openFile(plan.path)
        notify(`已按模板 ${userTemplate.name} 创建 ${plan.path}${plan.unset.length ? `（未赋值变量：${plan.unset.join('、')}）` : ''}`)
        return
      }
      await request('file.create', { path: target, directory: dialog.mode === 'createDir', template: dialog.template || undefined })
      await refreshTree()
      if (dialog.mode === 'createFile') await openFile(target)
      notify(dialog.mode === 'createDir' ? `已创建文件夹 ${name}` : `已创建文件 ${name}`)
    }
```

> 需要 `import { computed } from 'vue'`（App.vue 已有）。`userTemplate` 直接满足 `CreatableFileTemplate`
> （`{name, extension, content}`，见 `src/fileTemplateCreate.ts:25-29` 与 `src/fileTemplateVars.ts:159-168`）。
> `plan.unset` 是「模板引用了但本次没给值的变量」（上游 `FileTemplateBase.getUnsetAttributes`），
> 提示而不是隐瞒；判据在 `tests/template-create.test.mjs`。

---

## W2 · `externalTools` 的 schema 放开完整 bean 字段（外部工具 16 个字段里 11 个现在存不进宿主设置）

- **目标文件**：`native/settings_schema.cpp` 第 **262-271** 行（`externalTools` 那一支）。
- **要接什么**：把 `known_keys(entry, {"name","command"}, …)` 的白名单按上游 `Tool` 的 bean 放开，
  放开后 `src/externalToolsRecords.ts` 的 `toolRecordsFrom()` 就是「宿主设置 + localStorage 两处来源」的唯一合并入口
  （该模块头 `:14-18` 已经写死了这个前提，并把本请求的编号标在 `:17`）。
- **为什么需要**：现在多余键会被判 `INVALID_SETTINGS` ⇒ `workingDirectory` / `useConsole` / `showConsoleOnStdOut` /
  `showConsoleOnStdErr` / `synchronizeAfterExecution` / `description` / `group` / `outputFilters` 只能落 localStorage，
  **不随项目走**（换机器/重装就丢），而上游这些字段是 `.tools` 设置的一部分。
  四个 `shownIn*`（`Tool.java:62-65`）**不放开**：上游在源码注释里已标注「effectively not used anymore, see IDEA-190856」，
  本仓 `src/externalToolsModel.ts` 也按「存得下但没有消费者」如实标注，不给它开持久化口子。
- **上游依据**：`platform/lang-impl/src/com/intellij/tools/Tool.java:56-77`（本轮实测该文件 452 行；
  `:72` = `synchronizeAfterExecution`、`:75-76` = program/parameters 两字段被本仓合成一条 `command`）；
  编辑面 `platform/lang-impl/src/com/intellij/tools/ToolEditorDialog.java:100-121`（`getData`）与 `:137-158`（`setData`）。

### 可照抄的整段替换（`native/settings_schema.cpp:262-271`）

```cpp
        } else if (it.key() == "externalTools") {
            // 外部工具：上游 Tool.java:56-77 的 bean 形状。name/command 仍必填（其余可选），
            // 上限 32 条与两条长度限制保持原口径。
            if (!value.is_array() || value.size() > 32)
                fail("INVALID_SETTINGS", "externalTools must be an array of at most 32 entries.");
            for (const auto& entry : value) {
                if (!entry.is_object()) fail("INVALID_SETTINGS", "each external tool must be an object.");
                known_keys(entry, {"name", "command", "description", "group", "enabled", "useConsole",
                                   "showConsoleOnStdOut", "showConsoleOnStdErr", "synchronizeAfterExecution",
                                   "workingDirectory", "outputFilters"}, "INVALID_SETTINGS");
                const auto name = text_or(entry, "name"), command = text_or(entry, "command");
                if (name.empty() || name.size() > 80) fail("INVALID_SETTINGS", "external tool name must be 1..80 bytes.");
                if (command.empty() || command.size() > 1000) fail("INVALID_SETTINGS", "external tool command must be 1..1000 bytes.");
                // 可选文本字段：给了就要是字符串（缺省 = 用上游默认值，由前端 Tool.java:56-76 的默认档兜）。
                for (const auto* key : {"description", "group", "workingDirectory"}) {
                    if (entry.contains(key) && !entry.at(key).is_string())
                        fail("INVALID_SETTINGS", std::string("external tool ") + key + " must be a string.");
                }
                for (const auto* key : {"enabled", "useConsole", "showConsoleOnStdOut", "showConsoleOnStdErr",
                                        "synchronizeAfterExecution"}) {
                    if (entry.contains(key) && !entry.at(key).is_boolean())
                        fail("INVALID_SETTINGS", std::string("external tool ") + key + " must be a boolean.");
                    }
                if (entry.contains("outputFilters") && !entry.at("outputFilters").is_array())
                    fail("INVALID_SETTINGS", "external tool outputFilters must be an array.");
            }
```

> 落地后请同批跑 `.tools/nctest-all.bat`（先 `call vcvars64.bat`），并把 `native/settings_schema` 那条
> 「未知键 → INVALID_SETTINGS」的既有用例补一条「externalTools 带 description/enabled 也收」的正例；
> 前端侧不需要改动：`src/externalToolsRecords.ts` 已经在读这些键，读不到就用 localStorage 那份。

---

## W3 · 启动时把「忽略的文件与目录」灌进文件类型注册表（上游是应用启动时装 `filetypes` 组件）

- **目标文件**：`src/main.ts` 第 **23** 行（`try { createApp(App).mount('#app') } …` 之前）。
- **要接什么**：`src/fileTypeIgnoredList.ts` 的两条导出 —— `loadIgnoredPatterns()`（`:226`，从 localStorage 读清单）
  与 `applyIgnoredPatterns(patterns)`（`:211`，把清单灌进进程内注册表并广播 `fileTypesChanged`）。
- **为什么需要**：现状只有打开「设置 › 文件类型」那一页时才灌（`src/components/FileTypesPage.vue:261`）
  ⇒ **启动后到第一次进设置页之间，忽略清单对判定不生效**（`isPathIgnored` 走的是模块内默认表，不是用户那份）。
  上游没有这个问题，因为那张表是 `filetypes` 组件初始化的一部分，不是某个 UI 的副作用。
- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:165`
  与 `:1363-1364`（本轮实测该文件 2025 行）；忽略掩码本体 = 同文件族的 `IgnoredPatternSet`（分号分隔，`*.pyc;*.class`）。

### 可照抄的整段替换（`src/main.ts:3-5` 的 import 区 + `:19-24` 的 else 分支）

```ts
import { applyIgnoredPatterns, loadIgnoredPatterns } from './fileTypeIgnoredList.ts'
```

```ts
} else {
  // 忽略清单要在任何 UI 之前就生效（上游 FileTypeManagerImpl.java:165 + :1363-1364 的组件初始化那一档），
  // 而不是等用户第一次打开「设置 › 文件类型」。
  applyIgnoredPatterns(loadIgnoredPatterns())
  // 界面挂不起来时不要留一片白窗：上游 `StartupErrorReporter.processException`
  // （platform/platform-impl/.../bootstrap/StartupErrorReporter.java:353-409）就是为这件事存在的，
  // 落点见 src/platformIdeStartupFailure.ts。
  try { createApp(App).mount('#app') } catch (error) { showStartupFailure(error) }
}
```

---

## 不需要接线的（本轮已核实，别误接）

- `src/rootsJarEntries.ts`（档案条目解析）：已有引用方 `src/jarEntriesSource.ts`，缺的是**宿主 Method**，
  由另一代理在同批接（派单明确本轮不动它，也不动 `native/library_sources*.cpp`）。
- 「把内容探测接进打开流程」：**早就接了** —— `src/App.vue:2189` 的每个 `CodeEditor` 都是
  `:language="associationOf(tab.path, tab.content)"`，内部走 `src/fileTypeDetection.ts:142` 查进程内注册表；
  本轮反向验证（见 `docs/batch-2026-10-06-bucket15.md` §4）钉住了这条链。
- 「按内容 CRC 判定设置文件真变了」：**早就接了** —— `src/gradleHost.ts:43` import `calculateSettingsFilesCrc`、`:616-619` 用。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1 已接线**：`src/App.vue:160-161` 两条 import、`:254-257` `nameDialogTemplates`（内建 16 kind + 自定义模板）、`:1793-1796` `applyNameDialog` 的 user 模板分支（`createFileFromTemplate`）、`:2570-2571` `<select>` 走 `v-for`。16 行硬编码 option 已撤，净减行。
- **W2（`externalTools` schema 放开）跳过** —— 目标 `native/settings_schema.cpp`，本 lane 禁改 `native/**`（除 `main.cpp` 本就禁）。需 native owner 处理。
- **W3 已接线（形状订正）**：`src/main.ts:6` import `loadIgnoredPatterns`、`:30` 调 `loadIgnoredPatterns()`（该函数自己已 `applyToManager`，无需再套 `applyIgnoredPatterns`），在 `createApp(...).mount()` 之前。

结论：W1/W3 早已接线，未改任何文件。
