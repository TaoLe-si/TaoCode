import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { parseStarterCommandLine, runApplicationStarter } from './applicationStarters.ts'
import { showStartupFailure } from './platformIdeStartupFailure.ts'
import { loadIgnoredPatterns } from './fileTypeIgnoredList.ts'
// 插件 API 面的启动装配：声明上游同名的 EP（`com.intellij.fileEditorProvider` 等）并注册
// `com.intellij.service` 下按 FQN 取的四类服务（`HttpVirtualFileSystem` / `FileEditorManager` /
// `ShelveChangesManager` / `JavaPsiFacade`）+ 本 lane 补的 `FileSwitcherApi` / `EditorWindow` /
// `SavedPatchesProvider` / `ProjectView`。等价于上游启动时把插件服务登记进 `ApplicationManager`。
// 同时把 bundled 的大文件查看器挂进 `com.intellij.fileEditorProvider`（模块加载即注册）。
import './largeFileViewer.ts'
import { installPluginApi } from './pluginApi.ts'
// 调试 / 差异 / 变更列表三域的上游同名 EP（`com.intellij.xdebugger.breakpointType` /
// `com.intellij.diff.DiffTool` / `com.intellij.diff.merge.MergeTool` / `com.intellij.diff.DiffExtension` /
// `com.intellij.vcs.changeListDecorator`）：模块加载即声明 EP 并登记 bundled 默认贡献，
// 插件按上游接口挂进来的那一刻就有效（消费点：`DiffView.vue` 的查看器创建钩子等）。
import './debugDiffExtensionPoints.ts'
// 运行/调试两域的上游同名 EP（`com.intellij.configurationType` / `com.intellij.runConfigurationProducer`
// / `com.intellij.programRunner` / `com.intellij.stepsBeforeRunProvider` / `com.intellij.console.folding`
// / `com.intellij.consoleActionsPostProcessor` / `com.intellij.executor` /
// `com.intellij.runConfigurationBeforeRunProviderDelegate`，以及 `com.intellij.xdebugger.*` 的
// breakpointType / settings / configurableProvider / textValueVisualizer / attachDebuggerProvider /
// breakpointGroupingRule / debuggerSupport / attachHostProvider）。
// 模块加载即声明 EP 并登记 bundled 默认贡献，第三方（原版 IDEA 插件）按同一 id 挂进来即生效；
// 消费点见 `src/executionExtensionPoints.ts` / `src/xdebuggerExtensionPoints.ts` 的文件头
// （`src/runConfigTree.ts` 的类型标签、`src/runIssues.ts` 的控制台折叠、`src/debugAttach.ts` 的附加目标等）。
import './executionExtensionPoints.ts'
import './xdebuggerExtensionPoints.ts'
// daemon 域的上游同名 EP（`com.intellij.highlightVisitor` / `com.intellij.localInspection` /
// `com.intellij.inspectionToolProvider` / `com.intellij.intentionAction` / `com.intellij.errorQuickFixProvider` /
// `com.intellij.problemHighlightFilter` / `com.intellij.inspectionElementsMerger` /
// `com.intellij.daemon.changeLocalityDetector` / `com.intellij.problemsView*` 与
// `com.intellij.frontendProblemsViewContentProvider` 十三条，外加分析侧三条
// externalAnnotatorsFilter / implicitUsageProvider / contributedReferencesAnnotator，
// 见 `src/daemonExtensionPoints.ts` 与 `src/daemonAnalysisExtensionPoints.ts`）。
// **为什么要在入口显式 import**：这个模块此前只被 `src/problems.ts` / `src/inspectionIdentity.ts`
// 等消费方**间接**带进来 —— 入口一旦单独跑（或某条路径不再 import 那些消费方），十三条 EP
// 就一条都没声明，插件按 id 挂过来会直接 `UnknownExtensionPointError`。入口显式 import
// 让「daemon 域的 EP 在 App 挂起来之前一定就绪」成为**不依赖别人**的保证；
// 模块加载即声明（`declareDaemonExtensionPoints()` 在本模块尾部调用）。
import './daemonExtensionPoints.ts'

// 浏览器预览的「命令行」：真实 argv 在宿主 `native/main.cpp` 里、当前没有透出到前端的通道，
// 所以 `?command=<名字>&args=...` 是 `ApplicationStarter` 的入口替身（如
// `list-commands`、`generateEnvironmentKeysFile`）。跑启动命令时不挂 App，只把输出文本
// 放进页面；没有 command 参数时行为与以前完全一样。
const starterCommand = parseStarterCommandLine(window.location.search)
if (starterCommand) {
  void runApplicationStarter(starterCommand.command, starterCommand.args).then(result => {
    const output = document.createElement('pre')
    output.id = 'starter-output'
    output.textContent = result.error ? `${result.error}\n` : result.output
    document.body.appendChild(output)
  })
} else {
  // 「忽略的文件与目录」要在任何界面挂起来之前灌进文件类型注册表：上游那张表是
  // `FileTypeManagerImpl` 的组件字段（`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:165`
  // `new IgnoredPatternSet(DEFAULT_IGNORED)`，默认表同文件 `:142`），存过的那份在 loadState
  // 里直接 `ignoredPatterns.setIgnoreMasks(...)`（同文件 `:1236-1238`），不是某个设置页的副作用。
  // 订正（2026-10-06 复核 docs/wiring-requests-2026-10-06-bucket15.md W3）：原写「:1363-1364」，
  // 那几行实际是 `setFileTypes` 里的 `readHashBangs`，指不到忽略清单 ⇒ 坐标改成 :165 + :1236-1238。
  // 另一处订正：请求给的代码是 `applyIgnoredPatterns(loadIgnoredPatterns())`，但
  // `loadIgnoredPatterns()` 自己已经 `applyToManager`（src/fileTypeIgnoredList.ts:226-230），
  // 再套一层只会多写一次 localStorage ⇒ 只调 loadIgnoredPatterns()。
  loadIgnoredPatterns()
  // 插件 API 面先装配：把 EP 与服务登记进宿主，App 挂起来之前就绪（插件按 FQN 取服务的那一刻
  // 拿得到）。宿主侧的实时数据源（打开的标签 / 最近文件 / 储藏）由 App 装配后再覆盖注册，
  // `installPluginApi` 对同 id 是覆盖语义，重复调用安全。
  installPluginApi()
  // 界面挂不起来时不要留一片白窗：上游 `StartupErrorReporter.processException`
  // （platform/platform-impl/.../bootstrap/StartupErrorReporter.java:353-409）就是为这件事存在的，
  // 落点见 src/platformIdeStartupFailure.ts。
  try { createApp(App).mount('#app') } catch (error) { showStartupFailure(error) }
}
